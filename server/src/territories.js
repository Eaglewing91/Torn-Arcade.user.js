// Online Torn Territories. The server runs every online game with the same rules engine as the phone (tt-engine.js),
// so it checks every move, rolls the dice and deals the cards. Players only ever see their own cards.
// - Lobby: the host invites up to 3 players by Torn ID (invites show up on their phones, GET /v1/inbox), and/or makes
//   the game public: open seats anyone can take from the public lobby list or with Quick match.
// - The host starts the game (seats nobody took are played by the computer); a public game also starts by itself
//   once every seat is filled.
// - 30-second timer: when the game waits on a person (their turn, a discard or a trade offer) and they don't act
//   within 30 seconds, the computer makes that move (for a turn: plays the rest of that turn) and play goes on.
// - Live updates: GET .../:id?v=<version>&wait=1 waits up to 20 seconds for something to change (long polling,
//   plain HTTPS, no websockets).
// - Games with 2 or more people change their online rating (Elo, by final Respect).
'use strict';
const crypto = require('crypto');
const db = require('./db');
const TTEngine = require('./tt-engine');

const TURN_MS = Number(process.env.TT_TURN_MS) || 45000;   // the inactivity timer: 45 seconds, reset by every move you make
const TURN_CAP_MS = Number(process.env.TT_TURN_CAP_MS) || 4 * 60000;   // but one whole turn can't run past 4 minutes
const AI_MS = Number(process.env.TT_AI_MS) || 900;         // pause between computer moves
const SETUP_AI_MS = Math.min(AI_MS, 450);
const LOBBY_MS = 30 * 60000, KEEP_OVER_MS = 15 * 60000, WAIT_MS = 20000;
const COLS = ['#3fd17a', '#ff4a5a', '#ffb02e', '#5aa8ff', '#b07aff', '#ff7ac8', '#2fd0c0', '#f2f2f2'];
const AI_NAMES = ['The Racket', 'Southside Crew', 'Neon Syndicate'];
const rnd = function () { return crypto.randomInt(0, 2 ** 32) / 2 ** 32; };

const live = new Map();   // game id -> { row, E, G, waiters, nextAt, waitKey, waitSince, dirty }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tt_games (
  id          BIGSERIAL PRIMARY KEY,
  status      TEXT NOT NULL,                  -- lobby, active, over, cancelled
  host        BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
  size        TEXT NOT NULL,
  seats       JSONB NOT NULL,                 -- [{ acc, tornId, name, col, st: host|pending|joined|declined|ai|left }]
  state       JSONB,
  ver         INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tt_games_status ON tt_games(status);
ALTER TABLE tt_games ADD COLUMN IF NOT EXISTS public BOOLEAN NOT NULL DEFAULT FALSE;   -- listed in the public lobby (2.42)
`;
async function migrate() {
  await db.q(SCHEMA);
  const rows = (await db.q("SELECT * FROM tt_games WHERE status IN ('lobby', 'active')")).rows;
  rows.forEach(function (r) { load(r); });
}

function load(row) {
  const E = TTEngine({ rnd: rnd });
  if (row.state) E.set(row.state);
  const g = { row: row, E: E, G: row.state, waiters: [], nextAt: 0, waitKey: '', waitSince: Date.now(), dirty: false, seen: Date.now() };
  live.set(Number(row.id), g);
  return g;
}
async function save(g) {
  g.dirty = false;
  await db.q('UPDATE tt_games SET status = $2, seats = $3, state = $4, ver = $5, public = $6, updated_at = now() WHERE id = $1', [g.row.id, g.row.status, JSON.stringify(g.row.seats), g.G ? JSON.stringify(g.G) : null, g.row.ver, !!g.row.public]);
}
// Something changed: new version, save soon, wake everyone waiting for news.
function bump(g) {
  g.row.ver++; g.dirty = true;
  const w = g.waiters; g.waiters = [];
  w.forEach(function (x) { clearTimeout(x.timer); x.done(); });
}

function seatOf(g, acc) { return g.row.seats.findIndex(function (s) { return s.acc === acc && (s.st === 'host' || s.st === 'joined'); }); }
function summary(g, me) {
  const r = g.row, G = g.G;
  return {
    id: Number(r.id), game: 'territories', status: r.status, size: r.size, ver: r.ver, host: r.seats[0].name, public: !!r.public, open: r.seats.filter(function (s) { return s.st === 'open'; }).length,
    seats: r.seats.map(function (s) { return { name: s.name, tornId: s.tornId || 0, col: s.col, st: s.st }; }),
    you: me ? seatOf(g, me.id) : -1,
    invited: me ? r.seats.some(function (s) { return s.tornId === me.torn_id && s.st === 'pending'; }) : false,
    waitingOn: G && r.status === 'active' ? g.E.waiting() : -1, left: G && r.status === 'active' ? Math.max(0, g.waitSince + TURN_MS - Date.now()) : 0, auto: G && r.status === 'active' ? g.E.isAI(g.E.waiting()) : false,
    winner: G && r.status === 'over' ? G.winner : -1, turn: G ? G.turn : 0, rated: !!(G && G.rated)
  };
}
// One player's view of the game. Clients that already have the board get only what changes on it.
function view(g, seat, hasBoard) {
  const v = g.E.viewFor(g.G, seat);
  v.log = v.log.slice(0, 40);
  if (hasBoard) {
    v.vo = v.verts.map(function (x) { return [x.owner, x.lvl]; }); v.eo = v.edges.map(function (x) { return x.k === 'fly' ? [x.owner, x.t] : x.owner; });   // flight routes (Flight Paths) as [owner, turn built]
    delete v.verts; delete v.edges; delete v.hexes; delete v.ports;
  }
  return v;
}

/* ---------- The game clock: computer moves and the 30-second timer ---------- */
function step(g, now) {
  const G = g.G, E = g.E;
  if (!G || g.row.status !== 'active') return;
  if (G.phase === 'over') { finish(g); return; }
  const w = E.waiting(), key = [w, G.phase, G.turn, G.setup && G.setup.i, G.discardQ.length, G.offer ? 1 : 0].join('|');
  if (key !== g.waitKey) { g.waitKey = key; g.waitSince = now; g.nextAt = now + (G.phase === 'setup' ? SETUP_AI_MS : AI_MS); }
  const tk = [G.cur, G.turn, G.setup && G.setup.i].join('|');
  if (tk !== g.turnKey) { g.turnKey = tk; g.turnSince = now; }
  if (E.isAI(w)) {
    if (now < g.nextAt) return;
    E.aiMove(); g.nextAt = now + (G.phase === 'setup' ? SETUP_AI_MS : AI_MS); bump(g);
  } else if (now - g.waitSince >= TURN_MS || (w === G.cur && now - (g.turnSince || now) >= TURN_CAP_MS)) {
    E.takeOver(w); g.waitKey = ''; bump(g);
  }
  if (G.phase === 'over') finish(g);
}
let ticking = false;
async function tick() {
  if (ticking) return; ticking = true;
  const now = Date.now();
  try {
    for (const g of live.values()) {
      try { step(g, now); } catch (e) { console.error('tt step', g.row.id, e.message); }
      if (g.row.status === 'lobby' && now - g.seen > LOBBY_MS) { g.row.status = 'cancelled'; bump(g); }
      if (g.dirty) await save(g).catch(function (e) { console.error('tt save', e.message); });
      if ((g.row.status === 'over' || g.row.status === 'cancelled') && now - g.seen > KEEP_OVER_MS) live.delete(Number(g.row.id));
    }
  } finally { ticking = false; }
}
let timer = null;
function start() { if (!timer) timer = setInterval(tick, Math.max(10, Math.min(250, AI_MS))); if (timer.unref) timer.unref(); }

/* ---------- Ratings (games with 2 or more people) ---------- */
// Game types: 'large' (Classic, first to 14; 'standard' is the retired small map) and Flight Paths to 12 or 16.
const GAME_TYPES = ['large', 'fp12', 'fp16'];
function atLeast(req, min) { const v = String(req.headers['x-arcade-version'] || '').split('.').map(Number); for (let i = 0; i < 3; i++) { if ((v[i] || 0) !== min[i]) return (v[i] || 0) > min[i]; } return true; }
function ratingKey(size) { return size === 'fp12' || size === 'fp16' ? 'territories:' + size : 'territories'; }
async function finish(g) {
  if (g.row.status !== 'active') return;
  g.row.status = 'over'; g.seen = Date.now(); bump(g);
  const G = g.G, people = g.row.seats.map(function (s, i) { return { s: s, i: i }; }).filter(function (x) { return x.s.acc && (x.s.st === 'host' || x.s.st === 'joined' || x.s.st === 'left'); });
  if (people.length < 2) return;
  const rk = ratingKey(g.row.size);   // Classic, Flight Paths to 12 and to 16 each have their own rating
  const E = g.E, score = people.map(function (x) { return x.i === G.winner ? 99 : E.respect(x.i, true); });
  try {
    const cur = {};
    for (const x of people) {
      await db.q("INSERT INTO ratings (account_id, game) VALUES ($1, $2) ON CONFLICT DO NOTHING", [x.s.acc, rk]);
      cur[x.s.acc] = (await db.q("SELECT rating FROM ratings WHERE account_id = $1 AND game = $2", [x.s.acc, rk])).rows[0].rating;
    }
    const K = 32 / (people.length - 1);
    for (let a = 0; a < people.length; a++) {
      let d = 0;
      for (let b = 0; b < people.length; b++) {
        if (a === b) continue;
        const ra = cur[people[a].s.acc], rb = cur[people[b].s.acc], exp = 1 / (1 + Math.pow(10, (rb - ra) / 400));
        const S = score[a] > score[b] ? 1 : score[a] === score[b] ? 0.5 : 0;
        d += K * (S - exp);
      }
      await db.q("UPDATE ratings SET rating = rating + $2, games = games + 1, wins = wins + $3, updated_at = now() WHERE account_id = $1 AND game = $4",
        [people[a].s.acc, Math.round(d), people[a].i === G.winner ? 1 : 0, rk]);
    }
    G.rated = true; g.dirty = true;
  } catch (e) { console.error('tt rating', e.message); }
}

/* ---------- Routes (all need a verified account) ---------- */
async function myGames(me) {
  const out = [];
  live.forEach(function (g) {
    const r = g.row, mine = seatOf(g, me.id) >= 0, inv = r.seats.some(function (s) { return s.tornId === me.torn_id && s.st === 'pending'; });
    if ((mine || inv) && r.status !== 'cancelled') out.push(summary(g, me));
  });
  return out.sort(function (a, b) { return b.id - a.id; });
}
function openGames(me, size) {   // public lobbies with a free seat
  const out = [];
  live.forEach(function (g) { const r = g.row; if (r.status === 'lobby' && r.public && seatOf(g, me.id) < 0 && (!size || r.size === size) && r.seats.some(function (s) { return s.st === 'open'; })) out.push(summary(g, me)); });
  return out.sort(function (a, b) { return a.id - b.id; }).slice(0, 30);
}
function startGame(g) {
  const r = g.row; let k = 0;
  r.seats.forEach(function (s) { if (s.st === 'pending' || s.st === 'declined' || s.st === 'open') { s.st = 'ai'; s.acc = null; s.name = AI_NAMES[k++]; } });
  g.G = g.E.newGame({ mode: /^fp/.test(r.size) ? 'fp' : 'classic', win: r.size === 'fp16' ? 16 : 12, diff: 'normal', speed: AI_MS, online: true, players: r.seats.map(function (s) { return { name: s.name, col: s.col, ai: s.st === 'ai', id: s.tornId || 0 }; }) });
  r.status = 'active'; r.public = false; g.waitKey = ''; bump(g);
}
async function newLobby(me, size, col, ids, pub) {
  col = Number.isInteger(col) && col >= 0 && col < COLS.length ? col : 0;
  const left = COLS.map(function (x, i) { return i; }).filter(function (i) { return i !== col; });
  const seats = [{ acc: me.id, tornId: me.torn_id, name: me.name, col: COLS[col], st: 'host' }].concat(ids.map(function (id, k) { return { acc: null, tornId: id, name: '[' + id + ']', col: COLS[left[k]], st: 'pending' }; }));
  if (pub) while (seats.length < 4) seats.push({ acc: null, tornId: 0, name: 'Open seat', col: COLS[left[seats.length - 1]], st: 'open' });
  const row = (await db.q("INSERT INTO tt_games (status, host, size, seats, public) VALUES ('lobby', $1, $2, $3, $4) RETURNING *", [me.id, GAME_TYPES.indexOf(size) >= 0 ? size : 'large', JSON.stringify(seats), !!pub])).rows[0];
  return load(row);
}
async function inbox(me) {
  const invites = [], turns = [];
  live.forEach(function (g) {
    const r = g.row;
    if (r.status === 'lobby' && r.seats.some(function (s) { return s.tornId === me.torn_id && s.st === 'pending'; })) invites.push({ id: Number(r.id), from: r.seats[0].name, fromId: r.seats[0].tornId, size: r.size });
    if (r.status === 'active') { const i = seatOf(g, me.id); if (i >= 0 && g.E.waiting() === i && !g.E.isAI(i)) turns.push({ id: Number(r.id), left: Math.max(0, g.waitSince + TURN_MS - Date.now()) }); }
  });
  return { invites: invites, turns: turns };
}

async function route(req, res, url, c) {
  const path = url.pathname, method = req.method;
  const me = await c.whoAsks(req);
  if (!me) return c.fail(res, 401, 'signed_out', 'Sign in to play online.');
  if (me.banned) return c.fail(res, 403, 'banned', 'This account can\'t play online.');
  if (!me.verified) return c.fail(res, 403, 'verify_first', 'Verify your Torn ID to play online games.');
  let m;
  if (path === '/v1/tt/games' && method === 'GET') return c.send(res, 200, { games: await myGames(me) });
  if (path === '/v1/tt/public' && method === 'GET') return c.send(res, 200, { games: openGames(me, GAME_TYPES.indexOf(url.searchParams.get('size')) >= 0 ? url.searchParams.get('size') : null) });
  if ((path === '/v1/tt/games' || path === '/v1/tt/quick') && method === 'POST') {
    if (c.limited(c.ip, 'ttnew', 15, 10 * 60000)) return c.fail(res, 429, 'slow_down', 'Too many new games. Wait a few minutes.');
    const b = await c.readBody(req), size = GAME_TYPES.indexOf(b.size) >= 0 ? b.size : 'large';
    if (/^fp/.test(size) && !atLeast(req, [2, 41, 0])) return c.fail(res, 426, 'update', 'Update Torn Arcade to 2.41 or newer to play Flight Paths.');
    if (path === '/v1/tt/quick') {   // take a seat in the oldest public lobby of this game type, or open one
      const wait = openGames(me, size)[0];
      if (wait) {
        const g = live.get(wait.id), s = g.row.seats.find(function (x) { return x.st === 'open'; });
        s.acc = me.id; s.tornId = me.torn_id; s.name = me.name; s.st = 'joined';
        if (!g.row.seats.some(function (x) { return x.st === 'open' || x.st === 'pending'; })) startGame(g); else bump(g);
        await save(g); return c.send(res, 200, { game: summary(g, me), matched: true });
      }
      let mine = null; live.forEach(function (g) { if (!mine && g.row.status === 'lobby' && g.row.public && g.row.size === size && seatOf(g, me.id) >= 0) mine = g; });
      if (mine) return c.send(res, 200, { game: summary(mine, me), matched: false });
    }
    const ids = path === '/v1/tt/quick' ? [] : Array.isArray(b.invite) ? b.invite.map(Number) : [], pub = path === '/v1/tt/quick' || !!b.public;
    if (ids.length > 3 || (!pub && ids.length < 1) || ids.some(function (x) { return !(x > 0 && x < 1e8) || x === me.torn_id; }) || new Set(ids).size !== ids.length) return c.fail(res, 400, 'bad_invite', 'Invite 1 to 3 other players by their Torn ID, or make the game public.');
    let open = 0; live.forEach(function (g) { if (g.row.host === me.id && (g.row.status === 'lobby' || g.row.status === 'active')) open++; });
    if (open >= 3) return c.fail(res, 400, 'too_many', 'You already have 3 online games going. Finish or cancel one first.');
    const g = await newLobby(me, size, b.col, ids, pub);
    return c.send(res, 200, { game: summary(g, me), matched: false });
  }
  if (path === '/v1/inbox' && method === 'GET') return c.send(res, 200, await inbox(me));
  if (!(m = /^\/v1\/tt\/games\/(\d+)(?:\/([a-z]+))?$/.exec(path))) return c.fail(res, 404, 'not_found', 'Not found.');
  const g = live.get(Number(m[1]));
  if (!g) return c.fail(res, 404, 'no_game', 'That game has finished or was cancelled.');
  g.seen = Date.now();
  const r = g.row, seat = seatOf(g, me.id), what = m[2] || '';
  const inv = r.seats.findIndex(function (s) { return s.tornId === me.torn_id && s.st === 'pending'; });
  if (method === 'GET' && !what) {
    if (seat < 0 && inv < 0 && !(r.public && r.status === 'lobby')) return c.fail(res, 403, 'not_yours', 'You\'re not in this game.');
    const since = Number(url.searchParams.get('v')), hasBoard = url.searchParams.get('board') === '1';
    const reply = function () { if (!res.writableEnded) c.send(res, 200, { game: summary(g, me), state: g.G && seat >= 0 ? view(g, seat, hasBoard) : null }); };
    if (url.searchParams.get('wait') === '1' && since === r.ver) {
      const w = { done: reply, timer: setTimeout(function () { g.waiters = g.waiters.filter(function (x) { return x !== w; }); reply(); }, WAIT_MS) };
      g.waiters.push(w);
      req.on('close', function () { clearTimeout(w.timer); g.waiters = g.waiters.filter(function (x) { return x !== w; }); });
      return;
    }
    return reply();
  }
  if (method !== 'POST') return c.fail(res, 404, 'not_found', 'Not found.');
  if (what === 'join' || what === 'decline') {
    let i = inv;
    if (i < 0 && what === 'join' && r.public && seat < 0) i = r.seats.findIndex(function (s) { return s.st === 'open'; });   // a public seat
    if (r.status !== 'lobby' || i < 0) return c.fail(res, 400, 'not_now', 'That game isn\'t open any more.');
    if (what === 'join' && /^fp/.test(r.size) && !atLeast(req, [2, 41, 0])) return c.fail(res, 426, 'update', 'This is a Flight Paths game. Update Torn Arcade to 2.41 or newer to join it.');
    const s = r.seats[i];
    if (what === 'join') { s.acc = me.id; s.tornId = me.torn_id; s.name = me.name; s.st = 'joined'; } else s.st = 'declined';
    if (r.public && !r.seats.some(function (x) { return x.st === 'open' || x.st === 'pending'; })) startGame(g);   // full: off we go
    else bump(g);
    await save(g);
    return c.send(res, 200, { game: summary(g, me) });
  }
  if (what === 'start') {
    if (r.status !== 'lobby' || seat !== 0) return c.fail(res, 400, 'not_now', 'Only the host can start, before the game begins.');
    startGame(g); await save(g);
    return c.send(res, 200, { game: summary(g, me) });
  }
  if (what === 'cancel') {
    if (r.status !== 'lobby' || seat !== 0) return c.fail(res, 400, 'not_now', 'Only the host can cancel a game that hasn\'t started.');
    r.status = 'cancelled'; bump(g); await save(g);
    return c.send(res, 200, { ok: true });
  }
  if (what === 'leave') {   // leaving hands your seat to the computer for the rest of the game
    if (seat < 0) return c.fail(res, 403, 'not_yours', 'You\'re not in this game.');
    if (r.status === 'lobby') { if (seat === 0) r.status = 'cancelled'; else { r.seats[seat].st = 'declined'; r.seats[seat].acc = null; } }
    else if (r.status === 'active') {
      r.seats[seat].st = 'left'; g.G.players[seat].ai = true; g.E.say(g.G.players[seat].name + ' left the game. The computer takes over their faction.');
      if (!r.seats.some(function (s) { return s.st === 'host' || s.st === 'joined'; })) { r.status = 'cancelled'; }
    }
    bump(g); await save(g);
    return c.send(res, 200, { ok: true });
  }
  if (what === 'act') {
    if (r.status !== 'active' || seat < 0) return c.fail(res, 400, 'not_now', 'This game isn\'t running.');
    if (c.limited(c.ip, 'ttact', 240, 60000)) return c.fail(res, 429, 'slow_down', 'Too many moves. Slow down a little.');
    if (g.E.isAI(seat)) return c.fail(res, 400, 'auto', 'The computer is playing this turn for you. You\'re back in control on your next turn.');
    const b = await c.readBody(req), was = g.E.waiting(), out = g.E.act(seat, b.a);
    if (out.err) return c.fail(res, 400, out.err, 'That move isn\'t allowed right now.');
    if (was === seat) g.waitSince = Date.now();   // every move you make (a road, a trade...) gives you a fresh 45 seconds
    bump(g);
    if (g.G.phase === 'over') await finish(g);
    return c.send(res, 200, { ok: true, answers: out.answers || null, ver: r.ver });
  }
  return c.fail(res, 404, 'not_found', 'Not found.');
}

// Deleting an account takes the player out of their games (their seats go to the computer).
function forget(accId) {
  live.forEach(function (g) {
    g.row.seats.forEach(function (s, i) {
      if (s.acc !== accId) return;
      s.acc = null;
      if (g.row.status === 'active') { s.st = 'left'; g.G.players[i].ai = true; } else if (g.row.status === 'lobby') { if (i === 0) g.row.status = 'cancelled'; else s.st = 'declined'; }
      bump(g);
    });
  });
}

module.exports = { migrate: migrate, start: start, route: route, inbox: inbox, forget: forget, _live: live, _tick: tick };
