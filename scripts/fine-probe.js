/**
 * Probe the small-edit fast path:
 *   npx tsx scripts/fine-probe.ts <world-slug> "<prompt>" ["<prompt>" ...] [@selected-id ...]
 * Prints what it understood, the compact diff, the patches and the time for each prompt
 * (each against the original world). Dev tool, not part of the product.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadCatalog } from '@aether/assets';
import { validateWorld } from '@aether/core';
import { catalog } from '@aether/procgen';
import { diffLineText } from '../packages/agent/src/refine/describe';
import { parseEdit } from '../packages/agent/src/refine/parse';
import { EMPTY_MEMORY, planFineEdit } from '../packages/agent/src/refine/plan';
import { applyPatches } from '@aether/core';
const [name, ...rest] = process.argv.slice(2);
const chain = rest.includes('--chain');
const selection = rest.filter((a) => a.startsWith('@')).map((a) => a.slice(1));
const prompts = rest.filter((a) => !a.startsWith('@') && a !== '--chain').flatMap((a) => (a.startsWith('file:') ? readFileSync(a.slice(5), 'utf8').split('\n').map((l) => l.trim()).filter(Boolean) : [a]));
if (!name || prompts.length === 0) {
    console.error('usage: fine-probe <world-slug> "<prompt>" ... [@selected-id]');
    process.exit(2);
}
const raw = JSON.parse(readFileSync(resolve(process.cwd(), `apps/studio/public/templates/worlds/${name}.json`), 'utf8'));
const v = validateWorld(raw.world ?? raw);
if (!v.ok)
    throw new Error('invalid world');
await loadCatalog();
let current = v.world;
let memory = EMPTY_MEMORY;
for (const prompt of prompts) {
    console.log(`\n=== ${prompt}`);
    console.log('parsed:', JSON.stringify(parseEdit(prompt).commands).slice(0, 400));
    const t0 = performance.now();
    const r = planFineEdit({ world: chain ? current : v.world, text: prompt, selection, memory, catalogs: { generators: catalog() } });
    if (chain) {
        memory = r.memory;
        if (r.kind === 'edit')
            current = applyPatches(current, r.patches).world;
    }
    console.log(`kind=${r.kind} reason=${r.reason ?? ''} ${r.detail ?? ''} (${(performance.now() - t0).toFixed(0)} ms)`);
    if (r.summary)
        console.log('summary:', r.summary);
    for (const l of r.diff.slice(0, 6))
        console.log('  ', diffLineText(l));
    if (r.patches.length > 0)
        console.log('patches:', JSON.stringify(r.patches).slice(0, 300));
    if (r.targets.length > 0 || r.added.length > 0)
        console.log('targets:', r.targets.slice(0, 6).join(', '), 'added:', r.added.join(', '), 'cosmetic:', r.cosmetic);
    if (r.question)
        console.log('question:', r.question.text, r.question.candidates.map((c) => c.id).join(', '));
}
