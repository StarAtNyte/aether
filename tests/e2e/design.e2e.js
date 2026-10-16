/**
 * AI-first design end-to-end check that costs nothing: the studio talks to
 * `/api/local/*` exactly as it does on a developer's machine, but the model's
 * answers are scripted (no CLI runs, no quota). The script is what a good
 * designer would send; everything else is the real product: the design tools
 * measuring and refusing, the checker, the review loop with real renders and
 * numbered marks from the live viewport, the chat view of the progress.
 *
 *   npm run build && npm run e2e:design
 *
 * Runs in Chromium, then Firefox (one browser at a time):
 *
 * 1. Prompt "a bedroom with a window, a door, a double bed, curtains and
 *    pictures": the model writes a design plan, the shell is built at the
 *    planned positions, the pieces are placed by tool calls, and the checker
 *    (run here, in Node, on the resulting document) finds nothing over the
 *    door or the window and no error at all; the review loop sent the model
 *    rendered views with numbered marks and a legend, the chat shows the
 *    review and it ended approved.
 * 2. A painting is dragged over the window by hand (a deliberately broken
 *    room); the user asks "why is the painting over the window?": the model
 *    looks (query_scene), moves it with edit_items, says what it did, and the
 *    checker finds the room clean again. The model was never asked a fact it
 *    could look up.
 */
import { chromium, firefox } from 'playwright';
import { reviewFindings } from '@aether/arch';
import { CHROME_ARGS, FIREFOX_PREFS, findChrome, findFirefox, startServer, SKIP_FIRST_RUN } from './support/env';
import { BEDROOM_ITEMS, BEDROOM_PLAN, PAINTING_FIX } from './support/design-script';
const TURN_TIMEOUT_MS = 180_000;
const BUILDING = BEDROOM_PLAN.id;
function log(line) {
    process.stdout.write(`${line}\n`);
}
function check(cond, message) {
    if (!cond)
        throw new Error(message);
}
async function waitFor(what, timeoutMs, probe) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const v = await probe();
        if (v)
            return v;
        if (Date.now() > deadline)
            throw new Error(`timed out waiting for ${what}`);
        await new Promise((r) => setTimeout(r, 250));
    }
}
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
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
function blocks(m) {
    if (!m)
        return [];
    return typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
}
/** The scripted designer: replies by what the conversation looks like (the prompt, the step, a review turn). */
function script(messages, fake) {
    const last = blocks(messages[messages.length - 1]);
    const lastText = last.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n');
    const reviewing = lastText.includes('REVIEW round');
    const first = JSON.stringify(messages.find((m) => m.role === 'user' && typeof m.content !== 'string') ?? '');
    const toolCalls = messages.filter((m) => m.role === 'assistant' && blocks(m).some((b) => b.type === 'tool_use')).length;
    const id = `t${fake.requests.length + 1}`;
    const use = (name, input) => ({ content: [{ type: 'text', text: `Using ${name}.` }, { type: 'tool_use', id, name, input }], stopReason: 'tool_use' });
    const step = reviewing ? 'review' : first.includes('why is the painting') ? ['look', 'fix', 'finish'][Math.min(toolCalls, 2)] : ['plan', 'place', 'finish'][Math.min(toolCalls, 2)];
    fake.requests.push({
        step: step ?? 'finish',
        images: last.filter((b) => b.type === 'image').length,
        legend: lastText.includes('Numbers drawn on the images'),
        tools: [],
        reviewText: reviewing ? lastText.slice(0, 600) : '',
    });
    if (reviewing)
        return use('finish', { message: 'Checked every view: nothing covers the door or the window, the bed is centred under the picture, the curtains flank the window.' });
    switch (step) {
        case 'plan':
            return use('design_plan', { plan: BEDROOM_PLAN });
        case 'place':
            return use('place_items', { items: BEDROOM_ITEMS, message: 'Furnish the bedroom' });
        case 'look':
            return use('query_scene', { queries: [{ q: 'wall', room: 'bedroom', wall: 'east' }, { q: 'review' }] });
        case 'fix':
            return use('edit_items', { edits: PAINTING_FIX, message: 'Move the painting off the window' });
        default:
            return use('finish', { message: first.includes('why is the painting') ? 'The painting was hanging over the window on the east wall. I moved it to the north wall above the bed, centred, and the room checks clean.' : 'A calm bedroom: a double bed centred under a picture, nightstands either side, curtains framing the window, a rug and a ceiling light.' });
    }
}
async function installLocalAi(page, fake) {
    await page.route('**/api/health', async (route) => {
        const res = await route.fetch();
        const body = (await res.json());
        await json(route, { ...body, local: true });
    });
    await page.route('**/api/local/**', async (route) => {
        const req = route.request();
        const path = new URL(req.url()).pathname;
        if (path === '/api/local/status')
            return json(route, { ok: true, name: 'aether-local', version: '1', backends: [backend, otherBackend], account: null, jobs: 0, login: null });
        if (path === '/api/local/complete') {
            const body = req.postDataJSON();
            if (body.request.role !== 'planner')
                return json(route, { content: [{ type: 'text', text: '{}' }], stopReason: 'end', model: 'gpt-6.1-sol' });
            const out = script(body.request.messages, fake);
            const rec = fake.requests[fake.requests.length - 1];
            if (rec)
                rec.tools = (body.request.tools ?? []).map((t) => t.name);
            return json(route, { ...out, usage: { inputTokens: 1500, outputTokens: 120 }, model: 'gpt-6.1-sol' });
        }
        if (path === '/api/local/accounts')
            return json(route, { items: [{ id: 'default', label: 'This computer', active: true, signedIn: true, detail: 'Logged in using ChatGPT' }], activeId: 'default', jobs: 0 });
        return json(route, { error: { code: 'not_found', message: 'Unknown endpoint.' } }, 404);
    });
}
function turnState(page) {
    return page.evaluate(() => {
        const a = window.__aether;
        if (!a)
            return null;
        const st = a.store.getState();
        const last = st.chat[st.chat.length - 1];
        const events = last && last.role === 'assistant' ? last.events : [];
        return {
            busy: st.agentBusy,
            status: last && last.role === 'assistant' ? last.status : null,
            events: events.map((e) => (e.type === 'review' ? `review:${e.phase}:${e.text.slice(0, 100)}` : e.type === 'error' || e.type === 'notice' ? `${e.type}(${e.text.slice(0, 200)})` : e.type === 'message' ? `message(${e.text.slice(0, 200)})` : e.type)),
            head: a.history.head,
            entities: Object.keys(a.history.current.entities).length,
            chat: st.chat.length,
        };
    });
}
function world(page) {
    return page.evaluate(() => JSON.parse(JSON.stringify(window.__aether?.history.current)));
}
async function prompt(page, text) {
    const before = (await turnState(page));
    const input = page.getByLabel('Prompt', { exact: true });
    await input.click();
    await input.fill(text);
    await input.press('Enter');
    return waitFor(`the turn "${text.slice(0, 40)}"`, TURN_TIMEOUT_MS, async () => {
        const st = await turnState(page);
        return st && st.chat >= before.chat + 2 && !st.busy && st.status !== null && st.status !== 'streaming' ? st : null;
    });
}
async function designTurns(browser, server, label) {
    const fake = { requests: [] };
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript({ content: SKIP_FIRST_RUN });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => log(`  [pageerror] ${e.message}`));
    if (process.env['E2E_DEBUG'])
        page.on('console', (m) => log(`  [console ${m.type()}] ${m.text().slice(0, 300)}`));
    try {
        await installLocalAi(page, fake);
        await page.addInitScript((p) => {
            try {
                localStorage.setItem('aether.ai.prefs.v1', JSON.stringify(p));
            }
            catch {
                /* storage blocked: the assertions below fail */
            }
        }, { mode: 'auto', effort: 'low', refine: 0 });
        await page.goto(`${server.url}/?debug=1#/new`, { waitUntil: 'domcontentloaded' });
        await waitFor('the editor', 90_000, async () => {
            const s = await turnState(page);
            return s && s.entities > 0 ? s : null;
        });
        const picker = page.getByTestId('model-picker');
        await waitFor('local AI in the model picker', 20_000, async () => (await picker.getAttribute('data-ai-kind')) === 'local' && (await picker.getAttribute('data-ai-status')) === 'ready');
        // 1. Plan first, place by tool calls, review with numbered renders.
        const t1 = await prompt(page, 'A bedroom with a window, a door, a double bed, curtains and pictures on the wall.');
        check(t1.status === 'done', `[${label}] the first turn ended with ${t1.status}: ${t1.events.join(' | ')}`);
        const steps = fake.requests.map((r) => r.step);
        check(steps[0] === 'plan' && steps[1] === 'place', `[${label}] the model did not plan first and place second: ${steps.join(',')}`);
        const w1 = await world(page);
        const f1 = reviewFindings(w1, BUILDING);
        check(f1.filter((f) => f.severity === 'error').length === 0, `[${label}] the checker found errors: ${f1.map((f) => f.message).join('; ')}`);
        check(!f1.some((f) => ['wall_item_on_opening', 'window_blocked', 'doorway_blocked', 'door_blocked'].includes(f.code)), `[${label}] something covers the door or the window: ${f1.map((f) => f.message).join('; ')}`);
        const scene = Object.keys(w1.entities).filter((id) => id.startsWith(`${BUILDING}-`) && w1.entities[id]?.tags.includes('placed'));
        check(scene.length >= 7, `[${label}] expected the placed pieces, found ${scene.length}`);
        const review = fake.requests.find((r) => r.step === 'review');
        check(review, `[${label}] the model was never asked to review: ${steps.join(',')}`);
        check(review.images >= 3, `[${label}] the review sent ${review.images} images, expected the plan and room views (viewport: ${JSON.stringify(await page.evaluate(() => ({ sim: !!window.__aether?.simulation, session: !!window.__aether?.simulation?.session })))})`);
        check(review.legend, `[${label}] the review had no numbered-mark legend: ${review.reviewText}`);
        check(review.tools.includes('query_scene') && review.tools.includes('place_items') && review.tools.includes('design_plan'), `[${label}] the model was not offered the design tools: ${review.tools.join(',')}`);
        check(t1.events.some((e) => e.startsWith('review:checking')) && t1.events.some((e) => e.startsWith('review:approved')), `[${label}] the chat does not show the review: ${t1.events.join(' | ')}`);
        check(t1.events.filter((e) => e.startsWith('patches')).length >= 2, `[${label}] the design and the placements were not committed as steps: ${t1.events.join(' | ')}`);
        await page.getByText(/Checked/).first().waitFor({ state: 'visible', timeout: 10_000 });
        log(`  ✓ [${label}] plan → shell → ${scene.length} pieces placed by tool calls; checker clean; review sent ${review.images} numbered renders and ended approved`);
        // The automatic walkthrough of the new building (the Verified bot) must finish before the next prompt.
        await waitFor('the walkthrough of the new building', 120_000, () => page.evaluate(() => (window.__aether?.store.getState().playtest.status !== 'running' ? true : null)));
        // 2. A painting dragged over the window; the user asks why.
        await page.evaluate((id) => {
            const a = window.__aether;
            if (!a)
                return;
            const e = a.history.current.entities[id];
            if (!e)
                throw new Error(`no ${id}`);
            a.history.commit([{ op: 'update', id, set: { transform: { ...e.transform, position: [4.26, 1.5, 1.9], rotation: [0, -90, 0] } } }], 'Drag the painting over the window', 'user');
        }, `${BUILDING}-picture`);
        const broken = reviewFindings(await world(page), BUILDING).filter((f) => f.severity === 'error');
        check(broken.length > 0, `[${label}] the broken room does not break any check`);
        const before = fake.requests.length;
        const t2 = await prompt(page, 'why is the painting over the window? fix it');
        check(t2.status === 'done', `[${label}] the second turn ended with ${t2.status}: ${t2.events.join(' | ')}`);
        const steps2 = fake.requests.slice(before).map((r) => r.step);
        check(steps2[0] === 'look' && steps2[1] === 'fix', `[${label}] the model did not look then fix: ${steps2.join(',')}`);
        const after = reviewFindings(await world(page), BUILDING);
        check(after.filter((f) => f.severity === 'error').length === 0, `[${label}] the room is still broken: ${after.map((f) => f.message).join('; ')}`);
        check(t2.events.some((e) => e.startsWith('message(') && /moved it/.test(e)), `[${label}] the model did not say what it did: ${t2.events.join(' | ')}`);
        check(!t2.events.some((e) => e.startsWith('error(')), `[${label}] the second turn reported an error: ${t2.events.join(' | ')}`);
        log(`  ✓ [${label}] "why is the painting over the window?": looked, moved it, said so; the checker is clean`);
    }
    finally {
        await ctx.close();
    }
}
async function runBrowser(name, launch, server) {
    log(`\n${name}`);
    let browser = null;
    try {
        browser = await launch();
        await designTurns(browser, server, name);
    }
    finally {
        await browser?.close().catch(() => undefined);
    }
}
async function main() {
    let server = null;
    try {
        server = await startServer((l) => log(l));
        const only = process.argv.slice(2);
        if (only.length === 0 || only.includes('--chromium'))
            await runBrowser('Chromium', () => chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] }), server);
        if (only.length === 0 || only.includes('--firefox'))
            await runBrowser('Firefox', () => firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } }), server);
        log('\ndesign e2e passed');
    }
    finally {
        await server?.stop().catch(() => undefined);
    }
}
main().catch((e) => {
    console.error(`design e2e FAILED: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
});
