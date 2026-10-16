import { describe, expect, it } from 'vitest';
import { RoomDescription, parseRoomDescription, type PhotoItem } from '../src/photo/description';
import { applyReality } from '../src/photo/reality';
import { FURNITURE, WindowParams, buildWindow } from '../src/index';
import { deriveBuild } from '../src/photo/derive';

const kinds = FURNITURE.map((f) => f.kind);

function room(items: unknown[], openings: unknown[] = [], extra: Record<string, unknown> = {}): RoomDescription {
  return RoomDescription.parse({
    footprint: { width: 3.7, depth: 4.5, ceiling: 2.6 },
    camera: { x: 3, z: 4, heading: -30 },
    openings,
    items,
    ...extra,
  });
}

describe('reality priors', () => {
  it('puts sockets and switches at their usual heights and says so', () => {
    const r = applyReality(room([
      { id: 'socket-1', kind: 'switch', label: 'wall socket', wall: 'north', along: 2, bottom: 1.5 },
      { id: 'switch-1', kind: 'switch', label: 'light switch', wall: 'north', along: 1, bottom: 0.2 },
      { id: 'socket-2', kind: 'switch', label: 'power outlet', wall: 'north', along: 3 },
    ]));
    const b = (id: string): number | undefined => r.description.items.find((i) => i.id === id)?.bottom;
    expect(b('socket-1')).toBe(0.5);
    expect(b('switch-1')).toBe(0.9);
    expect(b('socket-2')).toBe(0.3);
    expect(r.fixes.length).toBe(3);
  });

  it('keeps pictures out of the ceiling and within a hanging gap of the piece beneath', () => {
    const r = applyReality(room([
      { id: 'pic', kind: 'art', wall: 'north', along: 2, bottom: 2.2, params: { width: 0.6, height: 0.7 } },
      { id: 'bed', kind: 'bed', wall: 'north', along: 1.9, gap: 0 },
      { id: 'pic2', kind: 'art', wall: 'north', along: 1.2, above: 'bed', aboveGap: 1.4, params: { width: 0.6, height: 0.7 } },
    ]));
    const pic = r.description.items.find((i) => i.id === 'pic');
    expect((pic?.bottom ?? 9) + 0.7).toBeLessThanOrEqual(2.6 - 0.2 + 1e-9);
    expect(r.description.items.find((i) => i.id === 'pic2')?.aboveGap).toBe(0.7);
  });

  it('builds a palm for fronds, a small one for a single frond, and sizes plants to the room', () => {
    const r = applyReality(room([
      { id: 'frond', kind: 'plant', label: 'palm frond in the corner', wall: 'east', along: 4, params: { species: 'fig', height: 1.4 } },
      { id: 'tall', kind: 'plant', label: 'tall plant', at: [1, 1], params: { height: 2.4 } },
    ]));
    const f = r.description.items.find((i) => i.id === 'frond');
    expect(f?.params['species']).toBe('palm');
    expect(f?.params['height']).toBe(1.4);
    const single = applyReality(room([{ id: 'x', kind: 'plant', label: 'a single frond cutting', at: [1, 1], params: { height: 1.2 } }]));
    expect(single.description.items[0]?.params['height']).toBe(0.6);
    expect(r.description.items.find((i) => i.id === 'tall')?.params['height']).toBe(2.2);
  });

  it('reads the photo words: four-poster, quilted headboard, floral duvet, wire side table', () => {
    const r = applyReality(room([
      { id: 'bed', kind: 'bed', label: 'four-poster bed with a tufted headboard and floral duvet', wall: 'north', along: 1.9, gap: 0 },
      { id: 'side', kind: 'nightstand', label: 'white wire side table with a round tray top', wall: 'north', along: 3.4, gap: 0 },
    ]));
    const bed = r.description.items[0];
    expect(bed?.params).toMatchObject({ canopy: true, headboardStyle: 'tufted', pattern: 'floral' });
    expect(r.description.items[1]?.params['style']).toBe('wire');
    // No throw described: it takes the linen colour (the part's own is brown); a described one is kept.
    expect(bed?.params['throw']).toBe('#f1eee8');
    const kept = applyReality(room([{ id: 'bed', kind: 'bed', wall: 'north', along: 1.9, params: { linen: '#eeeeee', throw: '#112233' } }]));
    expect(kept.description.items[0]?.params['throw']).toBe('#112233');
    const tinted = applyReality(room([{ id: 'bed', kind: 'bed', wall: 'north', along: 1.9, params: { linen: '#eeeeee' } }]));
    expect(tinted.description.items[0]?.params['throw']).toBe('#eeeeee');
    // A model's own choice is never overridden.
    const own = applyReality(room([{ id: 'bed', kind: 'bed', label: 'floral bed', wall: 'north', along: 1.9, params: { pattern: 'plain' } }]));
    expect(own.description.items[0]?.params['pattern']).toBe('plain');
  });

  it('moves pieces that stand in each other apart along their wall, the smaller one', () => {
    const r = applyReality(room([
      { id: 'bed', kind: 'bed', wall: 'north', along: 1.9, gap: 0 },
      { id: 'ns', kind: 'nightstand', wall: 'north', along: 2.5, gap: 0 },
    ]));
    const bed = r.description.items.find((i) => i.id === 'bed');
    const ns = r.description.items.find((i) => i.id === 'ns');
    expect(bed?.along).toBe(1.9);
    expect((ns?.along ?? 0) - (bed?.along ?? 0)).toBeGreaterThanOrEqual(1.72 / 2 + 0.48 / 2 + 0.03 - 0.011);
    expect(r.fixes.some((f) => f.includes('stood in another piece'))).toBe(true);
    // Pieces that do not overlap are left alone.
    const ok = applyReality(room([
      { id: 'bed', kind: 'bed', wall: 'north', along: 1.9, gap: 0 },
      { id: 'ns', kind: 'nightstand', wall: 'north', along: 3.2, gap: 0 },
    ]));
    expect(ok.description.items.find((i) => i.id === 'ns')?.along).toBe(3.2);
  });

  it('leaves a piece in place when it cannot be moved clear of its wall', () => {
    const r = applyReality(room([
      { id: 'a', kind: 'wardrobe', wall: 'north', along: 1.85, gap: 0, params: { width: 3.6 } },
      { id: 'b', kind: 'wardrobe', wall: 'north', along: 1.85, gap: 0, params: { width: 3.4 } },
    ]));
    expect(r.description.items.map((i) => i.along)).toEqual([1.85, 1.85]);
  });

  it('repairs openings: floor-length windows, absurd door heights, windows that end below a window head', () => {
    const r = applyReality(room([], [
      { id: 'w1', kind: 'window', wall: 'west', along: 2, width: 1.2, height: 2, sill: 0.03 },
      { id: 'w2', kind: 'window', wall: 'east', along: 2, width: 1, height: 0.4, sill: 0.2 },
      { id: 'd1', kind: 'door', wall: 'south', along: 1, width: 0.9, height: 3.4 },
    ]));
    expect(r.description.openings[0]?.sill).toBe(0);
    expect(r.description.openings[1]?.height).toBe(1.2);
    expect(r.description.openings[2]?.height).toBeLessThanOrEqual(2.5);
  });

  it('keeps a bed out of the corner and bounds the eye height', () => {
    const r = applyReality(room([{ id: 'bed', kind: 'bed', wall: 'north', along: 3.5, gap: 0 }], [], { camera: { x: 3, z: 4, heading: 0, height: 2.4 } }));
    expect(r.description.items[0]?.along).toBeCloseTo(3.7 - (1.6 + 0.12) / 2, 2);
    expect(r.description.camera.height).toBe(2.1);
  });

  it('builds a TV that stands on nothing as a wall-mounted one, and keeps one that stands on its cabinet', () => {
    const r = applyReality(room([
      { id: 'cab', kind: 'sideboard', wall: 'west', along: 1, gap: 0 },
      { id: 'tv-a', kind: 'tv-set', on: 'cab', params: { inches: 22 } },
      { id: 'tv-b', kind: 'tv-set', wall: 'east', along: 2, bottom: 0.2, params: { inches: 120 } },
      { id: 'tv-c', kind: 'tv-set', on: 'missing', wall: 'east', along: 3 },
    ]));
    const k = (id: string): PhotoItem | undefined => r.description.items.find((i) => i.id === id);
    expect(k('tv-a')?.kind).toBe('tv-set');
    expect(k('tv-b')?.kind).toBe('tv');
    expect(k('tv-b')?.bottom).toBe(0.6);
    expect(k('tv-b')?.params['inches']).toBe(100);
    expect(k('tv-c')?.kind).toBe('tv');
    expect(k('tv-c')?.bottom).toBe(1);
  });

  it('lights the daylight beyond a glowing window: described glow becomes an emissive pane outside the glass', () => {
    const d = applyReality(room([], [{ id: 'w1', kind: 'window', wall: 'west', along: 2, width: 1.2, height: 2, sill: 0.5, note: 'tall sash window with sunlit street glowing behind' }, { id: 'w2', kind: 'window', wall: 'east', along: 2, width: 1.2, height: 1.2, sill: 0.9, note: 'small window' }])).description;
    expect(d.openings[0]?.glow).toBe(true);
    expect(d.openings[1]?.glow).toBeUndefined();
    const plan = deriveBuild(d).plan;
    const ops = plan.levels[0]!.openings;
    expect(ops.find((o) => o.id === 'w1')).toMatchObject({ daylight: '#fff4e2' });
    expect(ops.find((o) => o.id === 'w2')?.daylight).toBeUndefined();
    const emissive = (p: ReturnType<typeof buildWindow>): number => p.parts.filter((x) => (x.material as { emissive?: string }).emissive !== undefined).length;
    expect(emissive(buildWindow(WindowParams.parse({ daylight: '#ffeecc' })))).toBe(1);
    expect(emissive(buildWindow(WindowParams.parse({})))).toBe(0);
    // The pane sits behind the glass, on the outdoor side, inside the wall's thickness.
    const pane = buildWindow(WindowParams.parse({ daylight: '#ffeecc', interior: 'b', wallThickness: 0.28 })).parts.find((x) => (x.material as { emissive?: string }).emissive !== undefined)!;
    const zs = Array.from({ length: pane.positions.length / 3 }, (_, i) => pane.positions[i * 3 + 2] as number);
    expect(Math.max(...zs)).toBeLessThan(0);
    expect(Math.min(...zs)).toBeGreaterThan(-0.14);
  });

  it('runs inside parseRoomDescription and is reported as fixes, with synonyms for sockets', () => {
    const parsed = parseRoomDescription(
      {
        footprint: { width: 3.7, depth: 4.5, ceiling: 2.6 },
        camera: { x: 3, z: 4, heading: -30 },
        items: [{ id: 'socket', kind: 'socket', wall: 'north', along: 1, bottom: 1.6 }],
      },
      kinds,
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.items[0]?.kind).toBe('switch');
      expect(parsed.value.items[0]?.bottom).toBe(0.5);
      expect(parsed.fixes.length).toBeGreaterThanOrEqual(2);
    }
  });
});
