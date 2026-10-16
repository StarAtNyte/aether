/** Floats per trace frame. */
export const TRACE_STRIDE = 4;
/** Caps of the playtest agent. */
export const PLAYTEST_LIMITS = Object.freeze({
    DEFAULT_MAX_SIM_SECONDS: 240,
    MAX_SIM_SECONDS: 900,
    DEFAULT_BUDGET_MS: 20_000,
    MAX_BUDGET_MS: 120_000,
    MAX_OBJECTIVES: 200,
    MAX_FINDINGS: 24,
    MAX_PATH_POINTS: 240,
    MAX_TRACE_FRAMES: 6_000,
    /** Navigation grid cells (all levels together). */
    MAX_NAV_CELLS: 120_000,
    MAX_NAV_NODES: 160_000,
    /** Replans allowed per objective before it is called stuck. */
    MAX_REPLANS: 7,
});
