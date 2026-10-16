/**
 * Studio-wide constants. Everything tunable about limits, timing and storage
 * lives here so security and performance budgets are reviewable in one place.
 */
/** Fixed simulation timestep (seconds). Physics and logic always advance by exactly this. */
export const FIXED_DT = 1 / 60;
/** Maximum fixed steps per animation frame (spiral-of-death guard). */
export const MAX_SUBSTEPS = 5;
/** Largest wall-clock delta accepted per frame (seconds); longer stalls are dropped. */
export const MAX_FRAME_DT = 0.1;
/** How often HUD / perf stats are pushed to React (ms) — 4 Hz. */
export const STATS_INTERVAL_MS = 250;
/** Largest accepted world import (bytes). */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
/** Largest raw JSON accepted by the inspector's entity editor (characters). */
export const MAX_ENTITY_JSON_CHARS = 512 * 1024;
/** Longest prompt the chat box accepts (characters). */
export const MAX_PROMPT_CHARS = 4000;
/** Maximum chat entries kept in memory and in storage. */
export const MAX_CHAT_ENTRIES = 120;
/** Maximum events kept per assistant chat entry. */
export const MAX_EVENTS_PER_ENTRY = 200;
/** Maximum characters of any text rendered from an agent event. */
export const MAX_EVENT_TEXT = 12_000;
/** Previous turns sent to the agent as conversation context. */
export const AGENT_CONTEXT_TURNS = 8;
/** Number of rows above which the outliner virtualizes its list. */
export const OUTLINER_VIRTUALIZE_THRESHOLD = 300;
/** Outliner row height (px) — must match `.outliner-row` in the stylesheet. */
export const OUTLINER_ROW_HEIGHT = 28;
/** Maximum concurrent toast notifications. */
export const MAX_TOASTS = 4;
/** Verification budget handed to `@aether/physics.verify`. */
export const VERIFY_MAX_SECONDS = 12;
/**
 * Compute budget for a verification run (ms). Verification yields to the
 * browser between ~8 ms slices, so the UI stays responsive while it runs.
 */
export const VERIFY_BUDGET_MS = 2500;
/** Timeout for a generator dry-run in the sandbox (ms). */
export const GENERATOR_DRY_RUN_MS = 2500;
/** Timeout for the backend health probe (ms). */
export const HEALTH_TIMEOUT_MS = 2500;
/** Debounce for persisting the world to localStorage (ms). */
export const PERSIST_DEBOUNCE_MS = 600;
/** localStorage keys (versioned so a schema change never loads stale data). */
export const STORAGE_KEYS = {
    world: 'aether.studio.world.v1',
    chat: 'aether.studio.chat.v1',
    settings: 'aether.studio.settings.v1',
    layout: 'aether.studio.layout.v1',
    /** Boot-in-progress marker (crash-loop guard). */
    booting: 'aether.studio.booting.v1',
    /** World skipped by safe mode, kept for manual recovery. */
    recovery: 'aether.studio.world.recovery.v1',
};
/** Server endpoints (proxied to apps/server during development). */
export const API = {
    health: '/api/health',
    llm: '/api/llm',
    worlds: '/api/worlds',
};
/** Player character capsule used when the world has no controllable avatar entity. */
export const PLAYER_CAPSULE = { radius: 0.35, height: 1.7 };
/** Pseudo entity id reported to logic for the built-in character controller. */
export const PLAYER_PSEUDO_ID = 'player';
