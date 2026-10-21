// Cloud saves (verified Online play players who turn Cloud saves on): each game's save is kept here so the same
// progress is on every device. One row per game ("slot"). Every upload says which version it was based on; if
// another device saved since, the upload is refused (409) and the phone asks the player which save to keep, so a
// save is never overwritten by an older one by accident.
// Limits per player: 512 KB per game, 2 MB in total, 30 uploads a minute.
'use strict';
const db = require('./db');

const SLOTS = ['tornies', 'defence', 'eggdash', 'bogies', 'scores', 'territories'];
const SLOT_MAX = 512 * 1024, TOTAL_MAX = 2 * 1024 * 1024;
const SCHEMA = `
CREATE TABLE IF NOT EXISTS cloud_saves (
  account_id  BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  slot        TEXT NOT NULL,
  data        TEXT NOT NULL,                  -- the game's own save, as JSON text
  ver         INTEGER NOT NULL,
  size        INTEGER NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, slot)
);
`;
async function migrate() { await db.q(SCHEMA); }

async function route(req, res, url, c) {
  const me = await c.whoAsks(req);
  if (!me) return c.fail(res, 401, 'signed_out', 'Sign in to use cloud saves.');
  if (me.banned) return c.fail(res, 403, 'banned', 'This account can\'t use cloud saves.');
  if (!me.verified) return c.fail(res, 403, 'verify_first', 'Verify your Torn ID to use cloud saves.');
  const path = url.pathname, method = req.method;
  if (path === '/v1/saves' && method === 'GET') {
    const rows = (await db.q('SELECT slot, ver, size, updated_at FROM cloud_saves WHERE account_id = $1', [me.id])).rows, slots = {};
    let used = 0; rows.forEach(function (r) { slots[r.slot] = { ver: r.ver, size: r.size, at: r.updated_at }; used += r.size; });
    return c.send(res, 200, { slots: slots, used: used, limit: TOTAL_MAX });
  }
  if (path === '/v1/saves' && method === 'DELETE') {
    await db.q('DELETE FROM cloud_saves WHERE account_id = $1', [me.id]);
    return c.send(res, 200, { ok: true });
  }
  const m = /^\/v1\/saves\/([a-z]+)$/.exec(path);
  if (!m || SLOTS.indexOf(m[1]) < 0) return c.fail(res, 404, 'not_found', 'Unknown save.');
  const slot = m[1];
  if (method === 'GET') {
    const r = (await db.q('SELECT data, ver, updated_at FROM cloud_saves WHERE account_id = $1 AND slot = $2', [me.id, slot])).rows[0];
    if (!r) return c.fail(res, 404, 'no_save', 'No cloud save for that game yet.');
    return c.send(res, 200, { ver: r.ver, at: r.updated_at, data: r.data });
  }
  if (method === 'PUT') {
    if (c.limited('acc' + me.id, 'saves', 30, 60000)) return c.fail(res, 429, 'slow_down', 'Too many cloud saves. Wait a minute.');
    const b = await c.readBody(req, SLOT_MAX + 4096);
    if (typeof b.data !== 'string' || !Number.isInteger(b.base) || b.base < 0) return c.fail(res, 400, 'bad_save', 'Bad request.');
    try { JSON.parse(b.data); } catch (e) { return c.fail(res, 400, 'bad_save', 'That save couldn\'t be read.'); }
    const size = Buffer.byteLength(b.data, 'utf8');
    if (size > SLOT_MAX) return c.fail(res, 413, 'too_big', 'This save is too big for the cloud (512 KB per game).');
    const others = (await db.q('SELECT coalesce(sum(size), 0)::int AS n FROM cloud_saves WHERE account_id = $1 AND slot <> $2', [me.id, slot])).rows[0].n;
    if (others + size > TOTAL_MAX) return c.fail(res, 413, 'too_big', 'Your cloud saves are full (2 MB).');
    const cur = (await db.q('SELECT ver, updated_at FROM cloud_saves WHERE account_id = $1 AND slot = $2', [me.id, slot])).rows[0];
    const curVer = cur ? cur.ver : 0;
    if (!b.force && b.base !== curVer) return c.send(res, 409, { error: 'newer_save', message: 'Another device saved this game since.', ver: curVer, at: cur ? cur.updated_at : null });
    const r = (await db.q('INSERT INTO cloud_saves (account_id, slot, data, ver, size) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (account_id, slot) DO UPDATE SET data = EXCLUDED.data, ver = EXCLUDED.ver, size = EXCLUDED.size, updated_at = now() RETURNING ver, updated_at',
      [me.id, slot, b.data, curVer + 1, size])).rows[0];
    return c.send(res, 200, { ver: r.ver, at: r.updated_at });
  }
  return c.fail(res, 404, 'not_found', 'Not found.');
}

module.exports = { migrate: migrate, route: route, SLOTS: SLOTS };
