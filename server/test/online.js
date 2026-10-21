// Online Territories and Tornie trades, end to end against a local Postgres and a fake Torn API.
// The inactivity timer and computer moves are sped up (TT_TURN_MS, TT_AI_MS) so a whole game runs in seconds.
'use strict';
const http = require('http'), path = require('path'), { spawn, execFileSync } = require('child_process');
const TTEngine = require('../src/tt-engine');
const PG = ['-h', '/tmp', '-p', '5433', '-U', 'postgres', '-d', 'arcade', '-At', '-X', '-q'];
const sql = s => execFileSync('psql', PG.concat(['-c', s]), { encoding: 'utf8' }).trim();
const KEYS = { AAAAAAAAAAAAAAAA: { id: 571041, name: 'Eaglewing' }, BBBBBBBBBBBBBBBB: { id: 2, name: 'Duke' }, CCCCCCCCCCCCCCCC: { id: 3, name: 'Leslie' } };
const fake = http.createServer((q, s) => { const k = (q.headers.authorization || '').replace('ApiKey ', ''); s.end(JSON.stringify(KEYS[k] ? { profile: KEYS[k] } : { error: { code: 2, error: 'x' } })); }).listen(5871);
const fails = [];
function check(n, ok, x) { console.log((ok ? 'ok   ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 300) : '')); if (!ok) fails.push(n); }
async function call(m, p, body, tok) {
  const h = { 'Content-Type': 'application/json', 'X-Arcade-Version': '2.40.0' }; if (tok) h.Authorization = 'Bearer ' + tok;
  const r = await fetch('http://127.0.0.1:5870' + p, { method: m, headers: h, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (e) {} return { status: r.status, body: j };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  sql('DROP TABLE IF EXISTS chess_games, server_jobs, tornie_trades, tt_games, scores, ratings, tokens, accounts CASCADE');
  const srv = spawn('node', [path.join(__dirname, '../src/server.js')], { env: Object.assign({}, process.env, { PORT: '5870', DATABASE_URL: 'postgres://postgres@localhost:5433/arcade', TORN_API: 'http://127.0.0.1:5871', NODE_PATH: path.join(__dirname, 'shim'), TT_TURN_MS: '1500', TT_AI_MS: '20' }), stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; srv.stdout.on('data', d => logs += d); srv.stderr.on('data', d => logs += d);
  for (let i = 0; i < 50 && !/port 5870/.test(logs); i++) await sleep(100);
  try {
    const tok = {};
    for (const [k, v] of Object.entries(KEYS)) tok[v.name] = (await call('POST', '/v1/auth/torn', { key: k })).body.token;
    const A = tok.Eaglewing, B = tok.Duke, C = tok.Leslie;
    const guest = (await call('POST', '/v1/auth/guest')).body.token;
    let r = await call('POST', '/v1/tt/games', { invite: [2] }, guest); check('guests can\'t host', r.status === 403);
    r = await call('POST', '/v1/tt/games', { invite: [571041] }, A); check('can\'t invite yourself', r.status === 400);
    r = await call('POST', '/v1/tt/games', { invite: [2, 3, 4], size: 'standard', col: 3 }, A);
    const id = r.body.game.id; check('create a game with 3 invites', r.status === 200 && r.body.game.status === 'lobby' && r.body.game.seats.length === 4 && r.body.game.seats[0].col === '#5aa8ff', r.body.game);
    r = await call('GET', '/v1/inbox', null, B); check('invite reaches the invited player', r.body.invites.length === 1 && r.body.invites[0].from === 'Eaglewing' && r.body.invites[0].id === id, r.body);
    r = await call('GET', '/v1/inbox', null, A); check('host has no invite', r.body.invites.length === 0);
    r = await call('POST', '/v1/tt/games/' + id + '/start', null, B); check('only the host can start', r.status === 400);
    r = await call('POST', '/v1/tt/games/' + id + '/join', null, B); check('join', r.body.game.seats[1].st === 'joined' && r.body.game.seats[1].name === 'Duke' && r.body.game.you === 1, r.body.game.seats);
    r = await call('POST', '/v1/tt/games/' + id + '/decline', null, C); check('decline', r.body.game.seats[2].st === 'declined');
    r = await call('GET', '/v1/tt/games/' + id, null, C); check('a decliner can\'t look in', r.status === 403);
    // live update: B waits, A starts the game, B hears about it
    const v0 = (await call('GET', '/v1/tt/games/' + id, null, B)).body.game.ver;
    const t0 = Date.now(), wait = call('GET', '/v1/tt/games/' + id + '?wait=1&v=' + v0, null, B);
    await sleep(300);
    r = await call('POST', '/v1/tt/games/' + id + '/start', null, A); check('host starts; empty seats go to the computer', r.body.game.status === 'active' && r.body.game.seats[2].st === 'ai' && r.body.game.seats[3].st === 'ai' && r.body.game.seats[2].name === 'The Racket', r.body.game.seats);
    r = await wait; check('waiting player hears the start at once', r.body.game.status === 'active' && Date.now() - t0 < 3000 && r.body.state, Date.now() - t0);
    // play the first setup move by hand: A places a safehouse and a road
    let st = (await call('GET', '/v1/tt/games/' + id, null, A)).body.state;
    const E = TTEngine({}); E.set(st);
    const v = st.verts.findIndex((x, i) => E.safeOK(0, i, true));
    r = await call('POST', '/v1/tt/games/' + id + '/act', { a: { t: 'safe', v: v } }, A); check('a move by hand', r.status === 200, r.body);
    r = await call('POST', '/v1/tt/games/' + id + '/act', { a: { t: 'roll' } }, B); check('moves out of turn are refused', r.status === 400, r.body);
    st = (await call('GET', '/v1/tt/games/' + id, null, A)).body.state; E.set(st);
    const e = st.edges.findIndex((x, i) => E.routeOK(0, i));
    r = await call('POST', '/v1/tt/games/' + id + '/act', { a: { t: 'route', e: e } }, A); check('road next to it', r.status === 200, r.body);
    r = await call('POST', '/v1/tt/games/' + id + '/act', { a: { t: 'route', e: 99999 } }, A); check('nonsense moves refused', r.status === 400);
    // B now has 1.5s to move; don't: the computer moves for B
    r = await call('GET', '/v1/inbox', null, B); check('your turn shows in the inbox', r.body.turns.length === 1 && r.body.turns[0].id === id, r.body);
    await sleep(2200);
    st = (await call('GET', '/v1/tt/games/' + id, null, B)).body.state;
    check('the computer moved for a slow player', st.verts.some(x => x.owner === 1) && st.log.some(l => /ran out of time/.test(l)), st.log.slice(0, 4));
    // hidden information
    st = (await call('GET', '/v1/tt/games/' + id, null, B)).body.state;
    check('only your own cards are shown', st.players[0].n !== undefined && st.players[1].n === undefined && st.deck.every(x => x === '?') && !st.hid && st.bank, { a: st.players[0].hand, n: st.players[0].n });
    r = await call('GET', '/v1/tt/games/' + id + '?board=1', null, B); check('board left out once you have it', !r.body.state.hexes && Array.isArray(r.body.state.vo) && Array.isArray(r.body.state.eo));
    // nobody plays from here: timers and the computer finish the game
    let g; for (let i = 0; i < 400; i++) { g = (await call('GET', '/v1/tt/games/' + id, null, A)).body.game; if (g.status === 'over') break; await sleep(500); }
    check('the game plays to the end', g.status === 'over' && g.winner >= 0, g);
    await sleep(500);
    r = await call('GET', '/v1/leaderboard/territories', null, A);
    check('ratings updated for both people', r.body.players.length === 2 && r.body.players.every(p => p.games === 1) && r.body.players.reduce((s, p) => s + p.rating, 0) === 2400, r.body.players);
    st = (await call('GET', '/v1/tt/games/' + id, null, B)).body.state; check('cards shown to all at the end', st.players[0].n === undefined);
    // leaving hands the seat to the computer; cancel a lobby
    r = await call('POST', '/v1/tt/games', { invite: [2] }, A); const id2 = r.body.game.id;
    r = await call('POST', '/v1/tt/games/' + id2 + '/cancel', null, A); check('cancel a lobby', r.status === 200);
    r = await call('GET', '/v1/inbox', null, B); check('cancelled invites disappear', !r.body.invites.some(x => x.id === id2));
    r = await call('POST', '/v1/tt/games', { invite: [2] }, A); const id3 = r.body.game.id;
    await call('POST', '/v1/tt/games/' + id3 + '/join', null, B); await call('POST', '/v1/tt/games/' + id3 + '/start', null, A);
    r = await call('POST', '/v1/tt/games/' + id3 + '/leave', null, B); st = (await call('GET', '/v1/tt/games/' + id3, null, A)).body;
    check('leaving hands the seat to the computer', st.game.seats[1].st === 'left' && st.state.players[1].ai === true);

    // ---------- Tornie trades ----------
    const codeA = 'TORNIE-' + 'A'.repeat(60), codeB = 'TORNIE-' + 'B'.repeat(60), codeC = 'TORNIE-' + 'C'.repeat(60);
    r = await call('POST', '/v1/trades', { to: 2, offer: 'nope' }, A); check('bad Tornie code refused', r.status === 400);
    r = await call('POST', '/v1/trades', { to: 571041, offer: codeA }, A); check('can\'t trade with yourself', r.status === 400);
    r = await call('POST', '/v1/trades', { to: 2, offer: codeA }, A); const tid = r.body.trade.id; check('start a trade', r.status === 200 && r.body.trade.mine === codeA && !r.body.trade.theirs);
    r = await call('GET', '/v1/inbox', null, B); check('trade shows in the inbox', r.body.trades.some(x => x.id === tid && x.with.name === 'Eaglewing'), r.body.trades);
    r = await call('POST', '/v1/trades/' + tid + '/confirm', null, A); check('can\'t confirm before both Tornies are in', r.status === 400);
    r = await call('GET', '/v1/trades', null, B); check('invited player sees the offered Tornie', r.body.trades[0].theirs === codeA && r.body.trades[0].side === 'b');
    r = await call('POST', '/v1/trades/' + tid + '/offer', { offer: codeB }, B); check('they put a Tornie in', r.status === 200 && r.body.trade.mine === codeB && r.body.trade.theirs === codeA);
    r = await call('POST', '/v1/trades/' + tid + '/offer', { offer: codeC }, B); check('an offer can\'t be swapped afterwards', r.status === 400);
    r = await call('POST', '/v1/trades/' + tid + '/confirm', null, A); check('first confirm: still open, nothing to collect', r.body.trade.status === 'open' && !r.body.trade.collect);
    r = await call('POST', '/v1/trades/' + tid + '/cancel', null, C); check('outsiders can\'t touch it', r.status === 404);
    r = await call('POST', '/v1/trades/' + tid + '/confirm', null, B); check('both confirm: done, B collects A\'s Tornie', r.body.trade.status === 'done' && r.body.trade.collect === codeA);
    r = await call('GET', '/v1/trades', null, A); check('A collects B\'s Tornie', r.body.trades.find(x => x.id === tid).collect === codeB);
    r = await call('POST', '/v1/trades/' + tid + '/cancel', null, A); check('a finished trade can\'t be cancelled', r.status === 400);
    r = await call('POST', '/v1/trades/' + tid + '/collect', null, A); r = await call('GET', '/v1/trades', null, A); check('collected trades go away', !r.body.trades.some(x => x.id === tid));
    r = await call('POST', '/v1/trades/' + tid + '/collect', null, B);
    r = await call('POST', '/v1/trades', { to: 2, offer: codeA }, A); const tid2 = r.body.trade.id;
    await call('POST', '/v1/trades/' + tid2 + '/offer', { offer: codeB }, B);
    r = await call('POST', '/v1/trades/' + tid2 + '/cancel', null, B); check('cancel', r.body.trade.status === 'cancelled' && r.body.trade.collect === codeB);
    r = await call('GET', '/v1/trades', null, A); check('cancelled: each gets their own back', r.body.trades.find(x => x.id === tid2).collect === codeA);
    check('no server errors', !/error/i.test(logs), logs.split('\n').filter(l => /error/i.test(l)).slice(0, 3));
  } finally { srv.kill(); fake.close(); }
  console.log(fails.length ? fails.length + ' FAILED' : 'all passed');
  process.exit(fails.length ? 1 : 0);
})();
