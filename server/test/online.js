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
  sql('DROP TABLE IF EXISTS tornie_ids, trade_flags, trade_bans, chess_games, server_jobs, tornie_trades, tt_games, scores, ratings, tokens, accounts CASCADE');
  const srv = spawn('node', [path.join(__dirname, '../src/server.js')], { env: Object.assign({}, process.env, { TRADE_NEW_MAX: '100', PORT: '5870', DATABASE_URL: 'postgres://postgres@localhost:5433/arcade', TORN_API: 'http://127.0.0.1:5871', NODE_PATH: path.join(__dirname, 'shim'), TT_TURN_MS: '1500', TT_AI_MS: '20' }), stdio: ['ignore', 'pipe', 'pipe'] });
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
    const mk = require('./tcode'), codeA = mk({ sp: 4, lv: 10, iv: [1, 2, 3, 4, 5, 6] }), codeB = mk({ sp: 7, lv: 12, iv: [9, 9, 8, 7, 6, 5] }), codeC = mk({ sp: 9, lv: 3, iv: [3, 1, 4, 1, 5, 9] });
    const uA = 'tornie-a-1', uB = 'tornie-b-1', uC = 'tornie-c-1';
    r = await call('POST', '/v1/trades', { to: 2, offer: 'nope', uid: uA }, A); check('bad Tornie code refused', r.status === 400);
    r = await call('POST', '/v1/trades', { to: 571041, offer: codeA, uid: uA }, A); check('can\'t trade with yourself', r.status === 400);
    r = await call('POST', '/v1/trades', { to: 2, offer: codeA, uid: uA }, A); const tid = r.body.trade.id; check('start a trade', r.status === 200 && r.body.trade.mine === codeA && !r.body.trade.theirs);
    r = await call('GET', '/v1/inbox', null, B); check('trade shows in the inbox', r.body.trades.some(x => x.id === tid && x.with.name === 'Eaglewing'), r.body.trades);
    r = await call('POST', '/v1/trades/' + tid + '/confirm', null, A); check('can\'t confirm before both Tornies are in', r.status === 400);
    r = await call('GET', '/v1/trades', null, B); check('invited player sees the offered Tornie', r.body.trades[0].theirs === codeA && r.body.trades[0].side === 'b');
    r = await call('POST', '/v1/trades/' + tid + '/offer', { offer: codeB, uid: uB }, B); check('they put a Tornie in', r.status === 200 && r.body.trade.mine === codeB && r.body.trade.theirs === codeA);
    r = await call('POST', '/v1/trades/' + tid + '/offer', { offer: codeC, uid: uC }, B); check('an offer can\'t be swapped afterwards', r.status === 400);
    r = await call('POST', '/v1/trades/' + tid + '/confirm', null, A); check('first confirm: still open, nothing to collect', r.body.trade.status === 'open' && !r.body.trade.collect);
    r = await call('POST', '/v1/trades/' + tid + '/cancel', null, C); check('outsiders can\'t touch it', r.status === 404);
    r = await call('POST', '/v1/trades/' + tid + '/confirm', null, B); check('both confirm: done, B collects A\'s Tornie', r.body.trade.status === 'done' && r.body.trade.collect === codeA);
    r = await call('GET', '/v1/trades', null, A); check('A collects B\'s Tornie', r.body.trades.find(x => x.id === tid).collect === codeB);
    r = await call('POST', '/v1/trades/' + tid + '/cancel', null, A); check('a finished trade can\'t be cancelled', r.status === 400);
    r = await call('POST', '/v1/trades/' + tid + '/collect', null, A); r = await call('GET', '/v1/trades', null, A); check('collected trades go away', !r.body.trades.some(x => x.id === tid));
    r = await call('POST', '/v1/trades/' + tid + '/collect', null, B);
    r = await call('POST', '/v1/trades', { to: 2, offer: codeA, uid: uA }, A); check('anti-cheat: a Tornie already traded away (restored save) is refused', r.status === 400 && r.body.error === 'not_tradeable', r.body);
    r = await call('POST', '/v1/trades', { to: 2, offer: codeB, uid: uB }, A); const tid2 = r.body.trade.id; check('the new owner can trade it on', r.status === 200);
    r = await call('POST', '/v1/trades', { to: 3, offer: codeB, uid: uB }, A); check('anti-cheat: a Tornie can\'t be in two trades at once', r.status === 400 && /another trade/.test(r.body.message), r.body);
    await call('POST', '/v1/trades/' + tid2 + '/offer', { offer: codeA, uid: uA }, B);
    r = await call('POST', '/v1/trades/' + tid2 + '/cancel', null, B); check('cancel', r.body.trade.status === 'cancelled' && r.body.trade.collect === codeA && r.body.trade.collectUid === uA);
    r = await call('GET', '/v1/trades', null, A); check('cancelled: each gets their own back', r.body.trades.find(x => x.id === tid2).collect === codeB);
    // ---------- anti-cheat and the developer's trade watch ----------
    r = await call('POST', '/v1/trades', { to: 3, offer: codeA }, B); check('old versions (no Tornie ID) are asked to update', r.status === 426 && r.body.error === 'update');
    r = await call('POST', '/v1/trades', { to: 3, offer: mk({ sp: 4, lv: 10, iv: [31, 31, 31, 31, 31, 31] }), uid: uA }, B); check('anti-cheat: stats changed since last trade refused', r.status === 400 && /don't match/.test(r.body.message), r.body);
    r = await call('POST', '/v1/trades', { to: 3, offer: mk({ sp: 5, lv: 16, iv: [1, 2, 3, 4, 5, 6] }), uid: uA }, B); const tid3 = r.body.trade && r.body.trade.id; check('an evolved, levelled Tornie can still be traded by its owner', r.status === 200, r.body);
    r = await call('GET', '/v1/admin/trades', null, B); check('trade watch is developer only', r.status === 403);
    r = await call('GET', '/v1/admin/trades?tid=2', null, A); check('trade log', r.status === 200 && r.body.trades.length === 3 && r.body.trades[2].a.tornie.sp === 4 && r.body.trades[2].a.tornie.uid === uA && r.body.trades[2].status === 'done', r.body.trades && r.body.trades[2]);
    r = await call('GET', '/v1/admin/flags', null, A); check('flags recorded', r.body.flags.length === 3 && r.body.flags.map(f => f.reason).sort().join() === 'changed,in_trade,not_owner', r.body.flags.map(f => f.reason));
    r = await call('POST', '/v1/admin/revoke', { uid: uA, reason: 'duped' }, A); check('revoke a Tornie', r.status === 200);
    await call('POST', '/v1/trades/' + tid3 + '/offer', { offer: codeC, uid: uC }, C);
    r = await call('POST', '/v1/trades/' + tid3 + '/confirm', null, C); check('a trade with a revoked Tornie can\'t complete', r.status === 403);
    r = await call('POST', '/v1/trades/' + tid3 + '/cancel', null, C); check('but can be cancelled, each gets their own back', r.body.trade.collect === codeC);
    r = await call('POST', '/v1/trades', { to: 3, offer: mk({ sp: 5, lv: 16, iv: [1, 2, 3, 4, 5, 6] }), uid: uA }, B); check('a revoked Tornie can\'t be offered', r.status === 400 && /can't be traded/.test(r.body.message));
    r = await call('POST', '/v1/admin/ban', { tornId: 3, reason: 'testing' }, A); check('ban a player from trading', r.status === 200);
    r = await call('POST', '/v1/trades', { to: 2, offer: codeC, uid: uC }, C); check('banned player can\'t trade', r.status === 403 && r.body.error === 'trade_banned');
    r = await call('POST', '/v1/trades', { to: 3, offer: codeB, uid: uB }, A); check('nobody can start a trade with a banned player', r.status === 400);
    r = await call('GET', '/v1/admin/bans', null, A); check('ban and revoke lists', r.body.bans[0].tornId === 3 && r.body.revoked[0].uid === uA && r.body.revoked[0].reason === 'duped', r.body);
    r = await call('GET', '/v1/admin/tornies?uid=' + uA, null, A); check('look up a Tornie', r.body.tornies[0].owner === 2 && r.body.tornies[0].trades === 1 && r.body.tornies[0].sp === 5, r.body);
    await call('POST', '/v1/admin/unban', { tornId: 3 }, A); await call('POST', '/v1/admin/unrevoke', { uid: uA }, A);
    r = await call('POST', '/v1/trades', { to: 2, offer: codeC, uid: uC }, C); check('unban works', r.status === 200);
    r = await call('POST', '/v1/trades', { to: 3, offer: mk({ sp: 5, lv: 16, iv: [1, 2, 3, 4, 5, 6] }), uid: uA }, B); check('unrevoke works', r.status === 200, r.body);
    await call('POST', '/v1/trades/' + r.body.trade.id + '/offer', { offer: mk({ sp: 11, lv: 5 }), uid: 'tornie-c-2' }, C);
    await call('DELETE', '/v1/me', null, C);
    r = await call('GET', '/v1/admin/tornies?uid=' + uC, null, A); check('ownership records outlive account deletion', r.body.tornies.length === 1 && r.body.tornies[0].owner === 3);
    r = await call('POST', '/v1/trades', { to: 4, offer: mk({ sp: 5, lv: 16, iv: [1, 2, 3, 4, 5, 6] }), uid: uA }, B); check('a Tornie stuck in a deleted player\'s trade can be traded again', r.status === 200, r.body);
    check('no server errors', !/error/i.test(logs), logs.split('\n').filter(l => /error/i.test(l)).slice(0, 3));
  } finally { srv.kill(); fake.close(); }
  console.log(fails.length ? fails.length + ' FAILED' : 'all passed');
  process.exit(fails.length ? 1 : 0);
})();
