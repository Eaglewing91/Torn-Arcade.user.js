// Test-only stand-in for the 'pg' driver: runs each query through the psql command line against a local
// Postgres, so the real SQL is checked without installing the driver. Never used in production.
'use strict';
const { execFileSync } = require('child_process');
function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (Buffer.isBuffer(v)) return "'\\x" + v.toString('hex') + "'::bytea";
  return "'" + String(v).replace(/'/g, "''") + "'";
}
class Pool {
  constructor(o) { const u = new URL(o.connectionString); this.args = ['-h', '/tmp', '-p', u.port || '5432', '-U', u.username, '-d', u.pathname.slice(1), '-At', '-X', '-q', '-v', 'ON_ERROR_STOP=1']; }
  on() {}
  async end() {}
  async query(text, params) {
    let sql = text;
    (params || []).map((p, i) => i + 1).sort((a, b) => b - a).forEach(n => { sql = sql.split('$' + n).join(lit(params[n - 1])); });
    const t = sql.trim(), up = t.toUpperCase();
    let run;
    if (up.startsWith('CREATE')) run = t;
    else if (up.startsWith('SELECT')) run = "SELECT coalesce(json_agg(t), '[]') FROM (" + t + ') t';
    else if (/RETURNING/i.test(t)) run = 'WITH t AS (' + t + ") SELECT coalesce(json_agg(t), '[]') FROM t";
    else run = t;
    let out;
    try { out = execFileSync('psql', this.args.concat(['-c', run]), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { throw new Error(String(e.stderr || e.message).trim()); }
    const s = out.trim();
    return { rows: s.startsWith('[') ? JSON.parse(s) : [] };
  }
}
module.exports = { Pool };
