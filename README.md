# 📱 Torn Arcade

**A phone full of games for [Torn](https://www.torn.com), by Eaglewing [571041].**

Torn Arcade is a Tampermonkey userscript that adds a **Mobile Phone** link to Torn's sidebar. Click it and a phone opens on top of the page with nine games, a scores screen and settings. Everything runs inside the phone, and every image, sound and piece of music is built into the script.

---

## ⬇️ Install

1. Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension.
2. Open the install link and click **Install**:
   **[Install Torn Arcade](https://github.com/Eaglewing91/Torn-Arcade.user.js/raw/main/Torn-Arcade.user.js)**
3. Open Torn and click **Mobile Phone** under Calendar in the sidebar. On pages without the sidebar, a small floating **Phone** button appears instead.

Your progress is saved in Tampermonkey's storage on your device. Updating the script keeps your saves.

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
- Hand-painted Tornie and character art, an animated title screen and an original soundtrack.

### 👽 Torn Invasion
A Doom-style first-person shooter. Aliens have overrun Torn City, and you fight through infested levels with a **pistol, shotgun and plasma rifle**. Unlock levels as you clear them, beat your best times and scores, and collect achievements.

### 🐦 Angry Bogies
Bogie versus the Racket. Pull back the slingshot, fling Bogies into the gang's hideouts, smash the structures and knock out every thug. **Ten levels with three stars each**, scored on how efficiently you clear them.

### 🐍 Snake
The classic, Torn-style. Eat Torn badges to grow longer and grab cash bags for bonus points. Don't bite your own tail.

### 🔨 Whack-a-Mole
Hamsters pop out of their holes, so whack them before they duck back down. Golden hamsters are worth 3 points.

### 🃏 Card Match
A memory game. Flip two cards at a time and find every matching pair in as few moves as you can.

### 💣 Dirty Bombs
A minesweeper-style puzzle. Clear the city block by block without setting off a dirty bomb. Numbers show how many bombs are hidden next to each block.

### 🎯 Shooting Range
Test your aim. Shoot the targets before they flip away. Gold-rimmed targets and bullseyes score extra.

### 🐤 Flappy Torn
Tap to fly through the gaps in the pipes over the Torn City skyline. Every pipe you pass is a point.

### 🏆 Scores and ⚙️ Settings
Scores keeps your best result for every mini-game. Settings has sound and volume, wallpapers, optional Torn event notifications, a Tornies cheat-code box and options to reset each game's data.

---

## ✅ Torn rules

Torn Arcade is built to follow Torn's scripting rules:

- Apart from adding the **Mobile Phone** link to the sidebar, it never reads, clicks or changes anything on Torn's page.
- It **never loads Torn pages** and makes **no non-API requests** to Torn.
- It doesn't talk to any website other than the official Torn API, and only does that if you turn on event notifications.
- Games only react to keys while the phone is open, and never while you're typing in a text box.

### Optional event notifications
If you add a **Limited** access API key in Settings, the phone checks the official Torn API (`api.torn.com`, `/v2/user/events`) for new events **every 5 seconds while the phone is open**. That's 12 calls a minute, well under Torn's limit of 100. Nothing is requested while the phone is closed. The key is only ever sent to `api.torn.com`. See the [Torn API terms](https://www.torn.com/api.html).

---

## 📄 Terms of Service

| Data Storage | Data Sharing | Purpose of Use | Key Storage & Sharing | Key Access Level |
|---|---|---|---|---|
| Only locally | Nobody | Public amusement (games) and event notifications on the phone | Stored locally / Used only for automation (event checks while the phone is open). Never shared. | Limited (user → events). Optional: only needed for event notifications |

- **Data Storage:** settings, wallpaper, best scores, your Tornies save, Torn Invasion progress, Angry Bogies stars and your API key are kept in Tampermonkey storage on your device. Events are shown on the phone but never saved.
- **Data Sharing:** nothing is sent anywhere except event requests to `api.torn.com`.
- The same table is shown next to the API key box in Settings and at the top of the script.

---

## 📝 Licence

**All rights reserved.** You may install and use Torn Arcade for your own personal play from this official link. You may also read the code to check that it's safe and follows Torn's rules. You may not copy, modify, redistribute or reuse it or any part of it without written permission. See [LICENSE](LICENSE) for the full terms.

Torn is owned by its respective owners. Torn Arcade is an unofficial fan project and isn't affiliated with or endorsed by Torn.

---

Made by **Eaglewing [571041]**.
