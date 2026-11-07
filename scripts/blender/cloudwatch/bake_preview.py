"""A preview of the bake from the shot cameras, without baking: Cycles renders the passes the bake reads (diffuse direct +
indirect light, diffuse colour, contact AO, emission, the terminator-break noise as an AOV, the position for the haze)
and NumPy runs the bake's own finish (common.finish_np) on them. Minutes instead of the full bake's half hour, so the
lighting and the ramp can be iterated on; the honest stills of a finished bake are glb_shots.py.

  blender -b <out>/cloudwatch.blend -P scripts/blender/cloudwatch/bake_preview.py -- --out <dir> [--shots A,B,C]
        [--size 1280x720] [--samples 96] [--prefix p-] [--gpu]
"""
import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
import numpy as np  # noqa: E402

import common  # noqa: E402
import shots  # noqa: E402
import sky  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
ap.add_argument("--shots", default="A,B,C")
ap.add_argument("--size", default="1280x720")
ap.add_argument("--samples", type=int, default=96)
ap.add_argument("--prefix", default="p-")
ap.add_argument("--gpu", action="store_true")
ap.add_argument("--no-denoise", action="store_true")
ap.add_argument("--keep-light", action="store_true", help="keep the .blend's own sun and world")
A = ap.parse_args(argv)
os.makedirs(A.out, exist_ok=True)

sc = bpy.context.scene
if not A.keep_light:
    sky.build_light()
sc.render.engine = "CYCLES"
sc.cycles.samples = A.samples
sc.cycles.use_denoising = False
sc.cycles.diffuse_bounces = 4
sc.cycles.max_bounces = 8
sc.cycles.sample_clamp_indirect = 3.0
if A.gpu:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "CUDA"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type == "CUDA"
    sc.cycles.device = "GPU"
for ob in bpy.data.objects:
    if ob.get("cw_piece") in ("sky", "sea") or ob.name.startswith(("cloud", "glitter")):
        ob.visible_diffuse = False
        ob.visible_glossy = False
        ob.visible_transmission = False
        ob.visible_shadow = False

# Toon materials -> Diffuse(ALBEDO) plus the break noise as an AOV (what the bake's light, albedo and aux passes see).
done = {}
for m in list(bpy.data.materials):
    if not m.use_nodes or m.get("cw_emissive") or m.get("cw_line"):
        continue
    nt = m.node_tree
    alb = nt.nodes.get("ALBEDO")
    out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
    if alb is None or out is None:
        continue
    diff = nt.nodes.new("ShaderNodeBsdfDiffuse")
    nt.links.new(alb.outputs[0], diff.inputs["Color"])
    nt.links.new(diff.outputs[0], out.inputs[0])
    aov = nt.nodes.new("ShaderNodeOutputAOV")
    aov.aov_name = "edge"
    nt.links.new(common.brush_edge_socket(nt), aov.inputs["Value"])
# Outline shells: Cycles ignores backface culling, so the inverted hull is drawn only on camera rays through its back
# faces (as EEVEE and the browser draw it) and is transparent to every other ray.
for m in bpy.data.materials:
    if not m.get("cw_line") or not m.use_nodes:
        continue
    nt = m.node_tree
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    em = next(n for n in nt.nodes if n.type == "EMISSION")
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    lp = nt.nodes.new("ShaderNodeLightPath")
    inv = nt.nodes.new("ShaderNodeMath")
    inv.operation = "SUBTRACT"
    inv.inputs[0].default_value = 1.0
    nt.links.new(geo.outputs["Backfacing"], inv.inputs[1])
    fac = nt.nodes.new("ShaderNodeMath")
    fac.operation = "MULTIPLY"
    nt.links.new(inv.outputs[0], fac.inputs[0])
    nt.links.new(lp.outputs["Is Camera Ray"], fac.inputs[1])
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mx = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(fac.outputs[0], mx.inputs[0])
    nt.links.new(tr.outputs[0], mx.inputs[1])
    nt.links.new(em.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], out.inputs[0])
vl = sc.view_layers[0]
# The sun in a light group of its own: its pass over the diffuse colour is the sun's direct light (the sun mask).
if "sun" not in [g.name for g in vl.lightgroups]:
    vl.lightgroups.add(name="sun")
bpy.data.objects["sun"].lightgroup = "sun"
vl.use_pass_diffuse_direct = True
vl.use_pass_diffuse_indirect = True
vl.use_pass_diffuse_color = True
vl.use_pass_emit = True
vl.use_pass_ambient_occlusion = True
vl.use_pass_position = True
vl.use_pass_normal = True
if "edge" not in [a.name for a in vl.aovs]:
    a = vl.aovs.add()
    a.name = "edge"
    a.type = "VALUE"
sc.use_nodes = True
nt = sc.node_tree
for n in list(nt.nodes):
    nt.nodes.remove(n)
rl = nt.nodes.new("CompositorNodeRLayers")
fo = nt.nodes.new("CompositorNodeOutputFile")
fo.format.file_format = "OPEN_EXR"
fo.format.color_depth = "32"
fo.base_path = os.path.join(A.out, "_passes")
PASSES = ["DiffDir", "DiffInd", "DiffCol", "Emit", "AO", "Position", "Normal", "edge", "Alpha", "Combined_sun"]
fo.file_slots.clear()
for p in PASSES:
    fo.file_slots.new(p)
    nt.links.new(rl.outputs[p], fo.inputs[p])
comp = nt.nodes.new("CompositorNodeComposite")
nt.links.new(rl.outputs["Image"], comp.inputs["Image"])
sc.render.use_compositing = True
sc.view_settings.view_transform = "Standard"
sc.render.film_transparent = False
W, H = (int(v) for v in A.size.split("x"))
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = W, H, 100


def load(p, frame):
    path = os.path.join(A.out, "_passes", f"{p}{frame:04d}.exr")
    im = bpy.data.images.load(path, check_existing=False)
    a = np.empty(W * H * 4, np.float32)
    im.pixels.foreach_get(a)
    bpy.data.images.remove(im)
    os.remove(path)
    return a.reshape(H, W, 4)


def write_png(path, rgb01):
    """(H, W, 3) in 0..1, rows bottom-up (Blender's order) -> 8-bit PNG."""
    import struct
    import zlib
    h, w, _ = rgb01.shape
    px = (rgb01[::-1] * 255 + 0.5).astype(np.uint8)
    raw = b"".join(b"\x00" + px[y].tobytes() for y in range(h))

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


def blur(img, k=1):
    out = img.astype(np.float32)
    for axis in (0, 1):
        acc = np.zeros_like(out)
        for d in range(-k, k + 1):
            acc += np.roll(out, d, axis=axis)
        out = acc / (2 * k + 1)
    return out


for key, s in shots.shot_list().items():
    if key not in A.shots.split(","):
        continue
    cam = shots.camera(f"cam_{key}", s["eye"], s["target"], s["lens"])
    sc.camera = cam
    sc.render.filepath = os.path.join(A.out, f"_{key}_combined.png")
    bpy.ops.render.render(write_still=True)
    fr = sc.frame_current
    P_ = {p: load(p, fr) for p in PASSES}
    L = P_["DiffDir"][..., :3] + P_["DiffInd"][..., :3]
    L = L[..., 0] * 0.2126 + L[..., 1] * 0.7152 + L[..., 2] * 0.0722
    col = P_["DiffCol"][..., :3]
    has = col.sum(-1) > 1e-5
    pos = P_["Position"][..., :3]
    aux = np.stack([P_["edge"][..., 0], common.haze_np(pos[..., 0], pos[..., 1]), np.zeros_like(L)], -1)
    tmp = os.path.join(A.out, "_passes")
    g = {"albedo": col, "normal": P_["Normal"][..., :3]}
    Ld = common.denoise_np(L, tmp, **g) if not A.no_denoise else blur(L, 1)
    AOd = common.denoise_np(P_["AO"][..., 0], tmp, **g) if not A.no_denoise else P_["AO"][..., 0]
    sun_rgb = P_["Combined_sun"][..., :3] / np.maximum(col, 1e-4)
    sun = np.where(has, sun_rgb[..., 0] * 0.2126 + sun_rgb[..., 1] * 0.7152 + sun_rgb[..., 2] * 0.0722, 0.0)
    fin = common.finish_np(col, Ld, AOd, aux, blur(sun, 1))
    img = np.where(has[..., None], fin, 0.0) + P_["Emit"][..., :3]
    print(f"AETHER_PREVIEW {key} stops p10/50/90 =", np.percentile(common.stops_np(L[has], P_['AO'][..., 0][has]), [10, 50, 90]).round(2).tolist(), flush=True)
    srgb = np.where(img <= 0.0031308, img * 12.92, 1.055 * np.power(np.clip(img, 0, None), 1 / 2.4) - 0.055)
    path = os.path.join(A.out, f"{A.prefix}{key}.png")
    write_png(path, np.clip(srgb, 0, 1))
    print("AETHER_SHOT", path, flush=True)
