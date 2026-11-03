/**
 * Placeholder pieces: bare primitives standing in for things the engine can draw properly. A box named "Shipping
 * container", a "Sandbag wall" stacked from boxes, a cylinder called "barrel", an NPC drawn as a capsule: each reads as a
 * grey-box blockout in a finished world, while a built-in generator (or the character library) has the real thing.
 *
 * The check is mechanical: names (an entity's own, or the group it belongs to) are matched against the props the
 * generators cover, and only generators that exist in this build are suggested. Pickups, colliders and blockouts opt out
 * with a tag ("placeholder", "blockout", "collider", "trigger"). It runs in every review round, like the sunk check.
 */
import type { Entity, WorldDoc } from '@aether/core';
import { findingKey, scoreFindings, type Finding } from '@aether/arch';
import { getBuiltinGenerator } from '@aether/procgen';
import type { ReviewSnapshot } from './review';

/** Words in a name and the generator that draws that prop (the first existing generator of each list wins). */
export const PROP_GENERATORS: ReadonlyArray<{ words: RegExp; generators: readonly string[]; what: string }> = [
  { words: /\b(shipping[- ]?)?containers?\b|\bconex\b/, generators: ['shipping-container'], what: 'shipping container' },
  { words: /\bsand ?bags?\b/, generators: ['sandbag-wall'], what: 'sandbag wall' },
  { words: /\b(crates?|ammo ?box(es)?|supply ?box(es)?)\b/, generators: ['crate'], what: 'crate' },
  { words: /\b(barrels?|oil ?drums?|casks?)\b/, generators: ['barrel'], what: 'barrel' },
  { words: /\b(boulders?|rocks?)\b/, generators: ['boulder', 'rock'], what: 'boulder' },
  { words: /\bfences?\b/, generators: ['fence'], what: 'fence' },
  { words: /\b(lamp ?posts?|street ?lights?|street ?lamps?|flood ?lights?|light ?masts?)\b/, generators: ['lamp-post'], what: 'lamp post' },
  { words: /\b(relay|radio ?masts?|radio ?towers?|antennas?|comms? towers?|transmitters?)\b/, generators: ['radio-mast'], what: 'radio mast' },
  { words: /\b(tents?)\b/, generators: ['tent'], what: 'tent' },
  { words: /\b(benches?)\b/, generators: ['bench'], what: 'bench' },
  { words: /\b(pine|spruce|fir|tree)s?\b/, generators: ['tree-spruce', 'tree-pine', 'tree-broadleaf'], what: 'tree' },
];

const OPT_OUT = /^(placeholder|blockout|grey-?box|collider|trigger|hitbox|invisible|marker)$/;
const PRIMITIVE_PARTS = 3;

/** One placeholder: an entity (or a group of primitives) and what should draw it. */
export interface Placeholder {
  id: string;
  name: string;
  kind: 'prop' | 'capsule-person';
  /** Generator to use (props). */
  generator?: string;
  what: string;
  /** Primitive parts the piece is built from (1 for a single primitive). */
  parts: number;
}

/** The generator for a name, or null (only generators that exist in this build). */
export function generatorForName(name: string): { generator: string; what: string } | null {
  const n = name.toLowerCase();
  for (const p of PROP_GENERATORS) {
    if (!p.words.test(n)) continue;
    const g = p.generators.find((id) => getBuiltinGenerator(id) !== undefined);
    if (g) return { generator: g, what: p.what };
  }
  return null;
}

const isPrimitive = (e: Entity): boolean => e.shape.kind === 'primitive';
const optedOut = (e: Entity): boolean => e.tags.some((t) => OPT_OUT.test(t.toLowerCase())) || !e.visible;

/** Find the placeholders of `world`. */
export function findPlaceholders(world: WorldDoc): Placeholder[] {
  const all = Object.values(world.entities);
  const children = new Map<string, Entity[]>();
  for (const e of all) if (e.parent) children.set(e.parent, [...(children.get(e.parent) ?? []), e]);
  const out: Placeholder[] = [];
  for (const e of all) {
    if (optedOut(e)) continue;
    // A person drawn as a capsule: an NPC without a character (a boxed NPC is a machine: a turret, an objective).
    if (e.npc && e.shape.kind === 'primitive' && e.shape.primitive === 'capsule' && !e.character && e.npc.archetype !== 'predator' && e.npc.archetype !== 'prey') {
      out.push({ id: e.id, name: e.name, kind: 'capsule-person', what: 'person', parts: 1 });
      continue;
    }
    if (e.npc || e.character) continue;
    const name = e.name || '';
    if (!name) continue;
    const g = generatorForName(name);
    if (!g) continue;
    if (isPrimitive(e)) {
      if (e.parent) {
        const p = world.entities[e.parent];
        // A part of a group that is itself named after the prop is reported once, for the group.
        if (p && generatorForName(p.name || '')?.generator === g.generator) continue;
      }
      out.push({ id: e.id, name, kind: 'prop', generator: g.generator, what: g.what, parts: 1 });
      continue;
    }
    // A group (no shape of its own) named after the prop and built from primitives.
    if (e.shape.kind === 'none') {
      const parts = (children.get(e.id) ?? []).filter((c) => isPrimitive(c) && !optedOut(c)).length;
      if (parts >= PRIMITIVE_PARTS) out.push({ id: e.id, name, kind: 'prop', generator: g.generator, what: g.what, parts });
    }
  }
  return out;
}

/** The placeholders as review findings: one per generator (props) and one for the capsule people. */
export function placeholderFindings(world: WorldDoc): Finding[] {
  const found = findPlaceholders(world);
  const findings: Finding[] = [];
  const people = found.filter((p) => p.kind === 'capsule-person');
  if (people.length > 0) {
    const ids = people.map((p) => p.id);
    findings.push({
      code: 'placeholder_person',
      severity: 'warning',
      message: `${people.length} character${people.length > 1 ? 's are' : ' is'} drawn as a bare primitive (${ids.slice(0, 8).join(', ')}${ids.length > 8 ? ' …' : ''}): people must be rigged, animated humans.`,
      entities: ids.slice(0, 24),
      fix: 'give each one entity.character from the library (wardrobe, gender, top/bottom colours, hold, gear per role; keep the capsule as the collider)',
    } as Finding);
  }
  const byGen = new Map<string, Placeholder[]>();
  for (const p of found) if (p.kind === 'prop' && p.generator) byGen.set(p.generator, [...(byGen.get(p.generator) ?? []), p]);
  for (const [gen, list] of byGen) {
    const ids = list.map((p) => p.id);
    const stacked = list.filter((p) => p.parts > 1);
    const what = list[0]?.what ?? gen;
    const how = stacked.length > 0 ? `built from ${stacked.reduce((a, p) => a + p.parts, 0)} primitive parts` : 'a bare primitive';
    findings.push({
      code: 'placeholder_prop',
      severity: 'warning',
      message: `${list.length} ${what}${list.length > 1 ? 's are' : ' is'} ${how} (${ids.slice(0, 8).join(', ')}${ids.length > 8 ? ' …' : ''}) where the "${gen}" generator draws a real one.`,
      entities: ids.slice(0, 24),
      fix: `replace the shape with {kind:"procedural", generator:"${gen}", params:{...}} (base at y=0, so set y to the ground; remove the primitive parts of a group), with a different seed per copy; tag it "blockout" if the primitive is deliberate`,
    } as Finding);
  }
  return findings.slice(0, 12);
}

/** `snap` with the placeholders of `world` added to its findings (score and keys follow), so every review round checks them. */
export function withPlaceholders(snap: ReviewSnapshot, world: WorldDoc): ReviewSnapshot {
  let extra: Finding[];
  try {
    extra = placeholderFindings(world);
  } catch {
    return snap;
  }
  if (extra.length === 0) return snap;
  const findings = [...snap.findings.filter((f) => f.code !== 'placeholder_prop' && f.code !== 'placeholder_person'), ...extra];
  return { ...snap, findings, score: scoreFindings(findings), keys: new Set(findings.map(findingKey)) };
}
