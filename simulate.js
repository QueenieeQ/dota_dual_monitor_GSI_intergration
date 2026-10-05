// Sends fake GSI payloads to the server so the dashboard can be tested without Dota 2.
// Usage: npm run simulate   (server must be running)
// Options (env vars): SPEED=10 for 10x game time, SPECTATE=1 for an observer-style payload
const URL = process.env.GSI_URL || 'http://127.0.0.1:3636/';
const TOKEN = process.env.GSI_TOKEN || 'sidemonitor-change-me';
const SPEED = Number(process.env.SPEED) || 5;
const SPECTATE = process.env.SPECTATE === '1';

const matchid = String(8000000000 + Math.floor(Math.random() * 1e8));
const PREGAME = 15;
let clock = -PREGAME;

// ---------------------------------------------------------------------------
// Local player model
// ---------------------------------------------------------------------------
const me = {
    reliable: 0, unreliable: 600, itemValue: 0,
    lastHits: 0, denies: 0, kills: 0, deaths: 0, assists: 0, killStreak: 0,
    fromCreeps: 0, fromHeroes: 0, fromIncome: 0, fromShared: 0,
    itemSpent: 0, consumableSpent: 0, lostToDeath: 0,
    heroDamage: 0, towerDamage: 0, commands: 0, runes: 0, stacks: 0,
    xp: 0, hp: 640, mana: 290, respawn: 0, buybackCd: 0,
    abilityCds: [0, 0, 0, 0], skillPoints: [0, 0, 0, 0],
    inventory: ['item_tango', 'item_quelling_blade', 'item_branches', 'item_branches', 'empty', 'empty'],
    tpCd: 0,
};
const SHOP = [
    ['item_power_treads', 1400], ['item_bfury', 4100], ['item_manta', 4600],
    ['item_skadi', 5300], ['item_abyssal_blade', 6250], ['item_butterfly', 5450],
];
const ABILITIES = ['antimage_mana_break', 'antimage_blink', 'antimage_counterspell', 'antimage_mana_void'];
const ABILITY_CD = [0, 12, 15, 70];
const events = [];

function level() { return Math.min(30, 1 + Math.floor(Math.sqrt(me.xp / 90))); }

function step() {
    if (clock < 0) return;
    const gold = () => me.reliable + me.unreliable;
    const earn = (amount, reliable, bucket) => {
        if (reliable) me.reliable += amount; else me.unreliable += amount;
        me[bucket] += amount;
    };

    me.commands += 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < 4; i++) me.abilityCds[i] = Math.max(0, me.abilityCds[i] - 1);
    me.buybackCd = Math.max(0, me.buybackCd - 1);
    me.tpCd = Math.max(0, me.tpCd - 1);

    // Match events
    if (clock > 0 && clock % 180 === 0) {
        events.push({ game_time: clock + 90, event_type: 'bounty_rune_pickup', team: 'radiant', player_id: Math.floor(Math.random() * 5), bounty_value: 36 + clock / 60 * 2, team_gold: (36 + clock / 60 * 2) * 5 });
    }
    if (clock === 900) events.push({ game_time: clock + 90, event_type: 'roshan_killed', team: 'dire', killer_player_id: 7 });
    if (clock === 902) events.push({ game_time: clock + 90, event_type: 'aegis_picked_up', player_id: 6, snatched: false });
    if (clock === 600) events.push({ game_time: clock + 90, event_type: 'tip', sender_player_id: 3, receiver_player_id: 0, tip_amount: 50 });
    if (clock === 1100) events.push({ game_time: clock + 90, event_type: 'courier_killed', team: 'dire', killer_player_id: 0 });

    if (me.respawn > 0) {
        me.respawn--;
        if (me.respawn === 0) { me.hp = 640 + level() * 40; me.mana = 290 + level() * 15; }
        earn(1.5, false, 'fromIncome');
        return;
    }

    earn(1.5, false, 'fromIncome');
    me.xp += 4;
    if (Math.random() < 0.25) { earn(40, false, 'fromCreeps'); me.lastHits++; me.xp += 40; }
    if (Math.random() < 0.03) me.denies++;
    if (Math.random() < 0.01) {
        earn(250, true, 'fromHeroes'); me.kills++; me.killStreak++; me.xp += 200;
        me.heroDamage += 900;
    }
    if (Math.random() < 0.02) { earn(35, false, 'fromShared'); me.assists++; }
    if (Math.random() < 0.08) me.heroDamage += 80 + Math.floor(Math.random() * 300);
    if (Math.random() < 0.03) me.towerDamage += 150;
    if (Math.random() < 0.004) me.runes++;
    if (Math.random() < 0.002) me.stacks++;

    // Cast spells now and then
    for (const i of [1, 2, 3]) {
        if (me.skillPoints[i] > 0 && me.abilityCds[i] === 0 && Math.random() < 0.04) {
            me.abilityCds[i] = ABILITY_CD[i];
            me.mana = Math.max(0, me.mana - 60);
        }
    }
    if (me.tpCd === 0 && Math.random() < 0.01) me.tpCd = 80;

    // Combat damage / regen
    const maxHp = 640 + level() * 40, maxMana = 290 + level() * 15;
    me.hp = Math.min(maxHp, me.hp + (Math.random() < 0.12 ? -Math.floor(Math.random() * 120) : 12));
    me.mana = Math.min(maxMana, me.mana + 2);

    if (me.hp <= 0 || Math.random() < 0.003) {
        me.deaths++; me.killStreak = 0;
        const lost = Math.min(me.unreliable, 100 + level() * 10);
        me.unreliable -= lost; me.lostToDeath += lost;
        me.respawn = 6 + level() * 2; me.hp = 0;
    }

    // Level-up skill points
    const spent = me.skillPoints.reduce((a, b) => a + b, 0);
    if (spent < Math.min(level(), 16)) {
        const lv = level();
        const want = lv >= 6 && me.skillPoints[3] < Math.floor(lv / 6) && me.skillPoints[3] < 3 ? 3
            : [1, 0, 2].find((i) => me.skillPoints[i] < 4);
        if (want !== undefined) me.skillPoints[want]++;
    }

    // Shopping
    const nextBuy = SHOP.find(([name]) => !me.inventory.includes(name));
    if (nextBuy && gold() >= nextBuy[1]) {
        const [name, cost] = nextBuy;
        const fromU = Math.min(me.unreliable, cost);
        me.unreliable -= fromU; me.reliable -= cost - fromU;
        me.itemSpent += cost; me.itemValue += cost;
        const slot = me.inventory.findIndex((n) => n === 'empty' || n === 'item_tango' || n === 'item_branches');
        if (slot >= 0) me.inventory[slot] = name;
    }
    if (Math.random() < 0.004 && gold() > 100) { me.unreliable -= 90; me.consumableSpent += 90; }

}

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------
function roshan() {
    if (clock < 900) return { state: 'alive', end: 0 };
    const since = clock - 900;
    if (since < 480) return { state: 'respawn_base', end: 480 - since };
    if (since < 660) return { state: 'respawn_variable', end: 660 - since };
    return { state: 'alive', end: 0 };
}

function item(name, extra = {}) {
    return { name, purchaser: 0, can_cast: false, cooldown: 0, passive: name !== 'empty', ...extra };
}

function localPayload() {
    const gold = Math.floor(me.reliable + me.unreliable);
    const lv = level();
    const r = roshan();
    const items = {};
    me.inventory.forEach((n, i) => {
        items[`slot${i}`] = item(n, n === 'item_tango' ? { charges: 3, can_cast: true, passive: false }
            : n === 'item_manta' ? { can_cast: true, passive: false, cooldown: me.abilityCds[1] > 6 ? 30 : 0 } : {});
    });
    items.slot6 = item('item_magic_wand', { charges: 7, can_cast: true, passive: false });
    items.slot7 = item('empty');
    items.slot8 = item('empty');
    for (let i = 0; i < 6; i++) items[`stash${i}`] = item(i === 0 && clock > 300 ? 'item_ward_observer' : 'empty', i === 0 ? { charges: 1 } : {});
    items.teleport0 = item('item_tpscroll', { charges: 1, can_cast: me.tpCd === 0, passive: false, cooldown: me.tpCd });
    items.neutral0 = item(clock > 420 ? 'item_mysterious_hat' : 'empty');

    const abilities = {};
    ABILITIES.forEach((name, i) => {
        abilities[`ability${i}`] = {
            name, level: me.skillPoints[i], can_cast: me.skillPoints[i] > 0 && me.abilityCds[i] === 0 && i !== 0,
            passive: i === 0, ability_active: true, cooldown: me.abilityCds[i], ultimate: i === 3,
        };
    });
    abilities.ability4 = { name: 'generic_hidden', level: 0, can_cast: false, passive: false, ability_active: true, cooldown: 0, ultimate: false };

    const maxHp = 640 + lv * 40, maxMana = 290 + lv * 15;
    const minutes = Math.max(clock, 1) / 60;

    return {
        provider: { name: 'Dota 2', appid: 570, version: 47, timestamp: Math.floor(Date.now() / 1000) },
        map: {
            name: 'start', matchid, game_time: clock + 90, clock_time: clock,
            daytime: Math.floor(Math.max(clock, 0) / 300) % 2 === 0, nightstalker_night: false,
            radiant_score: Math.floor(Math.max(clock, 0) / 70), dire_score: Math.floor(Math.max(clock, 0) / 85),
            game_state: clock < 0 ? 'DOTA_GAMERULES_STATE_PRE_GAME' : 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS',
            paused: false, win_team: 'none', customgamename: '',
            ward_purchase_cooldown: clock > 0 ? (135 - (clock % 135)) % 135 : 0,
            roshan_state: r.state, roshan_state_end_seconds: r.end,
        },
        player: {
            steamid: '76561198000000000', accountid: '39735272', name: 'Simulated Player', activity: 'playing',
            kills: me.kills, deaths: me.deaths, assists: me.assists, last_hits: me.lastHits, denies: me.denies,
            kill_streak: me.killStreak, commands_issued: me.commands, kill_list: {},
            team_name: 'radiant', player_slot: 0, team_slot: 0,
            gold, gold_reliable: Math.floor(me.reliable), gold_unreliable: Math.floor(me.unreliable),
            gold_from_hero_kills: me.fromHeroes, gold_from_creep_kills: me.fromCreeps,
            gold_from_income: Math.floor(me.fromIncome), gold_from_shared: me.fromShared,
            gpm: clock > 0 ? Math.round((me.fromHeroes + me.fromCreeps + me.fromIncome + me.fromShared) / minutes) : 0,
            xpm: clock > 0 ? Math.round(me.xp / minutes) : 0,
            net_worth: gold + me.itemValue + 600,
            hero_damage: me.heroDamage, hero_healing: 0, tower_damage: me.towerDamage,
            wards_purchased: 0, wards_placed: 0, wards_destroyed: 0,
            runes_activated: me.runes, camps_stacked: me.stacks,
            support_gold_spent: 0, consumable_gold_spent: me.consumableSpent, item_gold_spent: me.itemSpent,
            gold_lost_to_death: me.lostToDeath, gold_spent_on_buybacks: 0,
        },
        hero: {
            xpos: -6000, ypos: -5800, id: 1, name: 'npc_dota_hero_antimage', level: lv, xp: me.xp,
            alive: me.respawn === 0, respawn_seconds: me.respawn,
            buyback_cost: 200 + lv * 30 + Math.floor((gold + me.itemValue) / 13), buyback_cooldown: me.buybackCd,
            health: Math.max(0, me.hp), max_health: maxHp, health_percent: Math.round((Math.max(0, me.hp) / maxHp) * 100),
            mana: me.mana, max_mana: maxMana, mana_percent: Math.round((me.mana / maxMana) * 100),
            silenced: false, stunned: Math.random() < 0.03, disarmed: false, magicimmune: false,
            hexed: false, muted: false, break: false, aghanims_scepter: clock > 1500, aghanims_shard: clock > 900,
            smoked: false, has_debuff: Math.random() < 0.08,
            talent_1: lv >= 10, talent_2: false, talent_3: false, talent_4: lv >= 15,
            talent_5: lv >= 20, talent_6: false, talent_7: false, talent_8: lv >= 25,
            attributes_level: Math.max(0, lv - 16),
        },
        abilities,
        items,
        events,
        auth: { token: TOKEN },
    };
}

// Observer-style payload: players / heroes keyed by team, plus buildings
function spectatorPayload() {
    const base = localPayload();
    const team = (t, ids) => Object.fromEntries(ids.map((id) => [`player${id}`, {
        name: `Player ${id}`, kills: (id * 3 + clock) % 9, deaths: id % 5, assists: (id * 7) % 11,
        last_hits: Math.floor(clock / 2.5) + id * 5, denies: id, gold: 300 + id * 50,
        net_worth: Math.floor(600 + clock * (7 + id * 0.4)), gpm: 350 + id * 20, xpm: 400 + id * 15, team_name: t,
    }]));
    const HEROES = ['antimage', 'crystal_maiden', 'pudge', 'lina', 'axe', 'sniper', 'invoker', 'juggernaut', 'lion', 'tidehunter'];
    const heroes = (ids) => Object.fromEntries(ids.map((id) => [`player${id}`, {
        name: `npc_dota_hero_${HEROES[id]}`, level: Math.min(30, 1 + Math.floor(Math.max(clock, 0) / 120)),
        alive: (clock + id * 11) % 97 > 8, respawn_seconds: 8,
    }]));
    const towers = (side, prefix, raxPrefix) => {
        const b = {};
        for (const lane of ['top', 'mid', 'bot']) {
            for (const n of [1, 2, 3]) {
                const destroyed = n === 1 && clock > 600 + (lane.length * 50) + (side === 'dire' ? 100 : 0);
                if (!destroyed) b[`${prefix}_tower${n}_${lane}`] = { health: n === 1 ? 1400 : 1800, max_health: n === 1 ? 1800 : 2500 };
            }
            b[`${raxPrefix}_rax_melee_${lane}`] = { health: 2200, max_health: 2200 };
            b[`${raxPrefix}_rax_range_${lane}`] = { health: 1300, max_health: 1300 };
        }
        b[`${prefix}_tower4_top`] = { health: 2600, max_health: 2600 };
        b[`${prefix}_tower4_bot`] = { health: 2600, max_health: 2600 };
        b[`${prefix}_fort`] = { health: 4500, max_health: 4500 };
        return b;
    };
    base.player = { team2: team('radiant', [0, 1, 2, 3, 4]), team3: team('dire', [5, 6, 7, 8, 9]) };
    base.hero = { team2: heroes([0, 1, 2, 3, 4]), team3: heroes([5, 6, 7, 8, 9]) };
    base.abilities = {};
    base.items = {};
    base.buildings = { radiant: towers('radiant', 'dota_goodguys', 'good'), dire: towers('dire', 'dota_badguys', 'bad') };
    const r = roshan();
    base.roshan = { alive: r.state === 'alive', health: 6000, max_health: 6000, spawn_phase: r.state, phase_time_remaining: r.end };
    return base;
}

// ---------------------------------------------------------------------------
async function send() {
    step();
    const body = SPECTATE ? spectatorPayload() : localPayload();
    try {
        const res = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const p = body.player;
        process.stdout.write(SPECTATE
            ? `\rclock ${String(clock).padStart(5)}  (spectator payload)  -> HTTP ${res.status}   `
            : `\rclock ${String(clock).padStart(5)}  gold ${String(p.gold).padStart(5)}  nw ${String(p.net_worth).padStart(6)}  lvl ${String(body.hero.level).padStart(2)}  -> HTTP ${res.status}   `);
    } catch (e) {
        console.error(`\nPOST to ${URL} failed: ${e.message}. Is the server running?`);
        process.exit(1);
    }
    clock++;
}

console.log(`Simulating ${SPECTATE ? 'spectated ' : ''}match ${matchid} at ${SPEED}x speed → ${URL} (Ctrl+C to stop)`);
setInterval(send, 1000 / SPEED);
