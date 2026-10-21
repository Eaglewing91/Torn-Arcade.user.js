  /* ================= Torn Territories: the rules engine =================
     Everything about the game itself: the board, the rules, every player action (act) and the computer players.
     It has no screen, sound or storage of its own, so the same code runs in the phone (games on this device) and
     on the Torn Arcade server (online games, where the server checks every move). The game lives in one plain
     object (G) that can be saved or sent as JSON. env gives it: rnd (random numbers), viewer() (whose screen this
     is, -1 on the server) and hooks for sounds and effects (snd, collect, lost, rolled, turn, win, last). */
  function TTEngine(env) {
    env = env || {};
    const noop = function () {};
    ['snd', 'collect', 'lost', 'rolled', 'turn', 'win', 'last'].forEach(function (k) { if (!env[k]) env[k] = noop; });
    const rnd = env.rnd || Math.random;
    function VIEW() { return env.viewer ? env.viewer() : -1; }
    let G = null;
    function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
    function pips(n) { return n ? 6 - Math.abs(7 - n) : 0; }
    function list(o) { return Object.keys(o).filter(function (r) { return o[r]; }).map(function (r) { return o[r] + ' ' + RN[r]; }).join(' + '); }
    function sum(o) { return Object.keys(o || {}).reduce(function (a, k) { return a + (o[k] || 0); }, 0); }
    const RES = ['brick', 'wood', 'wheat', 'ore', 'cotton'];
    const RN = { brick: 'Brick', wood: 'Wood', wheat: 'Wheat', ore: 'Ore', cotton: 'Cotton' };
    const DIST = {
      brick: { name: 'Brickworks', fill: ['#d0603e', '#8a3420'] },
      wood: { name: 'Timber Yard', fill: ['#4f9a4a', '#25602a'] },
      wheat: { name: 'Wheat Fields', fill: ['#efc64a', '#b0861a'] },
      ore: { name: 'Ore Mine', fill: ['#7f8aa0', '#434b5e'] },
      cotton: { name: 'Cotton Mill', fill: ['#cdbfe6', '#7d6ea8'] },
      none: { name: 'Racket HQ', fill: ['#4a4458', '#2a2636'] },
      sky: { name: 'Open Sky', fill: ['#6fa8e8', '#2d5c9e'] },            // Flight Paths only
      gold: { name: 'Smuggler\'s Den', fill: ['#f5cf55', '#9a6512'] }      // Flight Paths only: pays any card you choose
    };
    // Flight Paths: the islands are named after Torn's travel destinations
    const ISLANDS = ['Mexico', 'Cayman Islands', 'Canada', 'Hawaii', 'United Kingdom', 'Argentina', 'Switzerland', 'Japan', 'China', 'UAE', 'South Africa'];
    const COST = { route: { brick: 1, wood: 1 }, safe: { brick: 1, wood: 1, wheat: 1, cotton: 1 }, hq: { wheat: 2, ore: 3 }, fav: { wheat: 1, ore: 1, cotton: 1 }, fly: { wood: 1, cotton: 1 } };
    const FAV = {
      crew: { name: 'Call in the Crew', text: 'Send the police raid to any district and take a card from a rival there.' },
      supply: { name: 'Supply Run', text: 'Take any 2 cards from the bank.' },
      deal: { name: 'Street Deal', text: 'Name a resource. Every rival hands over all they have of it.' },
      roads: { name: 'Road Crew', text: 'Claim 2 roads for free (roads or flight routes in Flight Paths).' },
      respect: { name: 'Councillor\'s Favour', text: '+1 Respect, kept secret until you win.' }
    };
    const COLOURS = [['#3fd17a', 'Green'], ['#ff4a5a', 'Red'], ['#ffb02e', 'Orange'], ['#5aa8ff', 'Blue'], ['#b07aff', 'Purple'], ['#ff7ac8', 'Pink'], ['#2fd0c0', 'Teal'], ['#f2f2f2', 'White']];
    const NAMES = ['Your faction', 'The Racket', 'Southside Crew', 'Neon Syndicate'];
    const MAPS = {
      standard: { rows: [3, 4, 5, 4, 3], tiles: { brick: 3, wood: 4, wheat: 4, ore: 3, cotton: 4, none: 1 },
        nums: [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12], ports: ['any', 'any', 'any', 'any', 'brick', 'wood', 'wheat', 'ore', 'cotton'] },
      large: { rows: [4, 5, 6, 7, 6, 5, 4], tiles: { brick: 6, wood: 8, wheat: 8, ore: 6, cotton: 7, none: 2 },
        nums: [2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6, 8, 8, 8, 8, 9, 9, 9, 9, 10, 10, 10, 10, 11, 11, 11, 12, 12], ports: ['any', 'any', 'any', 'any', 'any', 'any', 'brick', 'wood', 'wheat', 'ore', 'cotton', 'wood', 'wheat'] }
    };
    const R = 58, CX = 380, CY = 290;
    function makeBoard(size) {
      const M = MAPS[size] || MAPS.large, centres = [];
      M.rows.forEach(function (L, ri) {
        const r = ri - (M.rows.length - 1) / 2;
        for (let k = 0; k < L; k++) centres.push([CX + (k - (L - 1) / 2) * R * Math.sqrt(3), CY + r * 1.5 * R]);
      });
      const near = function (a, b) { return Math.hypot(a.cx - b.cx, a.cy - b.cy) < R * 1.9; };
      let hexes, ok = false;
      while (!ok) {   // keep the busiest numbers (6 and 8) apart
        const pool = []; Object.keys(M.tiles).forEach(function (t) { for (let i = 0; i < M.tiles[t]; i++) pool.push(t); });
        const tiles = shuffle(pool), nums = shuffle(M.nums.slice());
        let k = 0;
        hexes = centres.map(function (c, i) { return { cx: c[0], cy: c[1], res: tiles[i], num: tiles[i] === 'none' ? 0 : nums[k++], verts: [] }; });
        ok = hexes.every(function (h) { return !(h.num === 6 || h.num === 8) || hexes.every(function (o) { return o === h || !(o.num === 6 || o.num === 8) || !near(h, o); }); });
      }
      const verts = [], edges = [], vk = {}, ek = {};
      hexes.forEach(function (h, hi) {
        const ids = [];
        for (let i = 0; i < 6; i++) {
          const a = Math.PI / 180 * (60 * i - 30), x = h.cx + R * Math.cos(a), y = h.cy + R * Math.sin(a), key = Math.round(x) + ',' + Math.round(y);
          if (vk[key] === undefined) { vk[key] = verts.length; verts.push({ x: x, y: y, hexes: [], adj: [], edges: [], owner: -1, lvl: 0, port: null }); }
          ids.push(vk[key]); verts[vk[key]].hexes.push(hi);
        }
        h.verts = ids;
        for (let i = 0; i < 6; i++) {
          const a = ids[i], b = ids[(i + 1) % 6], key = Math.min(a, b) + '-' + Math.max(a, b);
          if (ek[key] === undefined) { ek[key] = edges.length; edges.push({ a: a, b: b, owner: -1, hn: 0, hx: hi }); verts[a].adj.push(b); verts[b].adj.push(a); verts[a].edges.push(ek[key]); verts[b].edges.push(ek[key]); }
          edges[ek[key]].hn++;
        }
      });
      function ang(E) { return Math.atan2((verts[E.a].y + verts[E.b].y) / 2 - CY, (verts[E.a].x + verts[E.b].x) / 2 - CX); }
      const coast = edges.map(function (E, i) { return i; }).filter(function (i) { return edges[i].hn === 1; }).sort(function (a, b) { return ang(edges[a]) - ang(edges[b]); });
      const kinds = shuffle(M.ports.slice()), np = kinds.length, ports = [], off = Math.floor(rnd() * 3);
      for (let i = 0; i < np; i++) {
        const e = coast[(off + Math.round(i * coast.length / np)) % coast.length], E = edges[e], H = hexes[E.hx];
        const mx = (verts[E.a].x + verts[E.b].x) / 2, my = (verts[E.a].y + verts[E.b].y) / 2, dx = mx - H.cx, dy = my - H.cy, d = Math.hypot(dx, dy);
        ports.push({ e: e, kind: kinds[i], x: mx + dx / d * 30, y: my + dy / d * 30 });
        verts[E.a].port = kinds[i]; verts[E.b].port = kinds[i];
      }
      return { hexes: hexes, verts: verts, edges: edges, ports: ports };
    }
    /* Flight Paths board: Torn City (the mainland) and four islands in open sky. Islands never touch the mainland or each
       other, so the only way there is a chain of flight routes. Hex fields: res ('sky' for open sky), num, isl (0 = mainland,
       1-4 = islands). Edges know which hexes they border (hs) and whether a road (land) or flight route (sky) can go there;
       the edge of the board counts as sky. */
    // Based on Seafarers' large (5-6 player) "Heading for New Shores": a 30-district main island (the large Catan
    // board: 28 districts and 2 Racket HQs) and 11 harbours, all on the main island, with bigger islands (5, 5, 5 and 4
    // districts, 3 of them Smuggler's Dens). 49 districts in all, against Classic's 37.
    const FP = { rows: [8, 9, 10, 11, 12, 11, 10, 9, 8], main: 30, islands: [5, 5, 5, 4],
      mainPool: { brick: 5, wood: 6, wheat: 6, ore: 5, cotton: 6, none: 2 }, islPool: { brick: 3, wood: 4, wheat: 3, ore: 3, cotton: 3, gold: 3 },
      mainNums: [2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12], islNums: [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12, 4],
      ports: ['any', 'any', 'any', 'any', 'any', 'brick', 'wood', 'wheat', 'ore', 'cotton', 'cotton'] };
    function makeBoardFP() {
      const centres = [];
      FP.rows.forEach(function (L, ri) {
        const r = ri - (FP.rows.length - 1) / 2;
        for (let k = 0; k < L; k++) centres.push([CX + (k - (L - 1) / 2) * R * Math.sqrt(3), CY + r * 1.5 * R]);
      });
      const N = centres.length, nb = centres.map(function (c, i) { return centres.map(function (d, j) { return j; }).filter(function (j) { return j !== i && Math.hypot(c[0] - centres[j][0], c[1] - centres[j][1]) < R * 1.9; }); });
      const pick = function (a) { return a[Math.floor(rnd() * a.length)]; };
      let isl, tries = 0;
      for (;;) {   // grow the mainland, then the islands, until everything fits
        tries++; isl = Array(N).fill(-1);
        // the mainland starts a little left of centre; it prefers frontier hexes with more mainland neighbours (compact)
        const mid = centres.map(function (c, i) { return i; }).sort(function (a, b) { return Math.hypot(centres[a][0] - (CX - R * 2.6), centres[a][1] - CY) - Math.hypot(centres[b][0] - (CX - R * 2.6), centres[b][1] - CY); })[0];
        isl[mid] = 0; let size = 1;
        while (size < FP.main) {
          const fr = []; isl.forEach(function (v, i) { if (v === 0) nb[i].forEach(function (j) { if (isl[j] < 0 && fr.indexOf(j) < 0) fr.push(j); }); });
          const w = fr.map(function (j) { return nb[j].filter(function (k) { return isl[k] === 0; }).length; }), mx = Math.max.apply(null, w);
          isl[pick(fr.filter(function (j, k) { return w[k] >= Math.min(mx, 2); }))] = 0; size++;
        }
        const blocked = function (j, id) { return isl[j] >= 0 || nb[j].some(function (k) { return isl[k] >= 0 && isl[k] !== id; }); };
        let ok = true;
        FP.islands.forEach(function (n, k) {
          if (!ok) return;
          const id = k + 1, free = centres.map(function (c, i) { return i; }).filter(function (j) { return !blocked(j, id); });
          if (!free.length) { ok = false; return; }
          isl[pick(free)] = id;
          for (let m = 1; m < n; m++) {
            const fr = []; isl.forEach(function (v, i) { if (v === id) nb[i].forEach(function (j) { if (!blocked(j, id) && fr.indexOf(j) < 0) fr.push(j); }); });
            if (!fr.length) { ok = false; return; }
            isl[pick(fr)] = id;
          }
        });
        if (ok || tries > 200) break;
      }
      const land = isl.map(function (v, i) { return v >= 0 ? i : -1; }).filter(function (i) { return i >= 0; });
      const mainHexes = land.filter(function (i) { return isl[i] === 0; }), islHexes = land.filter(function (i) { return isl[i] > 0; });
      let res, nums, ok2 = false;
      const bag = function (o) { const a = []; Object.keys(o).forEach(function (t) { for (let i = 0; i < o[t]; i++) a.push(t); }); return shuffle(a); };
      while (!ok2) {
        res = Array(N).fill('sky');
        const mp = bag(FP.mainPool), ip = bag(FP.islPool);
        mainHexes.forEach(function (i) { res[i] = mp.pop(); });
        islHexes.forEach(function (i) { res[i] = ip.pop(); });
        // every island has at least one ordinary district (not only Smuggler's Dens)
        if ([1, 2, 3, 4].some(function (k) { return islHexes.filter(function (i) { return isl[i] === k; }).every(function (i) { return res[i] === 'gold'; }); })) continue;
        nums = Array(N).fill(0); const mn = shuffle(FP.mainNums.slice()), inn = shuffle(FP.islNums.slice());
        mainHexes.forEach(function (i) { if (res[i] !== 'none') nums[i] = mn.pop(); });
        islHexes.forEach(function (i) { nums[i] = inn.pop(); });
        ok2 = land.every(function (i) { return !(nums[i] === 6 || nums[i] === 8) || nb[i].every(function (j) { return !(nums[j] === 6 || nums[j] === 8); }); });
      }
      const hexes = centres.map(function (c, i) { return { cx: c[0], cy: c[1], res: res[i], num: nums[i], isl: isl[i], verts: [] }; });
      const verts = [], edges = [], vk = {}, ek = {};
      hexes.forEach(function (h, hi) {
        const ids = [];
        for (let i = 0; i < 6; i++) {
          const a = Math.PI / 180 * (60 * i - 30), x = h.cx + R * Math.cos(a), y = h.cy + R * Math.sin(a), key = Math.round(x) + ',' + Math.round(y);
          if (vk[key] === undefined) { vk[key] = verts.length; verts.push({ x: x, y: y, hexes: [], adj: [], edges: [], owner: -1, lvl: 0, port: null }); }
          ids.push(vk[key]); verts[vk[key]].hexes.push(hi);
        }
        h.verts = ids;
        for (let i = 0; i < 6; i++) {
          const a = ids[i], b = ids[(i + 1) % 6], key = Math.min(a, b) + '-' + Math.max(a, b);
          if (ek[key] === undefined) { ek[key] = edges.length; edges.push({ a: a, b: b, owner: -1, hn: 0, hx: hi, hs: [] }); verts[a].adj.push(b); verts[b].adj.push(a); verts[a].edges.push(ek[key]); verts[b].edges.push(ek[key]); }
          edges[ek[key]].hn++; edges[ek[key]].hs.push(hi);
        }
      });
      verts.forEach(function (V) { V.land = V.hexes.some(function (h) { return hexes[h].res !== 'sky'; }); });
      edges.forEach(function (E) {
        E.land = E.hs.some(function (h) { return hexes[h].res !== 'sky'; });
        E.sky = E.hn < 2 || E.hs.some(function (h) { return hexes[h].res === 'sky'; });
        if (E.land) E.hx = E.hs.filter(function (h) { return hexes[h].res !== 'sky'; })[0];   // the land side (harbours point away from it)
      });
      // harbours on the coasts (land meets sky), spread round the board
      function ang(E) { return Math.atan2((verts[E.a].y + verts[E.b].y) / 2 - CY, (verts[E.a].x + verts[E.b].x) / 2 - CX); }
      const coast = edges.map(function (E, i) { return i; }).filter(function (i) { const E = edges[i]; return E.land && E.sky && hexes[E.hx].isl === 0; })   // harbours: Torn City only
        .sort(function (a, b) { return ang(edges[a]) - ang(edges[b]); });
      const kinds = shuffle(FP.ports.slice()), ports = [], used = {};
      for (let i = 0; i < kinds.length && coast.length; i++) {
        let e = coast[(Math.round(i * coast.length / kinds.length) + Math.floor(rnd() * 2)) % coast.length], tries2 = 0;
        while ((used[edges[e].a] || used[edges[e].b]) && tries2++ < coast.length) e = coast[(coast.indexOf(e) + 1) % coast.length];
        const E = edges[e], H = hexes[E.hx];
        if (used[E.a] || used[E.b]) continue;
        [E.a, E.b].concat(verts[E.a].adj, verts[E.b].adj).forEach(function (v) { used[v] = 1; });
        const mx = (verts[E.a].x + verts[E.b].x) / 2, my = (verts[E.a].y + verts[E.b].y) / 2, dx = mx - H.cx, dy = my - H.cy, d = Math.hypot(dx, dy);
        ports.push({ e: e, kind: kinds[i], x: mx + dx / d * 30, y: my + dy / d * 30 });
        verts[E.a].port = kinds[i]; verts[E.b].port = kinds[i];
      }
      const names = shuffle(ISLANDS.slice()).slice(0, FP.islands.length);
      // the Air Marshal starts out in open sky, away from Torn City (like the Seafarers pirate ship)
      const far = hexes.map(function (h, i) { return i; }).filter(function (i) { return hexes[i].res === 'sky' && nb[i].every(function (j) { return isl[j] !== 0; }); });
      return { hexes: hexes, verts: verts, edges: edges, ports: ports, islands: ['Torn City'].concat(names), marshal: far.length ? pick(far) : -1 };
    }
    /* ---------- Rules ---------- */
    function P(i) { return G.players[i]; }
    function cards(p) { return RES.reduce(function (s, r) { return s + p.hand[r]; }, 0); }
    function stock(r) { return (G.size === 'standard' ? 19 : 24) - G.players.reduce(function (s, q) { return s + q.hand[r]; }, 0); }   // the bank holds 19 of each (24 on the large map)
    function canAfford(p, c) { return Object.keys(c).every(function (r) { return p.hand[r] >= c[r]; }); }
    function pay(p, c) { Object.keys(c).forEach(function (r) { p.hand[r] -= c[r]; }); }
    function spaced(v) { return G.verts[v].owner < 0 && G.verts[v].adj.every(function (a) { return G.verts[a].owner < 0; }); }
    function fp() { return G.mode === 'fp'; }
    function mainland(v) { return G.verts[v].hexes.some(function (h) { return G.hexes[h].isl === 0; }); }
    function safeOK(pi, v, setup) {
      if (fp() && (!G.verts[v].land || (setup && !mainland(v)))) return false;   // Flight Paths: on land, and the first two on Torn City
      return spaced(v) && (setup || G.verts[v].edges.some(function (e) { return G.edges[e].owner === pi; }));
    }
    // Roads join your buildings and other roads; flight routes join your buildings and other flight routes. They only
    // link up with each other at one of your own safehouses or HQs.
    function routeOK(pi, e) {
      const E = G.edges[e]; if (E.owner >= 0) return false;
      if (fp() && !E.land) return false;
      if (G.phase === 'setup') return E.a === G.setup.last || E.b === G.setup.last;
      return [E.a, E.b].some(function (v) { const V = G.verts[v]; return V.owner === pi || (V.owner < 0 && V.edges.some(function (x) { return x !== e && G.edges[x].owner === pi && G.edges[x].k !== 'fly'; })); });
    }
    function flyOK(pi, e) {
      if (!fp()) return false;
      const E = G.edges[e]; if (E.owner >= 0 || !E.sky || E.hs.indexOf(G.marshal) >= 0) return false;   // not past the Air Marshal
      if (G.phase === 'setup') return E.a === G.setup.last || E.b === G.setup.last;
      return [E.a, E.b].some(function (v) { const V = G.verts[v]; return V.owner === pi || (V.owner < 0 && V.edges.some(function (x) { return x !== e && G.edges[x].owner === pi && G.edges[x].k === 'fly'; })); });
    }
    // A flight route at the open end of a chain (not built this turn, not next to the Air Marshal) can be moved once a turn.
    function openFly(pi, e) {
      const E = G.edges[e];
      if (!fp() || E.owner !== pi || E.k !== 'fly' || E.t === G.turn || E.hs.indexOf(G.marshal) >= 0) return false;
      return [E.a, E.b].some(function (v) { return G.verts[v].owner !== pi && !G.verts[v].edges.some(function (x) { return x !== e && G.edges[x].owner === pi && G.edges[x].k === 'fly'; }); });
    }
    function anyRoute(pi) { return G.edges.some(function (E, e) { return routeOK(pi, e); }); }
    function anyFly(pi) { return fp() && G.edges.some(function (E, e) { return flyOK(pi, e); }); }
    function anyFree(pi) { const p = P(pi); return (p.routes > 0 && anyRoute(pi)) || (p.flights > 0 && anyFly(pi)); }
    function anySafe(pi) { return G.verts.some(function (V, v) { return safeOK(pi, v); }); }
    function rate(pi, r) {
      let best = 4;
      G.verts.forEach(function (V) { if (V.owner === pi && V.port) { if (V.port === r) best = 2; else if (V.port === 'any') best = Math.min(best, 3); } });
      return best;
    }
    function routeLen(pi) {
      let best = 0;
      function dfs(v, used, len, kind) {
        if (len > best) best = len;
        if (len > 0 && G.verts[v].owner >= 0 && G.verts[v].owner !== pi) return;   // a rival's building cuts the road
        G.verts[v].edges.forEach(function (e) {
          const E = G.edges[e]; if (E.owner !== pi || used[e]) return;
          const k = E.k === 'fly' ? 'f' : 'r';
          if (kind && k !== kind && G.verts[v].owner !== pi) return;   // roads and flight routes only join at your own building
          used[e] = 1; dfs(E.a === v ? E.b : E.a, used, len + 1, k); used[e] = 0;
        });
      }
      G.edges.forEach(function (E) { if (E.owner === pi) { dfs(E.a, {}, 0, null); dfs(E.b, {}, 0, null); } });
      return best;
    }
    function awards() {
      const lens = G.players.map(function (p, i) { return routeLen(i); });
      const h = G.longest, top = Math.max.apply(null, lens);
      if (!(h >= 0 && lens[h] >= 5 && lens[h] === top)) {   // the holder keeps it on a tie
        const leaders = lens.map(function (l, i) { return l === top ? i : -1; }).filter(function (i) { return i >= 0; });
        const nw = top >= 5 && leaders.length === 1 ? leaders[0] : -1;
        if (nw !== h) { G.longest = nw; if (nw >= 0) say(name(nw) + ' now ' + verb(nw, 'hold') + ' Longest Road (' + top + '). +2 Respect.'); }
      }
      G.players.forEach(function (p, i) { if (p.crew >= 3 && G.bigCrew !== i && (G.bigCrew < 0 || p.crew > P(G.bigCrew).crew)) { G.bigCrew = i; say(name(i) + ' now ' + (you(i) ? 'have' : 'has') + ' the Biggest Crew. +2 Respect.'); } });
    }
    // Respect needed to win: Classic 14 since 2.41 (with 20 roads, 6 safehouses, 5 HQs and 7 Councillor's Favours);
    // Flight Paths 12 or 16, chosen at the start. Games started before 2.41 keep their old target of 10.
    function WIN() { return (G && G.win) || 10; }
    function respect(pi, all) {
      let s = 0;
      G.verts.forEach(function (V) { if (V.owner === pi) s += V.lvl; });
      if (G.longest === pi) s += 2;
      if (G.bigCrew === pi) s += 2;
      if (G.bonus) s += 2 * G.bonus.filter(function (b) { return b.p === pi; }).length;   // Flight Paths: +2 for your first safehouse on each island (as in Seafarers)
      if (all) s += P(pi).favs.filter(function (f) { return f.t === 'respect'; }).length;
      return s;
    }
    function humans() { return G.players.filter(function (p) { return !p.ai; }).length; }
    function you(i) { return i === VIEW() && humans() === 1; }
    function name(i) { return you(i) ? 'You' : P(i).name; }
    function verb(i, v) { return you(i) ? v : v + (/(s|sh|ch)$/.test(v) ? 'es' : 's'); }
    function say(t) { G.log.unshift(t); if (G.log.length > 80) G.log.pop(); }
    function checkWin(pi) {
      if (G.phase === 'over' || respect(pi, true) < WIN()) return false;
      G.phase = 'over'; G.winner = pi;
      say(name(pi) + ' ' + verb(pi, 'reach') + ' ' + WIN() + ' Respect and take' + (you(pi) ? '' : 's') + ' over Torn City!');
      env.win(pi);
      return true;
    }

    /* ---------- Turn flow ---------- */
    function rollDice() {
      const a = 1 + Math.floor(rnd() * 6), b = 1 + Math.floor(rnd() * 6), n = a + b;
      G.dice = [a, b]; env.rolled();
      env.snd('dice');
      say(name(G.cur) + ' ' + verb(G.cur, 'roll') + ' ' + n + '.');
      if (n === 7) {
        G.discardQ = G.players.map(function (p, i) { return i; }).filter(function (i) { return cards(P(i)) > 7; });
        G.afterRaid = 'main'; G.phase = G.discardQ.length ? 'discard' : 'raid';
        env.snd('raid');
      } else { produce(n); G.phase = G.goldQ && G.goldQ.length ? 'gold' : 'main'; }
    }
    function produce(n) {
      const got = G.players.map(function () { return {}; }), gold = G.players.map(function () { return 0; });
      G.hexes.forEach(function (H, hi) {
        if (H.num !== n) return;
        if (hi === G.raid) { if (H.verts.some(function (v) { return G.verts[v].owner >= 0; })) say('The raided ' + DIST[H.res].name + ' pays nothing.'); return; }
        H.verts.forEach(function (v) { const V = G.verts[v]; if (V.owner < 0) return; if (H.res === 'gold') gold[V.owner] += V.lvl; else got[V.owner][H.res] = (got[V.owner][H.res] || 0) + V.lvl; });
      });
      // Smuggler's Den: each faction owed picks its cards (starting with whoever rolled)
      G.goldQ = [];
      for (let k = 0; k < G.players.length; k++) { const i = (G.cur + k) % G.players.length; if (gold[i]) G.goldQ.push({ p: i, n: gold[i] }); }
      RES.forEach(function (r) {   // the bank runs short: one faction owed gets what's left, two or more get nothing
        const owed = got.map(function (g) { return g[r] || 0; }), total = owed.reduce(function (a, b) { return a + b; }, 0), left = stock(r);
        if (!total || total <= left) return;
        const who = owed.filter(function (x) { return x; }).length;
        got.forEach(function (g, i) { if (!g[r]) return; if (who === 1 && left > 0) g[r] = left; else delete g[r]; });
        say('The bank is short of ' + RN[r] + (who === 1 && left > 0 ? ': only ' + left + ' to hand out.' : '. Nobody collects it.'));
      });
      got.forEach(function (g, i) { Object.keys(g).forEach(function (r) { P(i).hand[r] += g[r]; }); });
      got.forEach(function (g, i) {
        const k = Object.keys(g); if (!k.length) return;
        say(name(i) + ' ' + verb(i, 'collect') + ' ' + k.map(function (r) { return g[r] + ' ' + RN[r]; }).join(', ') + '.');
        env.collect(i, k);
      });
    }
    function discard(pi, take) {
      env.lost(pi);
      Object.keys(take).forEach(function (r) { P(pi).hand[r] -= take[r]; });
      say(name(pi) + ' ' + verb(pi, 'hand') + ' ' + Object.keys(take).reduce(function (a, r) { return a + take[r]; }, 0) + ' cards to the police.');
      G.discardQ.shift();
      if (!G.discardQ.length) G.phase = 'raid';
    }
    // Who can be robbed: factions with a building on the raided district, or (Air Marshal) a flight route on that sky.
    function victims(pi, h) {
      const out = [], add = function (o) { if (o >= 0 && o !== pi && cards(P(o)) > 0 && out.indexOf(o) < 0) out.push(o); };
      if (G.hexes[h].res === 'sky') G.edges.forEach(function (E) { if (E.k === 'fly' && E.hs.indexOf(h) >= 0) add(E.owner); });
      else G.hexes[h].verts.forEach(function (v) { add(G.verts[v].owner); });
      return out;
    }
    function robHex() { return G.robHex !== undefined && G.robHex >= 0 ? G.robHex : G.raid; }
    function islandName(h) { return G.islands && G.hexes[h].isl > 0 ? G.islands[G.hexes[h].isl] : ''; }
    function moveRaid(pi, h) {
      if (G.hexes[h].res === 'sky') {   // Flight Paths: the Air Marshal grounds flight routes on this sky and robs a flyer
        G.marshal = h;
        say(name(pi) + ' ' + verb(pi, 'send') + ' the Air Marshal into the sky.');
      } else {
        G.raid = h;
        say(name(pi) + ' ' + verb(pi, 'send') + ' the police raid to the ' + DIST[G.hexes[h].res].name + (G.hexes[h].num ? ' (' + G.hexes[h].num + ')' : '') + (islandName(h) ? ' in ' + islandName(h) : '') + '.');
      }
      G.robHex = h;
      const v = victims(pi, h);
      if (!v.length) G.phase = G.afterRaid;
      else if (v.length === 1) steal(pi, v[0]);
      else G.phase = 'steal';
    }
    function steal(pi, vi) {
      const have = RES.filter(function (r) { return P(vi).hand[r] > 0; }), r = have[Math.floor(rnd() * have.length)];
      P(vi).hand[r]--; P(pi).hand[r]++;
      if (!G.hid) G.hid = [];
      G.hid.push({ p: pi, r: r, t: G.turn });   // the other factions don't see which card was taken
      const seen = pi === VIEW() || vi === VIEW();
      say(name(pi) + ' ' + verb(pi, 'take') + (seen ? ' ' + RN[r] : ' a card') + ' from ' + (you(vi) ? 'you' : P(vi).name) + '.');
      env.collect(pi, [r]); env.lost(vi);
      G.phase = G.afterRaid;
    }
    function endTurn() {
      P(G.cur).favs.forEach(function (f) { f.fresh = false; });
      G.cur = (G.cur + 1) % G.players.length; G.turn++; G.phase = 'roll'; G.playedFav = false; G.dice = null; G.offer = null;
      G.aiActs = 0; G.asked = false; G.aiTraded = false; G.ask = null; G.auto = null; env.turn(G.cur);
      if (G.hid) G.hid = G.hid.filter(function (h) { return G.turn - h.t < G.players.length * 2; });   // after a couple of rounds it no longer matters
    }
    function placeSafe(pi, v, setup) {
      const p = P(pi);
      if (!setup) pay(p, COST.safe);
      G.verts[v].owner = pi; G.verts[v].lvl = 1; p.safes--;
      if (fp() && !setup) {   // Overseas Connections: +2 Respect for your first safehouse on each island
        const h = G.verts[v].hexes.filter(function (x) { return G.hexes[x].isl > 0; })[0];
        if (h !== undefined && !G.bonus.some(function (b) { return b.p === pi && b.i === G.hexes[h].isl; })) {
          G.bonus.push({ p: pi, i: G.hexes[h].isl });
          say('Overseas Connections: ' + name(pi) + ' ' + verb(pi, 'land') + ' in ' + G.islands[G.hexes[h].isl] + '. +2 Respect.');
        }
      }
      env.snd('safe');
      if (setup) {
        G.setup.last = v; G.setup.step = 'route';
        const got = [];
        if (G.setup.i >= G.players.length) G.verts[v].hexes.forEach(function (h) { const r = G.hexes[h].res; if (r !== 'none' && stock(r) > 0) { p.hand[r]++; got.push(RN[r]); } });
        say(name(pi) + ' ' + verb(pi, 'open') + ' a safehouse' + (got.length ? ' and ' + verb(pi, 'collect') + ' ' + got.join(', ') : '') + '.');
      } else say(name(pi) + ' ' + verb(pi, 'open') + ' a safehouse. +1 Respect.');
      awards();
    }
    function placeRoute(pi, e, free, fly) {
      const p = P(pi);
      if (!free) pay(p, fly ? COST.fly : COST.route);
      G.edges[e].owner = pi;
      if (fly) { G.edges[e].k = 'fly'; G.edges[e].t = G.turn; p.flights--; } else p.routes--;
      env.snd(fly ? 'fly' : 'road');
      if (G.phase === 'setup') {
        G.setup.i++; G.setup.step = 'safe'; G.setup.last = -1;
        if (G.setup.i >= G.setup.order.length) { G.phase = 'roll'; G.cur = 0; say('The city is carved up. ' + name(0) + ' ' + verb(0, 'roll') + ' first.'); }
        else G.cur = G.setup.order[G.setup.i];
        return;
      }
      say(name(pi) + ' ' + verb(pi, fly ? 'open' : 'build') + (fly ? ' a flight route' : ' a road') + (free ? ' for free' : '') + '.');
      if (G.phase === 'roads') { G.free--; if (G.free <= 0 || !anyFree(pi)) G.phase = 'main'; }
      awards();
    }
    function upgrade(pi, v) {
      const p = P(pi); pay(p, COST.hq); G.verts[v].lvl = 2; p.safes++; p.hqs--;
      env.snd('hq');
      say(name(pi) + ' ' + verb(pi, 'turn') + ' a safehouse into an HQ. +1 Respect.');
    }
    function buyFav(pi) {
      const p = P(pi); pay(p, COST.fav); const t = G.deck.pop();
      p.favs.push({ t: t, fresh: true }); env.snd('fav');
      say(name(pi) + ' ' + verb(pi, 'call') + ' in a favour' + (pi === VIEW() ? ': ' + FAV[t].name : '') + '.');
    }
    function canPlay(pi, f) { return f.t !== 'respect' && (f.t !== 'supply' || RES.reduce(function (a, r) { return a + Math.min(2, stock(r)); }, 0) >= 2) && !f.fresh && !G.playedFav && G.cur === pi && (G.phase === 'main' || (G.phase === 'roll' && f.t === 'crew')); }
    function useFav(pi, idx) {
      const f = P(pi).favs.splice(idx, 1)[0];
      G.playedFav = true;
      say(name(pi) + ' ' + verb(pi, 'play') + ' ' + FAV[f.t].name + '.');
      return f.t;
    }
    function others(pi, r) { return G.players.reduce(function (s, q, i) { return i === pi ? s : s + q.hand[r]; }, 0); }
    function streetDeal(pi, r) {
      let n = 0; G.players.forEach(function (q, i) { if (i !== pi) { n += q.hand[r]; q.hand[r] = 0; } });
      P(pi).hand[r] += n; say(name(pi) + ' ' + verb(pi, 'collect') + ' ' + n + ' ' + RN[r] + ' from the other factions.');
      env.collect(pi, [r], true);
    }
    /* ---------- Computer factions ---------- */
    function owns(pi, r) { return G.verts.some(function (V) { return V.owner === pi && V.hexes.some(function (h) { return G.hexes[h].res === r; }); }); }
    function vScore(v, pi) {
      const seen = {}; let s = 0;
      G.verts[v].hexes.forEach(function (h) { const H = G.hexes[h]; if (h === G.raid) return; s += pips(H.num); if (H.res !== 'none' && !seen[H.res]) { seen[H.res] = 1; s += 1.2; } });
      if (G.verts[v].port) s += G.verts[v].port === 'any' ? 0.8 : 0.5;
      if (pi !== undefined) RES.forEach(function (r) { if (seen[r] && !owns(pi, r)) s += 0.6; });
      return s + (G.diff === 'easy' ? rnd() * 4 : G.diff === 'normal' ? rnd() * 1.2 : rnd() * 0.3);
    }
    function shortOf(p, c) { return RES.reduce(function (t, r) { return t + Math.max(0, (c[r] || 0) - p.hand[r]); }, 0); }
    function plan(pi) {   // what it saves up for: whichever build it is closest to affording
      const p = P(pi), hasSafe = G.verts.some(function (V) { return V.owner === pi && V.lvl === 1; }), o = [];
      if (hasSafe && p.hqs) o.push(['hq', shortOf(p, COST.hq) - 0.3]);
      if (p.safes && anySafe(pi)) o.push(['safe', shortOf(p, COST.safe) - 0.5]);
      else if (p.safes && (p.routes || p.flights)) o.push(['route', shortOf(p, expandCost(pi)) - 0.4]);
      if (G.deck.length) o.push(['fav', shortOf(p, COST.fav) + 1.2]);
      if (!o.length) return 'fav';
      return o.sort(function (a, b) { return a[1] - b[1]; })[0][0];
    }
    function planCost(pi) { const pl = plan(pi); return pl === 'route' ? expandCost(pi) : COST[pl]; }
    // Saving up to expand: a road (or flight route) and most of a safehouse
    function expandCost(pi) {
      if (fp()) { const b = bestExpand(pi); if (b && b.fly) return { wood: 2, cotton: 2, brick: 1, wheat: 1 }; }
      return { brick: 2, wood: 2, wheat: 1, cotton: 1 };
    }
    function need(pi) { const p = P(pi), c = planCost(pi), out = {}; RES.forEach(function (r) { out[r] = Math.max(0, (c[r] || 0) - p.hand[r]); }); return out; }
    function worth(pi, r) { const n = need(pi), p = P(pi); return 1 + (n[r] ? 1.6 : 0) - (p.hand[r] >= 4 ? 0.5 : 0); }
    // What faction `who` holds as far as faction `by` can tell: every card collected, traded and spent is announced,
    // only the type of a card taken in a robbery stays hidden from everyone else.
    function est(who, by) {
      const h = Object.assign({}, P(who).hand);
      if (who !== by) (G.hid || []).forEach(function (x) { if (x.p === who && h[x.r] > 0) h[x.r]--; });
      return h;
    }
    // How much a hand lets a faction build that it couldn't before: an HQ matters most, then a safehouse.
    function unlocks(who, before, after) {
      let best = 0;
      const can = function (h, c) { return Object.keys(c).every(function (r) { return (h[r] || 0) >= c[r]; }); };
      if (P(who).hqs && G.verts.some(function (V) { return V.owner === who && V.lvl === 1; }) && !can(before, COST.hq) && can(after, COST.hq)) best = Math.max(best, 2);
      if (P(who).safes && anySafe(who) && !can(before, COST.safe) && can(after, COST.safe)) best = Math.max(best, 1.5);
      if (G.deck.length && !can(before, COST.fav) && can(after, COST.fav)) best = Math.max(best, 0.6);
      if (P(who).routes && !can(before, COST.route) && can(after, COST.route)) best = Math.max(best, 0.3);
      return best;
    }
    // Would computer faction pi make this swap? It gets `give` from `from` and hands over `want`.
    // Answers { ok, why } with why: 'cards' (doesn't have them), 'leader' (won't feed the leader),
    // 'threat' (the deal would let `from` build an HQ or safehouse) or 'value' (not worth it).
    function wantsDeal(pi, give, want, from) {
      const p = P(pi);
      if (RES.some(function (r) { return (want[r] || 0) > p.hand[r]; })) return { ok: false, why: 'cards' };
      const vis = respect(from, false), D = G.diff, W = WIN();   // how close to winning counts relative to the target
      if (vis >= W - (D === 'hard' ? 3 : D === 'normal' ? 2 : 1)) return { ok: false, why: 'leader' };
      let gain = 0;
      RES.forEach(function (r) { gain += (give[r] || 0) * worth(pi, r) - (want[r] || 0) * worth(pi, r); });
      const before = est(from, pi), after = Object.assign({}, before);
      RES.forEach(function (r) { after[r] = (after[r] || 0) + (want[r] || 0) - (give[r] || 0); });
      const th = unlocks(from, before, after), worthIt = D === 'easy' ? -0.2 : D === 'normal' ? 0.4 : 0.9;
      // never hand the last card for an HQ to someone close to winning; on Hard never hand anyone their HQ
      if ((th >= 2 && (D === 'hard' || vis + 1 >= W - (D === 'normal' ? 2 : 1))) || (th >= 1.5 && vis + 1 >= W - (D === 'easy' ? 0 : 1))) return { ok: false, why: 'threat' };
      const penalty = th * (D === 'easy' ? 0.25 : D === 'normal' ? 0.6 : 1);
      if (gain - penalty > worthIt) return { ok: true };
      return { ok: false, why: gain > worthIt ? 'threat' : 'value' };
    }
    // A counter-offer to a deal it turned down: ask for one or two more cards, starting with ones it needs.
    function counter(pi, give, want, from) {
      const have = P(from).hand, n = need(pi), tries = [];
      const want1 = RES.filter(function (r) { return !want[r] && have[r] - (give[r] || 0) > 0; }).sort(function (a, b) { return (n[b] - n[a]) || (have[b] - have[a]); });
      want1.forEach(function (r) { const g = Object.assign({}, give); g[r] = (g[r] || 0) + 1; tries.push(g); });
      want1.forEach(function (r) { want1.forEach(function (q) { const g = Object.assign({}, give); g[r] = (g[r] || 0) + 1; g[q] = (g[q] || 0) + 1; if (RES.every(function (x) { return (g[x] || 0) <= have[x]; })) tries.push(g); }); });
      for (let i = 0; i < tries.length; i++) if (wantsDeal(pi, tries[i], want, from).ok) return tries[i];
      return null;
    }
    // Trade with another computer faction for a missing card: offer spare cards, see who bites.
    function aiDeal(pi, short, plain) {
      const p = P(pi), n = need(pi);
      const spare = RES.filter(function (x) { return !n[x] && p.hand[x] > (plain[x] || 0); }).sort(function (a, b) { return p.hand[b] - p.hand[a]; });
      if (!spare.length) return false;
      const want = {}; want[short[0]] = 1;
      for (let k = 1; k <= 2; k++) {
        const give = {}; give[spare[0]] = Math.min(k, p.hand[spare[0]] - (plain[spare[0]] || 0)); if (!give[spare[0]]) continue;
        const partners = G.players.map(function (q, i) { return i; }).filter(function (i) { return i !== pi && P(i).ai && P(i).hand[short[0]] > 0 && wantsDeal(i, give, want, pi).ok; });
        if (partners.length) {
          const o = partners[Math.floor(rnd() * partners.length)];
          RES.forEach(function (x) { p.hand[x] += (want[x] || 0) - (give[x] || 0); P(o).hand[x] += (give[x] || 0) - (want[x] || 0); });
          say(p.name + ' trades ' + list(give) + ' to ' + P(o).name + ' for ' + list(want) + '.');
          return true;
        }
      }
      return false;
    }
    function hurt(h, pi) {
      let s = 0;
      G.hexes[h].verts.forEach(function (v) { const o = G.verts[v].owner; if (o >= 0 && o !== pi) s += pips(G.hexes[h].num) * G.verts[v].lvl * (1 + respect(o, false) / 5) + (cards(P(o)) ? 1 : 0); });
      return s + (G.diff === 'easy' ? rnd() * 6 : 0);
    }
    // Air Marshal: how much grounding the flight routes on this sky hurts the others
    function hurtSky(h, pi) {
      const by = {}; let s = 0;
      G.edges.forEach(function (E) { if (E.k === 'fly' && E.hs.indexOf(h) >= 0 && E.owner !== pi) by[E.owner] = (by[E.owner] || 0) + 1; });
      Object.keys(by).forEach(function (o) { s += by[o] * 1.2 * (1 + respect(+o, false) / 5) + (cards(P(+o)) ? 1 : 0); });
      return s;
    }
    function bestRaid(pi) {
      const land = G.hexes.map(function (H, i) { return i; }).filter(function (i) { return G.hexes[i].res !== 'sky' && i !== G.raid && G.hexes[i].verts.every(function (v) { return G.verts[v].owner !== pi; }); })
        .sort(function (a, b) { return hurt(b, pi) - hurt(a, pi); })[0];
      if (!fp()) return land;
      const sky = G.hexes.map(function (H, i) { return i; }).filter(function (i) { return G.hexes[i].res === 'sky' && i !== G.marshal && !G.edges.some(function (E) { return E.owner === pi && E.hs.indexOf(i) >= 0; }); })
        .sort(function (a, b) { return hurtSky(b, pi) - hurtSky(a, pi); })[0];
      // ground a rival's flight routes when they're heading somewhere (it blocks building and moving there), more often on Hard
      if (sky !== undefined && (land === undefined || (hurtSky(sky, pi) >= 3 && rnd() < (G.diff === 'hard' ? 0.5 : G.diff === 'normal' ? 0.35 : 0.2)))) return sky;
      return land;
    }
    // Flight Paths: where to build next. Looks a few steps ahead along open roads or open sky for a free spot,
    // and values a spot on an island it hasn't reached yet (the Overseas Connections bonus).
    function siteScore(w, pi) {
      let s = vScore(w, pi);
      const h = G.verts[w].hexes.filter(function (x) { return G.hexes[x].isl > 0; })[0];
      if (h !== undefined && !G.bonus.some(function (b) { return b.p === pi && b.i === G.hexes[h].isl; })) s += 6;
      return s;
    }
    function reach(pi, e, fly) {   // flights look further ahead: islands are a few hexes of open sky away
      const seen = {}, F = fly ? [0.9, 0.82, 0.74, 0.66, 0.58, 0.5, 0.43, 0.36, 0.3] : [0.9, 0.7, 0.5, 0.36, 0.25];
      let best = -1, front = [G.edges[e].a, G.edges[e].b];
      front.forEach(function (v) { seen[v] = 1; });
      for (let d = 0; d < F.length && front.length; d++) {
        const next = [];
        front.forEach(function (v) {
          const V = G.verts[v];
          if (V.owner >= 0 && V.owner !== pi) return;
          if (V.land && spaced(v)) best = Math.max(best, siteScore(v, pi) * F[d]);
          V.edges.forEach(function (x) {
            const E = G.edges[x]; if (E.owner >= 0 || !(fly ? E.sky && E.hs.indexOf(G.marshal) < 0 : E.land)) return;
            const w = E.a === v ? E.b : E.a; if (!seen[w]) { seen[w] = 1; next.push(w); }
          });
        });
        front = next;
      }
      return best;
    }
    function bestExpand(pi) {
      const p = P(pi); let best = null;
      G.edges.forEach(function (E, e) {
        if (p.routes > 0 && routeOK(pi, e)) { const s = reach(pi, e, false); if (!best || s > best.s) best = { e: e, fly: false, s: s }; }
        if (p.flights > 0 && flyOK(pi, e)) { const s = reach(pi, e, true) - 0.15; if (!best || s > best.s) best = { e: e, fly: true, s: s }; }
      });
      return best && best.s > 0 ? best : null;
    }
    // Smuggler's Den: take what the next build needs, then whatever it holds least of
    function aiGold(pi) {
      const q = G.goldQ[0], p = P(pi), n = need(pi), picks = [];
      for (let k = 0; k < q.n; k++) {
        const r = RES.filter(function (x) { return stock(x) > picks.filter(function (y) { return y === x; }).length; })
          .sort(function (a, b) { return ((n[b] || 0) - picks.filter(function (y) { return y === b; }).length) - ((n[a] || 0) - picks.filter(function (y) { return y === a; }).length) || (p.hand[a] - p.hand[b]); })[0];
        if (r) picks.push(r);
      }
      takeGold(pi, picks);
    }
    function takeGold(pi, picks) {
      picks.forEach(function (r) { P(pi).hand[r]++; });
      if (picks.length) { say(name(pi) + ' ' + verb(pi, 'pick') + ' ' + picks.map(function (r) { return RN[r]; }).join(', ') + ' from the Smuggler\'s Den.'); env.collect(pi, picks.slice()); }
      G.goldQ.shift();
      if (!G.goldQ.length) { G.phase = 'main'; }
    }
    function bestRoute(pi) {
      let best = -1, bs = -Infinity;
      G.edges.forEach(function (E, e) {
        if (!routeOK(pi, e)) return;
        let s = -1;
        [E.a, E.b].forEach(function (v) {
          if (spaced(v)) s = Math.max(s, vScore(v, pi));
          G.verts[v].adj.forEach(function (w) { if (spaced(w)) s = Math.max(s, vScore(w, pi) * 0.75); });
        });
        if (s > bs) { bs = s; best = e; }
      });
      return best;
    }
    function aiDiscard(pi) {
      const p = P(pi), take = {}, left = Object.assign({}, p.hand); let n = Math.floor(cards(p) / 2);
      while (n > 0) { const r = RES.filter(function (x) { return left[x] > 0; }).sort(function (a, b) { return (left[b] - worth(pi, b)) - (left[a] - worth(pi, a)); })[0]; left[r]--; take[r] = (take[r] || 0) + 1; n--; }
      discard(pi, take);
    }
    function aiStep() {
      const pi = G.cur, p = P(pi);
      if (G.phase === 'setup') {
        if (G.setup.step === 'safe') {
          const v = G.verts.map(function (V, i) { return i; }).filter(function (i) { return safeOK(pi, i, true); }).sort(function (a, b) { return vScore(b, pi) - vScore(a, pi); })[0];
          placeSafe(pi, v, true);
        } else if (fp()) { const b = bestExpand(pi) || { e: G.edges.findIndex(function (E, e) { return routeOK(pi, e) || flyOK(pi, e); }), fly: false }; placeRoute(pi, b.e, true, b.fly || !routeOK(pi, b.e)); }
        else placeRoute(pi, bestRoute(pi), true);
        return;
      }
      if (G.phase === 'roll') {
        const fi = p.favs.findIndex(function (f) { return f.t === 'crew' && canPlay(pi, f); });
        if (fi >= 0 && G.hexes[G.raid].verts.some(function (v) { return G.verts[v].owner === pi; })) { useFav(pi, fi); p.crew++; awards(); G.afterRaid = 'roll'; G.phase = 'raid'; return; }
        rollDice(); return;
      }
      if (G.phase === 'raid') { const h = bestRaid(pi); if (h === undefined) { G.phase = G.afterRaid; return; } moveRaid(pi, h); return; }
      if (G.phase === 'steal') { const v = victims(pi, robHex()).sort(function (a, b) { return respect(b, false) - respect(a, false); }); steal(pi, v[0]); return; }
      if (G.phase === 'roads') {
        if (fp()) { const b = bestExpand(pi); if (!b) { G.phase = 'main'; return; } placeRoute(pi, b.e, true, b.fly); return; }
        const e = p.routes ? bestRoute(pi) : -1; if (e < 0) { G.phase = 'main'; return; } placeRoute(pi, e, true); return;
      }
      if (G.phase !== 'main') return;
      if (checkWin(pi)) return;
      if (G.aiActs = (G.aiActs || 0) + 1, G.aiActs > 14) { endTurn(); return; }
      const fi = p.favs.findIndex(function (f) { return canPlay(pi, f); });
      if (fi >= 0) {   // play a favour card when it helps
        const t = p.favs[fi].t, n = need(pi), short = RES.filter(function (r) { return n[r]; });
        if (t === 'roads' && anyFree(pi)) { useFav(pi, fi); G.free = 2; G.phase = 'roads'; return; }
        if (t === 'supply' && short.length && short.reduce(function (s, r) { return s + n[r]; }, 0) <= 2) { useFav(pi, fi); const got = []; short.concat(short, RES).forEach(function (r) { if (got.length < 2 && stock(r) > got.filter(function (x) { return x === r; }).length) got.push(r); }); got.forEach(function (r) { p.hand[r]++; }); say(p.name + ' brings in ' + got.map(function (r) { return RN[r]; }).join(' and ') + '.'); return; }
        if (t === 'deal' && short.length) {
          const r = short.slice().sort(function (a, b) { return others(pi, b) - others(pi, a); })[0];
          if (others(pi, r) >= 2) { useFav(pi, fi); streetDeal(pi, r); return; }
        }
        const tgt = t === 'crew' ? bestRaid(pi) : undefined;
        if (t === 'crew' && ((p.crew + 1 >= 3 && (G.bigCrew < 0 || p.crew + 1 > P(G.bigCrew).crew)) || G.hexes[G.raid].verts.some(function (v) { return G.verts[v].owner === pi; }) || (tgt !== undefined && hurt(tgt, pi) >= 6 && rnd() < 0.6))) { useFav(pi, fi); p.crew++; awards(); G.afterRaid = 'main'; G.phase = 'raid'; return; }
      }
      if (p.hqs && canAfford(p, COST.hq)) {
        const v = G.verts.map(function (V, i) { return i; }).filter(function (i) { return G.verts[i].owner === pi && G.verts[i].lvl === 1; }).sort(function (a, b) { return vScore(b) - vScore(a); })[0];
        if (v !== undefined) { upgrade(pi, v); return; }
      }
      if (p.safes && canAfford(p, COST.safe)) {
        const v = G.verts.map(function (V, i) { return i; }).filter(function (i) { return safeOK(pi, i); }).sort(function (a, b) { return vScore(b, pi) - vScore(a, pi); })[0];
        if (v !== undefined) { placeSafe(pi, v, false); return; }
      }
      if (fp()) {
        const b = (plan(pi) === 'route' || (cards(p) > 7 && plan(pi) !== 'hq' && !anySafe(pi))) ? bestExpand(pi) : null;
        if (b && canAfford(p, b.fly ? COST.fly : COST.route)) { placeRoute(pi, b.e, false, b.fly); return; }
      } else if (p.routes && canAfford(p, COST.route) && (plan(pi) === 'route' || (cards(p) > 7 && plan(pi) !== 'hq' && !anySafe(pi)))) { const e = bestRoute(pi); if (e >= 0) { placeRoute(pi, e, false); return; } }
      const n = need(pi), short = RES.filter(function (r) { return n[r]; });
      if (short.length && short.reduce(function (s, r) { return s + n[r]; }, 0) <= 3) {
        const plain = planCost(pi);   // trade with the bank or a harbour for a missing card
        if (!G.aiTraded) { G.aiTraded = true; if (aiDeal(pi, short, plain)) return; }
        const spare = RES.filter(function (r) { return !n[r] && p.hand[r] - (plain[r] || 0) >= rate(pi, r); }).sort(function (a, b) { return p.hand[b] - p.hand[a]; })[0];
        if (spare && stock(short[0]) > 0) { const k = rate(pi, spare); p.hand[spare] -= k; p.hand[short[0]]++; say(p.name + ' trades ' + k + ' ' + RN[spare] + ' for 1 ' + RN[short[0]] + (k < 4 ? ' at a harbour.' : ' with the bank.')); return; }
        if (!G.asked && humans() === 1) {   // or ask the human player for it (one offer per turn)
          G.asked = true;
          const hi = G.players.findIndex(function (q) { return !q.ai; }), r = short[0];
          const giveR = RES.filter(function (x) { return !n[x] && p.hand[x] > (plain[x] || 0); }).sort(function (a, b) { return p.hand[b] - p.hand[a]; })[0];
          if (hi !== pi && giveR && P(hi).hand[r] > 0 && rnd() < (G.diff === 'easy' ? 0.55 : 0.4)) {
            const give = {}; give[giveR] = p.hand[giveR] - (plain[giveR] || 0) >= 3 ? 2 : 1;
            const want = {}; want[r] = 1;
            G.offer = { from: pi, to: hi, give: give, want: want }; G.phase = 'offer';
            say(p.name + ' offers you a trade.'); return;
          }
        }
      }
      if (G.deck.length && canAfford(p, COST.fav) && (plan(pi) === 'fav' || cards(p) > 7)) { buyFav(pi); return; }
      if (checkWin(pi)) return;
      endTurn();
    }
    /* ---------- New game. o: { mode: 'classic' | 'fp', win (Flight Paths: 12 or 16), diff, speed, online, players: [{ name, col, ai, id }] }
       Classic is always the large map (the small map was retired in 2.41). ---------- */
    function newGame(o) {
      const mode = o.mode === 'fp' ? 'fp' : 'classic', size = mode === 'fp' ? 'fp' : 'large', B = mode === 'fp' ? makeBoardFP() : makeBoard('large');
      const win = mode === 'fp' ? (Number(o.win) === 16 ? 16 : 12) : 14;
      const players = o.players.map(function (s) { return { name: s.name, col: s.col, ai: !!s.ai, id: s.id || 0, hand: { brick: 0, wood: 0, wheat: 0, ore: 0, cotton: 0 }, favs: [], crew: 0,
        routes: mode === 'fp' ? 15 : 20, flights: mode === 'fp' ? 15 : 0, safes: mode === 'fp' ? 5 : 6, hqs: mode === 'fp' ? 4 : 5 }; });
      const deck = shuffle(Array(20).fill('crew').concat(Array(mode === 'fp' ? 5 : 7).fill('respect'), Array(3).fill('supply'), Array(3).fill('deal'), Array(3).fill('roads')));
      const n = players.length, order = [];
      for (let i = 0; i < n; i++) order.push(i);
      for (let i = n - 1; i >= 0; i--) order.push(i);
      const xs = B.hexes.map(function (h) { return h.cx; }).concat(B.ports.map(function (p) { return p.x; })), ys = B.hexes.map(function (h) { return h.cy; }).concat(B.ports.map(function (p) { return p.y; }));
      const x0 = Math.min.apply(null, xs) - R - 14, x1 = Math.max.apply(null, xs) + R + 14, y0 = Math.min.apply(null, ys) - R - 34, y1 = Math.max.apply(null, ys) + R + 12;
      G = { v: 1, mode: mode, size: size, islands: B.islands || null, marshal: B.marshal !== undefined ? B.marshal : -1, bonus: [], goldQ: [], vb: [x0, y0, x1 - x0, y1 - y0].map(Math.round).join(' '), hexes: B.hexes, verts: B.verts, edges: B.edges, ports: B.ports, players: players, deck: deck, diff: o.diff || 'normal', speed: o.speed || 750, online: !!o.online,
        raid: B.hexes.findIndex(function (h) { return h.res === 'none'; }), cur: order[0], phase: 'setup', setup: { order: order, i: 0, step: 'safe', last: -1 },
        win: win, dice: null, turn: 0, playedFav: false, free: 0, discardQ: [], afterRaid: 'main', longest: -1, bigCrew: -1, winner: -1, log: [], offer: null, ask: null, auto: null, counted: false };
      say(mode === 'fp' ? 'A new Flight Paths game begins. Each faction opens two safehouses in Torn City, each with a road or a flight route. Fly out to ' + B.islands.slice(1).join(', ') + ' for +2 Respect each. First to ' + win + ' Respect wins.'
        : 'A new game begins. Each faction opens two safehouses, each with a road. The second safehouse pays its starting cards. First to ' + win + ' Respect wins.');
      return G;
    }
    // Who the game is waiting for, and whether that seat is played by the computer right now
    // (a computer faction, or a person whose turn was handed to the computer after 30 seconds).
    function waiting() {
      if (!G || G.phase === 'over') return -1;
      if (G.phase === 'discard') return G.discardQ[0];
      if (G.phase === 'gold') return G.goldQ[0].p;
      if (G.phase === 'offer') return G.offer.to;
      return G.cur;
    }
    // A handed-over turn lasts for that one turn (or, during setup, that one safehouse and road).
    function moveKey() { return G.phase === 'setup' ? 's' + G.setup.i : 't' + G.turn; }
    function isAI(i) { return P(i).ai || !!(G.auto && G.auto.p === i && G.auto.k === moveKey() && i === G.cur); }
    // One computer decision for whoever the game is waiting on.
    function aiMove() {
      const w = waiting(); if (w < 0) return;
      if (G.phase === 'discard') { aiDiscard(w); return; }
      if (G.phase === 'gold') { aiGold(w); return; }
      if (G.phase === 'offer') { answerOffer(w, false); return; }
      aiStep();
    }
    // Hand a person's turn (or the decision they're stuck on) to the computer.
    function takeOver(i) {
      if (G.phase === 'discard' && G.discardQ[0] === i) { say(P(i).name + ' was too slow. Cards were handed over for them.'); aiDiscard(i); return; }
      if (G.phase === 'gold' && G.goldQ[0].p === i) { say(P(i).name + ' was too slow. The computer picked their Smuggler\'s Den cards.'); aiGold(i); return; }
      if (G.phase === 'offer' && G.offer.to === i) { say(P(i).name + ' didn\'t answer in time.'); answerOffer(i, false); return; }
      if (G.cur === i && !isAI(i)) { G.auto = { p: i, k: moveKey() }; say(P(i).name + ' ran out of time. The computer plays this turn for them.'); }
    }
    function answerOffer(pi, yes) {
      const o = G.offer;
      if (yes) {
        RES.forEach(function (x) { P(o.to).hand[x] += (o.give[x] || 0) - (o.want[x] || 0); P(o.from).hand[x] += (o.want[x] || 0) - (o.give[x] || 0); });
        say(name(o.to) + ' ' + verb(o.to, 'take') + ' ' + P(o.from).name + '\'s deal: ' + list(o.give) + ' for ' + list(o.want) + '.');
        env.collect(o.to, Object.keys(o.give), true); env.last(o.to, o.want, o.give); env.last(o.from, o.give, o.want); env.snd('deal');
      } else say(name(o.to) + ' ' + verb(o.to, 'turn') + ' down ' + P(o.from).name + '.');
      G.offer = null; G.phase = 'main';
    }
    // Answers from the other factions to an offer: computer factions answer at once (yes, no, or a counter-offer);
    // in online games, other people are listed so the offer can be put to them.
    function answers(pi, give, want) {
      return G.players.map(function (p, i) { return i; }).filter(function (i) { return i !== pi && (P(i).ai || G.online); }).map(function (i) {
        if (!P(i).ai) return { i: i, human: true };   // people answer for themselves (their cards stay hidden)
        const w = wantsDeal(i, give, want, pi);
        return { i: i, ok: w.ok, why: w.why, counter: !w.ok && (w.why === 'value' || w.why === 'threat') ? counter(i, give, want, pi) : null };
      });
    }
    function okHand(o) { return o && typeof o === 'object' && Object.keys(o).every(function (k) { return RES.indexOf(k) >= 0 && Number.isInteger(o[k]) && o[k] >= 0 && o[k] <= 30; }); }
    /* ---------- Every move a player can make. Checks it's allowed, applies it, and returns { ok } or { err }. ---------- */
    function act(pi, a) {
      const no = function (why) { return { err: why || 'not_now' }; };
      if (!G || G.phase === 'over') return no('over');
      if (!a || typeof a.t !== 'string' || !P(pi)) return no('bad');
      const p = P(pi), cur = pi === G.cur, t = a.t, main = cur && G.phase === 'main';
      const num = function (x, max) { return Number.isInteger(x) && x >= 0 && x < max; };
      let out = { ok: true };
      if (t === 'roll') { if (!cur || G.phase !== 'roll') return no(); rollDice(); if (G.phase === 'main') checkWin(pi); }
      else if (t === 'safe') {
        if (!cur || !num(a.v, G.verts.length)) return no();
        if (G.phase === 'setup' && G.setup.step === 'safe' && safeOK(pi, a.v, true)) placeSafe(pi, a.v, true);
        else if (main && safeOK(pi, a.v) && canAfford(p, COST.safe) && p.safes) placeSafe(pi, a.v, false);
        else return no();
        checkWin(pi);
      }
      else if (t === 'route') {
        if (!cur || !num(a.e, G.edges.length)) return no();
        if (G.phase === 'setup' && G.setup.step === 'route' && routeOK(pi, a.e)) placeRoute(pi, a.e, true);
        else if (G.phase === 'roads' && routeOK(pi, a.e) && p.routes) placeRoute(pi, a.e, true);
        else if (main && routeOK(pi, a.e) && canAfford(p, COST.route) && p.routes) placeRoute(pi, a.e, false);
        else return no();
        checkWin(pi);
      }
      else if (t === 'fly') {   // Flight Paths: open a flight route
        if (!cur || !num(a.e, G.edges.length)) return no();
        if (G.phase === 'setup' && G.setup.step === 'route' && flyOK(pi, a.e)) placeRoute(pi, a.e, true, true);
        else if (G.phase === 'roads' && flyOK(pi, a.e) && p.flights) placeRoute(pi, a.e, true, true);
        else if (main && flyOK(pi, a.e) && canAfford(p, COST.fly) && p.flights) placeRoute(pi, a.e, false, true);
        else return no();
        checkWin(pi);
      }
      else if (t === 'move') {   // Flight Paths: move the flight route at the open end of a chain (once a turn)
        if (!main || !fp() || G.movedT === G.turn || !num(a.e, G.edges.length) || !num(a.to, G.edges.length) || a.e === a.to || !openFly(pi, a.e)) return no();
        const E = G.edges[a.e]; E.owner = -1; delete E.k; const tt = E.t; delete E.t;
        if (!flyOK(pi, a.to)) { E.owner = pi; E.k = 'fly'; E.t = tt; return no(); }
        const T = G.edges[a.to]; T.owner = pi; T.k = 'fly'; T.t = G.turn; G.movedT = G.turn;
        env.snd('fly'); say(name(pi) + ' ' + verb(pi, 'move') + ' a flight route.');
        awards(); checkWin(pi);
      }
      else if (t === 'gold') {   // Flight Paths: pick your Smuggler's Den cards
        const q = G.goldQ && G.goldQ[0];
        if (G.phase !== 'gold' || !q || q.p !== pi || !Array.isArray(a.picks)) return no();
        const want = Math.min(q.n, RES.reduce(function (s2, r) { return s2 + stock(r); }, 0));
        if (a.picks.length !== want || a.picks.some(function (r) { return RES.indexOf(r) < 0 || stock(r) < a.picks.filter(function (x) { return x === r; }).length; })) return no();
        takeGold(pi, a.picks);
      }
      else if (t === 'hq') { if (!main || !num(a.v, G.verts.length) || G.verts[a.v].owner !== pi || G.verts[a.v].lvl !== 1 || !canAfford(p, COST.hq) || !p.hqs) return no(); upgrade(pi, a.v); checkWin(pi); }
      else if (t === 'fav') { if (!main || !G.deck.length || !canAfford(p, COST.fav)) return no(); buyFav(pi); checkWin(pi); }
      else if (t === 'bank') {
        const g = a.give, w = a.get;
        if (!main || RES.indexOf(g) < 0 || RES.indexOf(w) < 0 || g === w) return no();
        const k = rate(pi, g); if (p.hand[g] < k || stock(w) < 1) return no();
        p.hand[g] -= k; p.hand[w]++;
        const gave = {}, got = {}; gave[g] = k; got[w] = 1;
        env.collect(pi, [w], true); env.snd('trade'); env.last(pi, gave, got);
        say(name(pi) + ' ' + verb(pi, 'trade') + ' ' + k + ' ' + RN[g] + ' for 1 ' + RN[w] + (k < 4 ? ' at a harbour.' : ' with the bank.'));
      }
      else if (t === 'end') { if (!main) return no(); if (!checkWin(pi)) endTurn(); }
      else if (t === 'raid') {
        if (!cur || G.phase !== 'raid' || !num(a.h, G.hexes.length)) return no();
        if (G.hexes[a.h].res === 'sky' ? (!fp() || a.h === G.marshal) : a.h === G.raid) return no();
        moveRaid(pi, a.h);
      }
      else if (t === 'rob') { if (!cur || G.phase !== 'steal' || victims(pi, robHex()).indexOf(a.v) < 0) return no(); steal(pi, a.v); }
      else if (t === 'discard') {
        if (G.phase !== 'discard' || G.discardQ[0] !== pi || !okHand(a.take)) return no();
        if (sum(a.take) !== Math.floor(cards(p) / 2) || RES.some(function (r) { return (a.take[r] || 0) > p.hand[r]; })) return no();
        discard(pi, a.take);
      }
      else if (t === 'play') {
        const f = p.favs[a.idx];
        if (!num(a.idx, p.favs.length) || !canPlay(pi, f)) return no();
        if (f.t === 'crew') { useFav(pi, a.idx); p.crew++; awards(); G.afterRaid = G.phase; G.phase = 'raid'; checkWin(pi); }
        else if (f.t === 'roads') { useFav(pi, a.idx); G.free = 2; G.phase = anyFree(pi) ? 'roads' : 'main'; }
        else if (f.t === 'supply') {
          const pk = a.picks;
          if (!Array.isArray(pk) || pk.length !== 2 || pk.some(function (r) { return RES.indexOf(r) < 0 || stock(r) < pk.filter(function (x) { return x === r; }).length; })) return no();
          useFav(pi, a.idx); pk.forEach(function (x) { p.hand[x]++; }); env.collect(pi, pk.slice());
          say(name(pi) + ' ' + verb(pi, 'bring') + ' in ' + RN[pk[0]] + ' and ' + RN[pk[1]] + '.');
        }
        else if (f.t === 'deal') { if (RES.indexOf(a.res) < 0) return no(); useFav(pi, a.idx); streetDeal(pi, a.res); env.snd('trade'); }
        else return no();
      }
      else if (t === 'ask') {   // put an offer to the other factions
        if (!main || !okHand(a.give) || !okHand(a.want) || !sum(a.give) || !sum(a.want) || RES.some(function (r) { return (a.give[r] && a.want[r]) || (a.give[r] || 0) > p.hand[r]; })) return no();
        G.ask = { give: a.give, want: a.want, answers: answers(pi, a.give, a.want) };
        say(name(pi) + ' ' + verb(pi, 'offer') + ' ' + list(a.give) + ' for ' + list(a.want) + '.');
        out.answers = G.ask.answers;
      }
      else if (t === 'accept') {   // take a computer faction's yes or counter-offer
        const A = G.ask, ans = A && A.answers[a.k];
        if (!main || !ans || !P(ans.i).ai || !(ans.ok || ans.counter)) return no();
        const them = P(ans.i), give = ans.counter || A.give;
        if (RES.some(function (x) { return (give[x] || 0) > p.hand[x] || (A.want[x] || 0) > them.hand[x]; })) return no('cards');
        RES.forEach(function (x) { p.hand[x] += (A.want[x] || 0) - (give[x] || 0); them.hand[x] += (give[x] || 0) - (A.want[x] || 0); });
        say(them.name + ' takes the deal: ' + list(give) + ' for ' + list(A.want) + '.');
        env.collect(pi, Object.keys(A.want), true); env.last(pi, give, A.want); env.snd('deal');
        G.ask = null; out.gave = give; out.got = A.want;
      }
      else if (t === 'propose') {   // online: put the offer to another person, who has 30 seconds to answer
        const A = G.ask;
        if (!main || !A || !G.online || !num(a.to, G.players.length) || a.to === pi || P(a.to).ai) return no();
        if (RES.some(function (x) { return (A.give[x] || 0) > p.hand[x] || (A.want[x] || 0) > P(a.to).hand[x]; })) return no('cards');
        G.offer = { from: pi, to: a.to, give: A.give, want: A.want }; G.phase = 'offer'; G.ask = null;
        say(name(pi) + ' ' + verb(pi, 'offer') + ' ' + P(a.to).name + ' ' + list(A.give) + ' for ' + list(A.want) + '.');
      }
      else if (t === 'yes' || t === 'no') {
        const o = G.offer;
        if (G.phase !== 'offer' || !o || o.to !== pi) return no();
        if (t === 'yes' && RES.some(function (x) { return (o.want[x] || 0) > P(o.to).hand[x] || (o.give[x] || 0) > P(o.from).hand[x]; })) return no('cards');
        answerOffer(pi, t === 'yes');
      }
      else return no('bad');
      return out;
    }
    // A copy of the game for one player's screen: other factions' cards and favours are hidden, and so is the deck.
    function viewFor(Gx, seat) {
      const g = JSON.parse(JSON.stringify(Gx)), over = g.phase === 'over';
      g.bank = {}; RES.forEach(function (r) { g.bank[r] = (g.size === 'standard' ? 19 : 24) - Gx.players.reduce(function (s, q) { return s + q.hand[r]; }, 0); });
      g.players.forEach(function (p, i) {
        if (i === seat || over) return;
        p.n = RES.reduce(function (s, r) { return s + p.hand[r]; }, 0);
        p.hand = { brick: 0, wood: 0, wheat: 0, ore: 0, cotton: 0 };
        p.favs = p.favs.map(function (f) { return { t: '?', fresh: f.fresh }; });
      });
      g.deck = g.deck.map(function () { return '?'; });
      delete g.hid;
      if (g.ask && !(seat === g.cur)) g.ask = null;
      return g;
    }
    return {
      get: function () { return G; }, set: function (g) { G = g; },
      RES: RES, RN: RN, DIST: DIST, COST: COST, FAV: FAV, MAPS: MAPS, R: R, CX: CX, CY: CY, ISLANDS: ISLANDS,
      newGame: newGame, act: act, aiMove: aiMove, aiStep: aiStep, aiDiscard: aiDiscard, takeOver: takeOver, waiting: waiting, isAI: isAI, viewFor: viewFor, answers: answers,
      P: P, cards: cards, stock: stock, canAfford: canAfford, spaced: spaced, safeOK: safeOK, routeOK: routeOK, flyOK: flyOK, openFly: openFly, anyRoute: anyRoute, anyFly: anyFly, anyFree: anyFree, anySafe: anySafe, robHex: robHex, fp: fp, rate: rate, routeLen: routeLen,
      respect: respect, WIN: WIN, humans: humans, you: you, name: name, verb: verb, say: say, checkWin: checkWin, canPlay: canPlay, victims: victims, pips: pips, list: list, sum: sum,
      wantsDeal: wantsDeal, counter: counter, est: est, produce: produce
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = TTEngine;
