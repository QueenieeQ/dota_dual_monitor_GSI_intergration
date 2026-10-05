// Dashboard settings: a small persisted store + the settings side sheet UI.
// Exposes window.Settings = { get, set, all, onChange, open, SCHEMA }.
(() => {
    'use strict';

    const STORAGE_KEY = 'd2sm.settings.v1';

    // Each entry renders one control in the settings sheet. Add new settings here.
    const PANELS = [
        ['hero', 'Hero'], ['performance', 'Performance'], ['economy', 'Economy'], ['minimap', 'Minimap'],
        ['items', 'Items'], ['abilities', 'Abilities'], ['events', 'Match events'], ['chart', 'Net worth chart'],
        ['buildings', 'Buildings (spectating)'], ['scoreboard', 'Scoreboard (spectating)'], ['raw', 'Raw GSI data'],
    ];

    const SCHEMA = [
        { section: 'Appearance' },
        {
            key: 'themeMode', type: 'segmented', label: 'Theme', default: 'auto',
            options: [['light', 'Light'], ['dark', 'Dark'], ['auto', 'Game time']],
            help: 'Game time: light during the in-game day, dark at night. Outside a match it follows your system setting.',
        },
        { key: 'heroColors', type: 'switch', label: 'Colors from your hero', default: true, help: "Build the whole palette from the hero you're playing." },
        {
            key: 'colorStyle', type: 'select', label: 'Color style', default: 'fidelity',
            options: [
                ['fidelity', 'Faithful: strong hero colors'],
                ['vibrant', 'Vibrant: maximum color'],
                ['expressive', 'Expressive: playful hue shifts'],
                ['content', 'Content: close to the portrait'],
                ['tonal_spot', 'Tonal spot: calm, Android default'],
            ],
        },
        { key: 'contrast', type: 'segmented', label: 'Contrast', default: '0', options: [['0', 'Standard'], ['0.5', 'Medium'], ['1', 'High']] },
        { key: 'defaultColor', type: 'color', label: 'Fallback color', default: '#c23c2a', help: 'Used outside a match, while spectating, or when hero colors are off.' },

        { section: 'Panels' },
        ...PANELS.map(([id, label]) => ({ key: `panel.${id}`, type: 'switch', label, default: true })),

        { section: 'Minimap' },
        { key: 'minimapBg', type: 'segmented', label: 'Background', default: 'detailed', options: [['detailed', 'Detailed'], ['simple', 'Simple']] },
        { key: 'minimapUnits', type: 'switch', label: 'Show creeps, wards & buildings', default: true },
        { key: 'minimapVision', type: 'switch', label: 'Show ward vision', default: true },
        { key: 'minimapIconSize', type: 'range', label: 'Hero icon size', default: 30, min: 16, max: 48, step: 1, unit: 'px' },
        { key: 'minimapCoords', type: 'switch', label: 'Show coordinates (for calibration)', default: false },
        { key: 'mapMin', type: 'number', label: 'World min (bottom-left)', default: -8200, step: 50, help: 'Tune these in a Demo game if markers are offset from the map.' },
        { key: 'mapMax', type: 'number', label: 'World max (top-right)', default: 8200, step: 50 },

        { section: 'Behaviour' },
        { key: 'deltaFade', type: 'range', label: 'Gold change highlight', default: 5, min: 1, max: 15, step: 1, unit: 's' },
        { key: 'liveTimers', type: 'switch', label: 'Tick timers between updates', default: true, help: 'Smooth one-second countdowns for the clock, day/night, Roshan and wards.' },
    ];

    const defaults = Object.fromEntries(SCHEMA.filter((s) => s.key).map((s) => [s.key, s.default]));
    let values = { ...defaults };
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        for (const k of Object.keys(saved)) if (k in defaults) values[k] = saved[k];
    } catch { /* storage unavailable: run with defaults */ }

    const listeners = new Set();
    function persist() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(values)); } catch { /* ignore */ }
    }
    function set(key, value) {
        if (values[key] === value) return;
        values[key] = value;
        persist();
        listeners.forEach((fn) => fn(key, value, values));
        syncControl(key);
    }

    // ------------------------------------------------------------------
    // Side sheet UI
    // ------------------------------------------------------------------
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    let dialog = null;

    function controlHtml(s) {
        const id = `set-${s.key.replace('.', '-')}`;
        const help = s.help ? `<div class="set-help">${esc(s.help)}</div>` : '';
        switch (s.type) {
            case 'switch':
                return `<label class="set-row" for="${id}"><span class="set-text"><span class="set-label">${esc(s.label)}</span>${help}</span>` +
                    `<input type="checkbox" role="switch" class="m3-switch" id="${id}" data-key="${s.key}"></label>`;
            case 'segmented':
                return `<div class="set-block"><div class="set-label">${esc(s.label)}</div>` +
                    `<div class="segmented" role="radiogroup" aria-label="${esc(s.label)}">` +
                    s.options.map(([v, l]) => `<label><input type="radio" name="${id}" value="${v}" data-key="${s.key}"><span>${esc(l)}</span></label>`).join('') +
                    `</div>${help}</div>`;
            case 'select':
                return `<div class="set-block"><label class="set-label" for="${id}">${esc(s.label)}</label>` +
                    `<select class="m3-select" id="${id}" data-key="${s.key}">` +
                    s.options.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('') + `</select>${help}</div>`;
            case 'range':
                return `<div class="set-block"><div class="set-label-row"><label class="set-label" for="${id}">${esc(s.label)}</label><output id="${id}-out"></output></div>` +
                    `<input type="range" class="m3-slider" id="${id}" data-key="${s.key}" min="${s.min}" max="${s.max}" step="${s.step}">${help}</div>`;
            case 'number':
                return `<div class="set-block"><label class="set-label" for="${id}">${esc(s.label)}</label>` +
                    `<input type="number" class="m3-field" id="${id}" data-key="${s.key}" step="${s.step || 1}">${help}</div>`;
            case 'color':
                return `<label class="set-row" for="${id}"><span class="set-text"><span class="set-label">${esc(s.label)}</span>${help}</span>` +
                    `<input type="color" class="m3-color" id="${id}" data-key="${s.key}"></label>`;
            default:
                return '';
        }
    }

    function syncControl(key) {
        if (!dialog) return;
        const s = SCHEMA.find((x) => x.key === key);
        if (!s) return;
        const v = values[key];
        dialog.querySelectorAll(`[data-key="${key}"]`).forEach((el) => {
            if (el.type === 'checkbox') el.checked = !!v;
            else if (el.type === 'radio') el.checked = el.value === String(v);
            else el.value = v;
            if (el.type === 'range') {
                const out = dialog.querySelector(`#${el.id}-out`);
                if (out) out.textContent = `${v}${s.unit || ''}`;
            }
        });
    }

    function build() {
        dialog = document.createElement('dialog');
        dialog.className = 'side-sheet';
        dialog.setAttribute('aria-label', 'Settings');
        let body = '';
        for (const s of SCHEMA) {
            if (s.section) body += `${body ? '</section>' : ''}<section class="set-section"><h3>${esc(s.section)}</h3>`;
            else body += controlHtml(s);
        }
        body += '</section>';
        dialog.innerHTML =
            `<header class="sheet-head"><h2>Settings</h2>` +
            `<button class="icon-btn" data-close aria-label="Close settings"><svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></button></header>` +
            `<div class="sheet-body">${body}<div class="theme-preview" id="themePreview"></div></div>` +
            `<footer class="sheet-foot"><button class="text-btn" data-reset>Reset to defaults</button><button class="filled-btn" data-close>Done</button></footer>`;
        document.body.appendChild(dialog);

        dialog.addEventListener('input', (e) => {
            const el = e.target;
            const key = el.dataset.key;
            if (!key) return;
            const s = SCHEMA.find((x) => x.key === key);
            let v;
            if (el.type === 'checkbox') v = el.checked;
            else if (el.type === 'range' || el.type === 'number') {
                v = Number(el.value);
                if (!Number.isFinite(v)) return;
            } else v = el.value;
            if (s.type === 'segmented' && !el.checked) return;
            set(key, v);
        });
        dialog.addEventListener('click', (e) => {
            if (e.target.closest('[data-close]')) dialog.close();
            else if (e.target.closest('[data-reset]')) {
                for (const k of Object.keys(defaults)) set(k, defaults[k]);
            } else if (e.target === dialog) dialog.close(); // click on the scrim
        });
        Object.keys(defaults).forEach(syncControl);
    }

    window.Settings = {
        SCHEMA,
        get: (key) => values[key],
        all: () => ({ ...values }),
        set,
        onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        open() {
            if (!dialog) build();
            Object.keys(defaults).forEach(syncControl);
            dialog.showModal();
            document.dispatchEvent(new CustomEvent('settings:open'));
        },
    };
})();
