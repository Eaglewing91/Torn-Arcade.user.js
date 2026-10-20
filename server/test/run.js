// End-to-end test against a local Postgres and a fake Torn API (no real keys).
// Needs: a local Postgres on /tmp:5433 with a database 'arcade'.
'use strict';
const http = require('http'), path = require('path'), { spawn, execFileSync } = require('child_process');
const PG = ['-h', '/tmp', '-p', '5433', '-U', 'postgres', '-d', 'arcade', '-At', '-X', '-q'];
const sql = s => execFileSync('psql', PG.concat(['-c', s]), { encoding: 'utf8' }).trim();
const KEYS = { AAAAAAAAAAAAAAAA: { id: 571041, name: 'Eaglewing' }, BBBBBBBBBBBBBBBB: { id: 2, name: 'Duke' }, CCCCCCCCCCCCCCCC: { id: 3, name: 'Leslie' } };
let tornCalls = 0, sawKeyInUrl = false;
const fake = http.createServer((req, res) => {
  tornCalls++; if (/key=/.test(req.url)) sawKeyInUrl = true;
  const k = (req.headers.authorization || '').replace('ApiKey ', '');
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(KEYS[k] ? { profile: Object.assign({ level: 50 }, KEYS[k]) } : { error: { code: 2, error: 'Incorrect key' } }));
}).listen(5871);
const fails = [];
function check(name, ok, extra) { console.log((ok ? 'ok   ' : 'FAIL ') + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); if (!ok) fails.push(name); }
async function call(method, p, body, token, origin) {
  const h = { 'Content-Type': 'application/json' }; if (token) h.Authorization = 'Bearer ' + token; if (origin) h.Origin = origin;
  const r = await fetch('http://127.0.0.1:5870' + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j, headers: r.headers };
}
(async () => {
  sql('DROP TABLE IF EXISTS ratings, tokens, accounts CASCADE');
  const srv = spawn('node', [path.join(__dirname, '../src/server.js')], { env: Object.assign({}, process.env, { PORT: '5870', DATABASE_URL: 'postgres://postgres@localhost:5433/arcade', TORN_API: 'http://127.0.0.1:5871', NODE_PATH: path.join(__dirname, 'shim') }), stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; srv.stdout.on('data', d => logs += d); srv.stderr.on('data', d => logs += d);
  for (let i = 0; i < 50 && !/port 5870/.test(logs); i++) await new Promise(r => setTimeout(r, 100));
  try {
    let r = await call('GET', '/health'); check('health', r.status === 200 && r.body.ok, r.body);
    r = await call('POST', '/v1/auth/torn', { key: 'short' }); check('rejects a malformed key without calling Torn', r.status === 400 && tornCalls === 0, r.body);
    r = await call('POST', '/v1/auth/torn', { key: 'ZZZZZZZZZZZZZZZZ' }); check('rejects a key Torn says is wrong', r.status === 400 && r.body.error === 'bad_key', r.body);
    r = await call('POST', '/v1/auth/torn', { key: 'AAAAAAAAAAAAAAAA' }); const tokA = r.body.token;
    check('verifies with a key', r.status === 200 && r.body.account.tornId === 571041 && r.body.account.name === 'Eaglewing' && r.body.account.verified, r.body.account);
    check('key sent in a header, never in the URL', !sawKeyInUrl);
    check('key never stored', sql("SELECT count(*) FROM accounts WHERE name LIKE '%AAAA%'") === '0' && !/AAAAAAAAAAAAAAAA/.test(sql("SELECT string_agg(t::text, ',') FROM (SELECT * FROM accounts) t") + sql("SELECT coalesce(string_agg(encode(hash, 'escape'), ','), '') FROM tokens")));
    check('token stored only as a hash', !sql("SELECT encode(hash, 'hex') FROM tokens").includes(Buffer.from(tokA).toString('hex')));
    r = await call('GET', '/v1/me', null, tokA); check('me', r.status === 200 && r.body.account.name === 'Eaglewing', r.body);
    r = await call('GET', '/v1/me'); check('me needs sign-in', r.status === 401);
    r = await call('GET', '/v1/me', null, 'x'.repeat(43)); check('a made-up token is refused', r.status === 401);
    // the same Torn ID signs into the same account
    r = await call('POST', '/v1/auth/torn', { key: 'AAAAAAAAAAAAAAAA' }); check('same Torn ID, same account', r.body.account.id === 1 && sql('SELECT count(*) FROM accounts') === '1', r.body.account);
    // guests, and a guest verifying keeps their account
    r = await call('POST', '/v1/auth/guest'); const tokG = r.body.token, gid = r.body.account.id;
    check('guest account', r.status === 200 && /^Guest-\d{4}$/.test(r.body.account.name) && !r.body.account.verified, r.body.account);
    r = await call('POST', '/v1/auth/torn', { key: 'BBBBBBBBBBBBBBBB' }, tokG); check('guest upgrades to verified', r.body.account.id === gid && r.body.account.name === 'Duke' && r.body.account.verified, r.body.account);
    r = await call('POST', '/v1/auth/torn', { key: 'CCCCCCCCCCCCCCCC' }); const tokC = r.body.token;
    // leaderboard: verified players with games only, best first; unknown game refused
    const ids = JSON.parse(sql("SELECT json_object_agg(name, id) FROM accounts"));
    sql(`INSERT INTO ratings (account_id, game, rating, games, wins) VALUES (${ids.Eaglewing}, 'territories', 1310, 12, 8), (${ids.Duke}, 'territories', 1250, 5, 3), (${ids.Leslie}, 'territories', 1200, 0, 0)`);
    r = await call('POST', '/v1/auth/guest'); sql(`INSERT INTO ratings (account_id, game, rating, games, wins) VALUES (${r.body.account.id}, 'territories', 1500, 9, 9)`);
    r = await call('GET', '/v1/leaderboard/territories', null, tokA);
    check('leaderboard order, verified only, played only', r.body.players.map(p => p.name).join(',') === 'Eaglewing,Duke' && r.body.me.rank === 1, r.body);
    r = await call('GET', '/v1/leaderboard/territories', null, tokC); check('unranked player sees no rank', r.body.me.rank === null && r.body.me.games === 0, r.body.me);
    r = await call('GET', '/v1/leaderboard/chess'); check('unknown game', r.status === 404);
    // CORS only for torn.com
    r = await call('GET', '/health', null, null, 'https://www.torn.com'); check('CORS for torn.com', r.headers.get('access-control-allow-origin') === 'https://www.torn.com');
    r = await call('GET', '/health', null, null, 'https://evil.example'); check('no CORS for other sites', !r.headers.get('access-control-allow-origin'));
    // bad input
    r = await fetch('http://127.0.0.1:5870/v1/auth/torn', { method: 'POST', body: '{nope' }); check('bad JSON', r.status === 400);
    r = await fetch('http://127.0.0.1:5870/v1/auth/torn', { method: 'POST', body: 'x'.repeat(9000) }).catch(() => ({ status: 413 })); check('large body refused', r.status === 413);
    // log out, delete account
    r = await call('POST', '/v1/auth/logout', null, tokC); r = await call('GET', '/v1/me', null, tokC); check('logout', r.status === 401);
    r = await call('DELETE', '/v1/me', null, tokA); check('delete account', r.status === 200 && sql("SELECT count(*) FROM accounts WHERE torn_id = 571041") === '0' && sql(`SELECT count(*) FROM ratings WHERE account_id = ${ids.Eaglewing}`) === '0' && sql(`SELECT count(*) FROM tokens WHERE account_id = ${ids.Eaglewing}`) === '0');
    r = await call('GET', '/v1/me', null, tokA); check('deleted token stops working', r.status === 401);
    // rate limit on sign-in
    let last; for (let i = 0; i < 12; i++) last = await call('POST', '/v1/auth/torn', { key: 'ZZZZZZZZZZZZZZZZ' });
    check('sign-in rate limit', last.status === 429, last.body);
    check('no server errors logged', !/error/i.test(logs.replace(/database setup/, '')), logs.trim());
  } finally { srv.kill(); fake.close(); }
  console.log(fails.length ? fails.length + ' FAILED' : 'all passed');
  process.exit(fails.length ? 1 : 0);
})();
