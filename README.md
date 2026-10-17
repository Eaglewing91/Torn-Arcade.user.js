# 📱 Torn Arcade

**A phone full of games for [Torn](https://www.torn.com), by Eaglewing [571041].**

Torn Arcade is a Tampermonkey userscript that adds a **Mobile Phone** link to Torn's sidebar. Click it and a phone opens on top of the page with five games, a scores screen and settings. Everything runs inside the phone, and every image, sound and piece of music is built into the script or its two optional Art Packs.

---

## ⬇️ Install

1. Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension.
2. Open the install link and click **Install**:
   **[Install Torn Arcade](https://github.com/Eaglewing91/Torn-Arcade.user.js/raw/main/Torn-Arcade.user.js)**
3. Open Torn and click **Mobile Phone** under Calendar in the sidebar. On pages without the sidebar, a small floating **Phone** button appears instead.

Your progress is saved in Tampermonkey's storage on your device. Updating the script keeps your saves.

### 🎨 Optional Art Packs
The illustrated Tornie and character artwork comes in two separate, optional scripts. This keeps Torn Arcade itself small (about 1.4 MB), so it works on phones and apps that only accept scripts up to 2 MB. Without them, Tornies uses its pixel-art versions.

| Script | What it adds | Size | Install |
|---|---|---|---|
| **Torn Arcade - Tornies Art** | Illustrated artwork for all 179 Tornies | about 1.4 MB | [Install](https://github.com/Eaglewing91/Torn-Arcade.user.js/raw/main/Torn-Arcade-Tornies-Art.user.js) |
| **Torn Arcade - Character Art** | Illustrated portraits of the gym leaders, story characters, trainers and your outfits | about 0.5 MB | [Install](https://github.com/Eaglewing91/Torn-Arcade.user.js/raw/main/Torn-Arcade-Character-Art.user.js) |

Install them like the main script, then reload Torn. The **Tornies Art** and **Character Art** apps on the bottom row of the phone show whether each pack is installed, a before/after preview, a gallery of the art you've unlocked and an on/off switch. Each pack updates itself separately.

How they link: the packs hand their pictures to Torn Arcade using browser events on the Torn page you're viewing. Torn Arcade checks every picture (known names, WebP images only) before using it. The packs make **no requests of any kind**, store nothing and need no API key.

### 🔄 Automatic updates
From version 2.15.2, Tampermonkey checks this link for new versions (about once a day by default) and updates the script for you. If you installed an older version from somewhere else, reinstall once from the link above. After that, updates are automatic. This check is made by Tampermonkey to GitHub only. It isn't a request to Torn and sends no data.

---

## 🎮 The games

### 🐾 Tornies
A creature-collecting RPG set in Torn City. You start in Maple Hollow with one of three partner Tornies and travel across the city to catch, train and battle **178 Tornies**, from Gutterats in the alleys to the Legendary Guardians.

- Win **8 Arena medals** from Torn City's Arena Leaders, then take on the **Torn Council** and the Champion.
- Turn-based battles with 17 types, status effects, boosters and evolutions.
- Day and night, live weather, fishing, a Day Care with eggs to hatch, rare golden Tornies, merits to earn and a Battle Tower.
- Trade Tornies with friends using trade codes. No server is involved.
- Custom illustrated artwork for every Tornie and character, made specifically for Torn Arcade (from the optional Art Packs; pixel art without them), plus an animated title screen and an original soundtrack.
- Illustrated towns and routes: soft shorelines, sandy beaches, snowy mountains, city streets and a neon casino strip, with swaying tall grass and lights that come on at night.
- Map options in Settings → Tornies: **Pre-load maps** (draws what is on screen during the normal fade, the rest in the background, and readies the next map as you walk towards an exit), **Save maps on this device** (maps you have visited open instantly next time), **Prepare all maps** (a one-off that draws and saves every outdoor map; about 40–100 MB of browser storage and a few minutes) and **Clear saved maps**.

### 👽 Torn Invasion
A Doom-style first-person shooter. Aliens have overrun Torn City, and you fight through infested levels with a **pistol, shotgun and plasma rifle**. Unlock levels as you clear them, beat your best times and scores, and collect achievements.

### 🐦 Angry Bogies
Bogie versus the Racket. Pull back the slingshot, fling Bogies into the gang's hideouts, smash the structures and knock out every thug. **Ten levels with three stars each**, scored on how efficiently you clear them.

### 💣 Dirty Bombs
A minesweeper-style puzzle. Clear the city block by block without setting off a dirty bomb. Numbers show how many bombs are hidden next to each block.

### 🐤 Flappy Torn
Tap to fly through the gaps in the pipes over the Torn City skyline. Every pipe you pass is a point.

### 🏆 Scores and ⚙️ Settings
Scores keeps your best result for every mini-game. Settings has sound and volume, wallpapers, optional Torn event notifications, a Tornies cheat-code box and options to reset each game's data.

---

## ✅ Torn rules

Torn Arcade is built to follow Torn's scripting rules:

- Apart from adding the **Mobile Phone** link to the sidebar, it never reads, clicks or changes anything on Torn's page.
- It **never loads Torn pages** and makes **no non-API requests** to Torn.
- It doesn't talk to any website other than the official Torn API, and only does that if you turn on event notifications. The Art Pack install buttons are plain links to this GitHub page that only open when you tap them.
- The optional Art Packs make no requests at all. They only pass pictures to Torn Arcade on the page.
- Games only react to keys while the phone is open, and never while you're typing in a text box.

### Optional event notifications
If you add a **Limited** access API key in Settings, the phone checks the official Torn API (`api.torn.com`, `/v2/user/events`) for new events **every 5 seconds while the phone is open**. That's 12 calls a minute, well under Torn's limit of 100. Nothing is requested while the phone is closed. The key is only ever sent to `api.torn.com`. See the [Torn API terms](https://www.torn.com/api.html).

---

## 📄 Terms of Service

| Data Storage | Data Sharing | Purpose of Use | Key Storage & Sharing | Key Access Level |
|---|---|---|---|---|
| Only locally | Nobody | Public amusement (games) and event notifications on the phone | Stored locally / Used only for automation (event checks while the phone is open). Never shared. | Limited (user → events). Optional: only needed for event notifications |

- **Data Storage:** settings, wallpaper, best scores, your Tornies save, Torn Invasion progress, Angry Bogies stars and your API key are kept in Tampermonkey storage on your device. Events are shown on the phone but never saved. With **Save maps on this device** on (Settings → Tornies), pictures of the Tornies maps the game has drawn are also kept in your browser's own storage for torn.com (IndexedDB, `torn-arcade-maps`). They are drawn by the script on your device, contain no personal data, are never uploaded or shared, and **Clear saved maps** deletes them.
- **Data Sharing:** nothing is sent anywhere except event requests to `api.torn.com`.
- The same table is shown next to the API key box in Settings and at the top of the script.

**Art Packs** (Tornies Art and Character Art):

| Data Storage | Data Sharing | Purpose of Use | Key Storage & Sharing | Key Access Level |
|---|---|---|---|---|
| No | Nobody | Public amusement (artwork for the Torn Arcade games) | Not stored / Not shared (no key used) | None (no API key needed) |

---

## 📝 Licence

**All rights reserved.** You may install and use Torn Arcade for your own personal play from this official link. You may also read the code to check that it's safe and follows Torn's rules. You may not copy, modify, redistribute or reuse it or any part of it without written permission. See [LICENSE](LICENSE) for the full terms.

Torn is owned by its respective owners. Torn Arcade is an unofficial fan project and isn't affiliated with or endorsed by Torn.

---

Made by **Eaglewing [571041]**.
