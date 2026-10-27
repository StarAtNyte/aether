/**
 * Room-from-photo end-to-end check that costs nothing: the studio talks to `/api/local/*` as on a developer's
 * machine, but the model's answers are scripted (no CLI runs, no quota). The script is what a vision model
 * would send for the hotel bedroom photo, in the order of the staged flow:
 *   three readings of the photo (merged into one description), the object inventory (listed twice), a verdict per
 *   object and per layout statement, then compare round 1 (verdicts, the difference list, a declared repair, the
 *   edit that moves one picture, then finish) and compare round 2 (everything passes, the difference closed, finish).
 * The panel of checklist judges is not scripted (it answers nothing), so the assistant's own verdicts decide, as on
 * a backend without a panel. Everything else is the real product: the "Recreate this image" button, validation of
 * the description, the shell and pieces built through the design tools, renders from the photo's camera with
 * numbered marks, the objective similarity, the repair-order guard, the per-object table, the chat card with the
 * assumptions as chips. Run with the perception layer off and on (its models are not reachable here, so the run
 * falls back to the picture alone).
 *
 *   npm run build && npx tsx tests/e2e/photo.e2e.ts [--chromium] [--firefox] [--out=DIR]
 *
 * With --out the final screenshots (the studio and the photo-camera render) are written there.
 */
import { readFileSync } from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, firefox, type Browser, type Page, type Route } from 'playwright';
import type { WorldDoc } from '@aether/core';
import { loadCatalog } from '@aether/assets';
import { PHOTO_BUILDING_ID } from '@aether/arch/photo';
import { readScene, reviewFindings } from '@aether/arch';
import { CHROME_ARGS, FIREFOX_PREFS, REPO_ROOT, SKIP_FIRST_RUN, findChrome, findFirefox, startServer, type TestServer } from './support/env';

const PHOTO = join(REPO_ROOT, 'tests/fixtures/photo/bedroom-cc0-hotel.jpg');
const DESCRIPTION = JSON.parse(readFileSync(join(REPO_ROOT, 'tests/fixtures/photo/hotel.description.json'), 'utf8')) as unknown;
const TURN_TIMEOUT_MS = 240_000;
const outArg = process.argv.find((a) => a.startsWith('--out='));
const OUT = outArg ? resolve(outArg.slice(6)) : null;

function log(line: string): void {
  process.stdout.write(`${line}\n`);
}
function check(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}
async function waitFor<T>(what: string, timeoutMs: number, probe: () => Promise<T | null | false>): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}
const json = (route: Route, body: unknown, status = 200): Promise<void> => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

interface Block {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
  id?: string;
}
interface Msg {
  role: string;
  content: string | Block[];
}
interface Fake {
  requests: Array<{ step: string; images: number; tools: string[] }>;
  compareRound: number;
  /** Declared repairs and listed differences the scripted model sent. */
  repairs: number;
  differences: number;
  /** The picture the fake model finds too low (named in the checklist: the readings are merged, so ids are not the description's). */
  picture: string;
}

const backend = {
  id: 'codex',
  label: 'Codex',
  installed: true,
  loggedIn: true,
  detail: 'Logged in using ChatGPT',
  account: 'ChatGPT',
  models: [{ id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol', efforts: ['low', 'medium', 'high'], vision: true }],
  defaultModel: 'gpt-6.1-sol',
  busy: 0,
};
const otherBackend = { ...backend, id: 'claude-code', label: 'Claude Code', loggedIn: false, detail: 'Not logged in', models: [{ id: 'sonnet', label: 'Sonnet', vision: true }], defaultModel: 'sonnet' };

function blocks(m: Msg | undefined): Block[] {
  return !m ? [] : typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
}

function checklistText(messages: Msg[]): string {
  const text = messages.flatMap((m) => blocks(m)).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n');
  return text.split('Checklist (answer every id):\n')[1] ?? '';
}

/** The checklist ids named in the first compare message ("- item-bed [structural]: …"). */
function checklistIds(messages: Msg[]): string[] {
  const text = messages.flatMap((m) => blocks(m)).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n');
  const section = text.split('Checklist (answer every id):\n')[1] ?? '';
  return section.split('\n').flatMap((l) => {
    const m = /^- ([a-z0-9-]+)(?: \[structural\])?:/.exec(l);
    return m?.[1] ? [m[1]] : [];
  });
}

function script(req: { messages: Msg[]; tools?: Array<{ name: string }> }, fake: Fake): { content: Block[]; stopReason: string } {
  const names = (req.tools ?? []).map((t) => t.name);
  const id = `t${fake.requests.length + 1}`;
  const last = blocks(req.messages[req.messages.length - 1]);
  const lastText = last.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n');
  const use = (name: string, input: unknown): { content: Block[]; stopReason: string } => ({ content: [{ type: 'tool_use', id, name, input }], stopReason: 'tool_use' });
  const images = last.filter((b) => b.type === 'image').length;
  if (names.length === 1 && names[0] === 'describe_room') {
    fake.requests.push({ step: 'describe', images, tools: names });
    return use('describe_room', { description: DESCRIPTION });
  }
  const ids = checklistIds(req.messages);
  const sawResult = last.some((b) => b.type === 'tool_result');
  if (lastText.includes('COMPARE') || lastText.includes('FINAL CHECK') || !sawResult) {
    fake.compareRound++;
    fake.requests.push({ step: `compare-${fake.compareRound}`, images, tools: names });
    if (!fake.picture) fake.picture = /^- item-([a-z0-9-]+)(?: \[structural\])?: [^\n]*\(art \1\)/m.exec(checklistText(req.messages))?.[1] ?? '';
    const failing = fake.compareRound === 1 && fake.picture ? [`item-${fake.picture}`] : [];
    const verdicts = ids.map((i) => ({ id: i, pass: !failing.includes(i), ...(failing.includes(i) ? { note: 'hangs a little too low' } : {}) }));
    const content: Block[] = [{ type: 'tool_use', id, name: 'report_verdicts', input: { verdicts } }];
    // The staged flow asks for the listed differences first, then a declared repair (cause before edit), then the edit.
    if (names.includes('report_differences')) {
      const diffs = failing.length > 0
        ? [{ id: 'picture-low', kind: 'position', cause: 'geometry', where: 'north wall', what: 'the picture hangs about 0.3 m too low', size: 3 }]
        : [{ id: 'picture-low', kind: 'position', cause: 'geometry', where: 'north wall', what: 'the picture now hangs at the photo height', size: 0, status: 'fixed' }];
      fake.differences++;
      content.push({ type: 'tool_use', id: `${id}d`, name: 'report_differences', input: { differences: diffs } });
    }
    if (failing.length > 0) {
      if (names.includes('declare_repair')) fake.repairs++;
      if (names.includes('declare_repair')) content.push({ type: 'tool_use', id: `${id}r`, name: 'declare_repair', input: { difference: 'picture-low', cause: 'geometry', why: 'the picture is too low on the wall' } });
      content.push({ type: 'tool_use', id: `${id}b`, name: 'edit_items', input: { edits: [{ op: 'move', ref: fake.picture, y: 1.6 }] } });
    } else content.push({ type: 'tool_use', id: `${id}c`, name: 'finish', input: { message: 'Everything matches.' } });
    return { content, stopReason: 'tool_use' };
  }
  // After the edits of a repair round the model sees their results and ends the round.
  fake.requests.push({ step: 'finish', images, tools: names });
  return use('finish', { message: 'done' });
}

interface DescribedItem {
  id: string;
  kind: string;
  label?: string;
  box?: number[];
}

/**
 * The per-object seats (role "critic"): the object inventory (listed twice, once blind), then a verdict per listed
 * object and per layout statement. The inventory is the described pieces that have a box; every object matches.
 */
function critic(req: { messages: Msg[]; tools?: Array<{ name: string }> }, fake: Fake): { content: Block[]; stopReason: string } {
  const name = req.tools?.[0]?.name ?? '';
  const id = `c${fake.requests.length + 1}`;
  const text = req.messages.flatMap((m) => blocks(m)).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n');
  const use = (tool: string, input: unknown): { content: Block[]; stopReason: string } => ({ content: [{ type: 'tool_use', id, name: tool, input }], stopReason: 'tool_use' });
  if (name === 'report_inventory') {
    fake.requests.push({ step: 'inventory', images: 0, tools: [name] });
    const items = ((DESCRIPTION as { items?: DescribedItem[] }).items ?? []).filter((i) => Array.isArray(i.box) && i.box.length === 4);
    return use(name, { items: items.map((i) => ({ id: i.id, kind: i.kind, category: i.kind === 'curtain' ? 'textile' : i.kind === 'art' ? 'decor' : 'furniture', label: i.label ?? i.kind, box: i.box, entity: 'none', confidence: 0.9 })) });
  }
  if (name === 'report_object_judgement') {
    fake.requests.push({ step: 'objects', images: 0, tools: [name] });
    const ids = [...text.matchAll(/^\d+\. id (\S+?):/gm)].map((m) => m[1] as string);
    return use(name, { verdicts: ids.map((i) => ({ id: i, present: 'match', type: 'match', position: 'match', size: 'match', material: 'match', evidence: 'The photo and the render show the same piece in the same place.' })) });
  }
  if (name === 'report_relations') {
    fake.requests.push({ step: 'relations', images: 0, tools: [name] });
    const ids = [...text.matchAll(/^- (\S+?): /gm)].map((m) => m[1] as string);
    return use(name, { relations: ids.map((i) => ({ id: i, ok: true })) });
  }
  fake.requests.push({ step: `other-critic:${name}`, images: 0, tools: [name] });
  return { content: [{ type: 'text', text: '{}' }], stopReason: 'end' };
}

async function installLocalAi(page: Page, fake: Fake): Promise<void> {
  await page.route('**/api/health', async (route) => {
    const res = await route.fetch();
    await json(route, { ...((await res.json()) as Record<string, unknown>), local: true });
  });
  await page.route('**/api/local/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path === '/api/local/status') return json(route, { ok: true, name: 'aether-local', version: '1', backends: [backend, otherBackend], account: null, jobs: 0, login: null });
    if (path === '/api/local/complete') {
      const body = req.postDataJSON() as { request: { role: string; messages: Msg[]; tools?: Array<{ name: string }> } };
      if (body.request.role === 'critic') return json(route, { ...critic(body.request, fake), usage: { inputTokens: 900, outputTokens: 80 }, model: 'gpt-6.1-sol' });
      if (body.request.role !== 'planner') return json(route, { content: [{ type: 'text', text: '{}' }], stopReason: 'end', model: 'gpt-6.1-sol' });
      return json(route, { ...script(body.request, fake), usage: { inputTokens: 1500, outputTokens: 120 }, model: 'gpt-6.1-sol' });
    }
    if (path === '/api/local/accounts') return json(route, { items: [{ id: 'default', label: 'This computer', active: true, signedIn: true, detail: 'Logged in using ChatGPT' }], activeId: 'default', jobs: 0 });
    return json(route, { error: { code: 'not_found', message: 'Unknown endpoint.' } }, 404);
  });
}

interface TurnState {
  busy: boolean;
  status: string | null;
  events: string[];
  entities: number;
  chat: number;
}
function turnState(page: Page): Promise<TurnState | null> {
  return page.evaluate((): TurnState | null => {
    const a = window.__aether;
    if (!a) return null;
    const st = a.store.getState();
    const last = st.chat[st.chat.length - 1];
    const events = last && last.role === 'assistant' ? last.events : [];
    return {
      busy: st.agentBusy,
      status: last && last.role === 'assistant' ? last.status : null,
      events: events.map((e) => (e.type === 'photo' ? `photo:${e.phase}:${e.text.slice(0, 120)}` : e.type === 'error' || e.type === 'notice' ? `${e.type}(${e.text.slice(0, 200)})` : e.type)),
      entities: Object.keys(a.history.current.entities).length,
      chat: st.chat.length,
    };
  });
}
const world = (page: Page): Promise<WorldDoc> => page.evaluate(() => JSON.parse(JSON.stringify(window.__aether?.history.current)) as WorldDoc);

async function photoTurn(browser: Browser, server: TestServer, label: string, perception: 'on' | 'off'): Promise<void> {
  const tag = `[${label}, perception ${perception}]`;
  const fake: Fake = { requests: [], compareRound: 0, picture: '', repairs: 0, differences: 0 };
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
  await ctx.addInitScript({ content: SKIP_FIRST_RUN });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log(`  [pageerror] ${e.message}`));
  try {
    await installLocalAi(page, fake);
    await page.addInitScript((p) => {
      try {
        localStorage.setItem('aether.ai.prefs.v1', JSON.stringify(p.prefs));
        if (p.perception === 'off') localStorage.setItem('aether.perception', 'off');
        else localStorage.removeItem('aether.perception');
      } catch {
        /* storage blocked: the assertions below fail */
      }
    }, { prefs: { mode: 'auto', effort: 'low', refine: 0 }, perception });
    await page.goto(`${server.url}/?debug=1#/new`, { waitUntil: 'domcontentloaded' });
    await waitFor('the editor', 90_000, async () => ((await turnState(page))?.entities ?? 0) > 0);
    const picker = page.getByTestId('model-picker');
    await waitFor('local AI in the model picker', 20_000, async () => (await picker.getAttribute('data-ai-kind')) === 'local' && (await picker.getAttribute('data-ai-status')) === 'ready');

    // Attach the photo; the "Recreate this image" action appears only with a picture.
    check((await page.getByTestId('recreate-image').count()) === 0, `${tag} the recreate button shows without a picture`);
    await page.locator('.composer input[type=file]').setInputFiles(PHOTO);
    await page.getByTestId('recreate-image').waitFor({ state: 'visible', timeout: 20_000 });
    const before = (await turnState(page)) as TurnState;
    await page.getByTestId('recreate-image').click();
    const t = await waitFor('the photo turn', TURN_TIMEOUT_MS, async () => {
      const st = await turnState(page);
      return st && st.chat >= before.chat + 2 && !st.busy && st.status !== null && st.status !== 'streaming' ? st : null;
    });
    check(t.status === 'done', `${tag} the turn ended with ${t.status}: ${t.events.join(' | ')}`);
    check(!t.events.some((e) => e.startsWith('error(')), `${tag} the turn reported an error: ${t.events.join(' | ')}`);
    const steps = fake.requests.map((r) => r.step);
    check(steps[0] === 'describe' && fake.requests[0]?.images === 1, `${tag} the model did not get the photo first: ${steps.join(',')}`);
    // The reads of the photo come first (merged into one description), then the object inventory, then the compare rounds.
    const firstCompare = steps.findIndex((x) => x.startsWith('compare'));
    check(firstCompare > 0 && steps.slice(0, firstCompare).every((x) => x === 'describe' || x === 'inventory' || x === 'objects' || x === 'relations' || x.startsWith('other-critic')), `${tag} unexpected steps before the first compare round: ${steps.join(',')}`);
    const afterFix = steps.slice(steps.indexOf('compare-1'), steps.indexOf('compare-2')).filter((x) => !x.startsWith('other-critic') && x !== 'objects' && x !== 'relations' && x !== 'inventory');
    check(afterFix.join(',') === 'compare-1,finish', `${tag} expected round 1 to fix then finish, got ${steps.join(',')}`);
    check(steps.filter((x) => x === 'inventory').length >= 1, `${tag} the object inventory was never asked: ${steps.join(',')}`);
    const compares = fake.requests.filter((r) => r.step.startsWith('compare'));
    check(compares.length === 2, `${tag} expected exactly two compare rounds (fix, then confirm), got ${steps.join(',')}`);
    check((compares[0]?.images ?? 0) >= 2, `${tag} the first compare round sent ${compares[0]?.images} images, expected the photo and the render`);
    for (const c of compares) {
      for (const tool of ['report_verdicts', 'edit_items', 'report_differences', 'declare_repair', 'stage_gate']) check(c.tools.includes(tool), `${tag} ${c.step} lacks the ${tool} tool: ${c.tools.join(',')}`);
    }
    check(fake.repairs === 1 && fake.differences === 2, `${tag} the scripted model made ${fake.repairs} repair declaration(s) and ${fake.differences} difference list(s), expected 1 and 2`);
    check(t.events.some((e) => e.startsWith('photo:round:1 difference from the photo; largest: picture-low')), `${tag} the difference list was not shown: ${t.events.join(' | ')}`);
    check(t.events.some((e) => e.startsWith('photo:round:Every checklist item matches')), `${tag} the final round did not conclude with every item matching: ${t.events.join(' | ')}`);
    check(t.events.some((e) => e.startsWith('photo:round:Round 2:') && e.includes('17/17')), `${tag} the second round did not judge every item passing: ${t.events.join(' | ')}`);

    const w = await world(page);
    await loadCatalog();
    const scene = readScene(w, PHOTO_BUILDING_ID);
    check(scene, `${tag} no room was built`);
    check(scene.items.filter((i) => i.kind === 'curtain').length === 2, `${tag} curtains: ${scene.items.filter((i) => i.kind === 'curtain').length}`);
    check(scene.items.some((i) => i.kind === 'bed' && i.against?.some((a) => a.compass === 'north')), `${tag} the bed is not against the north wall`);
    const picture = scene.items.find((i) => i.id.endsWith(fake.picture));
    check(picture && Math.abs(picture.y0 - 1.6) < 0.02, `${tag} the fix was not applied to the picture: ${picture?.y0}`);
    const bad = reviewFindings(w, PHOTO_BUILDING_ID).filter((f) => f.severity === 'error');
    check(bad.length === 0, `${tag} the checker found errors: ${JSON.stringify(bad).slice(0, 600)}`);
    check(t.events.some((e) => e.startsWith('photo:described')) && t.events.some((e) => e.startsWith('photo:done')), `${tag} the chat does not show the photo flow: ${t.events.join(' | ')}`);
    await page.getByTestId('photo-adjust').first().waitFor({ state: 'visible', timeout: 10_000 });
    const chips = await page.getByTestId('photo-adjust').count();
    check(chips >= 2, `${tag} expected the assumptions as chips, found ${chips}`);
    // The per-object table: the objects of the photo judged one by one, shown under the final message.
    const toggle = page.getByTestId('objects-toggle').first();
    await toggle.waitFor({ state: 'visible', timeout: 10_000 });
    await toggle.click();
    const rows = await page.getByTestId('objects-table').first().locator('tbody tr').count();
    check(rows >= 3, `${tag} the per-object table shows ${rows} rows`);
    log(`  ✓ ${tag} recreate button → description → shell and ${scene.items.length} pieces by tool calls → ${compares.length} compare rounds with real renders → repair declared, fix applied, final check; ${rows} objects in the table; ${chips} assumption chips`);
    if (OUT) {
      mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: join(OUT, `photo-studio-${label.toLowerCase()}-${perception}.png`) });
      const shot = await page.evaluate(async () => {
        const a = window.__aether as unknown as { simulation?: { screenshot?: () => Promise<string | null> } } | undefined;
        return (await a?.simulation?.screenshot?.()) ?? null;
      });
      if (shot) writeFileSync(join(OUT, `photo-viewport-${label.toLowerCase()}-${perception}.png`), Buffer.from(shot.split(',')[1] ?? '', 'base64'));
    }
  } finally {
    await ctx.close();
  }
}

async function runBrowser(name: string, launch: () => Promise<Browser>, server: TestServer, modes: Array<'on' | 'off'>): Promise<void> {
  log(`\n${name}`);
  let browser: Browser | null = null;
  try {
    browser = await launch();
    for (const m of modes) await photoTurn(browser, server, name, m);
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  let server: TestServer | null = null;
  try {
    server = await startServer((l) => log(l));
    const only = process.argv.slice(2).filter((a) => a.startsWith('--') && !a.startsWith('--out'));
    if (only.length === 0 || only.includes('--chromium')) await runBrowser('Chromium', () => chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] }), server, ['off', 'on']);
    if (only.length === 0 || only.includes('--firefox')) await runBrowser('Firefox', () => firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } }), server, ['on']);
    log('\nphoto e2e passed');
  } finally {
    await server?.stop().catch(() => undefined);
  }
}

main().catch((e: unknown) => {
  console.error(`photo e2e FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
