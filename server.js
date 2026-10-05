const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT) || 3636;
// Must match the "auth" > "token" value in gamestate_integration_sidemonitor.cfg
const AUTH_TOKEN = process.env.GSI_TOKEN || 'sidemonitor-change-me';
// Keep at most this many chart points per match (one per game second ≈ 2h of play)
const MAX_HISTORY = 7200;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Latest snapshot + per-match net worth history, so a refreshed or newly
// opened browser tab immediately shows the current state and the full chart.
let lastState = null;
let lastUpdateAt = 0;
let currentMatchId = null;
let history = []; // [{ t: clock_time, nw: net_worth, gold }]

// GSI payloads are usually a few KB; allow headroom for all data blocks.
app.use(express.json({ limit: '2mb' }));

app.use(express.static(path.join(__dirname, 'public')));
// Serve Chart.js locally so the dashboard works without internet access
app.use('/vendor', express.static(path.join(__dirname, 'node_modules', 'chart.js', 'dist')));
// Material You color library (ES modules). A few of its imports omit ".js",
// so let the static server resolve extensionless paths.
app.use('/vendor/mcu', express.static(
    path.join(__dirname, 'node_modules', '@material', 'material-color-utilities'),
    { extensions: ['js'] },
));

// ---------------------------------------------------------------------------
// Image proxy + disk cache for Valve's CDN art (hero portraits, minimap icons,
// items, abilities). Same-origin images let the browser read pixel colors for
// the hero theme (the CDN only allows dota2.com), and cached files keep
// working offline.
// ---------------------------------------------------------------------------
const CDN = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react';
const CACHE_DIR = path.join(__dirname, 'cache', 'img');
const IMG_PATH = /^(heroes|heroes\/icons|items|abilities)\/[a-z0-9_]+\.png$/;
const missing = new Map(); // path -> time of last failed fetch
const inflight = new Map(); // path -> Promise<Buffer|null>

async function fetchImage(rel) {
    const file = path.join(CACHE_DIR, rel);
    try {
        return await fs.promises.readFile(file);
    } catch { /* not cached yet */ }

    if (Date.now() - (missing.get(rel) || 0) < 10 * 60 * 1000) return null;
    if (inflight.has(rel)) return inflight.get(rel);

    const job = (async () => {
        try {
            const res = await fetch(`${CDN}/${rel}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const buf = Buffer.from(await res.arrayBuffer());
            await fs.promises.mkdir(path.dirname(file), { recursive: true });
            await fs.promises.writeFile(file, buf);
            return buf;
        } catch {
            missing.set(rel, Date.now());
            return null;
        } finally {
            inflight.delete(rel);
        }
    })();
    inflight.set(rel, job);
    return job;
}

app.get(/^\/img\/(.+)$/, async (req, res) => {
    const rel = req.params[0];
    if (!IMG_PATH.test(rel)) return res.sendStatus(400);
    const buf = await fetchImage(rel);
    if (!buf) return res.sendStatus(404);
    res.set('Cache-Control', 'public, max-age=86400').type('png').send(buf);
});

app.get('/health', (req, res) => {
    res.json({
        ok: true,
        lastUpdateAt,
        secondsSinceUpdate: lastUpdateAt ? Math.round((Date.now() - lastUpdateAt) / 1000) : null,
        matchId: currentMatchId,
        historyPoints: history.length,
        clients: io.engine.clientsCount,
    });
});

// Latest raw payload, handy for seeing which fields your client actually sends
app.get('/state', (req, res) => {
    res.json(lastState);
});

// Dota 2 POSTs the full game state here on every change (and every heartbeat)
app.post('/', (req, res) => {
    const state = req.body;

    if (state?.auth?.token !== AUTH_TOKEN) {
        console.warn('[gsi] rejected payload with missing/invalid auth token');
        return res.sendStatus(401);
    }

    // "previously"/"added" only describe what changed since the last packet;
    // the dashboard works from full snapshots, so don't ship them to browsers.
    delete state.previously;
    delete state.added;
    delete state.auth;

    lastState = state;
    lastUpdateAt = Date.now();
    recordHistory(state);

    io.emit('gameStateUpdate', state);
    res.sendStatus(200);
});

function recordHistory(state) {
    const map = state.map;
    const player = state.player;
    if (!map) return;

    // New match → start a fresh chart
    if (map.matchid && map.matchid !== currentMatchId) {
        console.log(`[gsi] match ${map.matchid} detected, resetting history`);
        currentMatchId = map.matchid;
        history = [];
        io.emit('history', history);
    }

    // Only a playing client reports its own net worth (spectator payloads don't)
    if (!player || typeof player.net_worth !== 'number') return;

    const t = map.clock_time;
    if (typeof t !== 'number' || t < 0) return; // skip pre-horn

    const last = history[history.length - 1];
    if (last && t === last.t) {
        // Same second: keep the latest value
        last.nw = player.net_worth;
        last.gold = player.gold;
        return;
    }
    if (last && t < last.t) return; // ignore out-of-order packets

    history.push({ t, nw: player.net_worth, gold: player.gold });
    if (history.length > MAX_HISTORY) history.shift();
}

io.on('connection', (socket) => {
    socket.emit('history', history);
    if (lastState) socket.emit('gameStateUpdate', lastState);
});

server.listen(PORT, () => {
    console.log(`Dota 2 GSI server listening on http://localhost:${PORT}`);
    console.log(`Open the dashboard at http://localhost:${PORT} on your side monitor`);
});
