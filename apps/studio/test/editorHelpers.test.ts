import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { History, validateWorld, type WorldDoc } from '@aether/core';
import { createStarterWorld } from '../src/lib/starterWorld';
import { PALETTE_ITEMS, PALETTE_SECTIONS, paletteEntity, paletteItem, uniqueEntityId } from '../src/lib/palette';
import { dataUrlToBlob, fitThumbnail } from '../src/lib/thumbnail';
import { checkReferenceBytes, checkReferenceFile, fitWithin, MAX_REFERENCE_BYTES } from '../src/lib/images';
import { worldLabels } from '../src/lib/labels';
import { axisDirections, MAX_LABELS, projectPoint } from '../src/engine/viewOverlay';
import { shortcut, isApplePlatform } from '../src/lib/keys';
import { humanize } from '../src/components/fields';
import { InputController } from '../src/engine/input';
import { TEMPLATES, templateBySlug, templateThumbnail, SUGGESTION_CHIPS } from '../src/lib/examples';
import { MAX_THUMBNAIL_BYTES } from '../src/projects/model';

function emptyWorld(): WorldDoc {
  const r = validateWorld({ name: 'T' });
  if (!r.ok) throw new Error('invalid');
  return r.world;
}

describe('object palette', () => {
  it('has unique ids, known sections, and every item commits as a valid entity', () => {
    expect(new Set(PALETTE_ITEMS.map((p) => p.id)).size).toBe(PALETTE_ITEMS.length);
    const sections = new Set(PALETTE_SECTIONS.map((s) => s.id));
    const history = new History(emptyWorld());
    for (const item of PALETTE_ITEMS) {
      expect(sections.has(item.section)).toBe(true);
      const entity = paletteEntity(item, history.current, [2, 0, -3]);
      const r = history.commit([{ op: 'add', entity }], `add ${item.id}`, 'user');
      expect(r.errors, item.id).toEqual([]);
    }
    expect(Object.keys(history.current.entities)).toHaveLength(PALETTE_ITEMS.length);
  });

  it('places items on the ground at the target point with unique ids', () => {
    const box = paletteItem('box');
    if (!box) throw new Error('missing box');
    const w = emptyWorld();
    const e = paletteEntity(box, w, [1, 0, 1]);
    expect(e.transform?.position).toEqual([1, 0.5, 1]);
    const world = { entities: { box: {}, 'box-2': {} } } as unknown as WorldDoc;
    expect(uniqueEntityId(world, 'box')).toBe('box-3');
    expect(uniqueEntityId(emptyWorld(), '!!!')).toBe('object');
    expect(uniqueEntityId(emptyWorld(), 'Lamp Post')).toBe('lamp-post');
    const light = paletteItem('point-light');
    if (light) expect(paletteEntity(light, w, [0, 0, 0]).transform?.position).toEqual([0, 2, 0]);
  });
});

describe('thumbnails', () => {
  it('decodes only allowlisted base64 image data URLs within budget', () => {
    const b = dataUrlToBlob('data:image/webp;base64,AAECAw==');
    expect(b?.size).toBe(4);
    expect(b?.type).toBe('image/webp');
    expect(dataUrlToBlob('data:image/svg+xml;base64,AAAA')).toBeNull();
    expect(dataUrlToBlob('data:text/html;base64,AAAA')).toBeNull();
    expect(dataUrlToBlob('data:image/png;base64,***')).toBeNull();
    expect(dataUrlToBlob(`data:image/png;base64,${'A'.repeat(MAX_THUMBNAIL_BYTES * 4)}`)).toBeNull();
    expect(dataUrlToBlob(42 as unknown as string)).toBeNull();
  });
  it('checks the stored-size budget', () => {
    expect(fitThumbnail(new Blob([new Uint8Array(10)]))).toBe(true);
    expect(fitThumbnail(new Blob([]))).toBe(false);
    expect(fitThumbnail(new Blob([new Uint8Array(MAX_THUMBNAIL_BYTES + 1)]))).toBe(false);
  });
  it('ships one template thumbnail path per template', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(9);
    for (const t of TEMPLATES) expect(existsSync(fileURLToPath(new URL(`../public${templateThumbnail(t.slug)}`, import.meta.url))), t.slug).toBe(true);
    expect(templateThumbnail('coin-island')).toBe('/templates/coin-island.webp');
    expect(templateBySlug('domino-run')?.title).toBe('Domino run');
    expect(templateBySlug('../etc')).toBeUndefined();
    expect(SUGGESTION_CHIPS.length).toBeGreaterThan(0);
  });
});

describe('reference images', () => {
  it('accepts PNG/JPEG/WebP within the size cap only', () => {
    expect(checkReferenceFile({ type: 'image/png', size: 100 })).toBeNull();
    expect(checkReferenceFile({ type: 'image/svg+xml', size: 100 })).toMatch(/PNG/);
    expect(checkReferenceFile({ type: 'image/jpeg', size: 0 })).toMatch(/empty/);
    expect(checkReferenceFile({ type: 'image/webp', size: MAX_REFERENCE_BYTES + 1 })).toMatch(/large/);
    // The header is read before any decode: a tiny PNG declaring 60000 x 60000 px is a decompression bomb.
    const png = (w: number, h: number): Uint8Array => {
      const b = new Uint8Array(33);
      b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
      new DataView(b.buffer).setUint32(16, w);
      new DataView(b.buffer).setUint32(20, h);
      return b;
    };
    expect(checkReferenceBytes(png(1920, 1080))).toBeNull();
    expect(checkReferenceBytes(png(60000, 60000))).toMatch(/too large/);
    expect(checkReferenceBytes(png(10000, 10000))).toMatch(/megapixels/);
    expect(checkReferenceBytes(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toMatch(/PNG/);
  });
  it('downscales to the longest edge without upscaling', () => {
    expect(fitWithin(4000, 2000)).toEqual({ width: 1024, height: 512 });
    expect(fitWithin(300, 200)).toEqual({ width: 300, height: 200 });
    expect(fitWithin(0, 10)).toEqual({ width: 0, height: 0 });
  });
});

describe('viewport labels and gizmo maths', () => {
  it('labels top-level visible things, most important first, capped', () => {
    const labels = worldLabels(createStarterWorld());
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.length).toBeLessThanOrEqual(MAX_LABELS);
    const w = createStarterWorld();
    for (const l of labels) {
      const e = w.entities[l.id];
      expect(e?.parent).toBeNull();
      expect(e?.shape.kind).not.toBe('scatter');
    }
  });
  it('projects points with an identity camera and reads axis directions', () => {
    const identity = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };
    // Perspective-like projection with w = -z.
    const proj = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, -1, 0, 0, -0.1, 0] };
    const out = new Float32Array(3);
    projectPoint({ matrixWorld: identity, matrixWorldInverse: identity, projectionMatrix: proj }, [0, 0, -5], 200, 100, out);
    expect([out[0], out[1], out[2]]).toEqual([100, 50, 1]);
    projectPoint({ matrixWorld: identity, matrixWorldInverse: identity, projectionMatrix: proj }, [0, 0, 5], 200, 100, out);
    expect(out[2]).toBe(0);
    const dirs = axisDirections(identity.elements, new Float32Array(6));
    expect([...dirs]).toEqual([1, -0, 0, -1, 0, -0]);
  });
});

describe('keyboard labels and humanized enums', () => {
  it('formats portable shortcuts per platform', () => {
    expect(shortcut('Mod+K', false)).toBe('Ctrl+K');
    expect(shortcut('Mod+Shift+Z', true)).toBe('⌘⇧Z');
    expect(shortcut('Mod+Enter', true)).toBe('⌘↵');
    expect(isApplePlatform({ platform: 'MacIntel' })).toBe(true);
    expect(isApplePlatform({ platform: 'Linux x86_64', userAgent: 'Firefox' })).toBe(false);
    expect(isApplePlatform(undefined)).toBe(false);
  });
  it('humanizes enum values', () => {
    expect(humanize('thirdPerson')).toBe('Third person');
    expect(humanize('lamp-post')).toBe('Lamp post');
    expect(humanize('none')).toBe('None');
    expect(humanize('')).toBe('');
  });
});

describe('touch input', () => {
  it('merges the virtual stick with the keyboard and latches taps', () => {
    const input = new InputController();
    input.setVirtualStick(0.5, -2);
    let s = input.sample(1 / 60);
    expect(s.forward).toBe(0.5);
    expect(s.right).toBe(-1);
    expect(s.jump).toBe(false);
    input.tapVirtual('Space');
    s = input.sample(1 / 60);
    expect(s.jump).toBe(true);
    s = input.sample(1 / 60);
    expect(s.jump).toBe(false);
    input.tapVirtual('KeyQ' as 'Space');
    expect(input.sample(1 / 60).keys.size).toBe(0);
    input.setVirtualStick(Number.NaN, 0);
    expect(input.sample(1 / 60).forward).toBe(0);
    input.turnBy(90);
    expect(input.yawDeg).toBe(90);
  });
});
