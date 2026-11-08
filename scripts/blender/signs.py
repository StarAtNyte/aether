"""Signage as a texture, never as thin geometry: text rasterized into a decal image, its own band of every baked atlas,
and a legibility check against the intended string.

Letters modelled as mesh (Blender's built-in font, a few millimetres proud of the board) map to UV islands a texel or
less wide in a town atlas: an I or a T falls below a texel, takes the palette band's one colour and vanishes ("SH OKAZE
S ORE"). Instead:

- `text_tris` / `rasterize`: the string in Blender's built-in font, as filled triangles, rasterized with numpy (4 x 4
  samples a pixel) into a coverage mask. That mask is both the decal's painting and the reference the checks compare
  against (OCR-free).
- `decal_material`: the board's front face carries the painted sign (board colour, ink letters) as an image, through
  its own UV map `decal` (0..1 over the face), in the style's toon material (its ALBEDO is the image, so every bake
  reads it). The material records what the bakes need: `cw_decal` (the image), `cw_decal_px` (the texels it must keep in
  an atlas), `cw_decal_ink` / `cw_decal_board` (for the check) and the text.
- Texel density follows the letters: the atlas slot gives the stroke at least `STROKE_PX` texels (the stroke width is
  measured on the mask), between `PPM_MIN` and `PPM_MAX` texels a metre; the source image is twice that.
- `layout_band` / `place_band`: every atlas a decal goes into (Cloudwatch's pieces, the building kit's export) keeps
  a band of rows for its decals (shelf-packed, with gutters) under its palette band; the decal faces stay out of the
  island pack and map onto their slot, so the bake writes the sign at its own density whatever the atlas's.
- `legibility`: a picture of the sign (a render, or the baked atlas's slot) against the mask, letter by letter: the ink
  and board colours observed on each letter's strip, each pixel classed along that board-to-ink axis, each letter's
  coverage (letters are the mask's column runs, rows for vertical text) and the IoU over the letters' band. A letter
  under half covered, or whose strip has lost its contrast, has vanished.
"""
import math

import bmesh
import bpy
import numpy as np

STROKE_PX = 3.0  # texels across a letter's stroke in an atlas
PPM_MIN, PPM_MAX = 60.0, 220.0  # texels a metre in an atlas slot
GUTTER = 4  # texels round each slot (bake margin and mip filtering)
SRC_SCALE = 2  # source image texels per atlas texel


def _hex(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], np.float32)


def text_tris(text, size, vertical=False, space_line=0.92):
    """The string in Blender's built-in font, `size` metres, centred on its bounds: (triangles (n, 3, 2) in metres, x
    right and y up; width; height). Vertical text stacks the letters top to bottom."""
    cu = bpy.data.curves.new("sg_txt", "FONT")
    cu.body = "\n".join(text) if vertical else text
    cu.size = size
    cu.space_line = space_line
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.resolution_u = 4
    cu.extrude = 0.0
    ob = bpy.data.objects.new("sg_txt", cu)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    bm = bmesh.new()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    tris = np.array([[(v.co.x, v.co.y) for v in f.verts] for f in bm.faces], np.float64).reshape(-1, 3, 2)
    bm.free()
    if not len(tris):
        return tris, 0.0, 0.0
    mn, mx = tris.reshape(-1, 2).min(axis=0), tris.reshape(-1, 2).max(axis=0)
    tris -= (mn + mx) / 2
    return tris, float(mx[0] - mn[0]), float(mx[1] - mn[1])


def rasterize(tris, w_px, h_px, ppm, ss=4):
    """Coverage (h_px, w_px) in 0..1 of the triangles on a w_px x h_px image centred on the origin, ppm pixels a metre;
    row 0 at the top."""
    W, H = w_px * ss, h_px * ss
    k = ppm * ss
    cov = np.zeros((H, W), bool)
    hw, hh = w_px / (2.0 * ppm), h_px / (2.0 * ppm)
    for t in tris:
        x0, y0 = t.min(axis=0)
        x1, y1 = t.max(axis=0)
        i0, i1 = max(0, int(math.floor((x0 + hw) * k - 0.5))), min(W - 1, int(math.ceil((x1 + hw) * k - 0.5)))
        j0, j1 = max(0, int(math.floor((hh - y1) * k - 0.5))), min(H - 1, int(math.ceil((hh - y0) * k - 0.5)))
        if i1 < i0 or j1 < j0:
            continue
        xs = (np.arange(i0, i1 + 1) + 0.5) / k - hw
        ys = hh - (np.arange(j0, j1 + 1) + 0.5) / k
        X, Y = np.meshgrid(xs, ys)
        e = []
        for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
            e.append((b[0] - a[0]) * (Y - a[1]) - (b[1] - a[1]) * (X - a[0]))
        inside = ((e[0] >= 0) & (e[1] >= 0) & (e[2] >= 0)) | ((e[0] <= 0) & (e[1] <= 0) & (e[2] <= 0))
        cov[j0:j1 + 1, i0:i1 + 1] |= inside
    return cov.reshape(h_px, ss, w_px, ss).mean(axis=(1, 3)).astype(np.float32)


def stroke_m(tris, w, h):
    """The letters' stroke width in metres: the lower quartile of the ink runs across rows and columns of a fine raster."""
    ppm = 800.0 / max(w, h, 1e-3)
    m = rasterize(tris, int(w * ppm) + 4, int(h * ppm) + 4, ppm, ss=1) > 0.5
    runs = []
    for a in (m, m.T):
        d = np.diff(np.pad(a.astype(np.int8), ((0, 0), (1, 1))), axis=1)
        for r in range(a.shape[0]):
            s, e = np.flatnonzero(d[r] == 1), np.flatnonzero(d[r] == -1)
            runs.extend((e - s).tolist())
    if not runs:
        return 0.02
    return float(np.percentile(runs, 25)) / ppm


def atlas_ppm(tris, w, h):
    return float(np.clip(STROKE_PX / max(stroke_m(tris, w, h), 1e-3), PPM_MIN, PPM_MAX))


def decal_material(name, text, size, board, ink, board_w, board_h, vertical=False, space_line=0.92, toon=None,
                   style="anime", brush=0.35):
    """A toon (or Principled) material painting `text` (ink) on a board of board_w x board_h metres (board colour), the
    text `size` metres centred on it, through the UV map `decal`. Returns the material."""
    tris, tw, th = text_tris(text, size, vertical, space_line)
    ppm = atlas_ppm(tris, tw, th)
    sw, sh = max(8, int(math.ceil(board_w * ppm))), max(8, int(math.ceil(board_h * ppm)))
    W, H = sw * SRC_SCALE, sh * SRC_SCALE
    cov = rasterize(tris, W, H, W / board_w)
    bc, ic = _hex(board), _hex(ink)
    rgb = bc[None, None] * (1 - cov[..., None]) + ic[None, None] * cov[..., None]
    img = bpy.data.images.get(name) or bpy.data.images.new(name, W, H, alpha=False)
    if tuple(img.size) != (W, H):
        img.scale(W, H)
    px = np.ones((H, W, 4), np.float32)
    px[..., :3] = rgb[::-1]  # bottom row first
    img.pixels.foreach_set(px.reshape(-1))
    # (a packed image needs a file name: Cycles crashed loading packed images whose path was empty)
    img.filepath_raw = f"//{name}.png"
    img.file_format = "PNG"
    img.pack()
    if style == "anime":
        if toon is None:
            from common import toon_material as toon
        m = toon(name, board, image=img, brush=brush)
    else:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        bsdf = nt.nodes["Principled BSDF"]
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        uvn = nt.nodes.new("ShaderNodeUVMap")
        uvn.uv_map = "decal"
        nt.links.new(uvn.outputs[0], tex.inputs[0])
        alb = nt.nodes.new("NodeReroute")
        alb.name = "ALBEDO"
        nt.links.new(tex.outputs["Color"], alb.inputs[0])
        nt.links.new(alb.outputs[0], bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = 0.7
    m["cw_decal"] = img.name
    m["cw_decal_px"] = [sw, sh]
    m["cw_decal_ink"] = ink
    m["cw_decal_board"] = board
    m["cw_decal_text"] = text
    m["cw_decal_vertical"] = 1 if vertical else 0
    return m


def set_decal_uv(bm, face, right, up):
    """UVs of the `decal` layer on a planar board face: 0..1 along `right` and `up` (unit vectors in the face's plane)
    over the face's own extent."""
    from mathutils import Vector
    lay = bm.loops.layers.uv.get("decal") or bm.loops.layers.uv.new("decal")
    R, U = Vector(right), Vector(up)
    us = [lp.vert.co.dot(R) for lp in face.loops]
    vs = [lp.vert.co.dot(U) for lp in face.loops]
    u0, u1, v0, v1 = min(us), max(us), min(vs), max(vs)
    for lp, u, v in zip(face.loops, us, vs):
        lp[lay].uv = ((u - u0) / max(u1 - u0, 1e-6), (v - v0) / max(v1 - v0, 1e-6))


# ---------------------------------------------------------------------------------------------------------------- atlas band

def decal_slots(me):
    """{material index: (w, h) texels} of the mesh's decal materials."""
    out = {}
    for i, m in enumerate(me.materials):
        if m is not None and m.get("cw_decal"):
            w, h = m["cw_decal_px"]
            out[i] = (int(w), int(h))
    return out


def decal_polys(me):
    slots = decal_slots(me)
    mi = np.zeros(len(me.polygons), np.int32)
    me.polygons.foreach_get("material_index", mi)
    return np.isin(mi, list(slots)) if slots else np.zeros(len(me.polygons), bool), slots


def layout_band(slots, size):
    """Shelf-pack the slots ({key: (w, h)}) across an atlas `size` wide: ({key: (x, y, w, h)} with y down from the band's
    top, rows used). A slot wider than the atlas is scaled down to fit."""
    rects, x, y, shelf = {}, GUTTER, GUTTER, 0
    for key, (w, h) in sorted(slots.items(), key=lambda kv: -kv[1][1]):
        if w + 2 * GUTTER > size:
            k = (size - 2 * GUTTER) / w
            w, h = int(w * k), max(4, int(h * k))
        if x + w + GUTTER > size:
            x, y, shelf = GUTTER, y + shelf + GUTTER, 0
        rects[key] = (x, y, w, h)
        x += w + GUTTER
        shelf = max(shelf, h)
    rows = (y + shelf + GUTTER) if rects else 0
    return rects, int(math.ceil(rows / 4.0) * 4)


def place_band(me, uv_name, size, top_rows, rects, band_rows):
    """Map each decal face's `decal` UVs onto its slot of the band (rows [size - top_rows - band_rows, size - top_rows),
    image rows bottom-up as UVs). Returns {material index: (x0, y0, w, h)} in image pixels, y0 the slot's bottom row."""
    if not rects:
        return {}
    duv = me.uv_layers.get("decal")
    if duv is None:
        raise RuntimeError("decal materials without a `decal` UV map")
    d = np.empty(len(me.loops) * 2, np.float32)
    duv.data.foreach_get("uv", d)
    d = d.reshape(-1, 2)
    uv = np.empty(len(me.loops) * 2, np.float32)
    me.uv_layers[uv_name].data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    band_top = size - top_rows  # exclusive, bottom-up rows
    out = {}
    for p in me.polygons:
        r = rects.get(p.material_index)
        if r is None:
            continue
        x, y, w, h = r
        y0 = band_top - y - h  # bottom row of the slot
        out[p.material_index] = (x, y0, w, h)
        for li in range(p.loop_start, p.loop_start + p.loop_total):
            uv[li] = ((x + np.clip(d[li, 0], 0, 1) * w) / size, (y0 + np.clip(d[li, 1], 0, 1) * h) / size)
    me.uv_layers[uv_name].data.foreach_set("uv", uv.reshape(-1))
    return out


def ref_mask(m, w, h):
    """The decal's ink coverage at w x h (row 0 at the top), read back from its image along the board-to-ink axis."""
    img = bpy.data.images[m["cw_decal"]]
    W, H = img.size
    px = np.empty(W * H * 4, np.float32)
    img.pixels.foreach_get(px)
    rgb = px.reshape(H, W, 4)[::-1, :, :3]
    bc, ic = _hex(m["cw_decal_board"]), _hex(m["cw_decal_ink"])
    dv = ic - bc
    t = np.clip(((rgb - bc) @ dv) / max(float(dv @ dv), 1e-6), 0, 1)
    return resize(t, w, h)


def resize(a, w, h):
    """Area-average (or nearest, upward) resize of a 2D array to (h, w)."""
    H, W = a.shape[:2]
    ys = np.minimum((np.arange(h + 1) * H / h).astype(int), H)
    xs = np.minimum((np.arange(w + 1) * W / w).astype(int), W)
    c = np.pad(np.cumsum(np.cumsum(a, axis=0), axis=1), ((1, 0), (1, 0)))
    y0, y1 = ys[:-1], np.maximum(ys[1:], ys[:-1] + 1)
    x0, x1 = xs[:-1], np.maximum(xs[1:], xs[:-1] + 1)
    y1, x1 = np.minimum(y1, H), np.minimum(x1, W)
    s = c[y1][:, x1] - c[y0][:, x1] - c[y1][:, x0] + c[y0][:, x0]
    return s / ((y1 - y0)[:, None] * (x1 - x0)[None, :])


def letter_runs(ref, vertical=False):
    """The letters of a mask: runs of columns (rows for vertical text) holding ink, as slices."""
    a = (ref > 0.5).any(axis=1 if vertical else 0)
    d = np.diff(np.concatenate([[0], a.astype(np.int8), [0]]))
    return [slice(s, e) for s, e in zip(np.flatnonzero(d == 1), np.flatnonzero(d == -1))]


def source_runs(m, w, h):
    """The letters' runs found on the decal's own image (where no two letters touch), scaled to a w x h picture."""
    img = bpy.data.images[m["cw_decal"]]
    W, H = img.size
    vertical = bool(m.get("cw_decal_vertical", 0))
    full = ref_mask(m, W, H)
    k = (h / H) if vertical else (w / W)
    out = []
    for sl in letter_runs(full, vertical):
        a, b = int(math.floor(sl.start * k)), int(math.ceil(sl.stop * k))
        out.append(slice(a, max(b, a + 1)))
    return out


def legibility(rgb, ref, text="", vertical=False, runs=None):
    """`rgb` (h, w, 3, any colour space) a picture of the sign aligned to `ref` (h, w ink coverage, row 0 at the top).

    Each letter is read on its own strip of the sign (its columns, its rows for vertical text): the ink and board colours
    observed there under the mask, each pixel classed along that board-to-ink axis, so the light's gradient over a sign
    (a banner's foot in shadow) does not read as a lost letter. A letter whose strip shows under a third of the median
    letter's contrast has vanished (its coverage is 0). Returns {iou, contrast, letters: [{char, coverage}], min_letter,
    ok}."""
    if (ref > 0.6).sum() < 4 or (ref < 0.05).sum() < 4:
        return {"ok": False, "reason": "no letters in the reference"}
    chars = [c for c in text if not c.isspace()]
    runs = runs if runs is not None else letter_runs(ref, vertical)
    got = np.zeros(ref.shape, bool)
    rows_ = []
    for k, sl in enumerate(runs):
        sel = (sl, slice(None)) if vertical else (slice(None), sl)
        r, pic = ref[sel], rgb[sel]
        ink, bg = r > 0.6, r < 0.05
        w = r > 0.5
        if not w.any() or ink.sum() < 2 or bg.sum() < 2:
            continue
        ci, cb = np.median(pic[ink], axis=0), np.median(pic[bg], axis=0)
        dv = ci - cb
        g = (((pic - cb) @ dv) / max(float(dv @ dv), 1e-6)) > 0.5
        got[sel] = g
        rows_.append((k, float(np.linalg.norm(dv)), float((g & w).sum() / max(1, w.sum()))))
    if not rows_:
        return {"ok": False, "reason": "no letter strips"}
    contrast = float(np.median([c for _, c, _ in rows_]))
    letters = []
    for k, c, cov in rows_:
        if c < contrast / 3:
            cov = 0.0
        letters.append({"char": chars[k] if len(chars) == len(runs) else str(k), "coverage": round(cov, 3), "contrast": round(c, 3)})
    # The IoU over the band the letters occupy (a frame or trim over the board's edge is not the letters' business).
    rows = np.flatnonzero((ref > 0.5).any(axis=0 if vertical else 1))
    band = (slice(None), slice(rows[0], rows[-1] + 1)) if vertical else (slice(rows[0], rows[-1] + 1), slice(None))
    want = ref[band] > 0.5
    iou = float((got[band] & want).sum() / max(1, (got[band] | want).sum()))
    mn = min(x["coverage"] for x in letters)
    ok = contrast > 0.12 and mn >= 0.5 and iou >= 0.45
    return {"iou": round(iou, 3), "contrast": round(contrast, 3), "letters": letters, "min_letter": round(mn, 3), "ok": bool(ok)}


def read(lg):
    """The letters as read: each letter kept or dropped (a space for a vanished one), e.g. 'SH OKAZE S ORE'."""
    return "".join(x["char"] if x["coverage"] >= 0.5 else "_" for x in lg.get("letters", []))


def check_atlas(mats, final_srgb, slots_px):
    """Every decal slot of a baked atlas (final_srgb: (size, size, 3), rows bottom-up) against its material's mask."""
    rows = []
    for mi, (x0, y0, w, h) in slots_px.items():
        m = mats[mi]
        pic = final_srgb[y0:y0 + h, x0:x0 + w][::-1]
        ref = ref_mask(m, w, h)
        lg = legibility(pic, ref, m.get("cw_decal_text", ""), bool(m.get("cw_decal_vertical", 0)), runs=source_runs(m, w, h))
        rows.append({"material": m.name, "text": m.get("cw_decal_text", ""), "px": [w, h], "read": read(lg), **lg})
    return rows
