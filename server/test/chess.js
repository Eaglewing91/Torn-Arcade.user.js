// Online Chess and public lobbies: invite, public list, Quick match (Chess and Territories), moves checked by the
// server, the 30-second timer (computer covers 3 timeouts, the 4th loses), resign, ratings, inbox.
'use strict';
const http = require('http'), path = require('path'), { spawn, execFileSync } = require('child_process');
const PG = ['-h', '/tmp', '-p', '5433', '-U', 'postgres', '-d', 'arcade', '-At', '-X', '-q'];
const sql = s => execFileSync('psql', PG.concat(['-c', s]), { encoding: 'utf8' }).trim();
const KEYS = { AAAAAAAAAAAAAAAA: { id: 571041, name: 'Eaglewing' }, BBBBBBBBBBBBBBBB: { id: 2, name: 'Duke' }, CCCCCCCCCCCCCCCC: { id: 3, name: 'Third' }, DDDDDDDDDDDDDDDD: { id: 4, name: 'Fourth' } };
const fake = http.createServer((q, s) => { const k = (q.headers.authorization || '').replace('ApiKey ', ''); s.end(JSON.stringify(KEYS[k] ? { profile: KEYS[k] } : { error: { code: 2 } })); }).listen(5871);
const fails = []; function check(n, ok, x) { console.log((ok ? 'ok   ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 220) : '')); if (!ok) fails.push(n); }
async function call(m, p, body, tok) { const h = { 'Content-Type': 'application/json', 'X-Arcade-Version': '2.42.0' }; if (tok) h.Authorization = 'Bearer ' + tok; const r = await fetch('http://127.0.0.1:5870' + p, { method: m, headers: h, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch (e) {} return { status: r.status, body: j }; }
const sq = n => (8 - +n[1]) * 8 + 'abcdefgh'.indexOf(n[0]);
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  sql('DROP TABLE IF EXISTS chess_games, server_jobs, cloud_saves, tornie_trades, tt_games, scores, ratings, tokens, accounts CASCADE');
  const srv = spawn('node', [path.join(__dirname, '../src/server.js')], { env: Object.assign({}, process.env, { PORT: '5870', DATABASE_URL: 'postgres://postgres@localhost:5433/arcade', TORN_API: 'http://127.0.0.1:5871', NODE_PATH: path.join(__dirname, 'shim'), CH_TURN_MS: '1500', TT_AI_MS: '20' }), stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; srv.stdout.on('data', d => logs += d); srv.stderr.on('data', d => logs += d);
  for (let i = 0; i < 50 && !/port 5870/.test(logs); i++) await wait(100);
  try {
    const T = {}; for (const k of Object.keys(KEYS)) T[KEYS[k].name] = (await call('POST', '/v1/auth/torn', { key: k })).body.token;
    const A = T.Eaglewing, B = T.Duke, C = T.Third, D = T.Fourth;
    // invite by Torn ID
    let r = await call('POST', '/v1/chess/games', { invite: 2, side: 'w' }, A); const g1 = r.body.game;
    check('invite made', r.status === 200 && g1.status === 'lobby' && g1.seats[1].st === 'pending', r.body);
    r = await call('GET', '/v1/inbox', null, B); check('invite in the inbox', r.body.invites.some(x => x.game === 'chess' && x.id === g1.id), r.body);
    r = await call('POST', '/v1/chess/games/' + g1.id + '/join', null, B); check('join starts the game', r.body.game.status === 'active', r.body);
    r = await call('POST', '/v1/chess/games/' + g1.id + '/move', { from: sq('e7'), to: sq('e5') }, B); check('not your move refused', r.status === 400);
    r = await call('POST', '/v1/chess/games/' + g1.id + '/move', { from: sq('e2'), to: sq('e5') }, A); check('illegal move refused', r.status === 400);
    const play = async (tok, a, b) => (await call('POST', '/v1/chess/games/' + g1.id + '/move', { from: sq(a), to: sq(b) }, tok)).body;
    await play(A, 'f2', 'f3'); await play(B, 'e7', 'e5'); await play(A, 'g2', 'g4'); r = await play(B, 'd8', 'h4');
    check('fool\'s mate', r.san === 'Qh4#', r);
    r = await call('GET', '/v1/chess/games/' + g1.id, null, A); check('game over, black wins by checkmate', r.body.game.status === 'over' && r.body.state.result === 'b' && r.body.state.reason === 'checkmate', r.body.game);
    await wait(300); check('rated', sql("SELECT string_agg(account_id || ':' || rating, ',' ORDER BY account_id) FROM ratings WHERE game = 'chess'") !== '', sql("SELECT string_agg(rating::text, ',') FROM ratings WHERE game = 'chess'"));
    // public game + list + join
    r = await call('POST', '/v1/chess/games', { public: true }, C); const g2 = r.body.game;
    r = await call('GET', '/v1/chess/public', null, D); check('public game listed', r.body.games.some(x => x.id === g2.id), r.body);
    r = await call('GET', '/v1/chess/public', null, C); check('own game not in your list', !r.body.games.some(x => x.id === g2.id));
    r = await call('POST', '/v1/chess/games/' + g2.id + '/join', null, D); check('anyone can join a public game', r.body.game.status === 'active');
    r = await call('GET', '/v1/chess/public', null, A); check('started game leaves the list', !r.body.games.some(x => x.id === g2.id));
    // timeout: computer covers 3 moves, the 4th loses
    const w2 = r = await call('GET', '/v1/chess/games/' + g2.id, null, C); const white = w2.body.game.seats[0].name;
    const whiteTok = white === 'Third' ? C : D, blackTok = white === 'Third' ? D : C;
    let autos = 0;
    for (let k = 0; k < 40; k++) {
      await wait(400);
      const s = (await call('GET', '/v1/chess/games/' + g2.id, null, blackTok)).body;
      if (s.game.status === 'over') break;
      if (s.state.turn === 'b' && !s.state.result) { const E = require('../src/chess-engine.js')({}); const m = E.bestMove(s.state, 'easy', 50); await call('POST', '/v1/chess/games/' + g2.id + '/move', m, blackTok); }
      autos = s.game.seats[0].auto;
    }
    r = await call('GET', '/v1/chess/games/' + g2.id, null, whiteTok);
    check('3 computer moves, then lost on time', r.body.game.status === 'over' && r.body.state.result === 'b' && r.body.state.reason === 'ran out of time' && r.body.game.seats[0].auto === 3, r.body.game);
    // Quick match chess
    r = await call('POST', '/v1/chess/quick', {}, A); check('quick match opens a public game when nobody waits', r.body.matched === false && r.body.game.public);
    const q1 = r.body.game.id;
    r = await call('POST', '/v1/chess/quick', {}, A); check('asking again keeps the same game', r.body.game.id === q1);
    r = await call('POST', '/v1/chess/quick', {}, B); check('quick match pairs the next player', r.body.matched === true && r.body.game.id === q1 && r.body.game.status === 'active', r.body);
    r = await call('POST', '/v1/chess/games/' + q1 + '/resign', null, A); check('resign', r.status === 200);
    r = await call('GET', '/v1/chess/games/' + q1, null, B); check('...opponent wins', r.body.state.reason === 'resignation' && r.body.game.status === 'over');
    // Territories: public lobby + quick match
    r = await call('POST', '/v1/tt/quick', { size: 'large', col: 0 }, A); const t1 = r.body.game;
    check('territories quick match opens a public lobby (3 open seats)', t1.public && t1.open === 3, t1);
    r = await call('GET', '/v1/tt/public?size=large', null, B); check('listed in the public lobby', r.body.games.some(x => x.id === t1.id));
    r = await call('GET', '/v1/tt/public?size=fp12', null, B); check('not listed under another game type', !r.body.games.some(x => x.id === t1.id));
    r = await call('POST', '/v1/tt/quick', { size: 'large' }, B); check('quick match fills a seat', r.body.matched && r.body.game.id === t1.id && r.body.game.open === 2);
    r = await call('POST', '/v1/tt/games/' + t1.id + '/join', null, C); check('join from the list', r.body.game.open === 1);
    r = await call('POST', '/v1/tt/games/' + t1.id + '/join', null, D); check('full public lobby starts by itself', r.body.game.status === 'active', r.body.game);
    r = await call('POST', '/v1/tt/games', { invite: [2], public: true, size: 'fp16' }, C); check('invite + public together', r.body.game.public && r.body.game.seats.filter(s => s.st === 'pending').length === 1 && r.body.game.open === 2, r.body.game);
    r = await call('POST', '/v1/tt/games/' + r.body.game.id + '/start', null, C); check('host can start early (computer takes empty seats)', r.body.game.status === 'active');
    r = await call('GET', '/v1/leaderboard/chess', null, A); check('chess leaderboard', r.status === 200 && r.body.players.length >= 2, r.body);
    check('no server errors', !/error/i.test(logs), logs.split('\n').filter(l => /error/i.test(l)).slice(0, 3));
  } finally { srv.kill(); fake.close(); }
  console.log(fails.length ? fails.length + ' FAILED' : 'all passed'); process.exit(fails.length ? 1 : 0);
})();
