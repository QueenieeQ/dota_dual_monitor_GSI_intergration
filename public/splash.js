// Match event splash screens: full-screen overlays for match join, hero pick,
// kills, deaths, kill streaks, win/loss and game conclusion. Self-contained,
// same pattern as minimap.js — listens to the "gsi" CustomEvent app.js
// dispatches on every packet and diffs against its own previous snapshot.
(() => {
    'use strict';

    const S = window.Settings;
    const overlay = document.getElementById('splashOverlay');
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // States in which "match joined" is a meaningful thing to announce (vs. a
    // page refresh landing mid-match, which shouldn't retroactively splash)
    const EARLY_STATES = new Set([
        'DOTA_GAMERULES_STATE_WAIT_FOR_PLAYERS_TO_LOAD', 'DOTA_GAMERULES_STATE_CUSTOM_GAME_SETUP',
        'DOTA_GAMERULES_STATE_PLAYER_DRAFT', 'DOTA_GAMERULES_STATE_HERO_SELECTION',
        'DOTA_GAMERULES_STATE_STRATEGY_TIME', 'DOTA_GAMERULES_STATE_TEAM_SHOWCASE',
        'DOTA_GAMERULES_STATE_WAIT_FOR_MAP_TO_LOAD', 'DOTA_GAMERULES_STATE_PRE_GAME',
    ]);

    const STREAK_LABELS = { 3: 'Killing Spree', 4: 'Dominating', 5: 'Mega-Kill', 6: 'Unstoppable', 7: 'Wicked Sick', 8: 'Monster Kill', 9: 'Godlike' };
    const streakLabel = (n) => (n >= 10 ? 'Beyond Godlike' : STREAK_LABELS[n]);

    const prettyHero = (name) => String(name).replace(/^npc_dota_hero_/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const heroImg = (name) => `/img/heroes/${String(name).replace('npc_dota_hero_', '').toLowerCase().replace(/[^a-z0-9_]/g, '')}.png`;

    // ------------------------------------------------------------------
    // Queue + overlay rendering
    // ------------------------------------------------------------------
    const queue = [];
    let showing = false;

    function pump() {
        if (showing || !queue.length) return;
        showing = true;
        const item = queue.shift();
        const duration = Number(S.get('splashDuration')) || 3;
        overlay.innerHTML =
            `<div class="splash-card ${item.variant}" style="--splash-life:${duration}s">` +
            (item.img ? `<img src="${item.img}" alt="" onerror="this.remove()">` : '') +
            `<div class="splash-title">${esc(item.title)}</div>` +
            (item.sub ? `<div class="splash-sub">${esc(item.sub)}</div>` : '') +
            `</div>`;
        overlay.hidden = false;
        setTimeout(() => {
            overlay.hidden = true;
            overlay.innerHTML = '';
            showing = false;
            pump();
        }, (duration + 0.3) * 1000); // 0.3s matches the CSS fade-out length
    }

    const VARIANT = { pick: '', join: '', kill: 'good', death: 'bad', streak: 'good', conclusion: '' };
    function maybeFire(type, title, sub, img, variant) {
        if (!S.get('splashEnabled') || S.get(`splash.${type}`) === false) return;
        queue.push({ title, sub, img: img || null, variant: variant ?? VARIANT[type] ?? '' });
        pump();
    }

    // ------------------------------------------------------------------
    // Diffing against the previous GSI snapshot
    // ------------------------------------------------------------------
    let prev = { matchid: null, heroName: null, kills: 0, alive: null, killStreak: 0, winTeam: null, gameState: null, seenMap: false };

    function onGsi(data) {
        const map = data?.map;
        if (!map) {
            prev = { matchid: null, heroName: null, kills: 0, alive: null, killStreak: 0, winTeam: null, gameState: null, seenMap: false };
            return;
        }

        const player = data.player;
        const isPlayer = !!(player && typeof player.gold === 'number');
        const hero = isPlayer ? data.hero : null;
        const heroName = hero?.name || null;
        const winTeam = map.win_team && map.win_team !== 'none' ? map.win_team : null;

        if (map.matchid !== prev.matchid) {
            if (prev.seenMap || EARLY_STATES.has(map.game_state)) maybeFire('join', 'Match joined', map.customgamename || '');
            prev = { ...prev, heroName: null, kills: 0, alive: null, killStreak: 0, winTeam: null };
        }

        // Gated the same way as "join": a page reload mid-match already has a hero and
        // shouldn't retroactively announce a pick that happened before the page loaded.
        if (heroName && heroName !== prev.heroName && (prev.seenMap || EARLY_STATES.has(map.game_state))) {
            maybeFire('pick', 'Hero picked', prettyHero(heroName), heroImg(heroName));
        }

        if (isPlayer && player.kills > prev.kills) maybeFire('kill', 'Kill!', `${player.kills} kills this match`);

        if (hero && prev.alive !== false && hero.alive === false) maybeFire('death', 'You died', '');

        const streak = isPlayer ? (player.kill_streak ?? 0) : 0;
        if (streak > prev.killStreak) {
            const label = streakLabel(streak);
            if (label) maybeFire('streak', label, `${streak} kills in a row`);
        }

        if (winTeam && winTeam !== prev.winTeam) {
            const teamLabel = winTeam === 'radiant' ? 'Radiant' : 'Dire';
            if (isPlayer) {
                const won = player.team_name === winTeam;
                maybeFire('winloss', won ? 'Victory' : 'Defeat', `${teamLabel} wins`, null, won ? 'good' : 'bad');
            } else {
                maybeFire('winloss', `${teamLabel} victory`, '', null, winTeam);
            }
        }

        if (map.game_state === 'DOTA_GAMERULES_STATE_POST_GAME' && prev.gameState !== 'DOTA_GAMERULES_STATE_POST_GAME') {
            maybeFire('conclusion', 'Game over', 'GG');
        }

        prev = {
            matchid: map.matchid ?? null, heroName, kills: isPlayer ? (player.kills ?? 0) : 0,
            alive: hero ? hero.alive !== false : null, killStreak: streak, winTeam, gameState: map.game_state ?? null, seenMap: true,
        };
    }

    window.addEventListener('gsi', (e) => onGsi(e.detail));
})();
