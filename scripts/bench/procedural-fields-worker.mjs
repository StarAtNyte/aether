/** Exact noise parity and event-loop gaps: inline generation versus worker warmup. Requires Vite. */
import { chromium, firefox } from 'playwright';
const name = process.env.AETHER_BENCH_BROWSER ?? 'chromium';
const rate = Number(process.env.AETHER_BENCH_CPU_RATE ?? 1);
if (!Number.isFinite(rate) || rate < 1 || rate > 20) throw new Error('Invalid CPU rate');
const base = process.env.AETHER_BENCH_URL ?? 'http://127.0.0.1:5177';
const root = '/@fs' + process.cwd() + '/';
const blocked = process.env.AETHER_BENCH_BLOCK_WORKER === '1';
const browser = await (name === 'firefox' ? firefox.launch() : chromium.launch());
try {
  const page = await browser.newPage(), errors = [], workers = [];
  if (blocked) await page.route('**/procedural-fields.worker*', route => route.abort());
  page.on('pageerror', e => errors.push(e.message));
  page.on('worker', worker => {
    const record = { url: worker.url().split('/').pop(), closed: false };
    workers.push(record); worker.on('close', () => { record.closed = true; });
  });
  if (name === 'chromium') {
    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setCPUThrottlingRate', { rate });
  } else if (rate !== 1) throw new Error('CPU throttling requires Chromium');
  await page.route('**/procedural-fields-probe', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Procedural fields</title>' }));
  await page.goto(base + '/procedural-fields-probe');
  const result = await page.evaluate(async ({ root }) => {
    const fields = await import(root + 'packages/render/src/gpu/procedural-fields.ts');
    const client = await import(root + 'packages/render/src/gpu/procedural-fields-client.ts');
    async function measure(action) {
      let last = performance.now(), maxGap = 0, ticks = 0;
      const timer = setInterval(() => { const t = performance.now(); maxGap = Math.max(maxGap, t - last); last = t; ticks++; }, 0);
      await new Promise(r => setTimeout(r, 10));
      const start = performance.now(), value = await action(), wallMs = performance.now() - start;
      await new Promise(r => setTimeout(r, 10)); clearInterval(timer);
      return { wallMs, maxGap, ticks, value };
    }
    const before = await measure(() => fields.createProceduralFields());
    const after = await measure(() => client.warmProceduralFields());
    const actual = { cloud: fields.cloudNoiseField(false), cirrus: fields.cloudNoiseField(true), material: fields.materialNoiseField() };
    const differences = {};
    for (const key of ['cloud', 'cirrus', 'material']) {
      const a = new Uint8Array(before.value[key].buffer), b = new Uint8Array(actual[key].buffer);
      let count = Math.abs(a.length - b.length);
      for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) count++;
      differences[key] = count;
    }
    const ready = fields.proceduralFieldsReady(), warmed = after.value;
    delete before.value; delete after.value;
    const second = await client.warmProceduralFields();
    return { before, after, ready, warmed, second, differences };
  }, { root });
  await page.waitForTimeout(100);
  console.log(JSON.stringify({ browser: name, cpuRate: rate, blocked, errors, workers, result }, null, 2));
  const lifecycle = blocked ? workers.every(worker => worker.closed) : workers.length === 1 && workers[0].closed;
  if (errors.length || !result.ready || result.warmed !== !blocked || !result.second || !lifecycle || Object.values(result.differences).some(Boolean)) process.exitCode = 1;
} finally { await browser.close(); }
