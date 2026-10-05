// Material You (M3) dynamic theme.
// Seed color = most characteristic color of the current hero's portrait (or the
// fallback color from settings). Light/dark comes from the theme setting, where
// "Game time" follows the in-game day/night cycle.
import {
    Hct, QuantizerCelebi, Score, argbFromHex, hexFromArgb,
    SchemeFidelity, SchemeVibrant, SchemeExpressive, SchemeContent, SchemeTonalSpot,
} from '/vendor/mcu/index.js';

const SCHEMES = {
    fidelity: SchemeFidelity,
    vibrant: SchemeVibrant,
    expressive: SchemeExpressive,
    content: SchemeContent,
    tonal_spot: SchemeTonalSpot,
};

// M3 color roles exported as --md-sys-color-<kebab-name>
const ROLES = [
    'primary', 'onPrimary', 'primaryContainer', 'onPrimaryContainer', 'inversePrimary',
    'secondary', 'onSecondary', 'secondaryContainer', 'onSecondaryContainer',
    'tertiary', 'onTertiary', 'tertiaryContainer', 'onTertiaryContainer',
    'error', 'onError', 'errorContainer', 'onErrorContainer',
    'background', 'onBackground', 'surface', 'onSurface', 'surfaceVariant', 'onSurfaceVariant',
    'surfaceDim', 'surfaceBright', 'surfaceContainerLowest', 'surfaceContainerLow', 'surfaceContainer',
    'surfaceContainerHigh', 'surfaceContainerHighest', 'inverseSurface', 'inverseOnSurface',
    'outline', 'outlineVariant', 'shadow', 'scrim', 'surfaceTint',
];
const kebab = (s) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

const S = window.Settings;
const root = document.documentElement;
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

const state = {
    heroName: null,     // npc_dota_hero_*
    heroSeed: null,     // ARGB from portrait
    inMatch: false,
    daytime: null,      // true / false / null (unknown)
    applied: '',        // signature of the last applied theme
    isDark: true,
    seedHex: null,
};
const seedCache = new Map();
let animTimer = 0;

// ---------------------------------------------------------------------------
// Seed color extraction (same approach as Android's wallpaper colors)
// ---------------------------------------------------------------------------
async function seedFromHero(heroName) {
    if (seedCache.has(heroName)) return seedCache.get(heroName);
    const short = heroName.replace('npc_dota_hero_', '');
    const img = new Image();
    img.src = `/img/heroes/${short}.png`;
    try {
        await img.decode();
    } catch {
        seedCache.set(heroName, null);
        return null;
    }
    const w = 128, h = Math.round((img.naturalHeight / img.naturalWidth) * 128) || 72;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const pixels = [];
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 255) continue;
        pixels.push(((255 << 24) | (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]) >>> 0);
    }
    const ranked = Score.score(QuantizerCelebi.quantize(pixels, 128), { desired: 1, filter: true });
    const seed = ranked[0] ?? null;
    seedCache.set(heroName, seed);
    return seed;
}

// ---------------------------------------------------------------------------
function resolveDark() {
    const mode = S.get('themeMode');
    if (mode === 'light') return false;
    if (mode === 'dark') return true;
    // "Game time": day = light, night = dark; no match → system preference
    if (state.inMatch && state.daytime !== null) return !state.daytime;
    return systemDark.matches;
}

function apply() {
    const useHero = S.get('heroColors') && state.heroSeed !== null;
    const seed = useHero ? state.heroSeed : argbFromHex(S.get('defaultColor') || '#c23c2a');
    const isDark = resolveDark();
    const style = S.get('colorStyle');
    const contrast = Number(S.get('contrast')) || 0;

    const sig = [seed, isDark, style, contrast].join('|');
    if (sig === state.applied) return;

    // Cross-fade everything together (skip on first paint)
    if (state.applied && state.seedHex) {
        root.classList.add('theme-anim');
        clearTimeout(animTimer);
        animTimer = setTimeout(() => root.classList.remove('theme-anim'), 600);
    }
    state.applied = sig;

    const Scheme = SCHEMES[style] || SchemeFidelity;
    const scheme = new Scheme(Hct.fromInt(seed), isDark, contrast);
    for (const role of ROLES) {
        const argb = scheme[role];
        if (typeof argb === 'number') root.style.setProperty(`--md-sys-color-${kebab(role)}`, hexFromArgb(argb));
    }
    root.dataset.theme = isDark ? 'dark' : 'light';
    root.style.colorScheme = isDark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', hexFromArgb(scheme.surface));

    state.isDark = isDark;
    state.seedHex = hexFromArgb(seed);
    renderPreview();
    window.dispatchEvent(new CustomEvent('themechange', { detail: { isDark, seed: state.seedHex, hero: useHero ? state.heroName : null } }));
}

function renderPreview() {
    const el = document.getElementById('themePreview');
    if (!el) return;
    const source = S.get('heroColors') && state.heroSeed !== null
        ? `from ${state.heroName.replace('npc_dota_hero_', '').replace(/_/g, ' ')}`
        : 'fallback color';
    el.innerHTML =
        `<span class="swatch" style="background:${state.seedHex}"></span>` +
        `<span>Seed ${state.seedHex} · ${source} · ${state.isDark ? 'dark' : 'light'}</span>` +
        ['primary', 'secondary', 'tertiary', 'primary-container', 'surface-container-high']
            .map((r) => `<span class="swatch small" title="${r}" style="background:var(--md-sys-color-${r})"></span>`).join('');
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------
let heroToken = 0;
async function onGsi(data) {
    const map = data?.map;
    state.inMatch = !!map && map.game_state !== undefined;
    state.daytime = map && typeof map.daytime === 'boolean'
        ? (map.daytime && !map.nightstalker_night)
        : null;

    // Only a playing client has its own hero; spectating uses the fallback color
    const heroName = typeof data?.hero?.name === 'string' ? data.hero.name : null;
    if (heroName !== state.heroName) {
        state.heroName = heroName;
        state.heroSeed = null;
        const token = ++heroToken;
        if (heroName) {
            const seed = await seedFromHero(heroName);
            if (token !== heroToken) return; // hero changed while loading
            state.heroSeed = seed;
        }
    }
    apply();
}

window.addEventListener('gsi', (e) => onGsi(e.detail));
S.onChange(() => apply());
systemDark.addEventListener('change', () => apply());
document.addEventListener('settings:open', renderPreview);

// Catch up with a payload that arrived before this module loaded
if (window.__lastGsi) onGsi(window.__lastGsi);
else apply();
