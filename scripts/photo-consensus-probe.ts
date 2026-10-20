/**
 * Merge recorded reads of one photo and print what the consensus keeps (no model calls).
 *
 *   npx tsx scripts/photo-consensus-probe.ts <file.json> [<file.json> ...]
 *
 * Each file is a description (`RoomDescription` JSON) or a recorded transcript (`*.transcript.json`, its describe_room
 * calls are used). Prints each read's pieces, the clusters with their support, and the consensus checklist.
 */
import { readFileSync } from 'node:fs';
import { buildChecklist, clusterReads, consensusDescription, parseRoomDescription, type RoomDescription } from '@aether/arch/photo';
import { partKinds } from '@aether/arch';

function readsOf(file: string): RoomDescription[] {
  const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const out: RoomDescription[] = [];
  const add = (v: unknown): void => {
    const p = parseRoomDescription(v, partKinds());
    if (p.ok) out.push(p.value);
    else console.error(`${file}: ${p.error}`);
  };
  if (raw && typeof raw === 'object' && 'responses' in raw && Array.isArray((raw as { responses: unknown }).responses)) {
    for (const r of (raw as { responses: Array<{ content?: Array<{ type: string; name?: string; input?: { description?: unknown } }> }> }).responses) {
      for (const b of r.content ?? []) if (b.type === 'tool_use' && b.name === 'describe_room' && b.input) add(b.input.description);
    }
  } else add(raw);
  return out;
}

const reads = process.argv.slice(2).flatMap(readsOf);
if (reads.length === 0) {
  console.error('no reads');
  process.exit(1);
}
const clusters = clusterReads(reads);
const res = consensusDescription(clusters, partKinds());
console.log(`reads: ${clusters.reads.map((d) => `${d.items.length} pieces / ${d.openings.length} openings`).join(', ')}; rotations ${clusters.rotations.join(',')}`);
for (const c of res.report.items) console.log(`  ${c.kept ? 'kept' : 'drop'} ${c.support}/${res.report.reads} ${c.key} ${c.kind} ${c.id ?? ''} (${c.where})`);
for (const c of res.report.openings) console.log(`  ${c.kept ? 'kept' : 'drop'} ${c.support}/${res.report.reads} ${c.key} ${c.kind} ${c.id ?? ''} (${c.where})`);
if (!res.ok) {
  console.error(`consensus refused: ${res.error}`);
  process.exit(1);
}
console.log(`consensus: ${res.description.footprint.width} x ${res.description.footprint.depth} m, ${res.description.items.length} pieces, ${res.description.openings.length} openings`);
for (const c of buildChecklist(res.description)) console.log(`  - ${c.id}: ${c.text}`);
if (res.fixes.length > 0) console.log(`repairs: ${res.fixes.join('; ')}`);
