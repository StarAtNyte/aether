/**
 * Projects home end to end, in Chromium then Firefox (one browser at a
 * time), against the built studio served by the server in mock mode:
 *
 *  1. the home loads with the template gallery (thumbnails decode) and an
 *     empty state;
 *  2. a template creates a project from its saved world and opens the
 *     editor, which autosaves it;
 *  3. back on the home page the project card shows a live thumbnail;
 *  4. rename, duplicate, delete with confirm and Undo from the card menu;
 *  5. export (.aether.json) and import round trip;
 *  6. search, sort by name, list view;
 *  7. projects persist across a reload (IndexedDB);
 *  8. the command palette (Ctrl+K) creates a project from a template;
 *  9. a legacy single-world save is migrated into the first project;
 * 10. phone layout: bottom tab bar on the home page, bottom sheet in the editor.
 *
 * Run: `npm run build && npm run e2e:projects` (`-- --chromium` / `-- --firefox`).
 */
import { readFileSync } from 'node:fs';
import { chromium, firefox, type Browser, type BrowserContext, type Page } from 'playwright';
import { CHROME_ARGS, FIREFOX_PREFS, findChrome, findFirefox, startServer, SKIP_FIRST_RUN } from './support/env';
import { FEATURED_TEMPLATES } from '../../apps/studio/src/lib/examples';

const ARGS = process.argv.slice(2);
const BROWSERS = ARGS.includes('--firefox') ? ['firefox'] : ARGS.includes('--chromium') ? ['chromium'] : ['chromium', 'firefox'];
const TIMEOUT = 120_000;
const BENIGN_CONSOLE: readonly RegExp[] = [/GL Driver Message/i, /GPU stall due to ReadPixels/i, /valid external Instance reference no longer exists/i, /^WebGL warning:/i];

const startedAt = performance.now();
function log(line: string): void {
  process.stdout.write(`[${((performance.now() - startedAt) / 1000).toFixed(1).padStart(6)}s] ${line}\n`);
}

class E2EFailure extends Error {
  override name = 'E2EFailure';
}

function check(cond: unknown, message: string): asserts cond {
  if (!cond) throw new E2EFailure(message);
}

async function waitEditorBuilt(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const a = window.__aether;
    if (!a || a.simulation === null) return false;
    const st = a.store.getState();
    const last = st.chat[st.chat.length - 1];
    return st.loading === null && !st.agentBusy && last?.role === 'assistant' && last.status === 'done';
  }, null, { timeout: TIMEOUT, polling: 250 });
}

async function waitSaved(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__aether?.store.getState().save.status === 'saved', null, { timeout: 20_000, polling: 100 });
}

async function cardTitles(page: Page): Promise<string[]> {
  return page.locator('.card--project .card__title').allTextContents();
}

async function openCardMenu(page: Page, name: string): Promise<void> {
  const card = page.locator('.card--project').filter({ has: page.locator('.card__title').getByText(name, { exact: true }) }).first();
  await card.hover();
  await card.getByRole('button', { name: `Actions for ${name}` }).click();
}

async function homeFlow(page: Page, base: string): Promise<void> {
  // 1. Home with templates and an empty state.
  await page.goto(`${base}/?debug=1#/`);
  await page.getByRole('heading', { name: 'Start from a template' }).waitFor({ timeout: 20_000 });
  const templates = page.locator('.card--template');
  check((await templates.count()) === FEATURED_TEMPLATES.length, `expected ${FEATURED_TEMPLATES.length} featured template cards, got ${await templates.count()}`);
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('.card--template img')].slice(0, 4).every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15_000 });
  await page.getByText('No projects yet').waitFor();
  log(`  home: ${FEATURED_TEMPLATES.length} featured templates with thumbnails, empty state`);

  // 2. Template → editor → built world → autosave.
  await templates.filter({ hasText: 'Lantern Isles' }).click();
  await page.waitForURL(/#\/p\/[a-z0-9]+$/, { timeout: 20_000 });
  await waitEditorBuilt(page);
  const entities = await page.evaluate(() => Object.keys(window.__aether?.history.current.entities ?? {}).length);
  check(entities > 5, `template world has only ${entities} entities`);
  await waitSaved(page);
  // The planner names the world; the project name follows it.
  const built = (await page.evaluate(() => window.__aether?.history.current.name)) ?? '';
  check(built.length > 0 && (await page.getByLabel('Project name').inputValue()) === built, 'top bar does not show the project name');
  log(`  template → editor: "${built}", ${entities} entities, saved`);

  // 3. Back to projects (app menu): the card has a live thumbnail.
  await page.getByRole('button', { name: 'Aether menu' }).click();
  await page.getByRole('menuitem', { name: 'Back to projects' }).click();
  await page.waitForURL(/#\/$/, { timeout: 20_000 });
  await page.locator('.card--project').first().waitFor();
  await page.waitForFunction(() => {
    const img = document.querySelector<HTMLImageElement>('.card--project img');
    return !!img && img.src.startsWith('blob:') && img.complete && img.naturalWidth > 0;
  }, null, { timeout: 20_000 });
  check((await cardTitles(page)).includes(built), `project card missing: ${(await cardTitles(page)).join(', ')}`);
  log('  home: project card with a live thumbnail');

  // 4. Rename, duplicate, delete + undo.
  await openCardMenu(page, built);
  await page.getByRole('menuitem', { name: 'Rename…' }).click();
  const nameInput = page.getByLabel('Project name');
  await nameInput.fill('Treasure beach');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.locator('.card--project .card__title', { hasText: 'Treasure beach' }).waitFor();
  await openCardMenu(page, 'Treasure beach');
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await page.locator('.card--project .card__title', { hasText: 'Treasure beach copy' }).waitFor();
  check((await page.locator('.card--project').count()) === 2, 'duplicate did not add a card');
  await openCardMenu(page, 'Treasure beach copy');
  await page.getByRole('menuitem', { name: 'Delete…' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.card--project').length === 1, null, { timeout: 10_000 });
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.card--project').length === 2, null, { timeout: 10_000 });
  log('  rename, duplicate, delete + undo');

  // 5. Export → import round trip.
  await openCardMenu(page, 'Treasure beach');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Export .aether.json' }).click()]);
  const file = await download.path();
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { format?: string; world?: { name?: string; entities?: Record<string, unknown> } };
  check(parsed.format === 'aether-world' && parsed.world?.name === 'Treasure beach', 'export is not the renamed world');
  check(Object.keys(parsed.world.entities ?? {}).length === entities, 'export lost entities');
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.waitForFunction(() => document.querySelectorAll('.card--project').length === 3, null, { timeout: 10_000 });
  log(`  export ${download.suggestedFilename()} → import: 3 projects`);

  // 6. Search, sort by name, list view (projects page).
  await page.getByLabel('Search projects').fill('copy');
  await page.waitForFunction(() => document.querySelectorAll('.card--project').length === 1, null, { timeout: 5_000 });
  await page.getByLabel('Search projects').fill('');
  await page.goto(`${base}/?debug=1#/projects`);
  await page.locator('.card--project').first().waitFor();
  await page.getByRole('button', { name: /Last updated/ }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Name' }).click();
  const sorted = await cardTitles(page);
  check(JSON.stringify(sorted) === JSON.stringify([...sorted].sort((a, b) => a.localeCompare(b))), `not sorted by name: ${sorted.join(', ')}`);
  await page.getByRole('radio', { name: 'List view' }).click();
  await page.locator('.project-row:not(.project-row--head)').first().waitFor();
  check((await page.locator('.project-row:not(.project-row--head)').count()) === 3, 'list view rows');
  await page.getByRole('radio', { name: 'Grid view' }).click();
  log('  search, sort by name, list view');

  // 7. Persistence across reload.
  await page.reload();
  await page.locator('.card--project').first().waitFor();
  check((await page.locator('.card--project').count()) === 3, 'projects did not persist across a reload');
  log('  projects persist across reload');

  // 8. Command palette → template.
  await page.keyboard.press('Control+k');
  const search = page.getByRole('combobox');
  await search.fill('haunted');
  await page.keyboard.press('Enter');
  await page.waitForURL(/#\/p\/[a-z0-9]+$/, { timeout: 20_000 });
  await waitEditorBuilt(page);
  check((await page.evaluate(() => window.__aether?.history.current.name)) !== 'Untitled world', 'palette template did not build');
  log('  command palette created a project from a template');
}

async function migrationFlow(browser: Browser, base: string, worldText: string, errors: string[]): Promise<void> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript({ content: SKIP_FIRST_RUN });
  try {
    await ctx.addInitScript((text) => {
      if (!localStorage.getItem('aether.studio.projects-migrated.v1')) localStorage.setItem('aether.studio.world.v1', text);
    }, worldText);
    const page = await ctx.newPage();
    watch(page, errors);
    await page.goto(`${base}/?debug=1#/`);
    await page.locator('.card--project', { hasText: 'Legacy island' }).waitFor({ timeout: 20_000 });
    await page.reload();
    await page.locator('.card--project').first().waitFor();
    check((await page.locator('.card--project').count()) === 1, 'legacy world migrated more than once');
    log('  legacy world migrated into a project (once)');
  } finally {
    await ctx.close();
  }
}

async function phoneFlow(browser: Browser, name: string, base: string, errors: string[]): Promise<void> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, ...(name === 'chromium' ? { isMobile: true } : {}) });
  await ctx.addInitScript({ content: SKIP_FIRST_RUN });
  try {
    const page = await ctx.newPage();
    watch(page, errors);
    await page.goto(`${base}/?debug=1#/`);
    await page.locator('.tabbar').waitFor();
    check(!(await page.locator('.sidebar').isVisible()), 'sidebar visible on a phone');
    await page.locator('.card--template', { hasText: 'Chain Reaction' }).click();
    await page.waitForURL(/#\/p\/[a-z0-9]+$/, { timeout: 20_000 });
    await waitEditorBuilt(page);
    await page.locator('.sheet').waitFor();
    check(await page.getByLabel('Prompt', { exact: true }).isVisible(), 'prompt not visible in the phone sheet');
    await page.locator('.sheet__tab', { hasText: 'Objects' }).click();
    await page.locator('.outliner-row').first().waitFor();
    log('  phone: tab bar on home, bottom sheet with prompt and tabs in the editor');
  } finally {
    await ctx.close();
  }
}

function watch(page: Page, errors: string[]): void {
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (!BENIGN_CONSOLE.some((re) => re.test(text))) errors.push(`console.error: ${text.slice(0, 300)}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 300)}`));
}

async function runBrowser(name: string, base: string): Promise<void> {
  let browser: Browser | null = null;
  let ctx: BrowserContext | null = null;
  const errors: string[] = [];
  try {
    browser = name === 'firefox' ? await firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } }) : await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
    log(`${name}`);
    ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    await ctx.addInitScript({ content: SKIP_FIRST_RUN });
    const page = await ctx.newPage();
    watch(page, errors);
    await homeFlow(page, base);
    const world = await page.evaluate(() => JSON.stringify({ ...window.__aether?.history.current, name: 'Legacy island' }));
    await ctx.close();
    ctx = null;
    await migrationFlow(browser, base, world, errors);
    await phoneFlow(browser, name, base, errors);
    check(errors.length === 0, `console/page errors:\n  ${errors.join('\n  ')}`);
    log(`${name} passed`);
  } finally {
    await ctx?.close().catch(() => undefined);
    await browser?.close();
  }
}

const server = await startServer((l) => (l.includes('"level":"error"') ? log(l) : undefined));
try {
  for (const name of BROWSERS) await runBrowser(name, server.url);
  log('PROJECTS E2E PASSED');
} catch (err) {
  log(`PROJECTS E2E FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await server.stop();
}
