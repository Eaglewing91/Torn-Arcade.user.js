// Safe Tornie trades. The server is the middleman: each side's Tornie (a signed Tornie trade code made by the game)
// is held here until both players have seen both Tornies and pressed Confirm. Then each can collect the other's.
// If either player cancels before that, each collects their own Tornie back. Nobody can receive a Tornie without
// their own being handed over at the same moment, and each Tornie can be collected once.
'use strict';
const db = require('./db');
const code = require('./tornie-code');
const ADMINS = String(process.env.ADMIN_IDS || '571041').split(',').map(Number);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tornie_trades (
  id          BIGSERIAL PRIMARY KEY,
  a           BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,   -- started the trade
  a_tid       INTEGER NOT NULL,
  a_name      TEXT NOT NULL,
  b_tid       INTEGER NOT NULL,                                            -- invited by Torn ID
  b           BIGINT REFERENCES accounts(id) ON DELETE CASCADE,
  b_name      TEXT,
  a_offer     TEXT,
  b_offer     TEXT,
  a_ok        BOOLEAN NOT NULL DEFAULT FALSE,
  b_ok        BOOLEAN NOT NULL DEFAULT FALSE,
  status      TEXT NOT NULL DEFAULT 'open',                                -- open, done, cancelled
  a_got       BOOLEAN NOT NULL DEFAULT FALSE,
  b_got       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tornie_trades_a ON tornie_trades(a);
CREATE INDEX IF NOT EXISTS tornie_trades_b ON tornie_trades(b_tid);
ALTER TABLE tornie_trades ADD COLUMN IF NOT EXISTS a_uid TEXT;
ALTER TABLE tornie_trades ADD COLUMN IF NOT EXISTS b_uid TEXT;
-- Anti-cheat. Every Tornie that goes into a trade is recorded with its owner (by Torn ID) and its stats. A Tornie can
-- only be offered by its current owner, never while it's in another trade, and never with different stats, so a
-- Tornie copied by restoring an old save can't be traded again. These records outlive account deletion.
CREATE TABLE IF NOT EXISTS tornie_ids (
  uid         TEXT PRIMARY KEY,
  owner       INTEGER NOT NULL,                 -- Torn ID
  sp          INTEGER NOT NULL,
  lv          INTEGER NOT NULL,
  golden      BOOLEAN NOT NULL DEFAULT FALSE,
  ivs         BIGINT NOT NULL,
  trade_id    BIGINT,                           -- the open trade it's in, if any
  trades      INTEGER NOT NULL DEFAULT 0,
  revoked     TEXT,                             -- reason, when the developer has stopped it trading
  first_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tornie_ids_owner ON tornie_ids(owner);
CREATE INDEX IF NOT EXISTS tornie_ids_trade ON tornie_ids(trade_id);
CREATE TABLE IF NOT EXISTS trade_flags (
  id          BIGSERIAL PRIMARY KEY,
  torn_id     INTEGER NOT NULL,
  name        TEXT,
  uid         TEXT,
  reason      TEXT NOT NULL,                    -- not_owner, in_trade, changed, revoked
  detail      TEXT,
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trade_flags_tid ON trade_flags(torn_id);
CREATE TABLE IF NOT EXISTS trade_bans (
  torn_id     INTEGER PRIMARY KEY,
  reason      TEXT,
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;
async function migrate() { await db.q(SCHEMA); }

const okCode = function (c) { return typeof c === 'string' && /^TORNIE-[A-Za-z0-9_-]{30,400}$/.test(c); };
const okUid = function (u) { return typeof u === 'string' && /^[a-z0-9-]{6,40}$/.test(u); };
const EXPIRE = "UPDATE tornie_trades SET status = 'cancelled', updated_at = now() WHERE status = 'open' AND updated_at < now() - interval '3 days'";
const PENDING = -1;   // a Tornie being put into a trade that hasn't been written yet

async function flag(me, uid, reason, detail) {
  await db.q('INSERT INTO trade_flags (torn_id, name, uid, reason, detail) VALUES ($1, $2, $3, $4, $5)', [me.torn_id, me.name, uid || null, reason, detail || null]);
}
async function tradeBanned(tid) { return (await db.q('SELECT 1 FROM trade_bans WHERE torn_id = $1', [tid])).rows.length > 0; }
// Puts a Tornie on hold for a trade. Returns null when it may go in, or a message for the player.
async function hold(me, uid, offer) {
  const d = code.decode(offer);
  if (!d) return 'That Tornie couldn\'t be packed for trading.';
  await db.q('INSERT INTO tornie_ids (uid, owner, sp, lv, golden, ivs) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (uid) DO NOTHING', [uid, me.torn_id, d.sp, d.lv, d.golden, d.ivs]);
  const t = (await db.q('SELECT * FROM tornie_ids WHERE uid = $1', [uid])).rows[0];
  if (t.revoked) { await flag(me, uid, 'revoked', t.revoked); return 'This Tornie can\'t be traded.'; }
  if (t.owner !== me.torn_id) { await flag(me, uid, 'not_owner', 'owned by ' + t.owner); return 'This Tornie has already been traded to another player, so it can\'t be traded again.'; }
  if (Number(t.ivs) !== d.ivs || t.golden !== d.golden) { await flag(me, uid, 'changed', 'stats changed since it was last traded'); return 'This Tornie\'s details don\'t match the last time it was traded, so it can\'t be traded.'; }
  const r = await db.q('UPDATE tornie_ids SET trade_id = $2, sp = $3, lv = $4, updated_at = now() WHERE uid = $1 AND (trade_id IS NULL OR ' +
    // a hold left behind by a request that never finished, or a trade that no longer exists or is over
    "(trade_id = -1 AND updated_at < now() - interval '1 minute') OR (trade_id > 0 AND NOT EXISTS (SELECT 1 FROM tornie_trades x WHERE x.id = tornie_ids.trade_id AND x.status = 'open'))) RETURNING uid", [uid, PENDING, d.sp, d.lv]);
  if (!r.rows.length) { await flag(me, uid, 'in_trade', 'offered while already in trade ' + t.trade_id); return 'This Tornie is already in another trade.'; }
  return null;
}
function unhold(uid, tradeId) { return db.q('UPDATE tornie_ids SET trade_id = $2 WHERE uid = $1 AND trade_id = $3', [uid, tradeId, PENDING]); }

// What one player sees of a trade: which side they're on, both offers, both confirmations, and what to collect.
function viewOf(t, me) {
  const side = Number(t.a) === Number(me.id) ? 'a' : 'b', other = side === 'a' ? 'b' : 'a';
  const collect = t.status === 'done' ? t[other + '_offer'] : t.status === 'cancelled' ? t[side + '_offer'] : null;
  const collectUid = t.status === 'done' ? t[other + '_uid'] : t.status === 'cancelled' ? t[side + '_uid'] : null;
  return {
    id: Number(t.id), side: side, status: t.status,
    with: side === 'a' ? { name: t.b_name || '[' + t.b_tid + ']', tornId: t.b_tid } : { name: t.a_name, tornId: t.a_tid },
    mine: t[side + '_offer'], theirs: t[other + '_offer'], myOk: t[side + '_ok'], theirOk: t[other + '_ok'],
    collect: collect && !t[side + '_got'] ? collect : null, collectUid: collect && !t[side + '_got'] ? collectUid || null : null, at: t.updated_at
  };
}
async function mine(me) {
  await db.q(EXPIRE);
  const rows = (await db.q('SELECT * FROM tornie_trades WHERE (a = $1 AND NOT (status <> \'open\' AND a_got)) OR (b_tid = $2 AND NOT (status <> \'open\' AND (b_got OR b_offer IS NULL))) ORDER BY id DESC LIMIT 20', [me.id, me.torn_id])).rows;
  return rows.map(function (t) { return viewOf(t, me); }).filter(function (v) { return v.status === 'open' || v.collect; });
}
// For phone notifications: trades waiting on you (a new offer to you, or the other side offered or confirmed).
async function waiting(me) {
  const list = await mine(me);
  return list.filter(function (v) { return v.collect || (v.status === 'open' && ((v.side === 'b' && !v.mine) || (v.theirs && !v.myOk))); }).map(function (v) { return { id: v.id, with: v.with, collect: !!v.collect }; });
}

async function route(req, res, url, c) {
  const me = await c.whoAsks(req);
  if (!me) return c.fail(res, 401, 'signed_out', 'Sign in to trade online.');
  if (me.banned) return c.fail(res, 403, 'banned', 'This account can\'t trade online.');
  if (!me.verified) return c.fail(res, 403, 'verify_first', 'Verify your Torn ID to trade online.');
  const path = url.pathname, method = req.method;
  if (path.indexOf('/v1/admin/') === 0) return admin(req, res, url, c, me);
  if (path === '/v1/trades' && method === 'GET') return c.send(res, 200, { trades: await mine(me) });
  if (path === '/v1/trades' && method === 'POST') {
    if (c.limited(c.ip, 'trnew', Number(process.env.TRADE_NEW_MAX) || 10, 10 * 60000)) return c.fail(res, 429, 'slow_down', 'Too many new trades. Wait a few minutes.');
    const b = await c.readBody(req), to = Number(b.to);
    if (!(to > 0 && to < 1e8) || to === me.torn_id) return c.fail(res, 400, 'bad_player', 'Enter another player\'s Torn ID.');
    if (!okCode(b.offer)) return c.fail(res, 400, 'bad_offer', 'That Tornie couldn\'t be packed for trading.');
    if (!okUid(b.uid)) return c.fail(res, 426, 'update', 'Update Torn Arcade to trade online.');
    if (await tradeBanned(me.torn_id)) return c.fail(res, 403, 'trade_banned', 'This account can\'t trade Tornies.');
    if (await tradeBanned(to)) return c.fail(res, 400, 'bad_player', 'That player can\'t trade Tornies.');
    const open = (await db.q("SELECT count(*)::int AS n FROM tornie_trades WHERE a = $1 AND status = 'open'", [me.id])).rows[0].n;
    if (open >= 5) return c.fail(res, 400, 'too_many', 'You already have 5 open trades. Finish or cancel one first.');
    const no = await hold(me, b.uid, b.offer);
    if (no) return c.fail(res, 400, 'not_tradeable', no);
    const known = (await db.q('SELECT name FROM accounts WHERE torn_id = $1 AND verified', [to])).rows[0];   // their name, if they've played online
    let t;
    try { t = (await db.q('INSERT INTO tornie_trades (a, a_tid, a_name, b_tid, b_name, a_offer, a_uid) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *', [me.id, me.torn_id, me.name, to, known ? known.name : null, b.offer, b.uid])).rows[0]; }
    catch (e) { await unhold(b.uid, null); throw e; }
    await unhold(b.uid, t.id);
    return c.send(res, 200, { trade: viewOf(t, me) });
  }
  const m = /^\/v1\/trades\/(\d+)\/(offer|confirm|cancel|collect)$/.exec(path);
  if (!m || method !== 'POST') return c.fail(res, 404, 'not_found', 'Not found.');
  const t = (await db.q('SELECT * FROM tornie_trades WHERE id = $1', [Number(m[1])])).rows[0];
  if (!t || !(Number(t.a) === Number(me.id) || t.b_tid === me.torn_id)) return c.fail(res, 404, 'no_trade', 'Trade not found.');
  const side = Number(t.a) === Number(me.id) ? 'a' : 'b', other = side === 'a' ? 'b' : 'a';
  const b = await c.readBody(req);
  let r;
  if (m[2] === 'offer') {   // the invited player puts their Tornie in; offers can't be swapped afterwards (cancel instead)
    if (side !== 'b' || !okCode(b.offer)) return c.fail(res, 400, 'bad_offer', 'That Tornie couldn\'t be packed for trading.');
    if (!okUid(b.uid)) return c.fail(res, 426, 'update', 'Update Torn Arcade to trade online.');
    if (await tradeBanned(me.torn_id)) return c.fail(res, 403, 'trade_banned', 'This account can\'t trade Tornies.');
    if (t.status !== 'open' || t.b_offer) return c.fail(res, 400, 'not_now', 'This trade already has your Tornie, or it has finished.');
    const no = await hold(me, b.uid, b.offer);
    if (no) return c.fail(res, 400, 'not_tradeable', no);
    r = await db.q("UPDATE tornie_trades SET b = $2, b_name = $3, b_offer = $4, b_uid = $5, a_ok = FALSE, b_ok = FALSE, updated_at = now() WHERE id = $1 AND status = 'open' AND b_offer IS NULL RETURNING *", [t.id, me.id, me.name, b.offer, b.uid]);
    if (!r.rows.length) { await unhold(b.uid, null); return c.fail(res, 400, 'not_now', 'This trade already has your Tornie, or it has finished.'); }
    await unhold(b.uid, t.id);
  } else if (m[2] === 'confirm') {
    if (await tradeBanned(me.torn_id) || await tradeBanned(side === 'a' ? t.b_tid : t.a_tid)) return c.fail(res, 403, 'trade_banned', 'This trade can\'t go ahead. Cancel it to get your Tornie back.');
    const rv = (await db.q('SELECT uid FROM tornie_ids WHERE trade_id = $1 AND revoked IS NOT NULL', [t.id])).rows;
    if (rv.length) return c.fail(res, 403, 'not_tradeable', 'A Tornie in this trade can\'t be traded. Cancel it to get your Tornie back.');
    r = await db.q('UPDATE tornie_trades SET ' + side + "_ok = TRUE, updated_at = now() WHERE id = $1 AND status = 'open' AND a_offer IS NOT NULL AND b_offer IS NOT NULL RETURNING *", [t.id]);
    if (!r.rows.length) return c.fail(res, 400, 'not_now', 'Both Tornies need to be in the trade before you can confirm.');
    // both confirmed: the swap happens in one step
    const d = await db.q("UPDATE tornie_trades SET status = 'done', updated_at = now() WHERE id = $1 AND status = 'open' AND a_ok AND b_ok RETURNING *", [t.id]);
    if (d.rows.length) {   // ownership changes hands with the swap
      r = d;
      await db.q('UPDATE tornie_ids SET owner = CASE WHEN uid = $2 THEN $4::int ELSE $3::int END, trade_id = NULL, trades = trades + 1, updated_at = now() WHERE trade_id = $1', [t.id, t.a_uid, t.a_tid, t.b_tid]);
    }
  } else if (m[2] === 'cancel') {
    r = await db.q("UPDATE tornie_trades SET status = 'cancelled', updated_at = now() WHERE id = $1 AND status = 'open' RETURNING *", [t.id]);
    if (!r.rows.length) return c.fail(res, 400, 'not_now', 'This trade has already finished.');
    await db.q('UPDATE tornie_ids SET trade_id = NULL WHERE trade_id = $1', [t.id]);
  } else {   // collect: the phone has added the Tornie to the save and tells the server it's done
    r = await db.q('UPDATE tornie_trades SET ' + side + "_got = TRUE, updated_at = now() WHERE id = $1 AND status <> 'open' RETURNING *", [t.id]);
    if (!r.rows.length) return c.fail(res, 400, 'not_now', 'Nothing to collect yet.');
  }
  return c.send(res, 200, { trade: viewOf(r.rows[0], me) });
}

// The developer's trade watch (Dev app): the trade log, flags, trade bans and revoking a Tornie.
function tornie(offer, uid) { const d = code.decode(offer); return d ? { uid: uid, sp: d.sp, lv: d.lv, golden: d.golden, nick: d.nick } : (offer ? { uid: uid } : null); }
async function admin(req, res, url, c, me) {
  if (ADMINS.indexOf(me.torn_id) < 0) return c.fail(res, 403, 'not_admin', 'Not allowed.');
  const path = url.pathname, method = req.method, q = url.searchParams, tid = Number(q.get('tid')) || 0;
  const limit = Math.min(200, Math.max(1, Number(q.get('limit')) || 50));
  if (path === '/v1/admin/trades' && method === 'GET') {
    const rows = (await db.q('SELECT * FROM tornie_trades WHERE ($1 = 0 OR a_tid = $1 OR b_tid = $1) ORDER BY id DESC LIMIT $2', [tid, limit])).rows;
    return c.send(res, 200, { trades: rows.map(function (t) {
      return { id: Number(t.id), status: t.status, at: t.updated_at, a: { tornId: t.a_tid, name: t.a_name, tornie: tornie(t.a_offer, t.a_uid) }, b: { tornId: t.b_tid, name: t.b_name, tornie: tornie(t.b_offer, t.b_uid) } };
    }) });
  }
  if (path === '/v1/admin/flags' && method === 'GET') {
    const rows = (await db.q('SELECT * FROM trade_flags WHERE ($1 = 0 OR torn_id = $1) ORDER BY id DESC LIMIT $2', [tid, limit])).rows;
    return c.send(res, 200, { flags: rows.map(function (f) { return { id: Number(f.id), tornId: f.torn_id, name: f.name, uid: f.uid, reason: f.reason, detail: f.detail, at: f.at }; }) });
  }
  if (path === '/v1/admin/bans' && method === 'GET') {
    const bans = (await db.q('SELECT * FROM trade_bans ORDER BY at DESC LIMIT 200')).rows;
    const revoked = (await db.q('SELECT uid, owner, sp, lv, golden, revoked, updated_at FROM tornie_ids WHERE revoked IS NOT NULL ORDER BY updated_at DESC LIMIT 200')).rows;
    return c.send(res, 200, { bans: bans.map(function (b) { return { tornId: b.torn_id, reason: b.reason, at: b.at }; }),
      revoked: revoked.map(function (t) { return { uid: t.uid, owner: t.owner, sp: t.sp, lv: t.lv, golden: t.golden, reason: t.revoked, at: t.updated_at }; }) });
  }
  if (path === '/v1/admin/tornies' && method === 'GET') {
    const uid = q.get('uid') || '';
    const rows = (await db.q('SELECT * FROM tornie_ids WHERE ($1 <> \'\' AND uid = $1) OR ($1 = \'\' AND owner = $2) ORDER BY updated_at DESC LIMIT $3', [uid, tid, limit])).rows;
    return c.send(res, 200, { tornies: rows.map(function (t) { return { uid: t.uid, owner: t.owner, sp: t.sp, lv: t.lv, golden: t.golden, trades: t.trades, inTrade: t.trade_id ? Number(t.trade_id) : null, revoked: t.revoked, firstSeen: t.first_seen }; }) });
  }
  if (method !== 'POST') return c.fail(res, 404, 'not_found', 'Not found.');
  const b = await c.readBody(req), reason = String(b.reason || '').slice(0, 200) || null;
  if (path === '/v1/admin/ban' || path === '/v1/admin/unban') {
    const who = Number(b.tornId);
    if (!(who > 0 && who < 1e8)) return c.fail(res, 400, 'bad_player', 'Enter a Torn ID.');
    if (path === '/v1/admin/ban') await db.q('INSERT INTO trade_bans (torn_id, reason) VALUES ($1, $2) ON CONFLICT (torn_id) DO UPDATE SET reason = $2, at = now()', [who, reason]);
    else await db.q('DELETE FROM trade_bans WHERE torn_id = $1', [who]);
    return c.send(res, 200, { ok: true });
  }
  if (path === '/v1/admin/revoke' || path === '/v1/admin/unrevoke') {
    if (!okUid(b.uid)) return c.fail(res, 400, 'bad_uid', 'Enter a Tornie ID.');
    const r = await db.q('UPDATE tornie_ids SET revoked = $2, updated_at = now() WHERE uid = $1 RETURNING uid', [b.uid, path === '/v1/admin/revoke' ? (reason || 'revoked') : null]);
    if (!r.rows.length) return c.fail(res, 404, 'no_tornie', 'No traded Tornie has that ID.');
    return c.send(res, 200, { ok: true });
  }
  return c.fail(res, 404, 'not_found', 'Not found.');
}

module.exports = { migrate: migrate, route: route, waiting: waiting };
