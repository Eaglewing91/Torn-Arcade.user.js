// Torn Arcade server: sign-in with a Torn ID, accounts and the global leaderboard.
// Plain Node http, no framework. Every reply is JSON. Bodies over 8 KB are refused.
'use strict';
const http = require('http');
const crypto = require('crypto');
const db = require('./db');
const torn = require('./torn');
const tt = require('./territories');
const chess = require('./chess');
const trades = require('./trades');
const saves = require('./saves');

const PORT = Number(process.env.PORT) || 8080;
const VERSION = '1.6.0';
// The 2.40 fresh start: scores and cloud saves for every game except Tornies must come from Torn Arcade 2.40.0 or later
// (older copies still hold the scores from before the reset).
const MIN_SCRIPT = [2, 40, 0];
function newEnough(req) { const v = String(req.headers['x-arcade-version'] || '').split('.').map(Number); for (let i = 0; i < 3; i++) { if ((v[i] || 0) !== MIN_SCRIPT[i]) return (v[i] || 0) > MIN_SCRIPT[i]; } return true; }
const GAMES = ['territories', 'territories:fp12', 'territories:fp16', 'chess'];   // rated games, played on the server (Classic, Flight Paths to 12, to 16)
// Best-score leaderboards. These scores come from players' own devices, so each has limits that throw out
// impossible values. dir: 'desc' = higher is better, 'asc' = lower is better (times).
const BOARDS = {};
['easy', 'normal', 'hard'].forEach(function (d) { BOARDS['flappy:' + d] = { dir: 'desc', min: 1, max: 100000 }; });
BOARDS['bombs:easy'] = { dir: 'asc', min: 1, max: 86400 };
BOARDS['bombs:normal'] = { dir: 'asc', min: 7, max: 86400 };
BOARDS['bombs:hard'] = { dir: 'asc', min: 25, max: 86400 };
BOARDS['eggdash:endless'] = { dir: 'desc', min: 1, max: 100000000 };
BOARDS['bogies:total'] = { dir: 'desc', min: 1, max: 100000000 };
for (let i = 1; i <= 6; i++) BOARDS['defence:' + i] = { dir: 'desc', min: 1, max: 30 };   // 30 waves since 2.40
BOARDS['tornies:caught'] = { dir: 'desc', min: 1, max: 179 };
BOARDS['tornies:medals'] = { dir: 'desc', min: 1, max: 8 };
BOARDS['invasion:standard'] = { dir: 'desc', min: 1, max: 100000000 };
const ORIGINS = ['https://www.torn.com', 'https://torn.com'];

/* ---------- Rate limits: per IP, in memory (one server instance) ---------- */
const buckets = new Map();
function limited(ip, kind, max, perMs) {
  const k = kind + '|' + ip, now = Date.now();
  let b = buckets.get(k);
  if (!b || now - b.t > perMs) { b = { t: now, n: 0 }; buckets.set(k, b); }
  b.n++;
  return b.n > max;
}
setInterval(function () { const now = Date.now(); buckets.forEach(function (b, k) { if (now - b.t > 15 * 60000) buckets.delete(k); }); }, 60000).unref();

/* ---------- Helpers ---------- */
function ipOf(req) { return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(); }
function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Arcade-Server': VERSION });
  res.end(JSON.stringify(body));
}
function fail(res, code, error, message) { send(res, code, { error: error, message: message }); }
function readBody(req, max) {
  return new Promise(function (resolve, reject) {
    let size = 0; const parts = [];
    const lim = max || 8192;   // a body a little too big is read and refused politely; a far bigger one is cut off
    req.on('data', function (c) { size += c.length; if (size > lim * 4) { reject(new Error('too_big')); req.destroy(); } else if (size <= lim) parts.push(c); });
    req.on('end', function () {
      if (size > lim) return reject(new Error('too_big'));
      if (!parts.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8'))); } catch (e) { reject(new Error('bad_json')); }
    });
    req.on('error', reject);
  });
}
const hashToken = function (t) { return crypto.createHash('sha256').update(t).digest(); };
async function newToken(accountId) {
  const t = crypto.randomBytes(32).toString('base64url');
  await db.q('INSERT INTO tokens (hash, account_id) VALUES ($1, $2)', [hashToken(t), accountId]);
  return t;
}
async function whoAsks(req) {   // the signed-in account, or null
  const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(req.headers.authorization || '');
  if (!m) return null;
  const r = await db.q('UPDATE tokens SET last_used = now() WHERE hash = $1 RETURNING account_id', [hashToken(m[1])]);
  if (!r.rows.length) return null;
  const a = await db.q('UPDATE accounts SET last_seen = now() WHERE id = $1 RETURNING id, torn_id, name, verified, banned', [r.rows[0].account_id]);
  return a.rows[0] || null;
}
function pub(a) { return { id: Number(a.id), tornId: a.torn_id, name: a.name, verified: a.verified }; }

/* ---------- Routes ---------- */
async function route(req, res, url) {
  const ip = ipOf(req), path = url.pathname, method = req.method;
  if (path === '/health') {
    let ok = true; try { await db.q('SELECT 1'); } catch (e) { ok = false; }
    return send(res, ok ? 200 : 503, { ok: ok, version: VERSION });
  }
  if (limited(ip, 'all', 240, 60000)) return fail(res, 429, 'slow_down', 'Too many requests. Wait a minute.');

  // Sign in with a Torn API key. The key is checked with api.torn.com once, then forgotten.
  if (path === '/v1/auth/torn' && method === 'POST') {
    if (limited(ip, 'verify', 10, 10 * 60000)) return fail(res, 429, 'slow_down', 'Too many sign-in attempts. Wait ten minutes.');
    const body = await readBody(req);
    const who = await torn.whoIs(body.key);
    if (who.error) return fail(res, who.error === 'bad_key' ? 400 : 502, who.error, who.message);
    const me = await whoAsks(req);
    let acc = (await db.q('SELECT * FROM accounts WHERE torn_id = $1', [who.id])).rows[0];
    if (acc) acc = (await db.q('UPDATE accounts SET name = $2, verified = TRUE, last_seen = now() WHERE id = $1 RETURNING *', [acc.id, who.name])).rows[0];
    else if (me && !me.verified) acc = (await db.q('UPDATE accounts SET torn_id = $2, name = $3, verified = TRUE WHERE id = $1 RETURNING *', [me.id, who.id, who.name])).rows[0];   // a guest becomes verified
    else acc = (await db.q('INSERT INTO accounts (torn_id, name, verified) VALUES ($1, $2, TRUE) RETURNING *', [who.id, who.name])).rows[0];
    if (acc.banned) return fail(res, 403, 'banned', 'This account can\'t play online.');
    return send(res, 200, { token: await newToken(acc.id), account: pub(acc) });
  }
  // A guest account: no key, not on the leaderboard.
  if (path === '/v1/auth/guest' && method === 'POST') {
    if (limited(ip, 'guest', 5, 60 * 60000)) return fail(res, 429, 'slow_down', 'Too many new accounts from here. Try again later.');
    const name = 'Guest-' + crypto.randomInt(1000, 10000);
    const acc = (await db.q('INSERT INTO accounts (name) VALUES ($1) RETURNING *', [name])).rows[0];
    return send(res, 200, { token: await newToken(acc.id), account: pub(acc) });
  }
  // Best-score leaderboards (verified players only).
  let m;
  if ((m = /^\/v1\/leaderboard\/([a-z]+:[a-z0-9]+)$/.exec(path)) && method === 'GET' && GAMES.indexOf(m[1]) < 0) {
    const B = BOARDS[m[1]];
    if (!B) return fail(res, 404, 'no_game', 'Unknown leaderboard.');
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || 50)), ord = B.dir === 'asc' ? 'ASC' : 'DESC';
    const rows = (await db.q(
      'SELECT a.name, a.torn_id, s.value FROM scores s JOIN accounts a ON a.id = s.account_id ' +
      'WHERE s.board = $1 AND a.verified AND NOT a.banned ORDER BY s.value ' + ord + ', s.updated_at, a.id LIMIT $2', [m[1], limit])).rows;
    const out = { board: m[1], dir: B.dir, players: rows.map(function (r, i) { return { rank: i + 1, name: r.name, tornId: r.torn_id, value: Number(r.value) }; }) };
    const me = await whoAsks(req);
    if (me) {
      const mine = (await db.q('SELECT value FROM scores WHERE account_id = $1 AND board = $2', [me.id, m[1]])).rows[0];
      if (mine && me.verified) {
        const better = (await db.q('SELECT count(*)::int AS n FROM scores s JOIN accounts a ON a.id = s.account_id WHERE s.board = $1 AND a.verified AND NOT a.banned AND s.value ' + (B.dir === 'asc' ? '<' : '>') + ' $2', [m[1], mine.value])).rows[0].n;
        out.me = { rank: better + 1, value: Number(mine.value) };
      } else out.me = { rank: null, value: null };
    }
    return send(res, 200, out);
  }
  // Send your best scores: keeps whichever is better, yours or the one already saved. Verified players only.
  if (path === '/v1/scores' && method === 'POST' && !newEnough(req)) return fail(res, 426, 'update', 'Update Torn Arcade to send scores to the new leaderboards.');
  if (path === '/v1/scores' && method === 'POST') {
    if (limited(ip, 'scores', 30, 60000)) return fail(res, 429, 'slow_down', 'Too many score updates. Wait a minute.');
    const me = await whoAsks(req);
    if (!me) return fail(res, 401, 'signed_out', 'Sign in to play online.');
    if (me.banned) return fail(res, 403, 'banned', 'This account can\'t play online.');
    if (!me.verified) return fail(res, 403, 'verify_first', 'Verify your Torn ID to join the global leaderboards.');
    const body = await readBody(req), sc = body && body.scores;
    if (!sc || typeof sc !== 'object' || Array.isArray(sc) || Object.keys(sc).length > 40) return fail(res, 400, 'bad_scores', 'Bad request.');
    let saved = 0; const rejected = [];
    for (const k of Object.keys(sc)) {
      const B = BOARDS[k], v = Number(sc[k]);
      if (!B || !Number.isFinite(v) || v < B.min || v > B.max || Math.floor(v) !== v) { rejected.push(k); continue; }
      await db.q('INSERT INTO scores (account_id, board, value) VALUES ($1, $2, $3) ON CONFLICT (account_id, board) DO UPDATE SET value = ' +
        (B.dir === 'asc' ? 'LEAST' : 'GREATEST') + '(scores.value, EXCLUDED.value), updated_at = CASE WHEN EXCLUDED.value ' + (B.dir === 'asc' ? '<' : '>') + ' scores.value THEN now() ELSE scores.updated_at END', [me.id, k, v]);
      saved++;
    }
    return send(res, 200, { saved: saved, rejected: rejected });
  }
  // The rated leaderboard (verified players only).
  if ((m = /^\/v1\/leaderboard\/([a-z]+(?::fp1[26])?)$/.exec(path)) && method === 'GET') {
    if (GAMES.indexOf(m[1]) < 0) return fail(res, 404, 'no_game', 'Unknown game.');
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || 50));
    const rows = (await db.q(
      'SELECT a.name, a.torn_id, r.rating, r.games, r.wins FROM ratings r JOIN accounts a ON a.id = r.account_id ' +
      'WHERE r.game = $1 AND a.verified AND NOT a.banned AND r.games > 0 ORDER BY r.rating DESC, r.wins DESC, a.id LIMIT $2', [m[1], limit])).rows;
    const out = { game: m[1], players: rows.map(function (r, i) { return { rank: i + 1, name: r.name, tornId: r.torn_id, rating: r.rating, games: r.games, wins: r.wins }; }) };
    const me = await whoAsks(req);
    if (me) {
      const mine = (await db.q('SELECT rating, games, wins FROM ratings WHERE account_id = $1 AND game = $2', [me.id, m[1]])).rows[0];
      if (mine && mine.games > 0 && me.verified) {
        const above = (await db.q('SELECT count(*)::int AS n FROM ratings r JOIN accounts a ON a.id = r.account_id WHERE r.game = $1 AND a.verified AND NOT a.banned AND r.games > 0 AND r.rating > $2', [m[1], mine.rating])).rows[0].n;
        out.me = { rank: above + 1, rating: mine.rating, games: mine.games, wins: mine.wins };
      } else out.me = { rank: null, rating: mine ? mine.rating : 1200, games: mine ? mine.games : 0, wins: mine ? mine.wins : 0 };
    }
    return send(res, 200, out);
  }
  // Online Territories, Tornie trades and the phone's notifications.
  const ctx = { whoAsks: whoAsks, send: send, fail: fail, readBody: readBody, limited: limited, ip: ip };
  if (path.indexOf('/v1/tt/') === 0) return tt.route(req, res, url, ctx);
  if (path.indexOf('/v1/chess/') === 0) return chess.route(req, res, url, ctx);
  if (path === '/v1/trades' || path.indexOf('/v1/trades/') === 0) return trades.route(req, res, url, ctx);
  if (method === 'PUT' && path.indexOf('/v1/saves/') === 0 && path !== '/v1/saves/tornies' && !newEnough(req)) return fail(res, 426, 'update', 'Update Torn Arcade to keep using cloud saves.');
  if (path === '/v1/saves' || path.indexOf('/v1/saves/') === 0) return saves.route(req, res, url, ctx);
  if (path === '/v1/inbox' && method === 'GET') {
    const who = await whoAsks(req);
    if (!who) return fail(res, 401, 'signed_out', 'Sign in to play online.');
    if (!who.verified || who.banned) return send(res, 200, { invites: [], turns: [], trades: [] });
    const box = await tt.inbox(who), cb = chess.inbox(who);
    box.invites = box.invites.concat(cb.invites); box.turns = box.turns.concat(cb.turns);   // Territories and Chess (game: 'chess')
    box.trades = await trades.waiting(who);
    return send(res, 200, box);
  }
  // Everything below needs a signed-in account.
  const me = await whoAsks(req);
  if (!me) return fail(res, 401, 'signed_out', 'Sign in to play online.');
  if (me.banned) return fail(res, 403, 'banned', 'This account can\'t play online.');
  if (path === '/v1/me' && method === 'GET') return send(res, 200, { account: pub(me) });
  if (path === '/v1/auth/logout' && method === 'POST') {
    const t = /^Bearer (.+)$/.exec(req.headers.authorization)[1];
    await db.q('DELETE FROM tokens WHERE hash = $1', [hashToken(t)]);
    return send(res, 200, { ok: true });
  }
  if (path === '/v1/me' && method === 'DELETE') {   // wipes the account, its sign-ins and its ratings
    tt.forget(me.id); chess.forget(me.id);
    await db.q('DELETE FROM accounts WHERE id = $1', [me.id]);
    return send(res, 200, { ok: true, deleted: true });
  }
  return fail(res, 404, 'not_found', 'Not found.');
}

// One-time jobs, each recorded so it never runs twice.
async function freshStart() {
  await db.q('CREATE TABLE IF NOT EXISTS server_jobs (name TEXT PRIMARY KEY, done_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  if ((await db.q("SELECT 1 FROM server_jobs WHERE name = 'fresh-start-2.40'")).rows.length) return;
  // 2.40 fresh start: wipe every leaderboard except Tornies, the Territories ratings, and cloud saves of the reset games.
  await db.q("DELETE FROM scores WHERE board NOT LIKE 'tornies:%'");
  await db.q("DELETE FROM ratings WHERE game = 'territories'");
  await db.q("CREATE TABLE IF NOT EXISTS cloud_saves (account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, slot TEXT NOT NULL, data TEXT NOT NULL, ver INTEGER NOT NULL, size INTEGER NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (account_id, slot))");
  await db.q("DELETE FROM cloud_saves WHERE slot <> 'tornies'");
  await db.q("INSERT INTO server_jobs (name) VALUES ('fresh-start-2.40')");
  console.log('fresh start 2.40 done');
}

const server = http.createServer(function (req, res) {
  const origin = req.headers.origin;
  if (origin && ORIGINS.indexOf(origin) >= 0) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Arcade-Version');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  let url;
  try { url = new URL(req.url, 'http://x'); } catch (e) { return fail(res, 400, 'bad_url', 'Bad request.'); }
  route(req, res, url).catch(function (e) {
    if (e.message === 'too_big') return fail(res, 413, 'too_big', 'Request too large.');
    if (e.message === 'bad_json') return fail(res, 400, 'bad_json', 'Bad request.');
    console.error('error', req.method, url.pathname, e.message);
    if (!res.headersSent) fail(res, 500, 'server_error', 'Something went wrong on the server.');
  });
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;

db.migrate().then(function () { return tt.migrate(); }).then(function () { return chess.migrate(); }).then(freshStart).then(function () { return trades.migrate(); }).then(function () { return saves.migrate(); }).then(function () {
  tt.start(); chess.start();
  server.listen(PORT, function () { console.log('Torn Arcade server ' + VERSION + ' on port ' + PORT); });
}).catch(function (e) { console.error('database setup failed', e.message); process.exit(1); });

function stop() { server.close(function () { db.pool.end().then(function () { process.exit(0); }); }); setTimeout(function () { process.exit(0); }, 5000).unref(); }
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
