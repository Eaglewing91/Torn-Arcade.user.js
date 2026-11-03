// ==UserScript==
// @name         Torn Arcade
// @namespace    https://github.com/Eaglewing91
// @version      2.56.0
// @description  Torn Arcade is temporarily paused while Torn staff review it. This version only adds the Mobile Phone link, which shows a notice. It runs no games, makes no requests of any kind and stores nothing. Your saved progress is kept on your device.
// @author       Eaglewing [571041]
// @copyright    2026, Eaglewing [571041]. All rights reserved.
// @license      All Rights Reserved - for use on Torn (torn.com) only; no copying, modifying, redistribution or use elsewhere (see LICENCE below)
// @homepageURL  https://github.com/Eaglewing91/Torn-Arcade.user.js
// @updateURL    https://github.com/Eaglewing91/Torn-Arcade.user.js/raw/main/Torn-Arcade.user.js
// @downloadURL  https://github.com/Eaglewing91/Torn-Arcade.user.js/raw/main/Torn-Arcade.user.js
// @icon         data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%232f7bd1'/%3E%3Ctext x='32' y='45' font-family='Arial' font-weight='900' font-size='38' text-anchor='middle' fill='%23fff'%3ET%3C/text%3E%3C/svg%3E
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @noframes
// ==/UserScript==

/*
 * LICENCE - ALL RIGHTS RESERVED - FOR USE ON TORN ONLY
 * Copyright (c) 2026 Eaglewing [571041]. All rights reserved.
 *
 * This licence covers the author's own work in Torn Arcade and its optional
 * companion scripts (Torn Arcade - Tornies Art and Torn Arcade - Character Art): the
 * code, the games and their design, the original characters and creatures
 * (including the Tornies), the artwork, the music and the original text
 * ("the Author's Work"). The Author's Work belongs to Eaglewing [571041].
 *
 * TORN'S OWN MATERIAL IS NOT CLAIMED
 * Torn, Torn City, and Torn's names, places, items, characters and other
 * content belong to Torn's owners. They appear in these scripts only as fan
 * references, inside scripts made solely for use on Torn. The author claims no
 * ownership of or rights over them, and this licence does not apply to them.
 * Player usernames are used with respect and belong to those players. Anything
 * will be removed or changed on request from Torn's staff or the player.
 *
 * 1. TORN ONLY
 *    The scripts are made for, and licensed only for use on, the Torn
 *    website (https://www.torn.com), in your own web browser through a
 *    userscript manager such as Tampermonkey. Any use outside Torn is
 *    unauthorised. That includes running, hosting, embedding or using any part
 *    of them on any other website, app, game, server, emulator, launcher or
 *    app store, or as standalone software.
 *
 * 2. WHAT YOU MAY DO
 *    - Install them from the official links published by the author and use
 *      them on Torn for your own personal play.
 *    - Read the code to check that it is safe and follows Torn's rules.
 *
 * 3. WHAT YOU MAY NOT DO (without the author's prior written permission)
 *    - Use them, or any part of the Author's Work, anywhere other than Torn
 *      (see 1).
 *    - Copy, reproduce or republish the Author's Work, in whole or in part.
 *    - Modify, adapt, translate or make derivative works from them.
 *    - Redistribute, share, sell, rent, sublicense or host them anywhere else
 *      (including other script sites, gists, repositories or file shares).
 *    - Extract or reuse any of the Author's Work (code, artwork, original
 *      characters, music or text) in other projects, products or media,
 *      including to train or build AI models.
 *    - Use them commercially in any way.
 *    - Remove or change this notice.
 *
 * 4. PERMISSION
 *    Permission to use the scripts is personal, non-exclusive,
 *    non-transferable and limited to Torn. It can be withdrawn at any time
 *    and ends automatically if any of these terms are broken.
 *
 * 5. NO WARRANTY
 *    The scripts are provided "as is", without warranty of any kind. The author
 *    is not liable for any loss or damage arising from their use.
 *
 * Torn Arcade is an unofficial fan project. It is not affiliated with, endorsed
 * by or sponsored by Torn or its owners.
 */

/*
 * TORN ARCADE IS PAUSED
 * Torn Arcade is temporarily paused while Torn staff review it, so that it fully complies with Torn's scripting
 * rules and advertising rules. Until the review is finished, this version does only this:
 * - It adds the "Mobile Phone" link to Torn's sidebar (or a small floating button where there is no sidebar).
 * - Opening it shows a notice that Torn Arcade is paused. Nothing else: no games, no other screens.
 * It makes no requests of any kind (no Torn API, no other website, no server), never reads or changes Torn's page
 * beyond adding that one link, and stores nothing. Your saved progress from earlier versions is not read, changed or
 * deleted: it stays on your device for when Torn Arcade returns.
 *
 * TERMS OF SERVICE (this version)
 * | Data Storage          | No                    |
 * | Data Sharing          | Nobody                |
 * | Purpose of Use        | Other: shows a notice |
 * | Key Storage & Sharing | Not stored / Not shared (no API key is used) |
 * | Key Access Level      | None                  |
 */

(function () {

  if (window.top !== window.self) return;            // never inside frames
  if (document.getElementById('ta-root')) return;    // only one copy per page
  // Styles this script adds, kept so they can be put back if a page (Torn's maintenance page) rebuilds itself.
  const TA_STYLES = [];
  function taStyle(css) { let s = null; try { s = GM_addStyle(css); } catch (e) {} TA_STYLES.push({ css: css, el: s && s.nodeType === 1 ? s : null }); return s; }

  /* ================= Starter =================
   * On every Torn page only this small part runs: it adds the "Mobile Phone" link (or a small floating
   * button where there is no sidebar). The phone and all seven games are set up the first time you open it,
   * so pages where you never open the phone pay almost nothing. */
  let arcade = null;
  function startArcade() { if (!arcade) arcade = PAUSED(); return arcade; }
  function PAUSED() {
    taStyle('.ta-paused{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;background:rgba(6,10,16,.72);font:14px/1.5 system-ui,-apple-system,"Segoe UI",Arial,sans-serif}' +
      '.ta-paused[hidden]{display:none}' +
      '.ta-pphone{width:min(340px,calc(100vw - 32px));border-radius:34px;padding:14px;background:#0b1119;border:1px solid #2c4466;box-shadow:0 20px 60px rgba(0,0,0,.6)}' +
      '.ta-pscreen{border-radius:24px;padding:34px 22px 26px;background:radial-gradient(ellipse at top,#16263a,#0c1520 70%);color:#dfe8f3;text-align:center}' +
      '.ta-pscreen .ta-pic{font-size:44px;line-height:1}' +
      '.ta-pscreen h2{margin:12px 0 8px;font-size:19px;color:#fff}' +
      '.ta-pscreen p{margin:0 0 10px;color:#b9c6d6;font-size:13.5px}' +
      '.ta-pscreen small{display:block;margin-top:6px;color:#7f8ea2;font-size:12px}' +
      '.ta-pscreen button{margin-top:14px;padding:8px 22px;border-radius:999px;border:1px solid #2f7bd1;background:#2f7bd1;color:#fff;font:600 13px system-ui,Arial,sans-serif;cursor:pointer}');
    const box = document.createElement('div');
    box.className = 'ta-paused'; box.hidden = true; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Torn Arcade is paused');
    box.innerHTML = '<div class="ta-pphone"><div class="ta-pscreen"><div class="ta-pic">🛠️</div><h2>Torn Arcade is temporarily down</h2>' +
      '<p>Torn Arcade is paused while it is reviewed by Torn staff, to make sure it fully meets Torn\'s scripting and advertising rules.</p>' +
      '<p>It will be back as soon as the review is finished. Your saved progress is safe on this device.</p>' +
      '<small>This version runs no games and makes no requests.</small><button type="button">Close</button></div></div>';
    const hide = function () { box.hidden = true; };
    box.addEventListener('click', function (e) { if (e.target === box || e.target.tagName === 'BUTTON') hide(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !box.hidden) hide(); });
    (document.body || document.documentElement).append(box);
    keepOnPage(box, function () { return !box.hidden; });
    return { open: function () { box.hidden = false; }, toggle: function () { box.hidden = !box.hidden; } };
  }
  try { taStyle('.ta-launch{position:fixed;left:12px;bottom:12px;z-index:2147482999;display:flex;align-items:center;gap:6px;padding:7px 13px 7px 10px;margin:0;border-radius:999px;border:1px solid #2f7bd1;background:rgba(12,20,31,.92);color:#e6f2ff;font:700 13px/1 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.45)}.ta-launch[hidden]{display:none}'); } catch (e) {}
  const launcher = document.createElement('button');
  launcher.type = 'button'; launcher.className = 'ta-launch'; launcher.innerHTML = '<span>📱</span><span>Phone</span>';
  launcher.title = 'Open Mobile Phone'; launcher.hidden = true;
  launcher.addEventListener('click', function () { startArcade().open(); });
  (document.body || document.documentElement).append(launcher);
  /* ================= "Mobile Phone" link in Torn's sidebar =================
   * Copies Torn's own Calendar row so it looks like the other area links, and
   * adds it straight after it. Clicking it only opens the phone on top of the
   * page: it is not a real link and never loads a page. If Torn redraws its
   * sidebar, a watcher on the sidebar alone adds the link back. */
  const LINK_ID = 'nav-mobile-phone';
  const PHONE_PATH = 'M4.6 0h6.8A1.6 1.6 0 0 1 13 1.6v12.8a1.6 1.6 0 0 1-1.6 1.6H4.6A1.6 1.6 0 0 1 3 14.4V1.6A1.6 1.6 0 0 1 4.6 0Zm.4 2.2v10h6v-10H5Zm3 10.9a.95.95 0 1 0 0 1.9.95.95 0 0 0 0-1.9Z';
  let sideWatch = null, linkTries = 0;
  function areaAnchor() {
    const cal = document.getElementById('nav-calendar');
    if (cal) return cal;
    const list = document.querySelectorAll('[class*="areas"] [id^="nav-"]:not(#' + LINK_ID + ')');
    return list.length ? list[list.length - 1] : null;
  }
  function stripActive(el) {
    [el].concat(Array.prototype.slice.call(el.querySelectorAll('[class]'))).forEach(function (n) {
      const cls = typeof n.className === 'string' ? n.className : (n.getAttribute('class') || '');
      const keep = cls.split(/\s+/).filter(function (c) { return c && !/active/i.test(c); }).join(' ');
      n.setAttribute('class', keep);
    });
  }
  function insertPhoneLink() {
    if (document.getElementById(LINK_ID)) return true;
    const anchor = areaAnchor();
    if (!anchor || !anchor.parentNode) return false;
    const row = anchor.cloneNode(true);
    row.id = LINK_ID;
    stripActive(row);
    row.querySelectorAll('[id]').forEach(function (n) { n.removeAttribute('id'); });
    const a = row.querySelector('a');
    if (!a) return false;
    a.setAttribute('href', '#'); a.removeAttribute('i-data'); a.setAttribute('role', 'button'); a.title = 'Open Mobile Phone';
    // Drop anything extra Torn shows on that row (counters, timers).
    Array.prototype.slice.call(row.querySelectorAll('[class*="amount"],[class*="counter"],[class*="timer"]')).forEach(function (n) { n.remove(); });
    const name = row.querySelector('[class*="linkName"]') || a.querySelector('span:last-child');
    if (name) name.textContent = 'Mobile Phone';
    const svg = row.querySelector('svg');
    // Torn's mobile layout (phones, tablets and Torn PDA: the "area-mobile" rows, or a window 1000px wide or less)
    // uses bigger icon tiles. There the copy keeps the Calendar icon's own size and viewBox, and the phone icon is
    // scaled to fill it, so it lines up with the other tiles. The PC sidebar is unchanged.
    const mobileSide = /area-mobile/.test(anchor.className || '') || !!anchor.querySelector('[class*="mobileLink"]') || window.innerWidth <= 1000;
    if (svg && mobileSide) {
      const vb = (svg.getAttribute('viewBox') || '0 0 16 16').split(/[\s,]+/).map(Number);
      const vw = vb[2] || 16, vh = vb[3] || 16, k = Math.min(vw, vh) / 16;
      svg.innerHTML = '<g transform="translate(' + (vb[0] + (vw - 16 * k) / 2) + ' ' + (vb[1] + (vh - 16 * k) / 2) + ') scale(' + k + ')"><path fill-rule="evenodd" d="' + PHONE_PATH + '"></path></g>';
    } else if (svg) {
      svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('width', '16'); svg.setAttribute('height', '16');
      svg.innerHTML = '<path fill-rule="evenodd" d="' + PHONE_PATH + '"></path>';
    }
    a.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); startArcade().toggle(); });
    anchor.parentNode.insertBefore(row, anchor.nextSibling);
    launcher.hidden = true;
    watchSidebar(anchor);
    return true;
  }
  function watchSidebar(anchor) {
    if (sideWatch) return;
    const box = anchor.closest('#sidebarroot') || anchor.closest('[class*="sidebar"]') || anchor.parentNode;
    let queued = false;
    sideWatch = new MutationObserver(function () {
      if (queued || document.getElementById(LINK_ID)) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; if (!insertPhoneLink()) { sideWatch.disconnect(); sideWatch = null; tryLink(); } });
    });
    sideWatch.observe(box, { childList: true, subtree: true });
  }
  // Torn draws its sidebar after the page loads, so look for it for a few seconds.
  function tryLink() {
    if (insertPhoneLink()) return;
    if (++linkTries < 30) setTimeout(tryLink, 400);
    else {
      launcher.hidden = false;   // no sidebar on this page: show the small floating button instead
    }
    keepOnPage(launcher, function () { return !launcher.hidden; });
  }
  // Some pages (Torn's maintenance page) redraw everything on the page every few seconds, which also removed the
  // phone. Put it back if that happens. This only looks at the phone's own elements.
  function keepOnPage(el, wanted) {
    if (el._keep) return;
    el._keep = setInterval(function () {
      if (!wanted()) return;
      if (!el.isConnected) (document.body || document.documentElement).append(el);
      // our styles went with the page: put them back (the phone and the button are always position:fixed when styled)
      if (getComputedStyle(el).position !== 'fixed') TA_STYLES.forEach(function (t) {
        if (t.el) { if (!t.el.isConnected) (document.head || document.documentElement).append(t.el); }
        else { try { const s = GM_addStyle(t.css); if (s && s.nodeType === 1) t.el = s; } catch (e) {} }
      });
    }, 500);
  }

  tryLink();
  try { GM_registerMenuCommand('Open Mobile Phone', function () { startArcade().open(); }); } catch (e) {}

})();
