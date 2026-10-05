// Minimap card: draws GSI minimap units (or, as a fallback, hero positions)
// on top of the background image from /resources.
// Exposes window.Minimap.update(data).
(() => {
    'use strict';

    const S = window.Settings;
    const $ = (id) => document.getElementById(id);

    // Where the playable square sits inside each 1000x1000 background image (fraction of width)
    const BACKGROUNDS = {
        detailed: { src: '/resources/7.38_minimap.webp', lo: 0.045, hi: 0.958 },
        simple: { src: '/resources/7.38_simple_minimap.webp', lo: 0.06, hi: 0.94 },
    };

    const card = $('minimapCard');
    const wrap = $('minimapWrap');
    const bg = $('minimapBg');
    const canvas = $('minimapCanvas');
    const ctx = canvas.getContext('2d');
    let last = null;
    let raf = 0;

    const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const teamColor = (t) => (t === 2 || t === 'radiant' ? cssVar('--radiant') : t === 3 || t === 'dire' ? cssVar('--dire') : '#b0b0b0');

    // Hero minimap icons (cached Image objects)
    const icons = new Map();
    function heroIcon(unitname) {
        const short = unitname.replace('npc_dota_hero_', '');
        if (!icons.has(short)) {
            const img = new Image();
            img.src = `/img/heroes/icons/${short}.png`;
            img.onload = schedule;
            icons.set(short, img);
        }
        const img = icons.get(short);
        return img.complete && img.naturalWidth ? img : null;
    }

    function setBackground() {
        const b = BACKGROUNDS[S.get('minimapBg')] || BACKGROUNDS.detailed;
        if (bg.getAttribute('src') !== b.src) bg.src = b.src;
        return b;
    }

    // World coordinates → canvas pixels
    function projector(size) {
        const b = setBackground();
        const min = Number(S.get('mapMin')), max = Number(S.get('mapMax'));
        const span = (b.hi - b.lo) * size;
        const off = b.lo * size;
        const k = span / (max - min || 1);
        return {
            x: (x) => off + (x - min) * k,
            y: (y) => off + (max - y) * k,
            r: (worldRadius) => worldRadius * k,
        };
    }

    // ------------------------------------------------------------------
    function collect(data) {
        const units = [];   // non-hero minimap elements
        const heroes = [];  // { x, y, team, name, local, yaw }
        const mm = data.minimap;
        if (mm && typeof mm === 'object') {
            for (const el of Object.values(mm)) {
                if (!el || typeof el.xpos !== 'number') continue;
                if (typeof el.unitname === 'string' && el.unitname.startsWith('npc_dota_hero_')) {
                    heroes.push({ x: el.xpos, y: el.ypos, team: el.team, name: el.unitname, yaw: el.yaw });
                } else units.push(el);
            }
        }
        const fromMinimap = heroes.length + units.length > 0;

        // Fallbacks: own hero position, or every hero when spectating
        const h = data.hero;
        if (h && typeof h.xpos === 'number' && h.name) {
            const match = heroes.find((x) => x.name === h.name);
            if (match) match.local = true;
            else heroes.push({ x: h.xpos, y: h.ypos, team: data.player?.team_name, name: h.name, local: true, dead: h.alive === false });
        }
        if (!fromMinimap && h) {
            for (const tk of ['team2', 'team3']) {
                for (const p of Object.values(h[tk] || {})) {
                    if (typeof p?.xpos === 'number' && p.name) heroes.push({ x: p.xpos, y: p.ypos, team: tk === 'team2' ? 2 : 3, name: p.name, dead: p.alive === false });
                }
            }
        }
        return { units, heroes, fromMinimap };
    }

    function kindOf(el) {
        const img = String(el.image || '');
        const name = String(el.unitname || '');
        if (/ward_obs|observer/.test(img + name)) return 'obs';
        if (/ward_sen|sentry/.test(img + name)) return 'sentry';
        if (/roshan/.test(img + name)) return 'roshan';
        if (/courier/.test(img + name)) return 'courier';
        if (/tower/.test(img + name)) return 'tower';
        if (/racks|rax|ancient|fort|building/.test(img + name)) return 'building';
        if (/creep|lane|siege/.test(img + name)) return 'creep';
        return 'other';
    }

    function draw() {
        raf = 0;
        const data = last;
        const size = wrap.clientWidth;
        if (!data || !size) return;
        const dpr = window.devicePixelRatio || 1;
        if (canvas.width !== Math.round(size * dpr)) {
            canvas.width = canvas.height = Math.round(size * dpr);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, size, size);

        const P = projector(size);
        const { units, heroes, fromMinimap } = collect(data);
        const showUnits = S.get('minimapUnits');
        const primary = cssVar('--md-sys-color-primary') || '#fff';

        // Ward vision
        if (showUnits && S.get('minimapVision')) {
            for (const el of units) {
                const k = kindOf(el);
                if ((k !== 'obs' && k !== 'sentry') || !el.visionrange) continue;
                ctx.beginPath();
                ctx.arc(P.x(el.xpos), P.y(el.ypos), P.r(el.visionrange), 0, Math.PI * 2);
                ctx.fillStyle = k === 'obs' ? 'rgba(255, 214, 90, 0.10)' : 'rgba(110, 170, 255, 0.10)';
                ctx.strokeStyle = k === 'obs' ? 'rgba(255, 214, 90, 0.45)' : 'rgba(110, 170, 255, 0.45)';
                ctx.setLineDash(k === 'sentry' ? [4, 3] : []);
                ctx.fill(); ctx.stroke();
                ctx.setLineDash([]);
            }
        }

        // Units
        if (showUnits) {
            for (const el of units) {
                const x = P.x(el.xpos), y = P.y(el.ypos);
                const k = kindOf(el);
                ctx.fillStyle = teamColor(el.team);
                ctx.strokeStyle = 'rgba(0,0,0,0.75)';
                ctx.lineWidth = 1;
                if (k === 'tower') { ctx.fillRect(x - 4, y - 4, 8, 8); ctx.strokeRect(x - 4, y - 4, 8, 8); }
                else if (k === 'building') { ctx.fillRect(x - 5, y - 5, 10, 10); ctx.strokeRect(x - 5, y - 5, 10, 10); }
                else if (k === 'creep') { ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill(); }
                else if (k === 'courier') {
                    ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 5, y); ctx.closePath();
                    ctx.fill(); ctx.stroke();
                } else if (k === 'roshan') {
                    ctx.fillStyle = '#ff8a3d';
                    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                } else if (k === 'obs' || k === 'sentry') {
                    ctx.fillStyle = k === 'obs' ? '#ffd65a' : '#6eaaff';
                    ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                } else { ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill(); }
            }
        }

        // Heroes (local hero last, so it's on top)
        const iconSize = Number(S.get('minimapIconSize')) || 30;
        heroes.sort((a, b) => (a.local ? 1 : 0) - (b.local ? 1 : 0));
        for (const h of heroes) {
            const x = P.x(h.x), y = P.y(h.y);
            const r = (h.local ? iconSize * 1.1 : iconSize) / 2;
            ctx.save();
            ctx.globalAlpha = h.dead ? 0.4 : 1;
            ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fill();
            const icon = heroIcon(h.name);
            if (icon) {
                ctx.save(); ctx.clip();
                ctx.drawImage(icon, x - r, y - r, r * 2, r * 2);
                ctx.restore();
            }
            ctx.lineWidth = h.local ? 3 : 2;
            ctx.strokeStyle = h.local ? primary : teamColor(h.team);
            ctx.stroke();
            if (h.local) {
                ctx.beginPath(); ctx.arc(x, y, r + 4, 0, Math.PI * 2);
                ctx.lineWidth = 1.5; ctx.strokeStyle = primary; ctx.globalAlpha = 0.55; ctx.stroke();
            }
            ctx.restore();
        }

        // Status line
        const local = heroes.find((h) => h.local);
        let status = fromMinimap
            ? `${heroes.length} heroes, ${units.length} other units from minimap data`
            : heroes.length > 1 ? 'Hero positions (no minimap data)' : 'Your hero only (Dota is not sending minimap data)';
        if (S.get('minimapCoords') && local) status += ` · you at x ${Math.round(local.x)}, y ${Math.round(local.y)}`;
        $('minimapStatus').textContent = status;
    }

    function schedule() {
        if (!raf) raf = requestAnimationFrame(draw);
    }

    function update(data) {
        last = data;
        const hasPositions = !!(data.minimap || typeof data.hero?.xpos === 'number' ||
            Object.values(data.hero?.team2 || {}).some((p) => typeof p?.xpos === 'number'));
        card.hidden = !(data.map && hasPositions);
        if (!card.hidden) schedule();
    }

    setBackground();
    new ResizeObserver(schedule).observe(wrap);
    S.onChange((key) => { if (key.startsWith('minimap') || key.startsWith('map')) schedule(); });
    window.addEventListener('themechange', schedule);

    window.Minimap = { update };
})();
