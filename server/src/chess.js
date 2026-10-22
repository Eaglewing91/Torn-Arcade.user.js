// Online Chess. The server runs every online game with the same rules engine as the phone (chess-engine.js), so it
// checks every move. Verified players only.
// - Games: invite one player by Torn ID, or make a public game anyone can join from the lobby list, or Quick match
//   (joins the oldest public game waiting, or opens one). The game starts as soon as both seats are filled.
// - 30-second timer: if a player doesn't move in time, the computer moves for them, up to 3 times in a game.
//   The 4th time they run out of time they lose the game (on time).
// - Live updates: GET .../:id?v=<version>&wait=1 waits up to 20 seconds for something to change (long polling,
//   plain HTTPS, no websockets).
// - Games between two people change their chess rating (Elo).
'use strict';
const crypto = require('crypto');
const db = require('./db');
const ChessEngine = require('./chess-engine');

const TURN_MS = Number(process.env.CH_TURN_MS) || 45000;   // 45 seconds a move
const STRIKES = 3;                                   // moves the computer may make for a player who ran out of time
const LOBBY_MS = 30 * 60000, PUBLIC_MS = 15 * 60000, KEEP_OVER_MS = 15 * 60000, WAIT_MS = 20000;
const rnd = function () { return crypto.randomInt(0, 2 ** 32) / 2 ** 32; };
const E = ChessEngine({ rnd: rnd });
const live = new Map();   // game id -> { row, waiters, waitSince, dirty, seen }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS chess_games (
  id          BIGSERIAL PRIMARY KEY,
  status      TEXT NOT NULL,                  -- lobby, active, over, cancelled
  host        BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
  public      BOOLEAN NOT NULL DEFAULT FALSE, -- listed in the public lobby
  seats       JSONB NOT NULL,                 -- [white, black]: { acc, tornId, name, st: host|pending|joined|open|declined|left, auto }
  state       JSONB,
  ver         INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chess_games_status ON chess_games(status);
`;
async function migrate() {
  await db.q(SCHEMA);
  (await db.q("SELECT * FROM chess_games WHERE status IN ('lobby', 'active')")).rows.forEach(load);
}
function load(row) { const g = { row: row, waiters: [], waitSince: Date.now(), dirty: false, seen: Date.now() }; live.set(Number(row.id), g); return g; }
async function save(g) {
  g.dirty = false;
  await db.q('UPDATE chess_games SET status = $2, seats = $3, state = $4, ver = $5, public = $6, updated_at = now() WHERE id = $1', [g.row.id, g.row.status, JSON.stringify(g.row.seats), g.row.state ? JSON.stringify(g.row.state) : null, g.row.ver, !!g.row.public]);
}
function bump(g) { g.row.ver++; g.dirty = true; const w = g.waiters; g.waiters = []; w.forEach(function (x) { clearTimeout(x.timer); x.done(); }); }
function seatOf(g, acc) { return g.row.seats.findIndex(function (s) { return s.acc === acc && (s.st === 'host' || s.st === 'joined'); }); }
function colourOf(i) { return i === 0 ? 'w' : 'b'; }
function summary(g, me) {
  const r = g.row, S = r.state;
  const waitingOn = r.status === 'active' && S && !S.result ? (S.turn === 'w' ? 0 : 1) : -1;
  return {
    id: Number(r.id), game: 'chess', status: r.status, public: !!r.public, ver: r.ver, host: (r.seats.find(function (s) { return s.st === 'host'; }) || r.seats[0]).name,
    seats: r.seats.map(function (s) { return { name: s.name, tornId: s.tornId || 0, st: s.st, auto: s.auto || 0 }; }),
    you: me ? seatOf(g, me.id) : -1,
    invited: me ? r.seats.some(function (s) { return s.tornId === me.torn_id && s.st === 'pending'; }) : false,
    waitingOn: waitingOn, left: waitingOn >= 0 ? Math.max(0, g.waitSince + TURN_MS - Date.now()) : 0, strikes: STRIKES,
    result: S ? S.result : null, reason: S ? S.reason : '', moves: S ? S.moves.length : 0, rated: !!(S && S.rated)
  };
}

/* ---------- The clock: 45 seconds a move; the computer covers up to 3 timeouts, the 4th loses ---------- */
function step(g, now) {
  const r = g.row, S = r.state;
  if (r.status !== 'active' || !S) return;
  if (S.result) { finish(g); return; }
  if (now - g.waitSince < TURN_MS) return;
  const i = S.turn === 'w' ? 0 : 1, seat = r.seats[i];
  if ((seat.auto || 0) >= STRIKES || seat.st === 'left') {
    E.resign(S, S.turn, seat.st === 'left' ? 'left the game' : 'ran out of time');
  } else {
    seat.auto = (seat.auto || 0) + 1;
    const m = E.bestMove(S, 'normal', 300);
    if (m) E.play(S, m);
    S.note = seat.name + ' ran out of time; the computer moved for them (' + seat.auto + ' of ' + STRIKES + ').';
  }
  g.waitSince = now; bump(g);
  if (S.result) finish(g);
}
let ticking = false;
async function tick() {
  if (ticking) return; ticking = true;
  const now = Date.now();
  try {
    for (const g of live.values()) {
      try { step(g, now); } catch (e) { console.error('chess step', g.row.id, e.message); }
      if (g.row.status === 'lobby' && now - g.seen > (g.row.public ? PUBLIC_MS : LOBBY_MS)) { g.row.status = 'cancelled'; bump(g); }
      if (g.dirty) await save(g).catch(function (e) { console.error('chess save', e.message); });
      if ((g.row.status === 'over' || g.row.status === 'cancelled') && now - g.seen > KEEP_OVER_MS) live.delete(Number(g.row.id));
    }
  } finally { ticking = false; }
}
let timer = null;
function start() { if (!timer) timer = setInterval(tick, 250); if (timer.unref) timer.unref(); }

async function finish(g) {
  const r = g.row, S = r.state;
  if (r.status !== 'active') return;
  r.status = 'over'; g.seen = Date.now(); bump(g);
  const a = r.seats[0], b = r.seats[1];
  // Only real games between two different players change ratings: both seats are people (games against the computer
  // are only ever played on the phone and never sent here), and both players made at least one move themselves
  // (a game resigned or abandoned before that doesn't count).
  if (!a.acc || !b.acc || a.acc === b.acc) return;
  const own = [0, 1].map(function (i) { return (S.moves || []).filter(function (m, k) { return k % 2 === i; }).length - (r.seats[i].auto || 0); });
  if (own[0] < 1 || own[1] < 1) { S.note = 'This game ended before both players had moved, so it doesn\'t change ratings.'; bump(g); return; }
  try {
    const cur = {};
    for (const x of [a, b]) {
      await db.q("INSERT INTO ratings (account_id, game) VALUES ($1, 'chess') ON CONFLICT DO NOTHING", [x.acc]);
      cur[x.acc] = (await db.q("SELECT rating FROM ratings WHERE account_id = $1 AND game = 'chess'", [x.acc])).rows[0].rating;
    }
    const sa = S.result === 'w' ? 1 : S.result === 'b' ? 0 : 0.5, ea = 1 / (1 + Math.pow(10, (cur[b.acc] - cur[a.acc]) / 400)), d = Math.round(32 * (sa - ea));
    await db.q("UPDATE ratings SET rating = rating + $2, games = games + 1, wins = wins + $3, updated_at = now() WHERE account_id = $1 AND game = 'chess'", [a.acc, d, sa === 1 ? 1 : 0]);
    await db.q("UPDATE ratings SET rating = rating + $2, games = games + 1, wins = wins + $3, updated_at = now() WHERE account_id = $1 AND game = 'chess'", [b.acc, -d, sa === 0 ? 1 : 0]);
    S.rated = true; g.dirty = true;
  } catch (e) { console.error('chess rating', e.message); }
}
function begin(g) {
  const r = g.row;
  r.status = 'active'; r.state = E.newGame(); g.waitSince = Date.now(); r.public = false; bump(g);
}

/* ---------- Routes ---------- */
function myGames(me) {
  const out = [];
  live.forEach(function (g) { const r = g.row; if ((seatOf(g, me.id) >= 0 || r.seats.some(function (s) { return s.tornId === me.torn_id && s.st === 'pending'; })) && r.status !== 'cancelled') out.push(summary(g, me)); });
  return out.sort(function (a, b) { return b.id - a.id; });
}
function openGames(me) {   // public games waiting for an opponent
  const out = [];
  live.forEach(function (g) { const r = g.row; if (r.status === 'lobby' && r.public && seatOf(g, me.id) < 0 && r.seats.some(function (s) { return s.st === 'open'; })) out.push(summary(g, me)); });
  return out.sort(function (a, b) { return a.id - b.id; }).slice(0, 30);
}
function inbox(me) {
  const invites = [], turns = [];
  live.forEach(function (g) {
    const r = g.row;
    if (r.status === 'lobby' && r.seats.some(function (s) { return s.tornId === me.torn_id && s.st === 'pending'; })) { const h = r.seats.find(function (s) { return s.st === 'host'; }); invites.push({ id: Number(r.id), game: 'chess', from: h.name, fromId: h.tornId }); }
    if (r.status === 'active' && r.state && !r.state.result) { const i = seatOf(g, me.id); if (i >= 0 && colourOf(i) === r.state.turn) turns.push({ id: Number(r.id), game: 'chess', left: Math.max(0, g.waitSince + TURN_MS - Date.now()) }); }
  });
  return { invites: invites, turns: turns };
}
function openCount(me) { let n = 0; live.forEach(function (g) { if (seatOf(g, me.id) >= 0 && (g.row.status === 'lobby' || g.row.status === 'active')) n++; }); return n; }
async function create(me, b) {
  const pub = !!b.public, to = Number(b.invite) || 0;
  const side = b.side === 'b' ? 'b' : b.side === 'w' ? 'w' : (rnd() < 0.5 ? 'w' : 'b');
  const host = { acc: me.id, tornId: me.torn_id, name: me.name, st: 'host', auto: 0 };
  const other = to ? { acc: null, tornId: to, name: '[' + to + ']', st: 'pending', auto: 0 } : { acc: null, tornId: 0, name: 'Open seat', st: 'open', auto: 0 };
  const seats = side === 'w' ? [host, other] : [other, host];
  const row = (await db.q("INSERT INTO chess_games (status, host, public, seats) VALUES ('lobby', $1, $2, $3) RETURNING *", [me.id, pub && !to, JSON.stringify(seats)])).rows[0];
  return load(row);
}
async function route(req, res, url, c) {
  const path = url.pathname, method = req.method;
  const me = await c.whoAsks(req);
  if (!me) return c.fail(res, 401, 'signed_out', 'Sign in to play online.');
  if (me.banned) return c.fail(res, 403, 'banned', 'This account can\'t play online.');
  if (!me.verified) return c.fail(res, 403, 'verify_first', 'Verify your Torn ID to play online games.');
  let m;
  if (path === '/v1/chess/games' && method === 'GET') return c.send(res, 200, { games: myGames(me) });
  if (path === '/v1/chess/public' && method === 'GET') return c.send(res, 200, { games: openGames(me) });
  if ((path === '/v1/chess/games' || path === '/v1/chess/quick') && method === 'POST') {
    if (c.limited(c.ip, 'chnew', 15, 10 * 60000)) return c.fail(res, 429, 'slow_down', 'Too many new games. Wait a few minutes.');
    const b = await c.readBody(req);
    if (path === '/v1/chess/quick') {   // join the oldest public game waiting, or open one
      const wait = openGames(me)[0];
      if (wait) { const g = live.get(wait.id), s = g.row.seats.find(function (x) { return x.st === 'open'; }); s.acc = me.id; s.tornId = me.torn_id; s.name = me.name; s.st = 'joined'; begin(g); await save(g); return c.send(res, 200, { game: summary(g, me), matched: true }); }
      const mine = []; live.forEach(function (g) { if (g.row.status === 'lobby' && g.row.public && seatOf(g, me.id) >= 0) mine.push(g); });
      if (mine.length) return c.send(res, 200, { game: summary(mine[0], me), matched: false });   // already waiting in one
      b.public = true; b.invite = 0;
    } else {
      const to = Number(b.invite) || 0;
      if (to && (!(to > 0 && to < 1e8) || to === me.torn_id)) return c.fail(res, 400, 'bad_invite', 'Invite another player by their Torn ID.');
      if (!to && !b.public) return c.fail(res, 400, 'bad_invite', 'Invite a player by Torn ID, or make a public game.');
    }
    if (openCount(me) >= 5) return c.fail(res, 400, 'too_many', 'You already have 5 online chess games going. Finish or cancel one first.');
    const g = await create(me, b);
    return c.send(res, 200, { game: summary(g, me), matched: false });
  }
  if (!(m = /^\/v1\/chess\/games\/(\d+)(?:\/([a-z]+))?$/.exec(path))) return c.fail(res, 404, 'not_found', 'Not found.');
  const g = live.get(Number(m[1]));
  if (!g) return c.fail(res, 404, 'no_game', 'That game has finished or was cancelled.');
  g.seen = Date.now();
  const r = g.row, seat = seatOf(g, me.id), what = m[2] || '';
  const inv = r.seats.findIndex(function (s) { return s.tornId === me.torn_id && s.st === 'pending'; });
  if (method === 'GET' && !what) {
    if (seat < 0 && inv < 0 && !(r.public && r.status === 'lobby')) return c.fail(res, 403, 'not_yours', 'You\'re not in this game.');
    const since = Number(url.searchParams.get('v'));
    const reply = function () { if (!res.writableEnded) c.send(res, 200, { game: summary(g, me), state: r.state && seat >= 0 ? r.state : null }); };
    if (url.searchParams.get('wait') === '1' && since === r.ver) {
      const w = { done: reply, timer: setTimeout(function () { g.waiters = g.waiters.filter(function (x) { return x !== w; }); reply(); }, WAIT_MS) };
      g.waiters.push(w);
      req.on('close', function () { clearTimeout(w.timer); g.waiters = g.waiters.filter(function (x) { return x !== w; }); });
      return;
    }
    return reply();
  }
  if (method !== 'POST') return c.fail(res, 404, 'not_found', 'Not found.');
  if (what === 'join') {
    if (r.status !== 'lobby') return c.fail(res, 400, 'not_now', 'That game isn\'t open any more.');
    let i = inv;
    if (i < 0 && r.public && seat < 0) i = r.seats.findIndex(function (s) { return s.st === 'open'; });
    if (i < 0) return c.fail(res, 400, 'not_now', 'That game isn\'t open any more.');
    const s = r.seats[i]; s.acc = me.id; s.tornId = me.torn_id; s.name = me.name; s.st = 'joined';
    begin(g); await save(g);
    return c.send(res, 200, { game: summary(g, me) });
  }
  if (what === 'decline') {
    if (r.status !== 'lobby' || inv < 0) return c.fail(res, 400, 'not_now', 'That invite isn\'t open any more.');
    r.seats[inv].st = 'declined'; r.status = 'cancelled'; bump(g); await save(g);
    return c.send(res, 200, { ok: true });
  }
  if (what === 'cancel') {
    if (r.status !== 'lobby' || seat < 0) return c.fail(res, 400, 'not_now', 'Only a game that hasn\'t started can be cancelled.');
    r.status = 'cancelled'; bump(g); await save(g);
    return c.send(res, 200, { ok: true });
  }
  if (what === 'resign' || what === 'leave') {
    if (seat < 0) return c.fail(res, 403, 'not_yours', 'You\'re not in this game.');
    if (r.status === 'lobby') { r.status = 'cancelled'; bump(g); await save(g); return c.send(res, 200, { ok: true }); }
    if (r.status !== 'active') return c.fail(res, 400, 'not_now', 'This game has finished.');
    E.resign(r.state, colourOf(seat), what === 'leave' ? 'left the game' : 'resignation');
    bump(g); await finish(g); await save(g);
    return c.send(res, 200, { ok: true });
  }
  if (what === 'move') {
    if (r.status !== 'active' || seat < 0) return c.fail(res, 400, 'not_now', 'This game isn\'t running.');
    if (c.limited(c.ip, 'chmove', 240, 60000)) return c.fail(res, 429, 'slow_down', 'Too many moves. Slow down a little.');
    if (r.state.turn !== colourOf(seat)) return c.fail(res, 400, 'not_your_turn', 'It\'s not your move.');
    const b = await c.readBody(req), out = E.play(r.state, { from: Number(b.from), to: Number(b.to), promo: typeof b.promo === 'string' ? b.promo.slice(0, 1).toUpperCase() : '' });
    if (out.err) return c.fail(res, 400, out.err, 'That move isn\'t allowed.');
    r.state.note = ''; g.waitSince = Date.now(); bump(g);
    if (r.state.result) await finish(g);
    return c.send(res, 200, { ok: true, san: out.san, ver: r.ver });
  }
  return c.fail(res, 404, 'not_found', 'Not found.');
}
// Deleting an account: their lobbies are cancelled, running games are lost on the clock as if they left.
function forget(accId) {
  live.forEach(function (g) {
    const r = g.row;
    r.seats.forEach(function (s, i) {
      if (s.acc !== accId) return;
      s.acc = null;
      if (r.status === 'lobby') r.status = 'cancelled';
      else if (r.status === 'active') { s.st = 'left'; E.resign(r.state, colourOf(i), 'left the game'); finish(g); }
      bump(g);
    });
  });
}
module.exports = { migrate: migrate, start: start, route: route, inbox: inbox, forget: forget, _live: live, _tick: tick };
