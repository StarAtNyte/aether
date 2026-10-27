import { describe, expect, it } from 'vitest';
import { exifFovDeg } from '../src/photo/image-size';

/** A minimal JPEG: SOI, APP1 (big-endian TIFF, ExifIFD with FocalLengthIn35mmFilm), SOF0 of the given size, EOI. */
function jpeg(f35: number, w: number, h: number): string {
  const tiff: number[] = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8];
  tiff.push(0, 1, 0x87, 0x69, 0, 4, 0, 0, 0, 1, 0, 0, 0, 26, 0, 0, 0, 0); // IFD0 at 8: ExifIFD pointer -> 26
  tiff.push(0, 1, 0xa4, 0x05, 0, 3, 0, 0, 0, 1, (f35 >> 8) & 255, f35 & 255, 0, 0, 0, 0, 0, 0); // ExifIFD at 26
  const exif = [...Buffer.from('Exif\0\0', 'binary'), ...tiff];
  const app1 = [0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 255, ...exif];
  const sof = [0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, ...app1, ...sof, 0xff, 0xd9]).toString('base64')}`;
}

describe('exifFovDeg', () => {
  it('reads the 35 mm equivalent focal length as a horizontal field of view', () => {
    // 26 mm on a 4:3 landscape frame: diagonal 81.7 deg, horizontal about 69 deg
    expect(exifFovDeg(jpeg(26, 4032, 3024))).toBeGreaterThan(66);
    expect(exifFovDeg(jpeg(26, 4032, 3024))).toBeLessThan(72);
    // a 13 mm ultra wide is much wider
    expect(exifFovDeg(jpeg(13, 4032, 3024)) as number).toBeGreaterThan(95);
  });
  it('gives null without the tag or for other formats', () => {
    expect(exifFovDeg('data:image/png;base64,AAAA')).toBeNull();
    expect(exifFovDeg(jpeg(0, 640, 480))).toBeNull();
  });
});
