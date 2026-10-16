/** Initial state (no building). */
export const DEFAULT_ARCH_UI = Object.freeze({
    building: null,
    levels: [],
    walls: 'up',
    levelMode: 'stacked',
    level: 0,
    xray: false,
    section: null,
    plan: false,
    planTool: 'select',
    roomType: 'living',
    quality: 'realtime',
    studioAvailable: true,
    sunHour: null,
    photo: false,
    reveal: null,
});
/** Section heights the slider offers (metres above the ground floor). */
export const SECTION_RANGE = Object.freeze([0.3, 12]);
const WALLS = ['up', 'cutaway', 'down'];
const LEVELS = ['stacked', 'exploded', 'solo'];
const TOOLS = ['select', 'rect', 'polygon', 'door', 'window'];
const ROOM_TYPES = ['living', 'kitchen', 'dining', 'bedroom', 'bathroom', 'office', 'hall', 'entry', 'cafe', 'meeting', 'open-office', 'lobby', 'storage', 'laundry', 'terrace', 'garage', 'studio', 'kids'];
function finite(v) {
    return typeof v === 'number' && Number.isFinite(v);
}
/** Merge a patch into the state, keeping every field valid (unknown values fall back to the current ones). */
export function mergeArchUi(cur, patch) {
    const n = { ...cur, ...patch };
    const levels = Array.isArray(n.levels) ? n.levels.slice(0, 64) : cur.levels;
    const maxLevel = Math.max(0, levels.length - 1);
    return {
        building: typeof n.building === 'string' && n.building.length > 0 ? n.building.slice(0, 64) : null,
        levels,
        walls: WALLS.includes(n.walls) ? n.walls : cur.walls,
        levelMode: LEVELS.includes(n.levelMode) ? n.levelMode : cur.levelMode,
        level: finite(n.level) ? Math.max(0, Math.min(maxLevel, Math.round(n.level))) : 0,
        xray: n.xray === true,
        section: n.section === null ? null : finite(n.section) ? Math.max(SECTION_RANGE[0], Math.min(SECTION_RANGE[1], n.section)) : cur.section,
        plan: n.plan === true,
        planTool: TOOLS.includes(n.planTool) ? n.planTool : cur.planTool,
        roomType: ROOM_TYPES.includes(n.roomType) ? n.roomType : cur.roomType,
        quality: n.quality === 'studio' ? 'studio' : 'realtime',
        studioAvailable: n.studioAvailable !== false,
        sunHour: n.sunHour === null ? null : finite(n.sunHour) ? Math.max(0, Math.min(24, n.sunHour)) : cur.sunHour,
        photo: n.photo === true,
        reveal: n.reveal === null || n.reveal === undefined ? null : finite(n.reveal) ? Math.max(0, Math.min(1, n.reveal)) : null,
    };
}
/** Sky preset and hour for a daylight-study hour (night before dawn and after dusk). */
export function skyForHour(hour) {
    const h = finite(hour) ? ((hour % 24) + 24) % 24 : 12;
    if (h < 5.8 || h >= 20.6)
        return { sky: 'night', timeOfDay: h };
    if (h < 8)
        return { sky: 'dawn', timeOfDay: h };
    if (h >= 17.2)
        return { sky: 'sunset', timeOfDay: h };
    return { sky: 'day', timeOfDay: h };
}
/** Walkthrough time-of-day presets (keys 1–4). */
export const TIME_PRESETS = Object.freeze([
    { key: '1', label: 'Morning', hour: 8.4 },
    { key: '2', label: 'Midday', hour: 13 },
    { key: '3', label: 'Golden hour', hour: 18.1 },
    { key: '4', label: 'Night', hour: 22 },
]);
/** Label of a sun hour ("14:30"). */
export function hourLabel(hour) {
    const h = finite(hour) ? Math.max(0, Math.min(24, hour)) : 12;
    const whole = Math.floor(h);
    const min = Math.round((h - whole) * 60);
    const hh = min === 60 ? whole + 1 : whole;
    return `${String(hh % 24).padStart(2, '0')}:${String(min === 60 ? 0 : min).padStart(2, '0')}`;
}
/** Storey a horizontal section at `height` (metres above the ground floor) cuts through: only its rooms are labelled. */
export function sectionLevel(levels, height) {
    let base = 0;
    for (const l of levels) {
        if (height < base + l.height)
            return l.index;
        base += l.height;
    }
    return levels.length > 0 ? levels[levels.length - 1].index : null;
}
