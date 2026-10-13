import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalAi } from './src/local';
const dataDir = await mkdtemp(join(tmpdir(), 'aether-real-smoke-'));
const local = new LocalAi({ dataDir });
await local.init();
const st = await local.status();
console.log('STATUS', JSON.stringify(st.backends.map((b) => [b.id, b.loggedIn, b.account ?? '', b.models.length])));
const tools = [{ name: 'finish', description: 'Finish with a short message.', inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] } }];
for (const backend of ['codex', 'claude-code'] as const) {
  const t = Date.now();
  try {
    const r = await local.provider(backend, backend === 'codex' ? undefined : 'haiku', 'low').complete({ role: 'planner', system: 'You are a test. Call finish with message "pong".', messages: [{ role: 'user', content: 'ping' }], tools, maxTokens: 200, session: 'p-smoketest1' });
    console.log('COMPLETE', backend, Date.now() - t, 'ms', JSON.stringify(r.content).slice(0, 200), r.model, JSON.stringify(r.usage));
  } catch (e) {
    console.log('COMPLETE-ERR', backend, String(e));
  }
}
console.log('SESSIONS', local.sessions.size);
const t = Date.now();
const job = await local.jobs.enqueueAsset({ kind: 'asset', backend: 'codex', effort: 'low', spec: { id: 'garden-lantern', description: 'a small stone garden lantern (Japanese toro style) with a glowing light chamber' }, budget: { turns: 2, minutes: 10 } });
await new Promise<void>((resolve) => local.jobs.subscribe(job.id, (e) => { if (e) console.log('EV', e.seq, e.phase, e.message.slice(0, 120)); else resolve(); }));
const done = local.jobs.get(job.id);
console.log('JOB', done?.status, done?.error ?? '', done?.result ? `turns=${done.result.turns} passed=${done.result.checkerPassed} usage=${JSON.stringify(done.result.usage)} src=${done.result.def.source.length}` : '', Date.now() - t, 'ms');
local.clearProject('p-smoketest1');
local.dispose();
