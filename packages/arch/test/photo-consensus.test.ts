import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildChecklist,
  clusterReads,
  consensusDescription,
  contested,
  frameRotation,
  kindClass,
  majority,
  medianOf,
  medoidColour,
  modeOf,
  parseRoomDescription,
  rotateDescription,
  rotatePoint,
  rotateWall,
  type PhotoItem,
  type RoomDescription,
} from '../src/photo/index';
import { partKinds } from '../src/index';

const FIXTURE = resolve(__dirname, '../../../tests/fixtures/photo/hotel.description.json');
const base = (): RoomDescription => {
  const p = parseRoomDescription(JSON.parse(readFileSync(FIXTURE, 'utf8')) as unknown, partKinds());
  if (!p.ok) throw new Error(p.error);
  return p.value;
};
const kinds = partKinds();

/** A read of the photo: the fixture with the changes a different read makes. */
function read(edit: (d: RoomDescription) => void): RoomDescription {
  const d = structuredClone(base());
  edit(d);
  const p = parseRoomDescription(d, kinds);
  if (!p.ok) throw new Error(p.error);
  return p.value;
}
const item = (d: RoomDescription, id: string): PhotoItem => {
  const it = d.items.find((x) => x.id === id);
  if (!it) throw new Error(`no ${id}`);
  return it;
};

/** Three reads that disagree the way live reads do: positions, sizes, colours, an extra and a missing piece, a room size. */
function divergent(): RoomDescription[] {
  const a = read((d) => {
    item(d, 'bed').along = 2.45;
    item(d, 'bed').params['linen'] = '#f6f2ea';
    // Only this read sees a plant in the corner.
    d.items.push({ id: 'plant', kind: 'plant', label: 'small plant', wall: 'west', along: 0.3, gap: 0.05, params: {}, visible: true, confidence: 0.4, box: [0.14, 0.7, 0.2, 0.95] });
  });
  const b = read((d) => {
    item(d, 'bed').along = 2.75;
    item(d, 'bed').params['linen'] = '#f3efe5';
    d.footprint.width = 3.9;
    // This read misses the TV.
    d.items = d.items.filter((x) => x.id !== 'tv');
  });
  const c = read((d) => {
    item(d, 'bed').along = 2.55;
    item(d, 'bed').params['linen'] = '#cfc8b8';
    d.footprint.width = 3.5;
    // This read names the side table a coffee table (same class) and gives a wrong kind for the floor lamp's wall.
    const s = item(d, 'side-table');
    s.kind = 'coffee-table';
    s.params = {};
  });
  return [a, b, c];
}

describe('reconciling independent reads of one photo', () => {
  it('helpers: median, mode with first-seen ties, the CIEDE2000 medoid, the majority, kind classes', () => {
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([4, 1, 2, 3])).toBe(2.5);
    expect(medianOf([])).toBeNull();
    expect(modeOf(['a', 'b', 'b', 'a', 'c'])).toBe('a');
    expect(modeOf(['x', 'y', 'y'])).toBe('y');
    // The medoid is a colour one read gave: the one nearest the others, not an average no read saw.
    expect(medoidColour(['#ffffff', '#f4f4f4', '#202020'])).toBe('#f4f4f4');
    expect(majority(1)).toBe(1);
    expect(majority(2)).toBe(2);
    expect(majority(3)).toBe(2);
    expect(majority(5)).toBe(3);
    expect(kindClass('nightstand')).toBe(kindClass('coffee-table'));
    expect(kindClass('bed')).toBe('bed');
  });

  it('a quarter turn of the frame maps walls, plan points, the room size and the camera consistently', () => {
    expect(rotateWall('west', 1)).toBe('north');
    expect(rotateWall('north', 3)).toBe('west');
    // A point 0.5 m from the west wall and 1 m from the north wall of a 4 x 3 room: after one turn the west wall is
    // north (so 0.5 m from it) and the north wall is east (so 1 m from it, in a 3 x 4 room).
    const r = rotatePoint([0.5, 1], 4, 3, 1);
    expect(r.p).toEqual([2, 0.5]);
    expect([r.W, r.D]).toEqual([3, 4]);
    expect(rotatePoint([0.5, 1], 4, 3, 4).p).toEqual([0.5, 1]);
    const d = base();
    const back = rotateDescription(rotateDescription(d, 1), 3);
    expect(back.footprint).toEqual(d.footprint);
    expect(back.items.map((i) => [i.wall, i.along])).toEqual(d.items.map((i) => [i.wall, i.along]));
    expect(back.camera.x).toBeCloseTo(d.camera.x, 9);
    expect(back.camera.z).toBeCloseTo(d.camera.z, 9);
    expect(((back.camera.heading - d.camera.heading) % 360 + 360) % 360).toBe(0);
  });

  it('finds the frame of a read that named the walls differently, from where things appear in the photo', () => {
    const d = base();
    expect(frameRotation(d, rotateDescription(d, 1))).toBe(3);
    expect(frameRotation(d, rotateDescription(d, 2))).toBe(2);
    expect(frameRotation(d, d)).toBe(0);
  });

  it('keeps what a majority saw, drops what one read saw, and takes the median position and the medoid colour', () => {
    const res = consensusDescription(clusterReads(divergent()), kinds);
    if (!res.ok) throw new Error(res.error);
    const d = res.description;
    // The plant (1 of 3) is out; the TV (2 of 3) is in; the side table read as two kinds is one piece.
    expect(d.items.some((i) => i.kind === 'plant')).toBe(false);
    expect(d.items.some((i) => i.kind === 'tv-set')).toBe(true);
    expect(d.items.filter((i) => kindClass(i.kind) === 'side-table')).toHaveLength(2);
    expect(d.items).toHaveLength(11);
    const plant = res.report.items.find((c) => c.kind === 'plant');
    expect(plant).toMatchObject({ support: 1, kept: false });
    // The room width is the median of 3.7, 3.9 and 3.5; the bed sits at the median FRACTION of its wall.
    expect(d.footprint.width).toBe(3.7);
    const bed = d.items.find((i) => i.kind === 'bed');
    expect(bed?.wall).toBe('north');
    const fractions = [2.45 / 3.7, 2.75 / 3.9, 2.55 / 3.5].sort((x, y) => x - y);
    expect(bed?.along).toBeCloseTo((fractions[1] as number) * 3.7, 2);
    // The linen colour is one a read gave (the one nearest the other two), never an average.
    expect(['#f6f2ea', '#f3efe5']).toContain(bed?.params['linen']);
    // References follow the canonical ids: the lamp stands on the merged nightstand, the TV on the merged cabinet.
    const lamp = d.items.find((i) => i.kind === 'table-lamp');
    expect(d.items.find((i) => i.id === lamp?.on)?.kind).toBe('nightstand');
    const tv = d.items.find((i) => i.kind === 'tv-set');
    expect(d.items.find((i) => i.id === tv?.on)?.kind).toBe('sideboard');
    const curtain = d.items.find((i) => i.kind === 'curtain');
    expect(d.openings.map((o) => o.id)).toContain(curtain?.opening);
    // Canonical ids in photo order.
    expect(d.items.filter((i) => i.kind === 'art').map((i) => i.id)).toEqual(['art-1', 'art-2']);
    expect(d.openings.map((o) => o.id)).toEqual(['window-1']);
  });

  it('brings reads in another frame into one frame before voting', () => {
    const [a, b, c] = divergent() as [RoomDescription, RoomDescription, RoomDescription];
    const straight = consensusDescription(clusterReads([a, b, c]), kinds);
    const turned = consensusDescription(clusterReads([a, rotateDescription(b, 1), rotateDescription(c, 3)]), kinds);
    if (!straight.ok || !turned.ok) throw new Error('refused');
    const walls = (d: RoomDescription): string[] => d.items.map((i) => `${i.id}:${i.wall ?? '-'}`).sort();
    // The anchor read may differ, so compare what does not depend on which frame wins: the same pieces on walls that
    // relate to each other the same way, and the same window.
    expect(turned.description.items.map((i) => i.id).sort()).toEqual(straight.description.items.map((i) => i.id).sort());
    const rel = (d: RoomDescription): string[] => {
      const win = d.openings[0]?.wall ?? 'north';
      const order = ['north', 'east', 'south', 'west'];
      return d.items.filter((i) => i.wall).map((i) => `${i.id}:${(order.indexOf(i.wall as string) - order.indexOf(win) + 4) % 4}`).sort();
    };
    expect(rel(turned.description)).toEqual(rel(straight.description));
    expect(walls(straight.description).length).toBe(11);
  });

  it('is deterministic and independent of the order the reads arrive in; the checklist follows the consensus exactly', () => {
    const reads = divergent();
    const one = consensusDescription(clusterReads(reads), kinds);
    const again = consensusDescription(clusterReads(reads.map((r) => structuredClone(r))), kinds);
    const shuffled = consensusDescription(clusterReads([reads[2], reads[0], reads[1]] as RoomDescription[]), kinds);
    if (!one.ok || !again.ok || !shuffled.ok) throw new Error('refused');
    expect(JSON.stringify(again.description)).toBe(JSON.stringify(one.description));
    expect(JSON.stringify(shuffled.description)).toBe(JSON.stringify(one.description));
    expect(buildChecklist(shuffled.description)).toEqual(buildChecklist(one.description));
    // The same consensus always gives the same checklist (and a JSON round trip of it too).
    const round = parseRoomDescription(JSON.parse(JSON.stringify(one.description)) as unknown, kinds);
    if (!round.ok) throw new Error(round.error);
    expect(buildChecklist(round.value)).toEqual(buildChecklist(one.description));
  });

  it('a reconciliation choice adds a contested piece some read saw and removes a non-unanimous one, never a unanimous one', () => {
    const clusters = clusterReads(divergent());
    const first = consensusDescription(clusters, kinds);
    const disputed = contested(first.report);
    const plant = disputed.add.find((c) => c.kind === 'plant');
    const tv = disputed.remove.find((c) => c.kind === 'tv-set');
    const bed = first.report.items.find((c) => c.kind === 'bed');
    expect(plant).toBeDefined();
    expect(tv).toBeDefined();
    expect(disputed.remove.some((c) => c.kind === 'bed')).toBe(false);
    const res = consensusDescription(clusters, kinds, { add: [plant?.key ?? ''], remove: [tv?.key ?? '', bed?.key ?? ''] });
    if (!res.ok) throw new Error(res.error);
    expect(res.description.items.some((i) => i.kind === 'plant')).toBe(true);
    expect(res.description.items.some((i) => i.kind === 'tv-set')).toBe(false);
    expect(res.description.items.some((i) => i.kind === 'bed')).toBe(true);
  });

  it('drops a piece whose host was left out, and reports it', () => {
    const reads = divergent().map((d, k) => (k === 0 ? d : { ...d, items: d.items.filter((i) => i.id !== 'nightstand') }));
    // Two reads lost the nightstand, but all three put the lamp on it.
    const res = consensusDescription(clusterReads(reads), kinds);
    if (!res.ok) throw new Error(res.error);
    expect(res.description.items.some((i) => i.kind === 'table-lamp' && i.on === undefined)).toBe(false);
    expect(res.report.orphans.length).toBeGreaterThanOrEqual(1);
  });

  it('one read is passed through as it is (ids made canonical)', () => {
    const d = base();
    const res = consensusDescription(clusterReads([d]), kinds);
    if (!res.ok) throw new Error(res.error);
    expect(res.description.items).toHaveLength(d.items.length);
    expect(res.description.footprint).toEqual(d.footprint);
    expect(res.report.items.every((c) => c.kept && c.support === 1)).toBe(true);
  });
});
