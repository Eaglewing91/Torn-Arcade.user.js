// Makes real Tornie trade codes for the tests (same layout as the game's encodeTrade, no moves).
'use strict';
const SALT = 'torn-arcade/tornies/trade/v1', B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function fnv32(bytes, salt) { let h = 2166136261; const f = c => { h ^= c; h = Math.imul(h, 16777619); }; for (let i = 0; i < salt.length; i++) f(salt.charCodeAt(i) & 255); for (const b of bytes) f(b); return h >>> 0; }
function b64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 3) { const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0), k = Math.min(3, bytes.length - i); for (let j = 0; j <= k; j++) s += B64[(n >>> (18 - 6 * j)) & 63]; } return s; }
function put(a, v, n) { for (let i = n - 1; i >= 0; i--) a.push(Math.floor(v / Math.pow(256, i)) & 255); }
module.exports = function (o) {
  const b = []; put(b, 2, 1); put(b, o.sp, 2); put(b, o.lv, 1); put(b, 1000, 4);
  let iv = 0; (o.iv || [1, 2, 3, 4, 5, 6]).forEach((x, k) => { iv += (x & 31) * Math.pow(32, k); });
  put(b, iv + (o.golden ? Math.pow(2, 30) : 0), 4); put(b, 0, 1);
  put(b, o.from || 1, 4); put(b, o.to || 2, 4); put(b, o.id || 7, 4);
  [0, 0, 0, 0, 0, 0].forEach(v => put(b, v, 1));
  [o.nick || '', o.fromName || 'X'].forEach(s => { put(b, s.length, 1); for (const ch of s) b.push(ch.charCodeAt(0)); });
  put(b, fnv32(b, SALT), 4); return 'TORNIE-' + b64(b);
};
