// Confirms who owns a Torn API key with one call to api.torn.com (user/basic, works with a Public key).
// The key is only held in memory for this one request. It is never stored or logged.
'use strict';
const BASE = process.env.TORN_API || 'https://api.torn.com';

async function whoIs(key) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9]{16}$/.test(key)) return { error: 'bad_key', message: 'That doesn\'t look like a Torn API key (16 letters and numbers).' };
  const ctl = new AbortController(), timer = setTimeout(function () { ctl.abort(); }, 8000);
  let d;
  try {
    const r = await fetch(BASE + '/v2/user/basic?comment=TornArcade', { headers: { Authorization: 'ApiKey ' + key, Accept: 'application/json' }, signal: ctl.signal });
    d = await r.json();
  } catch (e) {
    return { error: 'torn_down', message: 'Couldn\'t reach the Torn API. Try again in a minute.' };
  } finally { clearTimeout(timer); }
  if (d && d.error) {
    const code = d.error.code;
    if (code === 2 || code === 16 || code === 13 || code === 18) return { error: 'bad_key', message: 'Torn says that key isn\'t valid.' };
    if (code === 5 || code === 8 || code === 9) return { error: 'torn_busy', message: 'The Torn API is busy. Try again in a minute.' };
    return { error: 'torn_error', message: 'Torn API error: ' + String(d.error.error || code) };
  }
  const p = (d && d.profile) || d || {};
  const id = Number(p.id || p.player_id), name = String(p.name || '');
  if (!(id > 0) || !/^[A-Za-z0-9_-]{1,20}$/.test(name)) return { error: 'torn_error', message: 'Unexpected reply from the Torn API.' };
  return { id: id, name: name };
}

module.exports = { whoIs };
