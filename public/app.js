(() => {
    'use strict';

    // ======================================================================
    // Helpers
    // ======================================================================
    const $ = (id) => document.getElementById(id);
    const has = (v) => v !== undefined && v !== null;
    const fmtNum = (n) => Math.round(n).toLocaleString();
    const fmtSigned = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(Math.round(n)).toLocaleString();
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function fmtClock(seconds) {
        const s = Math.abs(Math.trunc(seconds));
        const m = Math.floor(s / 60);
        return `${seconds < 0 ? '-' : ''}${m}:${String(s % 60).padStart(2, '0')}`;
    }
    const fmtCd = (s) => (s >= 60 ? fmtClock(s) : String(Math.ceil(s)));

    function prettify(name) {
        return String(name)
            .replace(/^(npc_dota_hero_|item_)/, '')
            .replace(/_/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase());
    }

    // Heroes whose internal name differs from what players see in game
    const HERO_NAMES = {
        antimage: 'Anti-Mage', nevermore: 'Shadow Fiend', furion: "Nature's Prophet", obsidian_destroyer: 'Outworld Destroyer',
        magnataur: 'Magnus', rattletrap: 'Clockwerk', shredder: 'Timbersaw', skeleton_king: 'Wraith King',
        life_stealer: 'Lifestealer', wisp: 'Io', zuus: 'Zeus', windrunner: 'Windranger', treant: 'Treant Protector',
        vengefulspirit: 'Vengeful Spirit', queenofpain: 'Queen of Pain', doom_bringer: 'Doom', abyssal_underlord: 'Underlord',
        centaur: 'Centaur Warrunner', necrolyte: 'Necrophos', keeper_of_the_light: 'Keeper of the Light',
    };
    const heroName = (name) => HERO_NAMES[name.replace('npc_dota_hero_', '')] || prettify(name);

    // Valve's public CDN for hero / item / ability art. Falls back to text when offline.
    const CDN = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react';
    const heroImg = (name) => `${CDN}/heroes/${name.replace('npc_dota_hero_', '')}.png`;
    const itemImg = (name) => `${CDN}/items/${name.startsWith('item_recipe') ? 'recipe' : name.replace(/^item_/, '')}.png`;
    const abilityImg = (name) => `${CDN}/abilities/${name}.png`;

    const css = getComputedStyle(document.documentElement);
    const C = (name) => css.getPropertyValue(name).trim();

    const GAME_STATES = {
        DOTA_GAMERULES_STATE_INIT: 'Initializing',
        DOTA_GAMERULES_STATE_WAIT_FOR_PLAYERS_TO_LOAD: 'Loading players',
        DOTA_GAMERULES_STATE_CUSTOM_GAME_SETUP: 'Custom game setup',
        DOTA_GAMERULES_STATE_PLAYER_DRAFT: 'Player draft',
        DOTA_GAMERULES_STATE_HERO_SELECTION: 'Hero selection',
        DOTA_GAMERULES_STATE_STRATEGY_TIME: 'Strategy time',
        DOTA_GAMERULES_STATE_TEAM_SHOWCASE: 'Team showcase',
        DOTA_GAMERULES_STATE_WAIT_FOR_MAP_TO_LOAD: 'Loading map',
        DOTA_GAMERULES_STATE_PRE_GAME: 'Pre-game',
        DOTA_GAMERULES_STATE_GAME_IN_PROGRESS: 'Game in progress',
        DOTA_GAMERULES_STATE_POST_GAME: 'Post-game',
        DOTA_GAMERULES_STATE_DISCONNECT: 'Disconnected',
    };

    // Dota sends a heartbeat every 30s (cfg "heartbeat"), so silence beyond ~35s means no signal
    const STALE_AFTER_MS = 35000;

    // ======================================================================
    // Item / ability slot rendering (elements are reused to avoid image flicker)
    // ======================================================================
    function ensureSlots(container, count) {
        while (container.children.length < count) {
            const el = document.createElement('div');
            el.className = 'slot';
            container.appendChild(el);
        }
        while (container.children.length > count) container.lastChild.remove();
        return Array.from(container.children);
    }

    function setSlot(el, { name, img, cooldown, charges, muted, title }) {
        const empty = !name || name === 'empty';
        if (el.dataset.name !== (empty ? '' : name)) {
            el.dataset.name = empty ? '' : name;
            el.innerHTML = '';
            if (!empty) {
                const im = document.createElement('img');
                im.alt = '';
                im.src = img;
                im.onerror = () => {
                    im.remove();
                    const fb = document.createElement('div');
                    fb.className = 'fallback';
                    fb.textContent = prettify(name);
                    el.prepend(fb);
                };
                el.appendChild(im);
            }
        }
        el.title = empty ? '' : (title || prettify(name));
        el.classList.toggle('muted', !empty && !!muted);

        let cd = el.querySelector('.cd');
        if (!empty && cooldown > 0) {
            if (!cd) { cd = document.createElement('div'); cd.className = 'cd'; el.appendChild(cd); }
            cd.textContent = fmtCd(cooldown);
        } else if (cd) cd.remove();

        let ch = el.querySelector('.charges');
        if (!empty && charges > 0) {
            if (!ch) { ch = document.createElement('div'); ch.className = 'charges'; el.appendChild(ch); }
            ch.textContent = charges;
        } else if (ch) ch.remove();
    }

    function itemSlot(el, item) {
        if (!item) return setSlot(el, {});
        let title = prettify(item.name);
        if (item.contains_rune && item.contains_rune !== 'empty') title += ` (${item.contains_rune} rune)`;
        setSlot(el, {
            name: item.name,
            img: itemImg(item.name || ''),
            cooldown: item.cooldown,
            charges: item.charges,
            muted: item.can_cast === false && !item.passive && !(item.cooldown > 0),
            title,
        });
    }

    // ======================================================================
    // Net worth chart
    // ======================================================================
    const chart = new Chart($('netWorthChart'), {
        type: 'line',
        data: {
            datasets: [{
                label: 'Net worth',
                data: [], // [{ x: clock seconds, y: net worth }]
                borderColor: C('--accent'),
                backgroundColor: 'rgba(94, 162, 255, 0.10)',
                borderWidth: 2,
                fill: true,
                tension: 0.15,
                pointRadius: 0,
                pointHoverRadius: 5,
                pointHoverBorderWidth: 2,
                pointHoverBorderColor: C('--surface'),
                pointHoverBackgroundColor: C('--accent'),
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            parsing: false,
            normalized: true,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: {
                    type: 'linear',
                    min: 0,
                    ticks: { color: C('--muted'), maxTicksLimit: 8, callback: (v) => fmtClock(v) },
                    grid: { color: 'rgba(255,255,255,0.04)' },
                    border: { color: C('--border') },
                },
                y: {
                    beginAtZero: true,
                    ticks: { color: C('--muted'), callback: (v) => (v >= 1000 ? v / 1000 + 'k' : v) },
                    grid: { color: 'rgba(255,255,255,0.06)' },
                    border: { display: false },
                },
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    displayColors: false,
                    callbacks: {
                        title: (items) => fmtClock(items[0].parsed.x),
                        label: (item) => `Net worth ${fmtNum(item.parsed.y)}`,
                    },
                },
            },
        },
    });
    const series = chart.data.datasets[0].data;

    function renderChart() {
        $('chartEmpty').hidden = series.length > 0;
        chart.options.scales.x.max = series.length ? Math.max(60, series[series.length - 1].x) : undefined;
        $('pointCount').textContent = series.length ? `${series.length} samples` : '';
        chart.update('none');
    }

    function addPoint(t, nw) {
        if (typeof t !== 'number' || t < 0 || typeof nw !== 'number') return;
        const last = series[series.length - 1];
        if (last && last.x === t) last.y = nw;
        else if (!last || t > last.x) series.push({ x: t, y: nw });
        else return;
        renderChart();
    }

    function netWorth60s(nowT, nowNw) {
        for (let i = series.length - 1; i >= 0; i--) {
            if (series[i].x <= nowT - 60) return nowNw - series[i].y;
        }
        return series.length ? nowNw - series[0].y : 0;
    }

    // ======================================================================
    // Status / header
    // ======================================================================
    let lastPacketAt = 0;

    function setStatus(kind, text, sub) {
        $('statusDot').className = 'dot ' + kind;
        $('statusText').textContent = text;
        if (sub !== undefined) $('statusSub').textContent = sub;
    }

    function chip(text, kind = '', title = '') {
        return `<span class="chip ${kind}"${title ? ` title="${esc(title)}"` : ''}>${text}</span>`;
    }

    function renderHeader(data) {
        const map = data.map;
        $('clock').textContent = fmtClock(map.clock_time ?? 0);
        $('clock').classList.toggle('paused', !!map.paused);

        const stateLabel = GAME_STATES[map.game_state] || String(map.game_state || 'Unknown').replace('DOTA_GAMERULES_STATE_', '');
        const subParts = [];
        if (map.win_team && map.win_team !== 'none') subParts.push(`${map.win_team === 'radiant' ? 'Radiant' : 'Dire'} victory`);
        if (map.customgamename) subParts.push(map.customgamename);
        if (map.matchid) subParts.push(`Match ${map.matchid}`);
        const sub = subParts.join(' · ');

        if (map.paused) setStatus('warn', 'Paused', sub);
        else if (map.game_state === 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS') setStatus('live', stateLabel, sub);
        else setStatus('warn', stateLabel, sub);

        // Score
        const hasScore = has(map.radiant_score) && has(map.dire_score);
        $('score').hidden = !hasScore;
        if (hasScore) {
            $('radiantScore').textContent = map.radiant_score;
            $('direScore').textContent = map.dire_score;
        }

        // Map chips: day/night, Roshan, ward stock
        const chips = [];
        if (has(map.daytime)) {
            if (map.nightstalker_night) chips.push(chip('☾ Nightstalker night', 'warn'));
            else chips.push(chip(map.daytime ? '☀ Day' : '☾ Night'));
        }

        const rosh = roshanText(data);
        if (rosh) chips.push(chip(`Roshan <b>${rosh.text}</b>`, rosh.kind));

        if (map.ward_purchase_cooldown > 0) chips.push(chip(`Obs restock <b>${fmtClock(map.ward_purchase_cooldown)}</b>`));
        if (map.radiant_ward_purchase_cooldown > 0) chips.push(chip(`Radiant obs <b>${fmtClock(map.radiant_ward_purchase_cooldown)}</b>`));
        if (map.dire_ward_purchase_cooldown > 0) chips.push(chip(`Dire obs <b>${fmtClock(map.dire_ward_purchase_cooldown)}</b>`));

        $('mapChips').innerHTML = chips.join('');
    }

    function roshanText(data) {
        const r = data.roshan;
        if (r && has(r.alive)) {
            if (r.alive) {
                const pct = r.max_health ? Math.round((r.health / r.max_health) * 100) : null;
                return { text: pct !== null && pct < 100 ? `${pct}% HP` : 'Alive', kind: pct !== null && pct < 100 ? 'warn' : 'good' };
            }
            const t = r.phase_time_remaining > 0 ? ` ${fmtClock(r.phase_time_remaining)}` : '';
            return { text: `${r.spawn_phase ? prettify(r.spawn_phase) : 'Dead'}${t}`, kind: 'bad' };
        }
        const st = data.map.roshan_state;
        if (!st) return null;
        const t = data.map.roshan_state_end_seconds > 0 ? ` ${fmtClock(data.map.roshan_state_end_seconds)}` : '';
        if (st === 'alive') return { text: 'Alive', kind: 'good' };
        if (st === 'respawn_base') return { text: `Dead${t}`, kind: 'bad' };
        if (st === 'respawn_variable') return { text: `May respawn${t}`, kind: 'warn' };
        return { text: prettify(st) + t, kind: '' };
    }

    // ======================================================================
    // Hero
    // ======================================================================
    const HERO_STATUS = [
        ['stunned', 'Stunned', 'bad'],
        ['silenced', 'Silenced', 'bad'],
        ['hexed', 'Hexed', 'bad'],
        ['disarmed', 'Disarmed', 'bad'],
        ['muted', 'Muted', 'bad'],
        ['break', 'Break', 'bad'],
        ['has_debuff', 'Debuffed', 'warn'],
        ['magicimmune', 'Magic immune', 'good'],
        ['smoked', 'Smoked', 'good'],
    ];

    function renderHero(hero, player, map) {
        const show = !!(hero && hero.name);
        $('heroCard').hidden = !show;
        if (!show) return;

        const img = $('heroImg');
        const src = heroImg(hero.name);
        if (img.dataset.src !== src) { img.dataset.src = src; img.src = src; img.style.visibility = ''; }
        img.onerror = () => { img.style.visibility = 'hidden'; };

        $('heroName').textContent = heroName(hero.name);
        $('heroName').style.color = player?.team_name === 'radiant' ? C('--radiant') : player?.team_name === 'dire' ? C('--dire') : '';
        $('heroLevel').textContent = [
            has(hero.level) ? `Level ${hero.level}` : '',
            has(hero.xp) ? `${fmtNum(hero.xp)} XP` : '',
            hero.attributes_level ? `Attributes +${hero.attributes_level}` : '',
        ].filter(Boolean).join(' · ');
        $('kdaBig').textContent = player ? `${player.kills ?? 0} / ${player.deaths ?? 0} / ${player.assists ?? 0}` : '';

        const hpPct = hero.max_health ? (hero.health / hero.max_health) * 100 : hero.health_percent ?? 0;
        const mpPct = hero.max_mana ? (hero.mana / hero.max_mana) * 100 : hero.mana_percent ?? 0;
        $('hpFill').style.width = `${hpPct}%`;
        $('mpFill').style.width = `${mpPct}%`;
        $('hpText').textContent = has(hero.health) ? `${fmtNum(hero.health)} / ${fmtNum(hero.max_health)}` : '';
        $('mpText').textContent = has(hero.mana) ? `${fmtNum(hero.mana)} / ${fmtNum(hero.max_mana)}` : '';

        const life = $('lifeState');
        if (hero.alive === false) {
            life.className = 'life dead';
            life.textContent = `☠ Dead — respawn in ${hero.respawn_seconds ?? '?'}s`;
        } else {
            life.className = 'life';
            life.textContent = '';
        }

        // Buyback readiness
        const bb = $('buyback');
        if (has(hero.buyback_cost) && hero.buyback_cost > 0 && (map?.clock_time ?? 0) > 0) {
            const gold = player?.gold ?? 0;
            if (hero.buyback_cooldown > 0) {
                bb.innerHTML = chip(`Buyback cooldown <b>${fmtClock(hero.buyback_cooldown)}</b>`, 'warn');
            } else if (gold >= hero.buyback_cost) {
                bb.innerHTML = chip(`✓ Buyback ready <b>${fmtNum(hero.buyback_cost)}</b>`, 'good');
            } else {
                bb.innerHTML = chip(`✗ Buyback needs <b>${fmtNum(hero.buyback_cost - gold)}</b> more (cost ${fmtNum(hero.buyback_cost)})`, 'bad');
            }
        } else bb.innerHTML = '';

        // Status effects + Aghanim's
        const chips = HERO_STATUS.filter(([k]) => hero[k]).map(([, label, kind]) => chip(label, kind));
        if (has(hero.aghanims_scepter)) chips.push(chip("Aghanim's Scepter", hero.aghanims_scepter ? 'good' : 'off'));
        if (has(hero.aghanims_shard)) chips.push(chip("Aghanim's Shard", hero.aghanims_shard ? 'good' : 'off'));
        $('heroChips').innerHTML = chips.join('');

        // Talent tree: talent_1/2 = level 10 … talent_7/8 = level 25 (drawn top-down like in game)
        if (has(hero.talent_1)) {
            let html = '';
            for (let row = 3; row >= 0; row--) {
                const a = hero[`talent_${row * 2 + 1}`], b = hero[`talent_${row * 2 + 2}`];
                html += `<div class="lvl">${10 + row * 5}</div><div class="talent ${a ? 'on' : ''}"></div><div class="talent ${b ? 'on' : ''}"></div>`;
            }
            $('talents').innerHTML = html;
        } else $('talents').innerHTML = '';
    }

    // ======================================================================
    // Items
    // ======================================================================
    function renderItems(items) {
        const show = !!(items && items.slot0);
        $('itemsCard').hidden = !show;
        if (!show) return;

        ensureSlots($('inventory'), 6).forEach((el, i) => itemSlot(el, items[`slot${i}`]));
        ensureSlots($('backpack'), 3).forEach((el, i) => itemSlot(el, items[`slot${i + 6}`]));
        ensureSlots($('tpSlot'), 1).forEach((el) => itemSlot(el, items.teleport0));
        ensureSlots($('neutralSlot'), 1).forEach((el) => itemSlot(el, items.neutral0));

        const stashCount = Object.keys(items).filter((k) => k.startsWith('stash')).length;
        $('stashLabel').hidden = $('stash').hidden = stashCount === 0;
        ensureSlots($('stash'), stashCount).forEach((el, i) => itemSlot(el, items[`stash${i}`]));
    }

    // ======================================================================
    // Abilities
    // ======================================================================
    // Utility "abilities" every hero has that aren't worth a slot on the dashboard
    const HIDDEN_ABILITY = /^(generic_hidden|plus_|seasonal_|special_bonus|ability_|abyssal_underlord_portal_warp|twin_gate_portal_warp)/;

    function renderAbilities(abilities, heroName) {
        const prefix = heroName ? heroName.replace('npc_dota_hero_', '') + '_' : null;
        const list = abilities
            ? Object.keys(abilities)
                .filter((k) => /^ability\d+$/.test(k))
                .sort((a, b) => Number(a.slice(7)) - Number(b.slice(7)))
                .map((k) => abilities[k])
                .filter((a) => a?.name && !HIDDEN_ABILITY.test(a.name))
            : [];
        $('abilitiesCard').hidden = list.length === 0;
        if (!list.length) return;

        const box = $('abilities');
        while (box.children.length < list.length) {
            const wrap = document.createElement('div');
            wrap.className = 'ability';
            wrap.innerHTML = '<div class="slot"></div><div class="pips"></div><div class="aname"></div>';
            box.appendChild(wrap);
        }
        while (box.children.length > list.length) box.lastChild.remove();

        list.forEach((a, i) => {
            const wrap = box.children[i];
            wrap.classList.toggle('ult', !!a.ultimate);
            const cd = a.cooldown > 0 ? a.cooldown : a.charges === 0 && a.charge_cooldown > 0 ? a.charge_cooldown : 0;
            setSlot(wrap.children[0], {
                name: a.name,
                img: abilityImg(a.name),
                cooldown: cd,
                charges: a.max_charges > 0 ? a.charges : 0,
                muted: a.level === 0 || (!a.passive && a.can_cast === false && !(cd > 0)),
                title: `${prettify(a.name)} — level ${a.level}${a.passive ? ' (passive)' : ''}${a.ability_active === false ? ' (inactive)' : ''}`,
            });
            const max = Math.max(a.level || 0, a.ultimate ? 3 : 4);
            wrap.children[1].innerHTML = Array.from({ length: max }, (_, n) => `<span class="pip ${n < a.level ? 'on' : ''}"></span>`).join('');
            wrap.children[2].textContent = prettify(prefix && a.name.startsWith(prefix) ? a.name.slice(prefix.length) : a.name);
        });
    }

    // ======================================================================
    // Economy
    // ======================================================================
    let prev = { gold: null, nw: null };
    const deltaTimers = {};

    function showDelta(id, valueId, delta) {
        const el = $(id);
        el.textContent = (delta > 0 ? '▲ ' : '▼ ') + fmtSigned(delta);
        el.className = 'delta ' + (delta > 0 ? 'up' : 'down');
        const v = $(valueId);
        v.classList.remove('flash-up', 'flash-down');
        void v.offsetWidth; // restart animation
        v.classList.add(delta > 0 ? 'flash-up' : 'flash-down');
        clearTimeout(deltaTimers[id]);
        deltaTimers[id] = setTimeout(() => el.classList.add('stale'), 5000);
    }

    function setSigned(id, n) {
        const el = $(id);
        el.textContent = fmtSigned(n);
        el.style.color = n > 0 ? C('--good') : n < 0 ? C('--bad') : '';
    }

    function breakdown(player, title, rows, cls) {
        const present = rows.filter(([k]) => has(player[k]));
        if (!present.length) return '';
        const max = Math.max(1, ...present.map(([k]) => player[k]));
        return `<h3>${title}</h3>` + present.map(([k, label]) =>
            `<div class="brow"><span class="name">${label}</span>` +
            `<div class="track ${cls}"><div style="width:${(player[k] / max) * 100}%"></div></div>` +
            `<span class="val">${fmtNum(player[k])}</span></div>`).join('');
    }

    function renderEconomy(player, map) {
        const gold = player.gold ?? 0;
        const nw = player.net_worth ?? 0;

        $('gold').textContent = fmtNum(gold);
        $('netWorth').textContent = fmtNum(nw);
        $('goldReliable').textContent = fmtNum(player.gold_reliable ?? 0);
        $('goldUnreliable').textContent = fmtNum(player.gold_unreliable ?? 0);
        $('gpm').textContent = fmtNum(player.gpm ?? 0);
        $('xpm').textContent = fmtNum(player.xpm ?? 0);
        $('lhdn').textContent = `${player.last_hits ?? 0} / ${player.denies ?? 0}`;

        if (prev.gold !== null && gold !== prev.gold) showDelta('goldDelta', 'gold', gold - prev.gold);
        if (prev.nw !== null && nw !== prev.nw) showDelta('netWorthDelta', 'netWorth', nw - prev.nw);
        prev = { gold, nw };

        addPoint(map.clock_time, nw);
        if (map.clock_time >= 0) setSigned('nw60', netWorth60s(map.clock_time, nw));

        $('goldSources').innerHTML = breakdown(player, 'Gold earned from', [
            ['gold_from_creep_kills', 'Creeps'],
            ['gold_from_hero_kills', 'Hero kills'],
            ['gold_from_income', 'Passive income'],
            ['gold_from_shared', 'Shared'],
        ], '');
        $('goldSpending').innerHTML = breakdown(player, 'Gold spent on', [
            ['item_gold_spent', 'Items'],
            ['consumable_gold_spent', 'Consumables'],
            ['support_gold_spent', 'Support items'],
            ['gold_spent_on_buybacks', 'Buybacks'],
            ['gold_lost_to_death', 'Lost to deaths'],
        ], 'spend');
    }

    // ======================================================================
    // Performance
    // ======================================================================
    function renderPerformance(player, map) {
        const minutes = Math.max(1, (map.game_time ?? map.clock_time ?? 0) / 60);
        const tiles = [
            ['Kill streak', player.kill_streak],
            ['Hero damage', player.hero_damage],
            ['Tower damage', player.tower_damage],
            ['Healing', player.hero_healing],
            has(player.wards_purchased)
                ? ['Wards placed / bought', has(player.wards_placed) ? `${player.wards_placed} / ${player.wards_purchased}` : undefined]
                : ['Wards placed', player.wards_placed],
            ['Wards destroyed', player.wards_destroyed],
            ['Runes', player.runes_activated],
            ['Camps stacked', player.camps_stacked],
            ['Commands', player.commands_issued],
            ['Actions / min', has(player.commands_issued) ? player.commands_issued / minutes : undefined],
        ].filter(([, v]) => has(v));

        $('perfCard').hidden = tiles.length === 0;
        $('perfTiles').innerHTML = tiles.map(([label, v]) =>
            `<div class="tile"><div class="label">${label}</div><div class="value">${typeof v === 'number' ? fmtNum(v) : esc(v)}</div></div>`).join('');
    }

    // ======================================================================
    // Events feed
    // ======================================================================
    let eventMatch = null;
    const seenEvents = new Map();

    function playerName(data, id) {
        if (!has(id) || id < 0) return 'someone';
        const team = id < 5 ? 'team2' : 'team3';
        const p = data.player?.[team]?.[`player${id}`];
        const h = data.hero?.[team]?.[`player${id}`];
        if (p?.name) return h?.name ? `${p.name} (${heroName(h.name)})` : p.name;
        return `Player ${id}`;
    }
    const teamName = (t) => (t === 'radiant' || t === 2 ? 'Radiant' : t === 'dire' || t === 3 ? 'Dire' : prettify(t ?? 'A team'));

    function describeEvent(e, data) {
        switch (e.event_type) {
            case 'roshan_killed': return `${teamName(e.team)} killed Roshan${has(e.killer_player_id) ? ` — last hit by ${playerName(data, e.killer_player_id)}` : ''}`;
            case 'aegis_picked_up': return `Aegis picked up by ${playerName(data, e.player_id)}${e.snatched ? ' (snatched!)' : ''}`;
            case 'aegis_denied': return `Aegis denied by ${playerName(data, e.player_id)}`;
            case 'bounty_rune_pickup': return `${playerName(data, e.player_id)} took a bounty rune: +${e.bounty_value ?? '?'} each${has(e.team_gold) ? `, ${fmtNum(e.team_gold)} for the team` : ''}`;
            case 'tip': return `${playerName(data, e.sender_player_id)} tipped ${playerName(data, e.receiver_player_id)}${has(e.tip_amount) ? ` ${e.tip_amount} gold` : ''}`;
            case 'courier_killed': return `${teamName(e.team)} courier killed${has(e.killer_player_id) ? ` by ${playerName(data, e.killer_player_id)}` : ''}`;
            default: return prettify(e.event_type || 'event');
        }
    }

    function renderEvents(data) {
        const events = data.events;
        $('eventsCard').hidden = !Array.isArray(events);
        if (!Array.isArray(events)) return;

        if (data.map?.matchid !== eventMatch) { eventMatch = data.map?.matchid; seenEvents.clear(); }
        for (const e of events) {
            const key = [e.game_time, e.event_type, e.player_id, e.killer_player_id, e.sender_player_id, e.team].join('|');
            if (!seenEvents.has(key)) seenEvents.set(key, e);
        }

        // Event times use game_time; convert to the match clock players see
        const offset = has(data.map?.game_time) && has(data.map?.clock_time) ? data.map.game_time - data.map.clock_time : 0;
        const list = [...seenEvents.values()].sort((a, b) => (b.game_time ?? 0) - (a.game_time ?? 0)).slice(0, 40);
        $('events').innerHTML = list.length
            ? list.map((e) => `<li><span class="t">${has(e.game_time) ? fmtClock(e.game_time - offset) : ''}</span><span>${esc(describeEvent(e, data))}</span></li>`).join('')
            : '<li class="empty-row">No events yet (Roshan, Aegis, bounty runes, tips, couriers)</li>';
    }

    // ======================================================================
    // Buildings (observer / spectator payloads)
    // ======================================================================
    function bcell(team, key, label, color) {
        if (!key || !team[key]) return `<div class="bcell gone" title="${label}: destroyed"><span>✕</span></div>`;
        const b = team[key];
        const pct = b.max_health ? Math.round((b.health / b.max_health) * 100) : 0;
        return `<div class="bcell" title="${label}: ${fmtNum(b.health)} / ${fmtNum(b.max_health)}"><div class="f" style="width:${pct}%;background:${color}"></div><span>${label} ${pct}%</span></div>`;
    }

    function renderBuildingsTeam(name, team, color) {
        const keys = Object.keys(team);
        const find = (re) => keys.find((k) => re.test(k));
        let html = `<div class="bteam"><h3 style="color:${color}">${name}</h3>`;
        for (const lane of ['top', 'mid', 'bot']) {
            html += `<div class="blane"><span class="ln">${lane}</span>`;
            for (const n of [1, 2, 3]) html += bcell(team, find(new RegExp(`tower${n}_${lane}`)), `T${n}`, color);
            html += bcell(team, find(new RegExp(`rax_melee_${lane}`)), 'Mel', color);
            html += bcell(team, find(new RegExp(`rax_range_${lane}`)), 'Rng', color);
            html += '</div>';
        }
        const t4 = keys.filter((k) => /tower4/.test(k)).sort();
        html += `<div class="blane"><span class="ln">base</span>`;
        html += bcell(team, t4[0], 'T4', color) + bcell(team, t4[1], 'T4', color);
        html += bcell(team, find(/fort/), 'Ancient', color);
        html += '</div></div>';
        return html;
    }

    function renderBuildings(buildings) {
        const show = !!(buildings && (buildings.radiant || buildings.dire));
        $('buildingsCard').hidden = !show;
        if (!show) return;
        $('buildings').innerHTML =
            (buildings.radiant ? renderBuildingsTeam('Radiant', buildings.radiant, C('--radiant')) : '') +
            (buildings.dire ? renderBuildingsTeam('Dire', buildings.dire, C('--dire')) : '');
    }

    // ======================================================================
    // Scoreboard (observer / spectator payloads)
    // ======================================================================
    function renderScoreboard(data) {
        const pl = data.player || {};
        const show = !!(pl.team2 || pl.team3);
        $('scoreboardCard').hidden = !show;
        if (!show) return;

        let html = '<thead><tr><th>Player</th><th>Hero</th><th>Lv</th><th>K / D / A</th><th>LH / DN</th><th>Gold</th><th>Net worth</th><th>GPM</th><th>XPM</th></tr></thead><tbody>';
        for (const [teamKey, label, cls] of [['team2', 'Radiant', 'radiant-text'], ['team3', 'Dire', 'dire-text']]) {
            const players = pl[teamKey] || {};
            const ids = Object.keys(players).sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)));
            const total = ids.reduce((s, id) => s + (players[id].net_worth ?? 0), 0);
            html += `<tr class="team-row"><td colspan="9" class="${cls}">${label} — ${fmtNum(total)} net worth</td></tr>`;
            for (const id of ids) {
                const p = players[id];
                const h = data.hero?.[teamKey]?.[id] || {};
                html += `<tr class="${h.alive === false ? 'dead' : ''}">` +
                    `<td>${esc(p.name ?? id)}</td>` +
                    `<td>${h.name ? esc(heroName(h.name)) : '—'}${h.alive === false ? ` ☠ ${h.respawn_seconds ?? ''}s` : ''}</td>` +
                    `<td>${h.level ?? ''}</td>` +
                    `<td>${p.kills ?? 0} / ${p.deaths ?? 0} / ${p.assists ?? 0}</td>` +
                    `<td>${p.last_hits ?? 0} / ${p.denies ?? 0}</td>` +
                    `<td>${fmtNum(p.gold ?? 0)}</td>` +
                    `<td>${fmtNum(p.net_worth ?? 0)}</td>` +
                    `<td>${p.gpm ?? ''}</td><td>${p.xpm ?? ''}</td></tr>`;
            }
        }
        $('scoreboard').innerHTML = html + '</tbody>';
    }

    // ======================================================================
    // Raw inspector (only serialised while open)
    // ======================================================================
    let lastRawAt = 0;
    function renderRaw(data, force) {
        $('rawKeys').textContent = '· blocks received: ' + Object.keys(data).join(', ');
        if (!$('rawDetails').open) return;
        if (!force && Date.now() - lastRawAt < 1000) return;
        lastRawAt = Date.now();
        $('rawJson').textContent = JSON.stringify(data, null, 2);
    }
    let lastData = null;
    $('rawDetails').addEventListener('toggle', () => lastData && renderRaw(lastData, true));

    // ======================================================================
    // Socket wiring
    // ======================================================================
    setInterval(() => {
        if (lastPacketAt && Date.now() - lastPacketAt > STALE_AFTER_MS) {
            setStatus('off', 'No signal', 'Dota 2 stopped sending updates — game closed or not in a match');
        }
    }, 2000);

    const socket = io();
    socket.on('connect', () => { if (!lastPacketAt) setStatus('', 'Waiting for Dota 2…', 'Connected to server, no GSI data yet'); });
    socket.on('disconnect', () => setStatus('off', 'Server offline', 'Lost connection to the Node.js server — reconnecting…'));

    socket.on('history', (points) => {
        series.length = 0;
        for (const p of points) series.push({ x: p.t, y: p.nw });
        renderChart();
    });

    socket.on('gameStateUpdate', (data) => {
        lastPacketAt = Date.now();
        lastData = data;
        renderRaw(data);

        if (!data.map) {
            setStatus('warn', 'In menus', 'Dota 2 connected — not in a match');
            $('clock').textContent = '--:--';
            return;
        }

        renderHeader(data);

        const player = data.player;
        const isSpectating = !!(player && (player.team2 || player.team3));
        const isPlayer = !!(player && has(player.gold));
        if (isSpectating) setStatus('warn', 'Spectating', 'Personal panels are hidden; showing all players instead');

        $('economyCard').hidden = !isPlayer;
        $('chartCard').hidden = isSpectating;
        if (isPlayer) {
            renderEconomy(player, data.map);
            renderPerformance(player, data.map);
        } else {
            $('perfCard').hidden = true;
        }

        renderHero(isPlayer ? data.hero : null, player, data.map);
        renderItems(isPlayer ? data.items : null);
        renderAbilities(isPlayer ? data.abilities : null, data.hero?.name);
        renderEvents(data);
        renderBuildings(data.buildings);
        renderScoreboard(data);
    });
})();
