/**
 * Radiance RGBE (`.hdr`) reader / writer and the reduced copy of a library sky.
 *
 * Every library sky ships twice: the 1024 x 512 original (the photographic background and the sharpest
 * reflections) and a 512 x 256 copy that image-based light alone is lit from. A sky used only as light is
 * prefiltered into a blurred cube map, so the quarter of the pixels carries the same light; the copy is a
 * quarter of the bytes and is what the renderer fetches unless the sky is also drawn as the background.
 * The reduction is a 2 x 2 box average of linear radiance, so the energy is preserved (the sun disc spreads
 * over fewer, dimmer texels; its direction and the total light are unchanged).
 */

export interface Rgbe {
  width: number;
  height: number;
  /** Linear RGB, 3 floats per texel, top row first. */
  data: Float32Array;
}

/** Decode a Radiance file (`-Y h +X w`, flat or new-style RLE scanlines). Throws on anything else. */
export function decodeRgbe(buf: Uint8Array): Rgbe {
  let p = 0;
  const line = (): string => {
    let s = '';
    while (p < buf.length && buf[p] !== 10) s += String.fromCharCode(buf[p++]!);
    p++;
    return s;
  };
  if (!line().startsWith('#?')) throw new Error('not a Radiance file');
  for (let l = line(); l !== ''; l = line()) if (p >= buf.length) throw new Error('truncated header');
  const m = /^-Y (\d+) \+X (\d+)$/.exec(line());
  if (!m) throw new Error('unsupported Radiance orientation');
  const height = Number(m[1]);
  const width = Number(m[2]);
  const data = new Float32Array(width * height * 3);
  const row = new Uint8Array(width * 4);
  for (let y = 0; y < height; y++) {
    if (width >= 8 && width < 32768 && buf[p] === 2 && buf[p + 1] === 2 && ((buf[p + 2]! << 8) | buf[p + 3]!) === width) {
      p += 4;
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < width) {
          let n = buf[p++]!;
          if (n > 128) {
            n -= 128;
            const v = buf[p++]!;
            for (let i = 0; i < n; i++) row[(x++) * 4 + c] = v;
          } else {
            for (let i = 0; i < n; i++) row[(x++) * 4 + c] = buf[p++]!;
          }
        }
      }
    } else {
      for (let i = 0; i < width * 4; i++) row[i] = buf[p++]!;
    }
    for (let x = 0; x < width; x++) {
      const e = row[x * 4 + 3]!;
      const k = e === 0 ? 0 : 2 ** (e - 136);
      const o = (y * width + x) * 3;
      data[o] = row[x * 4]! * k;
      data[o + 1] = row[x * 4 + 1]! * k;
      data[o + 2] = row[x * 4 + 2]! * k;
    }
  }
  return { width, height, data };
}

/** Encode with new-style RLE scanlines (the format three's loader and most tools read). */
export function encodeRgbe(img: Rgbe): Uint8Array {
  const { width, height, data } = img;
  const head = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`, 'latin1');
  const out: number[] = [...head];
  const row = new Uint8Array(width * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 3;
      const r = data[o]!;
      const g = data[o + 1]!;
      const b = data[o + 2]!;
      const v = Math.max(r, g, b);
      if (!(v > 1e-32)) {
        row.fill(0, x * 4, x * 4 + 4);
        continue;
      }
      const e = Math.ceil(Math.log2(v) + 1e-9);
      let f = 2 ** -e * 256;
      let ex = e;
      // log2 rounding can leave the mantissa at 256: bump the exponent once.
      if (v * f >= 256) {
        ex += 1;
        f = 2 ** -ex * 256;
      }
      row[x * 4] = Math.min(255, Math.floor(r * f));
      row[x * 4 + 1] = Math.min(255, Math.floor(g * f));
      row[x * 4 + 2] = Math.min(255, Math.floor(b * f));
      row[x * 4 + 3] = ex + 128;
    }
    out.push(2, 2, width >> 8, width & 255);
    for (let c = 0; c < 4; c++) {
      let x = 0;
      while (x < width) {
        let run = 1;
        while (x + run < width && run < 127 && row[(x + run) * 4 + c] === row[x * 4 + c]) run++;
        if (run >= 4) {
          out.push(128 + run, row[x * 4 + c]!);
          x += run;
        } else {
          // Literal stretch up to the next run of 4 or 128 bytes.
          let end = x;
          while (end < width && end - x < 128) {
            let r = 1;
            while (end + r < width && r < 4 && row[(end + r) * 4 + c] === row[end * 4 + c]) r++;
            if (r >= 4) break;
            end++;
          }
          if (end === x) end = x + 1;
          out.push(end - x);
          for (let i = x; i < end; i++) out.push(row[i * 4 + c]!);
          x = end;
        }
      }
    }
  }
  return Uint8Array.from(out);
}

/** Half the width and height: the 2 x 2 box average of linear radiance. */
export function halve(img: Rgbe): Rgbe {
  const width = img.width >> 1;
  const height = img.height >> 1;
  const data = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) {
        const at = (xx: number, yy: number): number => img.data[(yy * img.width + xx) * 3 + c]!;
        data[(y * width + x) * 3 + c] = (at(2 * x, 2 * y) + at(2 * x + 1, 2 * y) + at(2 * x, 2 * y + 1) + at(2 * x + 1, 2 * y + 1)) / 4;
      }
    }
  }
  return { width, height, data };
}

/** The reduced copy of a Radiance file: half the width and height. */
export function liteHdr(buf: Uint8Array): Uint8Array {
  return encodeRgbe(halve(decodeRgbe(buf)));
}
