# Dota 2 Side Monitor

A dashboard for a second monitor that updates live while you play Dota 2. It shows the match clock and status, live day/night, Roshan and ward timers, your hero, economy, items, abilities and performance, a minimap, match events, and a net worth vs. match time chart. The page uses Material You (M3) styling, and its colors come from the hero you're playing.

```
Dota 2 ──HTTP POST (GSI JSON)──▶ server.js (Express :3636) ──Socket.io──▶ browser (public/index.html)
```

## Files

| File | Purpose |
|---|---|
| `gamestate_integration_sidemonitor.cfg` | Tells Dota 2 where and what to send |
| `server.js` | Receives GSI POSTs, checks the auth token, keeps per-match history, broadcasts over Socket.io. Also proxies and caches Valve's hero, item and ability images in `cache/img` |
| `public/index.html`, `public/style.css` | Page layout and the M3 styles |
| `public/app.js` | Renders the panels and the live timer pills |
| `public/theme.js` | Builds the M3 color palette from the hero portrait (Google's `@material/material-color-utilities`) and switches light/dark |
| `public/settings.js` | Settings sheet, saved in the browser |
| `public/minimap.js` | Draws the minimap |
| `public/resources/` | Minimap background images (detailed and simple) |
| `simulate.js` | Sends fake GSI data so you can test without launching Dota |

## What's on the dashboard

Each panel appears only when Dota actually sends its data.

| Panel | Contents | Sent when |
|---|---|---|
| Top bar | Clock (amber when paused), game state, Radiant–Dire score, and three live timer pills. **Day/Night** counts down to the next switch. **Roshan** shows alive, or the earliest/latest respawn. **Observer wards** shows the restock countdown. Click a pill for exact match times. Also has the theme button and the settings button | Always in a match |
| Hero | Portrait, level and XP, HP/mana bars, death and respawn timer, buyback ready/cost/cooldown, status effects (stunned, silenced, hexed, …), Aghanim's Scepter/Shard, talents | Playing |
| Economy | Net worth and gold with deltas, reliable/unreliable, GPM/XPM, net worth over the last 60s, LH/DN, where gold came from and where it went | Playing |
| Items | Inventory, backpack, TP, neutral, stash, with cooldowns and charges | Playing |
| Abilities | Icons, level pips, cooldowns, charges, ultimate highlighted | Playing |
| Performance | Kill streak, hero/tower damage, healing, wards, runes, camps stacked, commands and actions per minute | Playing (some fields depend on the Dota build) |
| Minimap | Heroes (with icons), creeps, wards with vision circles, towers, couriers and Roshan. Without minimap data it shows your own hero's position only | Playing (own hero always); full map if Dota sends the `minimap` block |
| Match events | Roshan kills, Aegis, bounty runes, tips, courier kills | Playing or spectating |
| Buildings | HP of every tower, barracks and Ancient for both teams | Spectating / observing |
| Scoreboard | All 10 players: hero, level, K/D/A, LH/DN, gold, net worth, GPM/XPM | Spectating / observing |
| Raw GSI data | The full latest payload, plus the list of blocks your client is sending | Always |

Some of the data in the C# Dota2GSI library (draft, league, wearables, couriers, neutral item stash) is only sent to spectators or observers. It isn't shown yet. `league` and `wearables` are turned off in the cfg because they are large and not used.

## Theme and settings

- **Theme button** (top right): cycles **Light → Dark → Game time**. In Game time mode the page is light during the in-game day and dark at night. Outside a match it follows your system setting.
- **Hero colors**: when you pick a hero, the page reads the main color from the hero's portrait and builds a full Material You palette from it, the same way Android themes itself from your wallpaper. Meaning colors never change: green/red gains and losses, Radiant/Dire, HP/mana and gold.
- **Settings** (gear button), saved in this browser:
  - **Appearance:** theme mode, hero colors on/off, color style (Faithful, Vibrant, Expressive, Content, Tonal spot), contrast level, and a fallback color for when no hero is picked
  - **Panels:** show or hide each panel
  - **Minimap:** background (detailed/simple), creeps/wards/buildings, ward vision, hero icon size, a coordinate readout, and the world bounds used to line markers up with the image
  - **Behaviour:** how long gold changes stay highlighted, and whether timers tick between updates

To add a new setting, add an entry to `SCHEMA` in `public/settings.js`. The settings sheet builds its controls from that list.

### Calibrating the minimap

Markers are placed from Dota world coordinates. If they look offset in a real game:

1. Start a **Demo Hero** game.
2. Turn on **Settings → Minimap → Show coordinates**.
3. Walk to a corner of the map, such as your fountain.
4. Adjust **World min** and **World max** until your hero icon sits on the right spot.

## Setup

### 1. Install Node.js (version 18 or later)

```powershell
winget install OpenJS.NodeJS.LTS
```

Open a **new** terminal afterwards so that `node` and `npm` are on your PATH. Check with `node -v`.

### 2. Install dependencies

```powershell
cd C:\Games\Dota_2_dual
npm install
```

### 3. Install the GSI config file

Copy `gamestate_integration_sidemonitor.cfg` into:

```
<Steam library>\steamapps\common\dota 2 beta\game\dota\cfg\gamestate_integration\
```

On this PC, that folder is:

```
C:\Program Files (x86)\Steam\steamapps\common\dota 2 beta\game\dota\cfg\gamestate_integration\
```

```powershell
Copy-Item .\gamestate_integration_sidemonitor.cfg "C:\Program Files (x86)\Steam\steamapps\common\dota 2 beta\game\dota\cfg\gamestate_integration\"
```

- Create the `gamestate_integration` folder if it doesn't exist. The file name **must** start with `gamestate_integration_` and end in `.cfg`.
- If Dota is in another Steam library, open Steam, right-click Dota 2, choose **Manage → Browse local files**, and go to `game\dota\cfg`.
- The `token` in the `.cfg` must match `GSI_TOKEN` in `server.js` (default: `sidemonitor-change-me`). If you change one, change the other.

### 4. Enable GSI in Dota 2's launch options

In Steam, right-click **Dota 2 → Properties → General → Launch Options** and add:

```
-gamestateintegration
```

Without this flag, Dota 2 ignores the cfg folder. Restart Dota after adding the flag or changing the cfg; it reads the cfg only at launch.

### 5. Run it

```powershell
npm start
```

Open **http://localhost:3636** on your side monitor. Press F11 for fullscreen.

To view it from a tablet or phone on the same network, use `http://<this-PC's-LAN-IP>:3636`. You may need to allow Node.js through Windows Firewall.

## Verification

1. **Server is up.** Open http://localhost:3636/health. It should return `{"ok":true,...}`.
2. **Dashboard works without the game.** Leave `npm start` running, then in a second terminal run:
   ```powershell
   npm run simulate
   ```
   Add `$env:SPEED=20` first to run faster, `$env:SPECTATE=1` to test the spectator panels (buildings, scoreboard), or `$env:NO_MINIMAP=1` to test the "own hero only" minimap fallback.

   On the dashboard, the clock counts from `-0:15` to `0:00` and up, and the status changes from *Pre-game* to *Game in progress* with a green dot. Gold and net worth tick up, deltas flash green (▲) or red (▼), and the chart starts plotting at 0:00. Refresh the page: the chart keeps its history. Stop the simulator with Ctrl+C. After about 35 seconds, the status changes to *No signal*.
3. **Dota 2 is sending data.** Launch Dota with the launch option set. On the main menu, the dashboard shows *In menus* within about 30 seconds (Dota sends a heartbeat every 30 s). If the server console shows `rejected payload ... auth token`, the tokens don't match.
4. **Live match.** Start a bot match or a Demo Hero game. The clock, status, hero, economy and chart should all update in real time.
5. **See exactly what your client sends.** Expand **Raw GSI data** at the bottom of the dashboard, or open http://localhost:3636/state.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Dashboard stays on "Waiting for Dota 2…" | Check that `-gamestateintegration` is in the launch options, that the cfg is in the right folder with the right name, and that you restarted Dota |
| "Server offline" | `npm start` isn't running, or it crashed (check its console) |
| Port 3636 already in use | Run `$env:PORT=3637; npm start`, and change the `uri` in the cfg to port 3637 |
| "Spectating" status | Your own panels (hero, economy, items, chart) need you to be playing. When spectating, the scoreboard and buildings panels appear instead |
| A panel never appears | Your client isn't sending that block. Check the "blocks received" list next to **Raw GSI data**, and restart Dota after changing the cfg |
| Icons show as text, or no hero colors | Valve's CDN couldn't be reached the first time that image was needed. Images are cached in `cache/img` after the first successful load, so later sessions work offline |
| Minimap says "Your hero only" | Your client isn't sending the `minimap` block, so only your own position is shown. Check that the cfg has `"minimap" "1"` and restart Dota |
| Minimap markers are offset | See **Calibrating the minimap** above |
| Net worth shows 0 | Your Dota build doesn't include `player.net_worth`. Gold still works |

## Notes

- **History.** The server keeps one point per game second for the current match and resets when `map.matchid` changes. It doesn't record pre-horn points (negative clock).
- **What the deltas mean.** The large deltas show the change since the previous GSI update. "Net worth, last 60s" compares against the sample from about 60 game seconds earlier.
- **Fair play.** Valve only sends GSI data that your own client is allowed to see, so this dashboard is fine to use in matchmaking.
