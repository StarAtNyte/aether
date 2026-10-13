/**
 * Global zod configuration, imported before any schema is defined or parsed.
 *
 * `jitless`: zod 4 otherwise probes `new Function("")` and compiles object
 * parsers with it. The studio ships a strict Content-Security-Policy
 * (`script-src 'self' 'wasm-unsafe-eval'`), under which that probe is a
 * reported CSP violation (Firefox logs it as an error). The interpreter path
 * is behaviorally identical and keeps every environment on the same code.
 */
import { z } from 'zod';

z.config({ jitless: true });

/** True once the configuration ran (lets tests assert the import order). */
export const ZOD_JITLESS = z.config().jitless === true;
