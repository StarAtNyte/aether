"""
Offline texture conversion for the character pipeline (build-time only).

Rocketbox ships 2048 px uncompressed TGAs with a 3ds Max material model
(diffuse + normal + specular). This turns one character's maps into the
glTF PBR set the runtime uses, at 1024 px, as WebP:

  body_color / head_color     base colour (sRGB)
  body_normal / head_normal   tangent-space normals (linear)
  body_mr / head_mr           metallic-roughness (G = roughness from the specular map, B = 0)
  masks                       outfit masks in one small image: left half body
                              (R = top, G = bottom), right half head (R = hair); 0 on
                              skin, shoes, hands. The runtime recolours the base colour
                              textures with it (CPU, once per variant)
  hair                        colour + alpha of the hair/lash cards
  refs.json                   mean linear luminance of each recolourable region

The masks come from the mesh: `uvinfo.bin` (written by the converter) holds,
per texel, the height of the surface and its share of head/neck/hand
skinning. A texel is cloth when it is not skin coloured and not on a hand,
neck or head; whole UV islands are then labelled top (torso, arms), bottom
(legs) or dress by where they sit on the body, and shoes and boots are left
alone. See docs/CHARACTERS.md.

Usage: python3 -I textures.py <source dir with *.tga> <output dir> [uvinfo.bin]
"""
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage
from skimage.color import rgb2lab

SIZE = 1024


def find(src, key):
    for n in sorted(os.listdir(src)):
        low = n.lower()
        if key in low and low.endswith('.tga') and 'wr' not in low.replace('wrinkle', ''):
            return os.path.join(src, n)
    return None


def webp(im, path, q, lossless=False, exact=False):
    # exact keeps the colour channels under transparent texels (the mask packs data in R and G there)
    im.save(path, 'WEBP', quality=q, method=6, lossless=lossless, alpha_quality=100, exact=exact)


def load(path, mode='RGB'):
    return Image.open(path).convert(mode).resize((SIZE, SIZE), Image.LANCZOS)


def rough_from_spec(path):
    """Specular (bright = shiny) to glTF roughness (G), metalness 0 (B); R and A are set by the caller."""
    im = Image.open(path).convert('L').resize((SIZE // 2, SIZE // 2), Image.LANCZOS)
    g = im.point(lambda v: int(max(0.42, min(0.95, 1.0 - 0.6 * (v / 255.0))) * 255))
    return g


def srgb_to_linear(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lum(rgb):
    lin = srgb_to_linear(rgb.astype(np.float64))
    return lin[..., 0] * 0.2126 + lin[..., 1] * 0.7152 + lin[..., 2] * 0.0722


def skin_distance(rgb, ref):
    """Perceptual distance of every texel to the skin colour (chroma weighs more than lightness)."""
    lab = rgb2lab(rgb.astype(np.float64) / 255.0)
    r = rgb2lab(np.array(ref, dtype=np.float64).reshape(1, 1, 3) / 255.0)[0, 0]
    dl = (lab[..., 0] - r[0]) * 0.35
    da = lab[..., 1] - r[1]
    db = lab[..., 2] - r[2]
    return np.sqrt(dl * dl + da * da + db * db)


def read_uv(path):
    n = SIZE * SIZE
    a = np.fromfile(path, dtype=np.float32)
    if a.size != 3 * n:
        raise SystemExit('uvinfo.bin has the wrong size')
    return a[:n].reshape(SIZE, SIZE), a[n:2 * n].reshape(SIZE, SIZE), a[2 * n:].reshape(SIZE, SIZE)


def soft(mask):
    """Feather a boolean mask by one texel so tinted edges blend instead of showing a halo."""
    m = ndimage.binary_dilation(mask, iterations=1).astype(np.float32)
    m = ndimage.gaussian_filter(m, 0.8)
    return np.clip(m * 1.15, 0, 1)


def masks(body_rgb, head_rgb, body_y, body_hw, head_y, height, debug_dir):
    cov = np.isfinite(body_y)
    hw = np.nan_to_num(body_hw)
    y = np.nan_to_num(body_y, nan=-1.0)
    # Skin reference: hands, neck and head texels of the body map (always bare).
    ref_pix = body_rgb[cov & (hw > 0.75)]
    if ref_pix.shape[0] < 50:
        ref_pix = body_rgb[cov & (y > height * 0.6)]
    skin = np.median(ref_pix.reshape(-1, 3), axis=0)
    dist = skin_distance(body_rgb, skin)
    cloth_color = cov & (hw < 0.4) & (dist > 14.0)
    cloth_color = ndimage.binary_closing(cloth_color, iterations=2) & cov & (hw < 0.4)
    everything = cov & (hw < 0.4)
    # UV islands (merge across 2-texel seams).
    glued = ndimage.binary_dilation(cov, iterations=2)
    labels, count = ndimage.label(glued)
    top = np.zeros_like(cloth_color)
    bottom = np.zeros_like(cloth_color)
    for i in range(1, count + 1):
        isl = (labels == i) & cov
        if isl.sum() < 400:
            continue
        ys = y[isl]
        lo, hi, mean = float(ys.min()), float(ys.max()), float(ys.mean())
        yy, xx = np.nonzero(isl)
        width = (xx.max() - xx.min()) / SIZE
        # A narrow torso strip is garment all over (a tan vest is skin coloured but not skin);
        # wide islands and limbs may hold bare skin, which the colour test leaves out.
        torso_strip = width < 0.45 and (hi - lo) > height * 0.22 and mean > height * 0.55 and hi > height * 0.7
        sel = isl & (everything if torso_strip else cloth_color)
        if hi < 0.42:  # shoes and boots
            continue
        if lo < height * 0.42 and hi > height * 0.62:  # dress / one-piece: all "top"
            top |= sel
        elif mean >= height * 0.55:
            top |= sel
        else:
            bottom |= sel
    # Hair on the head map: skin reference from the forehead and cheeks, then
    # everything above the hairline that is not skin, plus the scalp.
    hcov = np.isfinite(head_y)
    hy = np.nan_to_num(head_y, nan=-1.0)
    box = np.zeros_like(hcov)
    box[int(0.15 * SIZE):int(0.27 * SIZE), int(0.45 * SIZE):int(0.55 * SIZE)] = True
    zone = hcov & box
    hskin = np.median(head_rgb[zone].reshape(-1, 3), axis=0) if zone.sum() > 50 else skin
    hdist = skin_distance(head_rgb, hskin)
    eye = height * 0.935
    scalp = hcov & (hy > height * 0.975) & (hdist > 15.0)
    sides = hcov & (hy > eye + 0.012) & (hdist > 18.0)
    hair = scalp | sides
    hair = ndimage.binary_closing(hair, iterations=2) & hcov
    hair = ndimage.binary_opening(hair, iterations=1)
    if debug_dir:
        os.makedirs(debug_dir, exist_ok=True)
        dbg = body_rgb.copy()
        dbg[top] = (0.4 * dbg[top] + 0.6 * np.array([255, 0, 255])).astype(np.uint8)
        dbg[bottom] = (0.4 * dbg[bottom] + 0.6 * np.array([0, 255, 255])).astype(np.uint8)
        hd = head_rgb.copy()
        hd[hair] = (0.4 * hd[hair] + 0.6 * np.array([255, 255, 0])).astype(np.uint8)
        Image.fromarray(np.concatenate([dbg, hd], axis=1)).resize((1024, 512)).save(os.path.join(debug_dir, 'masks.png'))
    return top, bottom, hair


def main():
    src, out = sys.argv[1], sys.argv[2]
    uvinfo = sys.argv[3] if len(sys.argv) > 3 else None
    height = float(sys.argv[4]) if len(sys.argv) > 4 else 1.8
    os.makedirs(out, exist_ok=True)
    body_c = load(find(src, 'body_color'))
    head_c = load(find(src, 'head_color'))
    webp(body_c, os.path.join(out, 'body_color.webp'), 84)
    webp(head_c, os.path.join(out, 'head_color.webp'), 84)
    for part in ('body', 'head'):
        n = find(src, f'{part}_normal')
        if n:
            webp(load(n), os.path.join(out, f'{part}_normal.webp'), 80)
    refs = {'top': 0.12, 'bottom': 0.1, 'hair': 0.06}
    top = bottom = hair = None
    if uvinfo:
        body_y, body_hw, head_y = read_uv(uvinfo)
        top, bottom, hair = masks(np.asarray(body_c), np.asarray(head_c), body_y, body_hw, head_y, height, os.path.join(out, '_debug'))
        bl = lum(np.asarray(body_c))
        hl = lum(np.asarray(head_c))
        if top.sum() > 50:
            refs['top'] = float(bl[top].mean())
        if bottom.sum() > 50:
            refs['bottom'] = float(bl[bottom].mean())
        if hair.sum() > 50:
            refs['hair'] = float(hl[hair].mean())
    for part in ('body', 'head'):
        s = find(src, f'{part}_specular')
        if not s:
            continue
        g = rough_from_spec(s).resize((SIZE, SIZE), Image.BILINEAR)
        full = Image.new('L', g.size, 255)
        zero = Image.new('L', g.size, 0)
        webp(Image.merge('RGB', (full, g, zero)), os.path.join(out, f'{part}_mr.webp'), 72)
    # Outfit masks, one small opaque image: left half body (R top, G bottom), right half head (R hair).
    half = 512
    mask = Image.new('RGB', (half * 2, half), (0, 0, 0))
    if top is not None:
        t = Image.fromarray((soft(top) * 255).astype(np.uint8)).resize((half, half), Image.BILINEAR)
        b = Image.fromarray((soft(bottom) * 255).astype(np.uint8)).resize((half, half), Image.BILINEAR)
        h2 = Image.fromarray((soft(hair) * 255).astype(np.uint8)).resize((half, half), Image.BILINEAR)
        z = Image.new('L', (half, half), 0)
        mask.paste(Image.merge('RGB', (t, b, z)), (0, 0))
        mask.paste(Image.merge('RGB', (h2, z, z)), (half, 0))
    webp(mask, os.path.join(out, 'masks.webp'), 82)
    h = find(src, 'opacity')
    if h:
        im = load(h, 'RGBA')
        webp(im, os.path.join(out, 'hair.webp'), 80)
    with open(os.path.join(out, 'refs.json'), 'w') as f:
        json.dump(refs, f)
    print('textures ->', out, sorted(x for x in os.listdir(out) if not x.startswith('_')), refs)


if __name__ == '__main__':
    main()
