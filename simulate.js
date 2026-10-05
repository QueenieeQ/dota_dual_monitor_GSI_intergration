// Sends fake GSI payloads to the server so the dashboard can be tested without Dota 2.
// Usage: npm run simulate   (server must be running)   Optional: SPEED=10 for 10x game time
const URL = process.env.GSI_URL || 'http://127.0.0.1:3000/';
const TOKEN = process.env.GSI_TOKEN || 'sidemonitor-change-me';
const SPEED = Number(process.env.SPEED) || 5;

const matchid = String(8000000000 + Math.floor(Math.random() * 1e8));
let clock = -15;
let reliable = 0;
let unreliable = 600;
let itemValue = 0;
let lastHits = 0;
let kills = 0;
let deaths = 0;

function tick() {
    if (clock >= 0) {
        unreliable += 1.5;                                    // passive gold
        if (Math.random() < 0.25) { unreliable += 40; lastHits++; } // creep kill
        if (Math.random() < 0.01) { reliable += 250; kills++; }     // hero kill
        if (Math.random() < 0.006) { unreliable = Math.max(0, unreliable - 150); deaths++; } // death
        const gold = reliable + unreliable;
        if (gold > 1200 && Math.random() < 0.05) {            // buy an item
            const cost = Math.min(gold, 500 + Math.floor(Math.random() * 1500));
            const fromU = Math.min(unreliable, cost);
            unreliable -= fromU;
            reliable -= cost - fromU;
            itemValue += cost;
        }
    }
    const gold = Math.floor(reliable + unreliable);

    return {
        provider: { name: 'Dota 2', appid: 570, version: 47, timestamp: Math.floor(Date.now() / 1000) },
        map: {
            name: 'start',
            matchid,
            game_time: clock + 90,
            clock_time: clock,
            daytime: Math.floor(Math.max(clock, 0) / 300) % 2 === 0,
            game_state: clock < 0 ? 'DOTA_GAMERULES_STATE_PRE_GAME' : 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS',
            paused: false,
            win_team: 'none',
        },
        player: {
            steamid: '76561198000000000',
            name: 'Simulated Player',
            team_name: 'radiant',
            kills, deaths, assists: Math.floor(kills * 1.3),
            last_hits: lastHits, denies: Math.floor(lastHits / 8),
            gold,
            gold_reliable: Math.floor(reliable),
            gold_unreliable: Math.floor(unreliable),
            net_worth: gold + itemValue + 600,
            gpm: clock > 0 ? Math.round(((gold + itemValue) / clock) * 60) : 0,
            xpm: clock > 0 ? Math.round(400 + clock / 10) : 0,
        },
        hero: { name: 'npc_dota_hero_anti_mage', level: Math.min(30, 1 + Math.floor(Math.max(clock, 0) / 120)) },
        auth: { token: TOKEN },
    };
}

async function send() {
    const body = tick();
    try {
        const res = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        process.stdout.write(`\rclock ${String(clock).padStart(5)}  gold ${String(body.player.gold).padStart(5)}  nw ${String(body.player.net_worth).padStart(6)}  -> HTTP ${res.status}   `);
    } catch (e) {
        console.error(`\nPOST to ${URL} failed: ${e.message}. Is the server running?`);
        process.exit(1);
    }
    clock++;
}

console.log(`Simulating match ${matchid} at ${SPEED}x speed → ${URL} (Ctrl+C to stop)`);
setInterval(send, 1000 / SPEED);
