/**
 * Photographed finish maps: FinishTextures upgrades existing finishes in
 * place (same textures, retiled to the photo's size), loads photos directly
 * for later finishes, keeps the procedural maps when photos fail, and never
 * lets a late procedural result overwrite a photo.
 */
import { describe, expect, it } from 'vitest';
import { FinishTextures, type PixelLoader } from '../src/materials/finish-textures';
import { tick } from './helpers';

function loader(calls: string[], fail = false): PixelLoader {
  return async (url, size) => {
    calls.push(url);
    if (fail) throw new Error('offline');
    const px = new Uint8Array(size * size * 4);
    px.fill(url.includes('albedo') ? 200 : url.includes('orm') ? 150 : 128);
    return px;
  };
}

const photo = (finish: string) => ({ tile: 1.8, albedo: `/x/${finish}.albedo.jpg`, orm: `/x/${finish}.orm.jpg`, normal: `/x/${finish}.normal.jpg` });

describe('photo finishes', () => {
  it('upgrades a live finish in place and retiles it', async () => {
    const ft = new FinishTextures();
    ft.configure({ size: 16 });
    let updates = 0;
    ft.configure({ onUpdate: () => updates++ });
    const maps = ft.get('oak');
    const tex = maps.map;
    await new Promise((r) => setTimeout(r, 5));
    const calls: string[] = [];
    ft.usePhotos((f) => (f === 'oak' ? photo(f) : null), loader(calls));
    await tick(10);
    expect(calls.sort()).toEqual(['/x/oak.albedo.jpg', '/x/oak.normal.jpg', '/x/oak.orm.jpg']);
    expect(ft.get('oak')).toBe(maps);
    expect(maps.map).toBe(tex);
    expect(maps.photo).toBe(true);
    expect((maps.map.image as { data: Uint8Array }).data[0]).toBe(200);
    expect(maps.map.repeat.x).toBeCloseTo(1 / 1.8, 6);
    expect(maps.normal.repeat.y).toBeCloseTo(1 / 1.8, 6);
    expect(updates).toBeGreaterThan(0);
    ft.dispose();
  });

  it('later finishes load photos directly; a late procedural result does not overwrite them', async () => {
    const ft = new FinishTextures();
    ft.configure({ size: 16 });
    const calls: string[] = [];
    ft.usePhotos((f) => (f === 'brick' ? photo(f) : null), loader(calls));
    const maps = ft.get('brick');
    await tick(10);
    expect(maps.photo).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
    // The inline procedural synthesis ran meanwhile: the photo pixels are still there.
    expect((maps.orm.image as { data: Uint8Array }).data[1]).toBe(150);
    // Finishes without photos stay procedural.
    expect(ft.get('paint').photo).toBe(false);
    ft.dispose();
  });

  it('keeps the procedural maps when the photos fail, and ignores mirror-like finishes', async () => {
    const ft = new FinishTextures();
    ft.configure({ size: 16 });
    const calls: string[] = [];
    ft.usePhotos(photo, loader(calls, true));
    const maps = ft.get('marble');
    await new Promise((r) => setTimeout(r, 10));
    expect(maps.photo).toBe(false);
    expect(maps.ready).toBe(true);
    ft.get('mirror');
    expect(calls.some((c) => c.includes('mirror'))).toBe(false);
    ft.dispose();
  });
});
