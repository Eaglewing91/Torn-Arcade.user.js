// Reads a Tornie trade code (the same format the game makes) so the server can log what was traded and check that a
// Tornie's stats never change between trades. Returns null when the code is damaged.
'use strict';
const PREFIX = 'TORNIE-', SALT = 'torn-arcade/tornies/trade/v1';
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function fnv32(bytes, salt) {
  let h = 2166136261;
  const feed = function (c) { h ^= c; h = Math.imul(h, 16777619); };
  for (let i = 0; i < salt.length; i++) feed(salt.charCodeAt(i) & 255);
  for (let i = 0; i < bytes.length; i++) feed(bytes[i]);
  return h >>> 0;
}
function b64dec(s) {
  const out = [];
  for (let i = 0; i < s.length; i += 4) {
    const ch = s.slice(i, i + 4);
    let n = 0;
    for (let j = 0; j < 4; j++) { const v = j < ch.length ? B64.indexOf(ch[j]) : 0; if (v < 0) return null; n |= v << (18 - 6 * j); }
    for (let j = 0; j < ch.length - 1; j++) out.push((n >>> (16 - 8 * j)) & 255);
  }
  return out;
}
function get(b, at, n) { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + b[at.i++]; return v; }

function decode(code) {
  try {
    code = String(code || '').replace(/\s+/g, '');
    if (code.toUpperCase().indexOf(PREFIX) !== 0) return null;
    const b = b64dec(code.slice(PREFIX.length));
    if (!b || b.length < 30) return null;
    if (fnv32(b.slice(0, b.length - 4), SALT) !== get(b, { i: b.length - 4 }, 4)) return null;
    const at = { i: 1 };
    const sp = get(b, at, 2), lv = get(b, at, 1); get(b, at, 4);
    const ivr = get(b, at, 4), n = get(b, at, 1);
    at.i += n * 3;
    const from = get(b, at, 4); get(b, at, 4); get(b, at, 4);
    if (b[0] >= 2) at.i += 6;
    const strs = [0, 1].map(function () { const L = get(b, at, 1); let s = ''; for (let k = 0; k < L; k++) s += String.fromCharCode(b[at.i++]); return s; });
    if (at.i !== b.length - 4 || sp < 1 || lv < 1 || lv > 100) return null;
    const golden = ivr >= Math.pow(2, 30);
    return { sp: sp, lv: lv, golden: golden, ivs: ivr % Math.pow(2, 30), nick: strs[0].replace(/[^A-Za-z0-9 .'\-]/g, '').slice(0, 10), from: from };
  } catch (e) { return null; }
}

module.exports = { decode: decode };
