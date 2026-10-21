  /* ================= Chess: the rules engine and the computer player =================
     Full rules: castling, en passant, promotion, check, checkmate, stalemate, the 50-move rule, threefold repetition
     and insufficient material. The same code runs on the phone (games against the computer) and on the Torn Arcade
     server (online games, where the server checks every move and plays timed-out moves). No screen, sound or storage.
     A game is one plain object (S) that can be saved or sent as JSON:
       b: 64 squares, index 0 = a8 ... 63 = h1; each '' or colour + piece, e.g. 'wK', 'bP'
       turn 'w' | 'b', castle 'KQkq' subset, ep: en-passant target square or -1, half: 50-move clock, full: move number,
       moves: [{ from, to, promo, san, cap }], reps: { positionKey: count }, result: null | 'w' | 'b' | 'draw', reason */
  function ChessEngine(env) {
    env = env || {};
    const rnd = env.rnd || Math.random;
    const FILES = 'abcdefgh';
    const VAL = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };
    // Piece-square tables from White's side (index 0 = a8). Black uses the mirror.
    const PST = {
      P: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
      N: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
      B: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
      R: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
      Q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
      K: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
      KE: [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50]
    };
    const KN = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
    const KG = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
    const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]], ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    function sqName(i) { return FILES[i % 8] + (8 - Math.floor(i / 8)); }
    function at(r, f) { return r >= 0 && r < 8 && f >= 0 && f < 8 ? r * 8 + f : -1; }
    function opp(c) { return c === 'w' ? 'b' : 'w'; }

    function newGame() {
      const back = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'], b = Array(64).fill('');
      for (let f = 0; f < 8; f++) { b[f] = 'b' + back[f]; b[8 + f] = 'bP'; b[48 + f] = 'wP'; b[56 + f] = 'w' + back[f]; }
      const S = { v: 1, b: b, turn: 'w', castle: 'KQkq', ep: -1, half: 0, full: 1, moves: [], reps: {}, result: null, reason: '' };
      S.reps[key(S)] = 1;
      return S;
    }
    function key(S) { return S.b.join(',') + '|' + S.turn + '|' + S.castle + '|' + S.ep; }

    /* ---------- Move generation ---------- */
    function attacked(b, sq, by) {   // is square sq attacked by colour `by`?
      const r = Math.floor(sq / 8), f = sq % 8;
      const pr = by === 'w' ? r + 1 : r - 1;   // a white pawn attacks from the rank below (higher index)
      for (const df of [-1, 1]) { const s = at(pr, f + df); if (s >= 0 && b[s] === by + 'P') return true; }
      for (const d of KN) { const s = at(r + d[0], f + d[1]); if (s >= 0 && b[s] === by + 'N') return true; }
      for (const d of KG) { const s = at(r + d[0], f + d[1]); if (s >= 0 && b[s] === by + 'K') return true; }
      for (const d of DIAG) for (let k = 1; k < 8; k++) { const s = at(r + d[0] * k, f + d[1] * k); if (s < 0) break; if (b[s]) { if (b[s] === by + 'B' || b[s] === by + 'Q') return true; break; } }
      for (const d of ORTH) for (let k = 1; k < 8; k++) { const s = at(r + d[0] * k, f + d[1] * k); if (s < 0) break; if (b[s]) { if (b[s] === by + 'R' || b[s] === by + 'Q') return true; break; } }
      return false;
    }
    function kingSq(b, c) { return b.indexOf(c + 'K'); }
    function inCheck(S, c) { return attacked(S.b, kingSq(S.b, c || S.turn), opp(c || S.turn)); }
    function pseudo(S, capsOnly) {
      const b = S.b, c = S.turn, o = opp(c), out = [];
      for (let i = 0; i < 64; i++) {
        const p = b[i]; if (!p || p[0] !== c) continue;
        const t = p[1], r = Math.floor(i / 8), f = i % 8;
        if (t === 'P') {
          const dir = c === 'w' ? -1 : 1, start = c === 'w' ? 6 : 1, last = c === 'w' ? 0 : 7;
          const add = function (to, cap, flag) { if (Math.floor(to / 8) === last) ['Q', 'R', 'B', 'N'].forEach(function (q) { out.push({ from: i, to: to, promo: q, cap: cap }); }); else out.push({ from: i, to: to, cap: cap, flag: flag }); };
          const one = at(r + dir, f);
          if (!capsOnly && one >= 0 && !b[one]) { add(one, ''); const two = at(r + 2 * dir, f); if (r === start && !b[two]) add(two, '', 'd'); }
          for (const df of [-1, 1]) { const s = at(r + dir, f + df); if (s < 0) continue; if (b[s] && b[s][0] === o) add(s, b[s]); else if (s === S.ep) add(s, o + 'P', 'e'); }
        } else if (t === 'N' || t === 'K') {
          for (const d of (t === 'N' ? KN : KG)) { const s = at(r + d[0], f + d[1]); if (s < 0 || (b[s] && b[s][0] === c)) continue; if (capsOnly && !b[s]) continue; out.push({ from: i, to: s, cap: b[s] }); }
          if (t === 'K' && !capsOnly) {   // castling: not out of, through or into check
            const home = c === 'w' ? 60 : 4, ks = c === 'w' ? 'K' : 'k', qs = c === 'w' ? 'Q' : 'q';
            if (i === home && !attacked(b, home, o)) {
              if (S.castle.indexOf(ks) >= 0 && !b[home + 1] && !b[home + 2] && b[home + 3] === c + 'R' && !attacked(b, home + 1, o) && !attacked(b, home + 2, o)) out.push({ from: i, to: home + 2, cap: '', flag: 'k' });
              if (S.castle.indexOf(qs) >= 0 && !b[home - 1] && !b[home - 2] && !b[home - 3] && b[home - 4] === c + 'R' && !attacked(b, home - 1, o) && !attacked(b, home - 2, o)) out.push({ from: i, to: home - 2, cap: '', flag: 'q' });
            }
          }
        } else {
          const dirs = t === 'B' ? DIAG : t === 'R' ? ORTH : DIAG.concat(ORTH);
          for (const d of dirs) for (let k = 1; k < 8; k++) {
            const s = at(r + d[0] * k, f + d[1] * k); if (s < 0) break;
            if (b[s]) { if (b[s][0] === o) out.push({ from: i, to: s, cap: b[s] }); break; }
            if (!capsOnly) out.push({ from: i, to: s, cap: '' });
          }
        }
      }
      return out;
    }
    // Make a move on S in place and return what's needed to undo it (fast, for the search).
    function make(S, m) {
      const b = S.b, p = b[m.from], c = p[0], u = { m: m, p: p, castle: S.castle, ep: S.ep, half: S.half, full: S.full, turn: S.turn };
      b[m.to] = m.promo ? c + m.promo : p; b[m.from] = '';
      if (m.flag === 'e') b[m.to + (c === 'w' ? 8 : -8)] = '';
      if (m.flag === 'k') { b[m.to - 1] = b[m.to + 1]; b[m.to + 1] = ''; }
      if (m.flag === 'q') { b[m.to + 1] = b[m.to - 2]; b[m.to - 2] = ''; }
      let cs = S.castle;
      if (p[1] === 'K') cs = cs.replace(c === 'w' ? /[KQ]/g : /[kq]/g, '');
      [[63, 'K'], [56, 'Q'], [7, 'k'], [0, 'q']].forEach(function (x) { if (m.from === x[0] || m.to === x[0]) cs = cs.replace(x[1], ''); });
      S.castle = cs;
      S.ep = m.flag === 'd' ? (m.from + m.to) / 2 : -1;
      S.half = p[1] === 'P' || m.cap ? 0 : S.half + 1;
      if (c === 'b') S.full++;
      S.turn = opp(c);
      return u;
    }
    function unmake(S, u) {
      const b = S.b, m = u.m, c = u.p[0];
      b[m.from] = u.p; b[m.to] = m.flag === 'e' ? '' : m.cap;
      if (m.flag === 'e') b[m.to + (c === 'w' ? 8 : -8)] = m.cap;
      if (m.flag === 'k') { b[m.to + 1] = b[m.to - 1]; b[m.to - 1] = ''; }
      if (m.flag === 'q') { b[m.to - 2] = b[m.to + 1]; b[m.to + 1] = ''; }
      S.castle = u.castle; S.ep = u.ep; S.half = u.half; S.full = u.full; S.turn = u.turn;
    }
    function legal(S, capsOnly) {
      const c = S.turn;
      return pseudo(S, capsOnly).filter(function (m) { const u = make(S, m), ok = !attacked(S.b, kingSq(S.b, c), opp(c)); unmake(S, u); return ok; });
    }

    /* ---------- Notation and game end ---------- */
    function san(S, m, all) {
      const p = S.b[m.from], t = p[1];
      let s;
      if (m.flag === 'k') s = 'O-O'; else if (m.flag === 'q') s = 'O-O-O';
      else {
        s = t === 'P' ? (m.cap ? FILES[m.from % 8] : '') : t;
        if (t !== 'P' && t !== 'K') {
          const twins = all.filter(function (x) { return x.to === m.to && x.from !== m.from && S.b[x.from] === p; });
          if (twins.length) {
            const sameF = twins.some(function (x) { return x.from % 8 === m.from % 8; }), sameR = twins.some(function (x) { return Math.floor(x.from / 8) === Math.floor(m.from / 8); });
            s += !sameF ? FILES[m.from % 8] : !sameR ? String(8 - Math.floor(m.from / 8)) : sqName(m.from);
          }
        }
        s += (m.cap ? 'x' : '') + sqName(m.to) + (m.promo ? '=' + m.promo : '');
      }
      const u = make(S, m), check = inCheck(S), mate = check && !legal(S).length; unmake(S, u);
      return s + (mate ? '#' : check ? '+' : '');
    }
    function insufficient(b) {
      const ps = b.filter(Boolean).filter(function (p) { return p[1] !== 'K'; });
      if (!ps.length) return true;
      if (ps.length === 1 && (ps[0][1] === 'B' || ps[0][1] === 'N')) return true;
      if (ps.every(function (p) { return p[1] === 'B'; })) {   // bishops all on one colour of square
        const cols = {}; b.forEach(function (p, i) { if (p && p[1] === 'B') cols[(Math.floor(i / 8) + i % 8) % 2] = 1; });
        return Object.keys(cols).length === 1;
      }
      return false;
    }
    function checkEnd(S) {
      const moves = legal(S);
      if (!moves.length) { if (inCheck(S)) { S.result = opp(S.turn); S.reason = 'checkmate'; } else { S.result = 'draw'; S.reason = 'stalemate'; } }
      else if (S.half >= 100) { S.result = 'draw'; S.reason = '50-move rule'; }
      else if ((S.reps[key(S)] || 0) >= 3) { S.result = 'draw'; S.reason = 'threefold repetition'; }
      else if (insufficient(S.b)) { S.result = 'draw'; S.reason = 'insufficient material'; }
      return S.result;
    }
    // Play a move given as { from, to, promo }. Returns { ok, san } or { err }.
    function play(S, mv) {
      if (!S || S.result) return { err: 'over' };
      if (!mv || !Number.isInteger(mv.from) || !Number.isInteger(mv.to)) return { err: 'bad' };
      const all = legal(S), m = all.find(function (x) { return x.from === mv.from && x.to === mv.to && (x.promo || '') === (x.promo ? (mv.promo || 'Q') : ''); });
      if (!m) return { err: 'illegal' };
      const s = san(S, m, all);
      make(S, m);
      S.moves.push({ from: m.from, to: m.to, promo: m.promo || '', san: s, cap: m.cap || '' });
      S.reps[key(S)] = (S.reps[key(S)] || 0) + 1;
      checkEnd(S);
      return { ok: true, san: s };
    }
    function resign(S, c, why) { if (S.result) return; S.result = opp(c); S.reason = why || 'resignation'; }

    /* ---------- The computer player: alpha-beta search with quiescence ---------- */
    function evaluate(S) {   // from the side to move
      const b = S.b; let s = 0, mat = 0;
      for (let i = 0; i < 64; i++) { const p = b[i]; if (p && p[1] !== 'K' && p[1] !== 'P') mat += VAL[p[1]]; }
      const endgame = mat <= 1600;
      for (let i = 0; i < 64; i++) {
        const p = b[i]; if (!p) continue;
        const t = p[1], idx = p[0] === 'w' ? i : (7 - Math.floor(i / 8)) * 8 + i % 8;
        const v = VAL[t] + (t === 'K' && endgame ? PST.KE[idx] : PST[t][idx]);
        s += p[0] === 'w' ? v : -v;
      }
      if (endgame && Math.abs(s) > 250) {   // winning endgame: drive the other king to the edge and bring your own king closer
        const win = s > 0 ? 'w' : 'b', lk = kingSq(b, opp(win)), wk = kingSq(b, win);
        const lr = Math.floor(lk / 8), lf = lk % 8, edge = Math.max(3 - lr, lr - 4) + Math.max(3 - lf, lf - 4);
        const close = 14 - (Math.abs(lr - Math.floor(wk / 8)) + Math.abs(lf - wk % 8));
        const bonus = 12 * edge + 5 * close;
        s += win === 'w' ? bonus : -bonus;
      }
      return S.turn === 'w' ? s : -s;
    }
    function order(ms) { return ms.sort(function (a, b) { return ((b.cap ? VAL[b.cap[1]] * 10 : 0) + (b.promo ? 800 : 0)) - ((a.cap ? VAL[a.cap[1]] * 10 : 0) + (a.promo ? 800 : 0)); }); }
    function quiesce(S, alpha, beta, ctx) {
      ctx.nodes++;
      const stand = evaluate(S);
      if (stand >= beta) return beta;
      if (stand > alpha) alpha = stand;
      const c = S.turn, ms = order(pseudo(S, true));
      for (const m of ms) {
        const u = make(S, m);
        if (attacked(S.b, kingSq(S.b, c), opp(c))) { unmake(S, u); continue; }
        const sc = -quiesce(S, -beta, -alpha, ctx); unmake(S, u);
        if (sc >= beta) return beta;
        if (sc > alpha) alpha = sc;
      }
      return alpha;
    }
    function search(S, depth, alpha, beta, ctx, ply) {
      if (ctx.stop || (ctx.nodes & 1023) === 0 && Date.now() > ctx.until) { ctx.stop = true; return 0; }
      if (depth <= 0) return quiesce(S, alpha, beta, ctx);
      ctx.nodes++;
      const c = S.turn, ms = order(pseudo(S, false));
      let any = false;
      for (const m of ms) {
        const u = make(S, m);
        if (attacked(S.b, kingSq(S.b, c), opp(c))) { unmake(S, u); continue; }
        any = true;
        const sc = -search(S, depth - 1, -beta, -alpha, ctx, ply + 1); unmake(S, u);
        if (ctx.stop) return 0;
        if (sc >= beta) return beta;
        if (sc > alpha) alpha = sc;
      }
      if (!any) return attacked(S.b, kingSq(S.b, c), opp(c)) ? -100000 + ply : 0;   // mated (prefer the quickest mate) or stalemate
      return alpha;
    }
    // Best move for the side to move. diff: 'easy' | 'normal' | 'hard'. ms: time limit.
    function bestMove(S0, diff, ms) {
      const S = JSON.parse(JSON.stringify({ b: S0.b, turn: S0.turn, castle: S0.castle, ep: S0.ep, half: S0.half, full: S0.full }));
      const moves = legal(S); if (!moves.length) return null;
      const D = { easy: { depth: 1, noise: 120, wild: 0.25 }, normal: { depth: 3, noise: 15, wild: 0 }, hard: { depth: 5, noise: 0, wild: 0 } }[diff] || { depth: 3, noise: 15, wild: 0 };
      if (D.wild && rnd() < D.wild) return moves[Math.floor(rnd() * moves.length)];   // Easy sometimes just plays something
      const ctx = { nodes: 0, until: Date.now() + (ms || (diff === 'hard' ? 1500 : 600)), stop: false };
      let best = moves[0], order1 = order(moves.slice());
      for (let depth = 1; depth <= D.depth; depth++) {   // iterative deepening: the best move so far is searched first
        let alpha = -Infinity, top = null;
        const list = [best].concat(order1.filter(function (m) { return m !== best; })), done = [];
        for (const m of list) {
          const u = make(S, m), sc = -search(S, depth - 1, -Infinity, D.noise ? Infinity : -alpha, ctx, 1); unmake(S, u);
          if (ctx.stop) break;
          const v = sc + (D.noise ? (rnd() - 0.5) * D.noise : 0);
          done.push(m);
          if (v > alpha) { alpha = v; top = m; }
        }
        if (top && (!ctx.stop || done.length > 1)) best = top;
        if (ctx.stop) break;
        if (alpha > 90000) break;   // found a mate
      }
      return { from: best.from, to: best.to, promo: best.promo || '' };
    }
    // A copy for the screen: legal moves for the side to move, whether it's check
    function info(S) { return { moves: legal(S).map(function (m) { return { from: m.from, to: m.to, promo: m.promo || '' }; }), check: inCheck(S), king: kingSq(S.b, S.turn) }; }

    return { _make: make, _unmake: unmake, newGame: newGame, play: play, legal: legal, bestMove: bestMove, info: info, inCheck: inCheck, resign: resign, sqName: sqName, VAL: VAL, checkEnd: checkEnd, key: key };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = ChessEngine;
