// Cloud saves: verified players only, version checks (a save is never overwritten by an older one by accident),
// forced overwrite, size limits, delete, and deleted with the account.
'use strict';
const http = require('http'), path = require('path'), { spawn, execFileSync } = require('child_process');
const PG = ['-h', '/tmp', '-p', '5433', '-U', 'postgres', '-d', 'arcade', '-At', '-X', '-q'];
const sql = s => execFileSync('psql', PG.concat(['-c', s]), { encoding: 'utf8' }).trim();
const KEYS = { AAAAAAAAAAAAAAAA: { id: 571041, name: 'Eaglewing' }, BBBBBBBBBBBBBBBB: { id: 2, name: 'Duke' } };
const fake = http.createServer((q, s) => { const k = (q.headers.authorization || '').replace('ApiKey ', ''); s.end(JSON.stringify(KEYS[k] ? { profile: KEYS[k] } : { error: { code: 2 } })); }).listen(5871);
const fails = [];
function check(n, ok, x) { console.log((ok ? 'ok   ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 200) : '')); if (!ok) fails.push(n); }
async function call(m, p, body, tok) {
  const h = { 'Content-Type': 'application/json', 'X-Arcade-Version': '2.40.0' }; if (tok) h.Authorization = 'Bearer ' + tok;
  const r = await fetch('http://127.0.0.1:5870' + p, { method: m, headers: h, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (e) {} return { status: r.status, body: j };
}
(async () => {
  sql('DROP TABLE IF EXISTS server_jobs, cloud_saves, tornie_trades, tt_games, scores, ratings, tokens, accounts CASCADE');
  const srv = spawn('node', [path.join(__dirname, '../src/server.js')], { env: Object.assign({}, process.env, { PORT: '5870', DATABASE_URL: 'postgres://postgres@localhost:5433/arcade', TORN_API: 'http://127.0.0.1:5871', NODE_PATH: path.join(__dirname, 'shim') }), stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; srv.stdout.on('data', d => logs += d); srv.stderr.on('data', d => logs += d);
  for (let i = 0; i < 50 && !/port 5870/.test(logs); i++) await new Promise(r => setTimeout(r, 100));
  try {
    const A = (await call('POST', '/v1/auth/torn', { key: 'AAAAAAAAAAAAAAAA' })).body.token, B = (await call('POST', '/v1/auth/torn', { key: 'BBBBBBBBBBBBBBBB' })).body.token;
    const G = (await call('POST', '/v1/auth/guest')).body.token;
    let r = await call('GET', '/v1/saves', null, G); check('guests can\'t use cloud saves', r.status === 403);
    r = await call('GET', '/v1/saves', null, A); check('empty to start', r.status === 200 && Object.keys(r.body.slots).length === 0 && r.body.limit === 2097152);
    const s1 = JSON.stringify({ pocket: { v: 1, name: 'Alex', party: [1, 2, 3], note: 'it\'s "quoted"' } });
    r = await call('PUT', '/v1/saves/tornies', { data: s1, base: 0 }, A); check('first upload', r.status === 200 && r.body.ver === 1, r.body);
    r = await call('GET', '/v1/saves/tornies', null, A); check('download it back exactly', r.body.data === s1 && r.body.ver === 1);
    r = await call('GET', '/v1/saves/tornies', null, B); check('other players can\'t see it', r.status === 404);
    r = await call('PUT', '/v1/saves/tornies', { data: JSON.stringify({ pocket: { v: 1, name: 'Alex', step: 2 } }), base: 1 }, A); check('next upload', r.body.ver === 2);
    r = await call('PUT', '/v1/saves/tornies', { data: JSON.stringify({ pocket: { v: 1, old: true } }), base: 1 }, A); check('an upload based on an older version is refused', r.status === 409 && r.body.ver === 2, r.body);
    r = await call('GET', '/v1/saves/tornies', null, A); check('...and the newer save is untouched', JSON.parse(r.body.data).pocket.step === 2);
    r = await call('PUT', '/v1/saves/tornies', { data: JSON.stringify({ pocket: { v: 1, kept: 'device' } }), base: 1, force: true }, A); check('"keep this device" overwrites on purpose', r.status === 200 && r.body.ver === 3);
    r = await call('PUT', '/v1/saves/chess', { data: '{}', base: 0 }, A); check('unknown game refused', r.status === 404);
    r = await call('PUT', '/v1/saves/defence', { data: 'not json', base: 0 }, A); check('broken data refused', r.status === 400);
    r = await call('PUT', '/v1/saves/defence', { data: JSON.stringify({ x: 'y'.repeat(530 * 1024) }), base: 0 }, A); check('over 512 KB refused', r.status === 413, r.body);
    r = await call('PUT', '/v1/saves/defence', { data: JSON.stringify({ fdefence: { open: 3 } }), base: 0 }, A);
    r = await call('GET', '/v1/saves', null, A); check('list with versions and sizes', r.body.slots.tornies.ver === 3 && r.body.slots.defence.ver === 1 && r.body.used > 0, r.body);
    r = await call('DELETE', '/v1/saves', null, A); r = await call('GET', '/v1/saves', null, A); check('delete my cloud saves', Object.keys(r.body.slots).length === 0);
    await call('PUT', '/v1/saves/eggdash', { data: '{"eggdash":{"eggs":5}}', base: 0 }, B);
    await call('DELETE', '/v1/me', null, B); check('deleted with the account', sql('SELECT count(*) FROM cloud_saves') === '0');
    // older copies of the script can't send scores or (non-Tornies) cloud saves
    const old = async (m, p, body) => (await fetch('http://127.0.0.1:5870' + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + A, 'X-Arcade-Version': '2.39.0' }, body: JSON.stringify(body) })).status;
    check('2.39 can\'t send scores', await old('POST', '/v1/scores', { scores: { 'flappy:hard': 5 } }) === 426);
    check('2.39 can\'t save Egg Dash to the cloud', await old('PUT', '/v1/saves/eggdash', { data: '{}', base: 0 }) === 426);
    check('2.39 can still save Tornies to the cloud', await old('PUT', '/v1/saves/tornies', { data: '{"pocket":{"v":1}}', base: 0 }) === 200);
    r = await call('POST', '/v1/scores', { scores: { 'defence:2': 31 } }, A); check('Faction Defence boards top out at 30 waves', r.body.rejected.indexOf('defence:2') >= 0);
    check('no server errors', !/error/i.test(logs), logs.split('\n').filter(l => /error/i.test(l)).slice(0, 3));
  } finally { srv.kill(); fake.close(); }
  // the one-time fresh start: wipes every board except Tornies, Territories ratings and non-Tornies cloud saves
  await new Promise(r => setTimeout(r, 500));
  const id = sql("SELECT id FROM accounts WHERE torn_id = 571041");
  sql(`INSERT INTO scores (account_id, board, value) VALUES (${id}, 'tornies:caught', 50), (${id}, 'flappy:hard', 30), (${id}, 'defence:1', 20) ON CONFLICT DO NOTHING`);
  sql(`INSERT INTO ratings (account_id, game, rating, games, wins) VALUES (${id}, 'territories', 1300, 3, 2) ON CONFLICT DO NOTHING`);
  sql(`INSERT INTO cloud_saves (account_id, slot, data, ver, size) VALUES (${id}, 'bogies', '{}', 1, 2) ON CONFLICT DO NOTHING`);
  sql("DELETE FROM server_jobs WHERE name = 'fresh-start-2.40'");
  const srv2 = spawn('node', [path.join(__dirname, '../src/server.js')], { env: Object.assign({}, process.env, { PORT: '5870', DATABASE_URL: 'postgres://postgres@localhost:5433/arcade', TORN_API: 'http://127.0.0.1:5871', NODE_PATH: path.join(__dirname, 'shim') }), stdio: ['ignore', 'pipe', 'pipe'] });
  let logs2 = ''; srv2.stdout.on('data', d => logs2 += d);
  for (let i = 0; i < 50 && !/port 5870/.test(logs2); i++) await new Promise(r => setTimeout(r, 100));
  check('fresh start: Tornies boards kept, the rest wiped', sql('SELECT string_agg(board, \',\') FROM scores') === 'tornies:caught' && sql('SELECT count(*) FROM ratings') === '0' && sql("SELECT string_agg(slot, ',') FROM cloud_saves") === 'tornies', [sql('SELECT string_agg(board, \',\') FROM scores'), sql("SELECT string_agg(slot, ',') FROM cloud_saves")]);
  check('fresh start runs once', /fresh start 2.40 done/.test(logs2) && sql("SELECT count(*) FROM server_jobs WHERE name = 'fresh-start-2.40'") === '1');
  srv2.kill();
  console.log(fails.length ? fails.length + ' FAILED' : 'all passed');
  process.exit(fails.length ? 1 : 0);
})();
