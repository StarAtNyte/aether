/** Canvas rasterisation, readback and ratio conversion stay off the page's event loop. */
import { foliagePixels, type FoliageKind } from '@aether/procgen/foliage';
import { composePhotoAtlas, loadLeafPhotos, type LeafPhotos } from './foliage-photo';

interface Scope {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}
const scope = self as unknown as Scope;
// The owner resets this worker whenever the photo source changes.
let photos: Promise<LeafPhotos | null> | null = null;
let photoBase: string | null = null;
const kinds = new Set(['broadleaf', 'shrub', 'fern', 'needles', 'blossom', 'flower', 'grass']);
scope.onmessage = async (event): Promise<void> => {
  const { id, kind, size, base } = event.data as { id: number; kind: FoliageKind; size: number; base: string | null };
  let pixels: Uint8Array | null = null;
  try {
    if (!Number.isSafeInteger(id) || !kinds.has(kind) || !Number.isInteger(size) || size < 32 || size > 1024 || (size & (size - 1)) !== 0 || (base !== null && typeof base !== 'string')) throw new Error('invalid atlas request');
    if (base !== null) {
      if (base !== photoBase) {
        void photos?.then(previous => previous?.image.close()).catch(() => undefined);
        photos = loadLeafPhotos(base);
        photoBase = base;
      }
      const sheet = await photos;
      if (sheet) pixels = composePhotoAtlas(kind, size, sheet.sheet, sheet.image);
    } else pixels = foliagePixels(kind, size).rgba;
  } catch { /* The caller retains the existing cooperative fallback. */ }
  if (pixels) scope.postMessage({ id, data: pixels.buffer }, [pixels.buffer]);
  else scope.postMessage({ id, data: null });
};
