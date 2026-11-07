"""
The Cycles side of the publish lightmap bake (scripts/blender-bake.ts writes the job directory and reads the results back).

  blender -b -P scripts/blender/bake-light.py -- --job <dir> [--device auto|GPU|OPTIX|CUDA|CPU]

Reads <dir>/job.json and the raw arrays it names (y-up world space, as the renderer's trace scene), builds:

- the trace scene: one triangle-soup mesh, per-face albedo ("alb") and flags ("ts" two-sided, "px" furniture proxy box);
  Lambertian (Diffuse BSDF, roughness 0); a proxy box's back faces are transparent (a texel on a piece of furniture sees
  out of the box that stands in for it, as the CPU bake skips that box); a one-sided back face emits in the "back" pass;
- the open ground: a 4 km plane 5 mm under ground.y with the ground's albedo;
- the receivers: the lightmap triangles (already pushed off their surface by the bake bias) with UV map "LM", invisible
  to every ray but the camera's (Cycles bakes nothing on an object with no ray visibility at all), a white diffuse;
- the lamps (point lights, power 4 pi x candela) and one sun (strength 1 W/m2, 0.5 degrees).

Then bakes, into one float image of the atlas, every pass the job lists (DIFFUSE, colour off; Cycles' value is irradiance/pi):

- "vis":  direct + indirect, world radiance 1 in red, every albedo 0, one-sided back faces emitting 1 in green:
          red = cosine-weighted share of rays that reach the sky (the ground plane blocks them below), green = share that
          hits a one-sided back face (the CPU bake's "inside a wall" test);
- "sky":  indirect only, world radiance 1/pi above the horizon (an open up-facing surface: irradiance 1): part sky0;
- "grad": indirect only, world radiance 3/(2 pi) * max(0, dir.z) (a cosine sky: irradiance 1 on an open up-facing
          surface and on the ground, 0 on a down-facing one): part sky1. Below the horizon the ground plane hides the sky,
          so a sky split into upper and lower halves would bake its lower half as nothing;
- "lamp": indirect only, the lamps on;
- "sun<k>": indirect only, the sun toward key k.

Writes <dir>/out/<pass>.f32 (size x size RGBA float32, Blender's row order: row 0 is v = 0, the same as the atlas) and
<dir>/out/done.json (device used, seconds per pass). A bake that writes no alpha (Cycles reports a GPU out of memory and
returns black) is redone on the CPU; the rest of the bake then stays there.

Denoising: none here (Cycles has no denoiser for bakes); the node side runs the CPU bake's own edge-aware filter on the result.
"""
import argparse
import json
import math
import os
import sys
import time

import bpy
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--job", required=True)
ap.add_argument("--device", default="auto")
A = ap.parse_args(argv)

JOB = json.load(open(os.path.join(A.job, "job.json")))
OUT = os.path.join(A.job, "out")
os.makedirs(OUT, exist_ok=True)
S = int(JOB["size"])


def arr(name, dtype):
    return np.fromfile(os.path.join(A.job, name), dtype=dtype)


def to_blender(p):
    """y-up (x, y, z) to Blender's z-up (x, -z, y), rows of three."""
    p = p.reshape(-1, 3)
    return np.stack([p[:, 0], -p[:, 2], p[:, 1]], axis=1).astype(np.float32)


def log(s):
    print(f"[bake-light] {s}", flush=True)


# ---------------------------------------------------------------------------------------------------------------------- scene

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = "CYCLES"
cy = sc.cycles
cy.samples = int(JOB["samples"])
cy.max_bounces = 12
cy.diffuse_bounces = int(JOB.get("bounces", 4))
cy.glossy_bounces = 0
cy.transmission_bounces = 0
cy.volume_bounces = 0
cy.transparent_max_bounces = 16
cy.sample_clamp_direct = 0
cy.sample_clamp_indirect = 0
cy.caustics_reflective = False
cy.caustics_refractive = False
cy.use_denoising = False
cy.seed = 1


def soup_mesh(name, pos, uv=None, normals=None):
    """A triangle-soup mesh from nine floats per triangle (already in Blender space)."""
    T = pos.shape[0] // 3
    me = bpy.data.meshes.new(name)
    me.vertices.add(T * 3)
    me.vertices.foreach_set("co", pos.ravel())
    me.loops.add(T * 3)
    me.loops.foreach_set("vertex_index", np.arange(T * 3, dtype=np.int32))
    me.polygons.add(T)
    me.polygons.foreach_set("loop_start", np.arange(0, T * 3, 3, dtype=np.int32))
    me.update(calc_edges=True)
    if uv is not None:
        layer = me.uv_layers.new(name="LM")
        layer.data.foreach_set("uv", uv.astype(np.float32).ravel())
    if normals is not None:
        me.polygons.foreach_set("use_smooth", np.ones(T, dtype=bool))
        me.normals_split_custom_set(normals.reshape(-1, 3).tolist())
    return me


def link(me, name):
    ob = bpy.data.objects.new(name, me)
    sc.collection.objects.link(ob)
    return ob


# Pass controls shared by the materials (set per pass).
CTRL = {}


def value_node(nt, key, v):
    n = nt.nodes.new("ShaderNodeValue")
    n.outputs[0].default_value = v
    CTRL.setdefault(key, []).append(n)
    return n


def set_ctrl(key, v):
    for n in CTRL.get(key, []):
        n.outputs[0].default_value = v


def math_node(nt, op, a, b):
    n = nt.nodes.new("ShaderNodeMath")
    n.operation = op
    for i, x in enumerate((a, b)):
        if isinstance(x, (int, float)):
            n.inputs[i].default_value = x
        else:
            nt.links.new(x, n.inputs[i])
    return n.outputs[0]


def trace_material():
    m = bpy.data.materials.new("trace")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    L = nt.links
    alb = nt.nodes.new("ShaderNodeAttribute")
    alb.attribute_name = "alb"
    ts = nt.nodes.new("ShaderNodeAttribute")
    ts.attribute_name = "ts"
    px = nt.nodes.new("ShaderNodeAttribute")
    px.attribute_name = "px"
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    mul = nt.nodes.new("ShaderNodeVectorMath")
    mul.operation = "SCALE"
    L.new(alb.outputs["Color"], mul.inputs[0])
    L.new(value_node(nt, "albedo", 1.0).outputs[0], mul.inputs["Scale"])
    dif = nt.nodes.new("ShaderNodeBsdfDiffuse")
    dif.inputs["Roughness"].default_value = 0.0
    L.new(mul.outputs[0], dif.inputs["Color"])
    # One-sided back faces emit green in the "vis" pass (not the proxies': their back faces are see-through).
    em_s = math_node(nt, "MULTIPLY", geo.outputs["Backfacing"], math_node(nt, "SUBTRACT", 1.0, ts.outputs["Fac"]))
    em_s = math_node(nt, "MULTIPLY", em_s, math_node(nt, "SUBTRACT", 1.0, px.outputs["Fac"]))
    em_s = math_node(nt, "MULTIPLY", em_s, value_node(nt, "emit", 0.0).outputs[0])
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (0, 1, 0, 1)
    L.new(em_s, em.inputs["Strength"])
    add = nt.nodes.new("ShaderNodeAddShader")
    L.new(dif.outputs[0], add.inputs[0])
    L.new(em.outputs[0], add.inputs[1])
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    L.new(math_node(nt, "MULTIPLY", geo.outputs["Backfacing"], px.outputs["Fac"]), mix.inputs["Fac"])
    L.new(add.outputs[0], mix.inputs[1])
    L.new(tr.outputs[0], mix.inputs[2])
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    L.new(mix.outputs[0], out.inputs["Surface"])
    return m


def ground_material(albedo):
    m = bpy.data.materials.new("ground")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    rgb = nt.nodes.new("ShaderNodeRGB")
    rgb.outputs[0].default_value = (*albedo, 1)
    mul = nt.nodes.new("ShaderNodeVectorMath")
    mul.operation = "SCALE"
    nt.links.new(rgb.outputs[0], mul.inputs[0])
    nt.links.new(value_node(nt, "ground_albedo", 1.0).outputs[0], mul.inputs["Scale"])
    dif = nt.nodes.new("ShaderNodeBsdfDiffuse")
    dif.inputs["Roughness"].default_value = 0.0
    nt.links.new(mul.outputs[0], dif.inputs["Color"])
    # Diagnostic (--ground emit): the ground glows with the CPU bake's model of it, albedo x the part's unit irradiance / pi,
    # never shadowed by the building (`relight.ts` groundFactors); its own diffuse is then off.
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*albedo, 1)
    nt.links.new(value_node(nt, "ground_emit", 0.0).outputs[0], em.inputs["Strength"])
    add = nt.nodes.new("ShaderNodeAddShader")
    nt.links.new(dif.outputs[0], add.inputs[0])
    nt.links.new(em.outputs[0], add.inputs[1])
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(add.outputs[0], out.inputs["Surface"])
    return m


def world():
    """Background colour per pass; strength = const + up * [z > 0] + grad * max(0, z) of the ray's (unit) direction."""
    w = bpy.data.worlds.new("w")
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes["Background"]
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    z = sep.outputs["Z"]
    up = math_node(nt, "MULTIPLY", math_node(nt, "GREATER_THAN", z, 0.0), value_node(nt, "sky_up", 0.0).outputs[0])
    gr = math_node(nt, "MULTIPLY", math_node(nt, "MAXIMUM", z, 0.0), value_node(nt, "sky_grad", 0.0).outputs[0])
    s = math_node(nt, "ADD", math_node(nt, "ADD", up, gr), value_node(nt, "sky_const", 0.0).outputs[0])
    nt.links.new(s, bg.inputs["Strength"])
    sc.world = w
    return bg


t_build = time.time()
tp = to_blender(arr("trace.f32", np.float32))
T = tp.shape[0] // 3
trace = soup_mesh("trace", tp)
alb = arr("trace_alb.f32", np.float32).reshape(-1, 3)
rgba = np.ones((T, 4), dtype=np.float32)
rgba[:, :3] = alb
trace.attributes.new("alb", "FLOAT_COLOR", "FACE").data.foreach_set("color", rgba.ravel())
trace.attributes.new("ts", "FLOAT", "FACE").data.foreach_set("value", arr("trace_ts.u8", np.uint8).astype(np.float32))
trace.attributes.new("px", "FLOAT", "FACE").data.foreach_set("value", arr("trace_px.u8", np.uint8).astype(np.float32))
trace.materials.append(trace_material())
link(trace, "trace")

g = JOB["ground"]
G = 2000.0
gy = float(g["y"]) - 0.005
gp = to_blender(np.array([-G, gy, -G, -G, gy, G, G, gy, G, -G, gy, -G, G, gy, G, G, gy, -G], dtype=np.float32))
gm = soup_mesh("ground", gp)
gm.materials.append(ground_material([max(0.0, min(1.0, float(c))) for c in g["albedo"]]))
link(gm, "ground")

rp = to_blender(arr("recv.f32", np.float32))
rn = to_blender(arr("recv_n.f32", np.float32))
ruv = arr("recv_uv.f32", np.float32)
recv = soup_mesh("recv", rp, uv=ruv, normals=rn)
rm = bpy.data.materials.new("recv")
rm.use_nodes = True
rnt = rm.node_tree
rnt.nodes.clear()
rd = rnt.nodes.new("ShaderNodeBsdfDiffuse")
rd.inputs["Color"].default_value = (1, 1, 1, 1)
rd.inputs["Roughness"].default_value = 0.0
ro = rnt.nodes.new("ShaderNodeOutputMaterial")
rnt.links.new(rd.outputs[0], ro.inputs["Surface"])
img = bpy.data.images.new("atlas", S, S, float_buffer=True, alpha=True)
img.colorspace_settings.name = "Non-Color"
tex = rnt.nodes.new("ShaderNodeTexImage")
tex.image = img
rnt.nodes.active = tex
recv.materials.append(rm)
recv_ob = link(recv, "recv")
for a in ("visible_diffuse", "visible_glossy", "visible_transmission", "visible_volume_scatter", "visible_shadow"):
    setattr(recv_ob, a, False)
recv_ob.visible_camera = True

bg = world()

lamps = []
for i, l in enumerate(JOB["lamps"]):
    c = [max(0.0, float(x)) for x in l["color"]]
    m = max(c)
    if m <= 0:
        continue
    ld = bpy.data.lights.new(f"lamp{i}", "POINT")
    ld.color = (c[0] / m, c[1] / m, c[2] / m)
    ld.energy = 4 * math.pi * m
    ld.shadow_soft_size = 0.0
    ld.use_shadow = True
    lo = bpy.data.objects.new(f"lamp{i}", ld)
    p = l["position"]
    lo.location = (p[0], -p[2], p[1])
    sc.collection.objects.link(lo)
    lamps.append(lo)

sun_d = bpy.data.lights.new("sun", "SUN")
sun_d.energy = 1.0
sun_d.angle = math.radians(0.5)
sun_d.color = (1, 1, 1)
sun = bpy.data.objects.new("sun", sun_d)
sc.collection.objects.link(sun)

bpy.context.view_layer.objects.active = recv_ob
recv_ob.select_set(True)
log(f"scene: {T} trace triangles, {rp.shape[0] // 3} receiver triangles, {len(lamps)} lamps, atlas {S}, {cy.samples} samples ({time.time() - t_build:.1f} s)")


# ---------------------------------------------------------------------------------------------------------------------- device

def use_device(kind):
    if kind == "CPU":
        cy.device = "CPU"
        return True
    prefs = bpy.context.preferences.addons["cycles"].preferences
    try:
        prefs.compute_device_type = kind
        prefs.get_devices()
    except Exception:
        return False
    found = False
    for d in prefs.devices:
        d.use = d.type == kind
        found = found or d.use
    if not found:
        return False
    cy.device = "GPU"
    return True


# auto: GPU, else CPU; GPU: the GPU only (the caller has a faster CPU bake than Cycles on the CPU); else that device, then CPU.
DEV = A.device.upper()
order = ["OPTIX", "CUDA", "CPU"] if DEV == "AUTO" else ["OPTIX", "CUDA"] if DEV == "GPU" else [DEV] + (["CPU"] if DEV != "CPU" else [])
devices = [d for d in order if d == "CPU" or use_device(d)]
if not devices:
    log(f"no device of {order}")
    sys.exit(3)
device = devices[0]
use_device(device)
log(f"device {device} (fallbacks {devices[1:]})")


# ---------------------------------------------------------------------------------------------------------------------- passes

def configure(name):
    for o in lamps:
        o.hide_render = name != "lamp"
    sun.hide_render = not name.startswith("sun")
    set_ctrl("albedo", 0.0 if name == "vis" else 1.0)
    emit_ground = JOB.get("ground_model") == "emit"
    gf = 1.0 if name in ("sky", "grad") else max(0.0, JOB["keys"][int(name[3:])][1]) if name.startswith("sun") else 0.0
    set_ctrl("ground_albedo", 0.0 if name == "vis" or emit_ground else 1.0)
    set_ctrl("ground_emit", gf / math.pi if emit_ground else 0.0)
    set_ctrl("emit", 1.0 if name == "vis" else 0.0)
    set_ctrl("sky_const", 1.0 if name == "vis" else 0.0)
    set_ctrl("sky_up", 1 / math.pi if name == "sky" else 0.0)
    set_ctrl("sky_grad", 3 / (2 * math.pi) if name == "grad" else 0.0)
    bg.inputs["Color"].default_value = (1, 0, 0, 1) if name == "vis" else (1, 1, 1, 1)
    if name.startswith("sun"):
        k = JOB["keys"][int(name[3:])]
        d = Vector((k[0], -k[2], k[1])).normalized()
        # A sun shines along its -Z: +Z toward the sun.
        sun.rotation_mode = "QUATERNION"
        sun.rotation_quaternion = d.to_track_quat("Z", "Y")
    b = sc.render.bake
    b.margin = 2
    b.margin_type = "EXTEND"
    b.use_pass_color = False
    b.use_pass_direct = name == "vis"
    b.use_pass_indirect = True
    b.target = "IMAGE_TEXTURES"
    b.use_clear = True


def bake_once(name):
    configure(name)
    img.pixels.foreach_set(np.zeros(S * S * 4, dtype=np.float32))
    bpy.ops.object.bake(type="DIFFUSE")
    px = np.empty(S * S * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    return px


need = 0.5 * float(JOB.get("covered", 1))
times = {}
for name in JOB["passes"]:
    t0 = time.time()
    while True:
        try:
            px = bake_once(name)
            ok = float(px[3::4].sum()) >= need
        except RuntimeError as e:
            log(f"{name}: {device} failed: {e}")
            ok = False
        if ok:
            break
        # Cycles' GPU out of memory leaves the image as it was (no alpha): the rest runs on the next device.
        devices = devices[1:]
        if not devices:
            log(f"{name}: no device could bake it")
            sys.exit(3)
        device = devices[0]
        use_device(device)
        log(f"{name}: falling back to {device}")
    px.tofile(os.path.join(OUT, f"{name}.f32"))
    times[name] = round(time.time() - t0, 2)
    log(f"{name}: {times[name]} s on {device}")

json.dump({"device": device, "seconds": times}, open(os.path.join(OUT, "done.json"), "w"))
