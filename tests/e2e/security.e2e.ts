/**
 * Security exploit attempts in real browsers (Chromium, then Firefox; one
 * browser at a time). Each attempt must FAIL against the production build:
 *
 * 1. Generator sandbox escapes. AI-written (or share-link-supplied) generator
 *    code runs in the locked-down sandbox worker. Browser workers keep their
 *    web APIs on the global's PROTOTYPE chain (`WorkerGlobalScope.prototype`)
 *    and expose interface objects (`WorkerGlobalScope`, `IDBFactory`), so a
 *    generator that reaches a prototype descriptor could call `fetch` or the
 *    `indexedDB` getter with an undefined receiver (WebIDL then uses the
 *    global) and read or wipe the studio origin's projects. Every attempt is
 *    run in the real bundled worker and must come back blocked, while a
 *    normal generator still builds.
 * 2. The worker answers only well-formed run requests (garbage is ignored).
 *
 *   npm run build && npm run e2e:security
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, firefox, type Browser, type Page } from 'playwright';
import { CHROME_ARGS, FIREFOX_PREFS, STUDIO_DIST, findChrome, findFirefox, startServer } from './support/env';

function log(line: string): void {
  process.stdout.write(`${line}\n`);
}

function check(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

const FINISH = 'api.add(api.box(1, 1, 1), {}); return api.build();';

/**
 * name → generator body. Each one throws "LEAK:…" if it gets hold of a
 * capability. Names are assembled at runtime and the body ends with the
 * `api.build()` the screen wants: the static token screen is advisory only,
 * so a real attacker gets past it like this and the worker lockdown is what
 * must hold.
 */
const P = "const P = 'proto' + 'ty' + 'pe';";
const ESCAPES: Readonly<Record<string, string>> = {
  protoIndexedDb: `${P} const d = Object.getOwnPropertyDescriptor(WorkerGlobalScope[P], 'index' + 'edDB'); throw new Error('LEAK:' + typeof d.get.call(undefined)); return api.build();`,
  protoFetch: `${P} const d = Object.getOwnPropertyDescriptor(WorkerGlobalScope[P], 'fe' + 'tch'); throw new Error('LEAK:' + typeof d.value.call(undefined, '/')); return api.build();`,
  protoCaches: `${P} const d = Object.getOwnPropertyDescriptor(WorkerGlobalScope[P], 'cach' + 'es'); throw new Error('LEAK:' + typeof d.get.call(undefined)); return api.build();`,
  dedicatedScope: `${P} const d = Object.getOwnPropertyDescriptor(DedicatedWorkerGlobalScope[P], 'post' + 'Message'); throw new Error('LEAK:' + typeof d.value); return api.build();`,
  eventTarget: `${P} const d = Object.getOwnPropertyDescriptor(EventTarget[P], 'addEventListener'); throw new Error('LEAK:' + typeof d.value); return api.build();`,
  idbFactory: `${P} const d = Object.getOwnPropertyDescriptor(IDBFactory[P], 'open'); throw new Error('LEAK:' + typeof d.value); return api.build();`,
};

/** Web names the token screen does not catch: none may still be defined in the sandbox. */
const SURVEY_NAMES = ['WorkerGlobalScope', 'DedicatedWorkerGlobalScope', 'EventTarget', 'IDBFactory', 'IDBDatabase', 'CacheStorage', 'Request', 'Response', 'Headers', 'FormData', 'ReadableStream', 'crypto', 'OffscreenCanvas', 'TextDecoder', 'Blob', 'URL', 'performance', 'structuredClone', 'reportError', 'FileReaderSync', 'Notification', 'StorageManager', 'GPU', 'FontFace'];
const SURVEY = `const defined = [${SURVEY_NAMES.map((n) => `typeof ${n} !== 'undefined' ? '${n}' : ''`).join(', ')}].filter((n) => n !== '');
if (defined.length > 0) throw new Error('LEAK:' + defined.join(','));
${FINISH}`;

interface RunOutcome {
  ok: boolean;
  error?: string;
  parts?: number;
}

/** Run generator bodies in the bundled sandbox worker of the production build. */
async function runInSandbox(page: Page, workerPath: string, sources: Record<string, string>): Promise<Record<string, RunOutcome>> {
  return page.evaluate(
    async ({ path, list }) => {
      const worker = new Worker(path, { type: 'module', name: 'aether-generator-sandbox' });
      const ready = new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('sandbox worker did not start')), 20_000);
        worker.addEventListener('message', (e: MessageEvent) => {
          if ((e.data as { type?: string }).type === 'ready') {
            clearTimeout(t);
            resolve();
          }
        });
        worker.addEventListener('error', (e) => reject(new Error(`worker error: ${(e as ErrorEvent).message}`)));
      });
      await ready;
      const out: Record<string, { ok: boolean; error?: string; parts?: number }> = {};
      let id = 1;
      // Garbage first: must be ignored (no reply, no crash).
      worker.postMessage({ type: 'run', id: 'x', source: 1 });
      worker.postMessage('not an object');
      for (const [name, source] of Object.entries(list)) {
        const my = id++;
        out[name] = await new Promise((resolve) => {
          const t = setTimeout(() => resolve({ ok: false, error: 'timeout' }), 15_000);
          const on = (e: MessageEvent): void => {
            const d = e.data as { type?: string; id?: number; ok?: boolean; error?: string; output?: { parts?: unknown[] } };
            if (d.type !== 'result' || d.id !== my) return;
            clearTimeout(t);
            worker.removeEventListener('message', on);
            resolve(d.ok ? { ok: true, parts: d.output?.parts?.length ?? 0 } : { ok: false, error: String(d.error) });
          };
          worker.addEventListener('message', on);
          worker.postMessage({ type: 'run', id: my, source, params: {}, seed: 1 });
        });
      }
      worker.terminate();
      return out;
    },
    { path: workerPath, list: sources },
  );
}

async function suite(browser: Browser, label: string, url: string, workerPath: string): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
  // tsx keeps function names with an `__name` helper that page.evaluate bodies reference.
  await context.addInitScript({ content: 'globalThis.__name = (f) => f;' });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${url}/play`, { waitUntil: 'domcontentloaded' });
    const sources: Record<string, string> = { normal: FINISH, survey: SURVEY };
    for (const [k, v] of Object.entries(ESCAPES)) sources[k] = v;
    const r = await runInSandbox(page, workerPath, sources);
    log(`[${label}] ${JSON.stringify(r)}`);
    check(r['normal']?.ok === true && r['normal'].parts === 1, `[${label}] a normal generator must still build: ${JSON.stringify(r['normal'])}`);
    for (const [name, outcome] of Object.entries(r)) {
      if (name === 'normal') continue;
      check(outcome.ok === false || name === 'survey', `[${label}] ${name} unexpectedly succeeded`);
      check(!/LEAK/.test(outcome.error ?? ''), `[${label}] sandbox escape "${name}": ${outcome.error}`);
    }
    check(r['survey']?.ok === true, `[${label}] web globals still reachable: ${JSON.stringify(r['survey'])}`);
    log(`[${label}] sandbox: ${Object.keys(ESCAPES).length} escape attempts blocked, normal generator builds`);
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  const worker = readdirSync(join(STUDIO_DIST, 'assets')).find((f) => /^sandbox\.worker-[A-Za-z0-9_-]{4,32}\.js$/.test(f));
  if (!worker) throw new Error('sandbox worker not found in apps/studio/dist/assets — run `npm run build` first.');
  const server = await startServer((l) => log(l));
  try {
    for (const [label, launch] of [
      ['chromium', () => chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] })],
      ['firefox', () => firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } })],
    ] as const) {
      let browser: Browser | null = null;
      try {
        browser = await launch();
        await suite(browser, label, server.url, `/assets/${worker}`);
      } finally {
        await browser?.close();
      }
    }
    log('security e2e: all exploit attempts blocked in Chromium and Firefox');
  } finally {
    await server.stop();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
