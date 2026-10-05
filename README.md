# Dota 2 Side Monitor

A dashboard for a second monitor that updates live while you play Dota 2. It shows the match clock, the game status, your gold and net worth with green/red change deltas, and a net worth vs. match time chart.

```
Dota 2 ──HTTP POST (GSI JSON)──▶ server.js (Express :3636) ──Socket.io──▶ browser (public/index.html)
```

## Files

| File | Purpose |
|---|---|
| `gamestate_integration_sidemonitor.cfg` | Tells Dota 2 where and what to send |
| `server.js` | Receives GSI POSTs, checks the auth token, keeps per-match history, broadcasts over Socket.io |
| `public/index.html` | The dashboard (Chart.js is served locally from `node_modules`, so it works offline) |
| `simulate.js` | Sends fake GSI data so you can test without launching Dota |

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
   On the dashboard, the clock counts from `-0:15` to `0:00` and up, and the status changes from *Pre-game* to *Game in progress* with a green dot. Gold and net worth tick up, deltas flash green (▲) or red (▼), and the chart starts plotting at 0:00. Refresh the page: the chart keeps its history. Stop the simulator with Ctrl+C. After about 35 seconds, the status changes to *No signal*.
3. **Dota 2 is sending data.** Launch Dota with the launch option set. On the main menu, the dashboard shows *In menus* within about 30 seconds (Dota sends a heartbeat every 30 s). If the server console shows `rejected payload ... auth token`, the tokens don't match.
4. **Live match.** Start a bot match or a Demo Hero game. The clock, status, hero, economy and chart should all update in real time.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Dashboard stays on "Waiting for Dota 2…" | Check that `-gamestateintegration` is in the launch options, that the cfg is in the right folder with the right name, and that you restarted Dota |
| "Server offline" | `npm start` isn't running, or it crashed (check its console) |
| Port 3636 already in use | Run `$env:PORT=3637; npm start`, and change the `uri` in the cfg to port 3637 |
| "Spectating" status | GSI only reports your own economy when you are a player. Spectator and replay payloads are keyed per player and aren't shown |
| Net worth shows 0 | Your Dota build doesn't include `player.net_worth`. Gold still works |

## Notes

- **History.** The server keeps one point per game second for the current match and resets when `map.matchid` changes. It doesn't record pre-horn points (negative clock).
- **What the deltas mean.** The large deltas show the change since the previous GSI update. "Net worth, last 60s" compares against the sample from about 60 game seconds earlier.
- **Fair play.** Valve only sends GSI data that your own client is allowed to see, so this dashboard is fine to use in matchmaking.
