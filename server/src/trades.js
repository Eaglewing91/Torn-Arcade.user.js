// Safe Tornie trades. The server is the middleman: each side's Tornie (a signed Tornie trade code made by the game)
// is held here until both players have seen both Tornies and pressed Confirm. Then each can collect the other's.
// If either player cancels before that, each collects their own Tornie back. Nobody can receive a Tornie without
// their own being handed over at the same moment, and each Tornie can be collected once.
'use strict';
const db = require('./db');

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
`;
async function migrate() { await db.q(SCHEMA); }

const okCode = function (c) { return typeof c === 'string' && /^TORNIE-[A-Za-z0-9_-]{30,400}$/.test(c); };
const EXPIRE = "UPDATE tornie_trades SET status = 'cancelled', updated_at = now() WHERE status = 'open' AND updated_at < now() - interval '3 days'";

// What one player sees of a trade: which side they're on, both offers, both confirmations, and what to collect.
function viewOf(t, me) {
  const side = Number(t.a) === Number(me.id) ? 'a' : 'b', other = side === 'a' ? 'b' : 'a';
  const collect = t.status === 'done' ? t[other + '_offer'] : t.status === 'cancelled' ? t[side + '_offer'] : null;
  return {
    id: Number(t.id), side: side, status: t.status,
    with: side === 'a' ? { name: t.b_name || '[' + t.b_tid + ']', tornId: t.b_tid } : { name: t.a_name, tornId: t.a_tid },
    mine: t[side + '_offer'], theirs: t[other + '_offer'], myOk: t[side + '_ok'], theirOk: t[other + '_ok'],
    collect: collect && !t[side + '_got'] ? collect : null, at: t.updated_at
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
  if (path === '/v1/trades' && method === 'GET') return c.send(res, 200, { trades: await mine(me) });
  if (path === '/v1/trades' && method === 'POST') {
    if (c.limited(c.ip, 'trnew', 10, 10 * 60000)) return c.fail(res, 429, 'slow_down', 'Too many new trades. Wait a few minutes.');
    const b = await c.readBody(req), to = Number(b.to);
    if (!(to > 0 && to < 1e8) || to === me.torn_id) return c.fail(res, 400, 'bad_player', 'Enter another player\'s Torn ID.');
    if (!okCode(b.offer)) return c.fail(res, 400, 'bad_offer', 'That Tornie couldn\'t be packed for trading.');
    const open = (await db.q("SELECT count(*)::int AS n FROM tornie_trades WHERE a = $1 AND status = 'open'", [me.id])).rows[0].n;
    if (open >= 5) return c.fail(res, 400, 'too_many', 'You already have 5 open trades. Finish or cancel one first.');
    const t = (await db.q('INSERT INTO tornie_trades (a, a_tid, a_name, b_tid, a_offer) VALUES ($1, $2, $3, $4, $5) RETURNING *', [me.id, me.torn_id, me.name, to, b.offer])).rows[0];
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
    r = await db.q("UPDATE tornie_trades SET b = $2, b_name = $3, b_offer = $4, a_ok = FALSE, b_ok = FALSE, updated_at = now() WHERE id = $1 AND status = 'open' AND b_offer IS NULL RETURNING *", [t.id, me.id, me.name, b.offer]);
    if (!r.rows.length) return c.fail(res, 400, 'not_now', 'This trade already has your Tornie, or it has finished.');
  } else if (m[2] === 'confirm') {
    r = await db.q('UPDATE tornie_trades SET ' + side + "_ok = TRUE, updated_at = now() WHERE id = $1 AND status = 'open' AND a_offer IS NOT NULL AND b_offer IS NOT NULL RETURNING *", [t.id]);
    if (!r.rows.length) return c.fail(res, 400, 'not_now', 'Both Tornies need to be in the trade before you can confirm.');
    // both confirmed: the swap happens in one step
    const d = await db.q("UPDATE tornie_trades SET status = 'done', updated_at = now() WHERE id = $1 AND status = 'open' AND a_ok AND b_ok RETURNING *", [t.id]);
    if (d.rows.length) r = d;
  } else if (m[2] === 'cancel') {
    r = await db.q("UPDATE tornie_trades SET status = 'cancelled', updated_at = now() WHERE id = $1 AND status = 'open' RETURNING *", [t.id]);
    if (!r.rows.length) return c.fail(res, 400, 'not_now', 'This trade has already finished.');
  } else {   // collect: the phone has added the Tornie to the save and tells the server it's done
    r = await db.q('UPDATE tornie_trades SET ' + side + "_got = TRUE, updated_at = now() WHERE id = $1 AND status <> 'open' RETURNING *", [t.id]);
    if (!r.rows.length) return c.fail(res, 400, 'not_now', 'Nothing to collect yet.');
  }
  return c.send(res, 200, { trade: viewOf(r.rows[0], me) });
}

module.exports = { migrate: migrate, route: route, waiting: waiting };
