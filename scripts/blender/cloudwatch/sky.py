"""Sky: the gradient dome with the sun glow and high streaks, the cloudscape (toon-shaded metaball masses), the sun lamp
and the ambient world light."""
import math

import bmesh
import bpy
from mathutils import Vector

from common import P, collection, rng, srgb

SUN_AZ = 252.0  # degrees from north (+Y), clockwise (east = +X)
SUN_EL = 10.0
DOME_R = 2600.0
EYE = Vector((0.0, 133.0, 46.0))  # the lookout: clouds are placed around it


def sun_dir():
    az, el = math.radians(SUN_AZ), math.radians(SUN_EL)
    return Vector((math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el)))


def _dome_material():
    m = bpy.data.materials.new("cw_sky")
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (1400, 0)
    geo = nt.nodes.new("ShaderNodeTexCoord")
    geo.location = (-1200, 0)
    norm = nt.nodes.new("ShaderNodeVectorMath")
    norm.operation = "NORMALIZE"
    norm.location = (-1000, 0)
    nt.links.new(geo.outputs["Object"], norm.inputs[0])
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    sep.location = (-800, 0)
    nt.links.new(norm.outputs[0], sep.inputs[0])
    # Elevation gradient.
    grad = nt.nodes.new("ShaderNodeValToRGB")
    grad.location = (-600, 200)
    cr = grad.color_ramp
    cr.interpolation = "EASE"
    stops = [(0.0, P["horizon"]), (0.035, "#f3a882"), (0.10, "#c98fa6"), (0.22, "#8b80c0"), (0.42, P["upper"]), (1.0, P["zenith"])]
    cr.elements[0].position, cr.elements[0].color = stops[0][0], srgb(stops[0][1])
    cr.elements[1].position, cr.elements[1].color = stops[-1][0], srgb(stops[-1][1])
    for pos, col in stops[1:-1]:
        e = cr.elements.new(pos)
        e.color = srgb(col)
    clampz = nt.nodes.new("ShaderNodeMath")
    clampz.operation = "MAXIMUM"
    clampz.inputs[1].default_value = 0.0
    clampz.location = (-700, 300)
    nt.links.new(sep.outputs["Z"], clampz.inputs[0])
    nt.links.new(clampz.outputs[0], grad.inputs[0])
    # Sun glow: dot(view dir, sun dir) -> wide warm halo plus a tight core.
    sd = sun_dir()
    dot = nt.nodes.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    dot.location = (-600, -200)
    dot.inputs[1].default_value = (sd.x, sd.y, sd.z)
    nt.links.new(norm.outputs[0], dot.inputs[0])
    wide = nt.nodes.new("ShaderNodeMapRange")
    wide.location = (-400, -200)
    wide.inputs["From Min"].default_value = 0.55
    wide.inputs["From Max"].default_value = 1.0
    wide.interpolation_type = "SMOOTHSTEP"
    nt.links.new(dot.outputs["Value"], wide.inputs["Value"])
    widep = nt.nodes.new("ShaderNodeMath")
    widep.operation = "POWER"
    widep.inputs[1].default_value = 2.2
    widep.location = (-250, -200)
    nt.links.new(wide.outputs[0], widep.inputs[0])
    # Horizon weighting of the halo (strongest near the horizon).
    hz = nt.nodes.new("ShaderNodeMapRange")
    hz.location = (-400, -380)
    hz.inputs["From Min"].default_value = 0.45
    hz.inputs["From Max"].default_value = 0.0
    nt.links.new(clampz.outputs[0], hz.inputs["Value"])
    halo = nt.nodes.new("ShaderNodeMath")
    halo.operation = "MULTIPLY"
    halo.location = (-100, -250)
    nt.links.new(widep.outputs[0], halo.inputs[0])
    nt.links.new(hz.outputs[0], halo.inputs[1])
    mixh = nt.nodes.new("ShaderNodeMix")
    mixh.data_type = "RGBA"
    mixh.blend_type = "SCREEN"
    mixh.location = (100, 100)
    nt.links.new(halo.outputs[0], mixh.inputs["Factor"])
    nt.links.new(grad.outputs["Color"], mixh.inputs[6])
    mixh.inputs[7].default_value = srgb(P["horizon_sun"])
    # Sun disc core (bright, blooms).
    core = nt.nodes.new("ShaderNodeMapRange")
    core.location = (-400, -600)
    core.inputs["From Min"].default_value = 0.99985
    core.inputs["From Max"].default_value = 0.99993
    nt.links.new(dot.outputs["Value"], core.inputs["Value"])
    corehalo = nt.nodes.new("ShaderNodeMapRange")
    corehalo.location = (-400, -800)
    corehalo.inputs["From Min"].default_value = 0.9955
    corehalo.inputs["From Max"].default_value = 1.0
    corehalo.interpolation_type = "SMOOTHSTEP"
    nt.links.new(dot.outputs["Value"], corehalo.inputs["Value"])
    chp = nt.nodes.new("ShaderNodeMath")
    chp.operation = "POWER"
    chp.inputs[1].default_value = 3.0
    chp.location = (-250, -800)
    nt.links.new(corehalo.outputs[0], chp.inputs[0])
    sun_amt = nt.nodes.new("ShaderNodeMath")
    sun_amt.operation = "ADD"
    sun_amt.location = (-100, -650)
    nt.links.new(core.outputs[0], sun_amt.inputs[0])
    nt.links.new(chp.outputs[0], sun_amt.inputs[1])
    # High streaks: stretched noise in a band of elevation, tinted pink-gold.
    nscale = nt.nodes.new("ShaderNodeMapping")
    nscale.location = (-1000, 500)
    nscale.inputs["Scale"].default_value = (0.6, 4.5, 9.0)
    nscale.inputs["Rotation"].default_value = (0.0, 0.0, math.radians(25))
    nt.links.new(norm.outputs[0], nscale.inputs[0])
    streak = nt.nodes.new("ShaderNodeTexNoise")
    streak.location = (-800, 500)
    streak.inputs["Scale"].default_value = 2.2
    streak.inputs["Detail"].default_value = 6.0
    streak.inputs["Roughness"].default_value = 0.62
    nt.links.new(nscale.outputs[0], streak.inputs["Vector"])
    sthr = nt.nodes.new("ShaderNodeMapRange")
    sthr.location = (-600, 500)
    sthr.inputs["From Min"].default_value = 0.56
    sthr.inputs["From Max"].default_value = 0.72
    nt.links.new(streak.outputs["Fac"], sthr.inputs["Value"])
    band = nt.nodes.new("ShaderNodeMapRange")
    band.location = (-600, 700)
    band.interpolation_type = "SMOOTHSTEP"
    band.inputs["From Min"].default_value = 0.08
    band.inputs["From Max"].default_value = 0.30
    nt.links.new(clampz.outputs[0], band.inputs["Value"])
    band2 = nt.nodes.new("ShaderNodeMapRange")
    band2.location = (-600, 900)
    band2.interpolation_type = "SMOOTHSTEP"
    band2.inputs["From Min"].default_value = 0.75
    band2.inputs["From Max"].default_value = 0.40
    nt.links.new(clampz.outputs[0], band2.inputs["Value"])
    bandm = nt.nodes.new("ShaderNodeMath")
    bandm.operation = "MULTIPLY"
    bandm.location = (-400, 800)
    nt.links.new(band.outputs[0], bandm.inputs[0])
    nt.links.new(band2.outputs[0], bandm.inputs[1])
    stm = nt.nodes.new("ShaderNodeMath")
    stm.operation = "MULTIPLY"
    stm.location = (-250, 600)
    nt.links.new(sthr.outputs[0], stm.inputs[0])
    nt.links.new(bandm.outputs[0], stm.inputs[1])
    stm2 = nt.nodes.new("ShaderNodeMath")
    stm2.operation = "MULTIPLY"
    stm2.inputs[1].default_value = 0.55
    stm2.location = (-100, 600)
    nt.links.new(stm.outputs[0], stm2.inputs[0])
    mixs = nt.nodes.new("ShaderNodeMix")
    mixs.data_type = "RGBA"
    mixs.location = (300, 200)
    nt.links.new(stm2.outputs[0], mixs.inputs["Factor"])
    nt.links.new(mixh.outputs[2], mixs.inputs[6])
    mixs.inputs[7].default_value = srgb("#f7c7c0")
    # Add the sun.
    emit_sky = nt.nodes.new("ShaderNodeEmission")
    emit_sky.location = (600, 200)
    nt.links.new(mixs.outputs[2], emit_sky.inputs["Color"])
    emit_sun = nt.nodes.new("ShaderNodeEmission")
    emit_sun.location = (600, -300)
    emit_sun.inputs["Color"].default_value = srgb(P["sun"])
    sunscale = nt.nodes.new("ShaderNodeMath")
    sunscale.operation = "MULTIPLY"
    sunscale.inputs[1].default_value = 3.0
    sunscale.location = (300, -500)
    nt.links.new(sun_amt.outputs[0], sunscale.inputs[0])
    nt.links.new(sunscale.outputs[0], emit_sun.inputs["Strength"])
    add = nt.nodes.new("ShaderNodeAddShader")
    add.location = (900, 0)
    nt.links.new(emit_sky.outputs[0], add.inputs[0])
    nt.links.new(emit_sun.outputs[0], add.inputs[1])
    nt.links.new(add.outputs[0], out.inputs[0])
    m["cw_sky"] = 1
    return m


def build_dome():
    bm = bmesh.new()
    bm.loops.layers.uv.new("UVMap")
    bmesh.ops.create_uvsphere(bm, u_segments=96, v_segments=48, radius=DOME_R, calc_uvs=True)
    # Normals inward.
    bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new("sky_dome")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("sky_dome", me)
    collection("sky").objects.link(ob)
    ob.location = EYE
    me.materials.append(_dome_material())
    for p in me.polygons:
        p.use_smooth = True
    ob["cw_piece"] = "sky"
    ob.visible_shadow = False
    return ob


def _cloud_material(name, base_z, top_z):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (1000, 0)
    diff = nt.nodes.new("ShaderNodeBsdfDiffuse")
    diff.location = (-600, 0)
    s2r = nt.nodes.new("ShaderNodeShaderToRGB")
    s2r.location = (-400, 0)
    nt.links.new(diff.outputs[0], s2r.inputs[0])
    bw = nt.nodes.new("ShaderNodeRGBToBW")
    bw.location = (-200, 0)
    nt.links.new(s2r.outputs[0], bw.inputs[0])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.location = (0, 0)
    cr = ramp.color_ramp
    cr.interpolation = "LINEAR"
    stops = [(0.0, P["cloud_deep"]), (0.16, P["cloud_shadow"]), (0.24, "#b08fbe"), (0.40, "#e2a7b4"), (0.48, P["cloud_lit2"]), (0.72, P["cloud_lit2"]), (0.78, P["cloud_lit"]), (1.0, "#fff4e4")]
    cr.elements[0].position, cr.elements[0].color = stops[0][0], srgb(stops[0][1])
    cr.elements[1].position, cr.elements[1].color = stops[-1][0], srgb(stops[-1][1])
    for pos, col in stops[1:-1]:
        e = cr.elements.new(pos)
        e.color = srgb(col)
    nt.links.new(bw.outputs[0], ramp.inputs[0])
    # Pink bases: world height.
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    geo.location = (-600, -300)
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    sep.location = (-400, -300)
    nt.links.new(geo.outputs["Position"], sep.inputs[0])
    hz = nt.nodes.new("ShaderNodeMapRange")
    hz.location = (-200, -300)
    hz.interpolation_type = "SMOOTHSTEP"
    hz.inputs["From Min"].default_value = base_z + (top_z - base_z) * 0.22
    hz.inputs["From Max"].default_value = base_z
    nt.links.new(sep.outputs["Z"], hz.inputs["Value"])
    hzm = nt.nodes.new("ShaderNodeMath")
    hzm.operation = "MULTIPLY"
    hzm.inputs[1].default_value = 0.55
    hzm.location = (0, -300)
    nt.links.new(hz.outputs[0], hzm.inputs[0])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MIX"
    mix.location = (300, 0)
    nt.links.new(hzm.outputs[0], mix.inputs["Factor"])
    nt.links.new(ramp.outputs[0], mix.inputs[6])
    mix.inputs[7].default_value = srgb(P["cloud_base"])
    # Silver lining: where the camera looks toward the sun, the cloud's silhouette glows gold.
    lw = nt.nodes.new("ShaderNodeLayerWeight")
    lw.location = (-200, -600)
    lw.inputs["Blend"].default_value = 0.5
    rimp = nt.nodes.new("ShaderNodeMath")
    rimp.operation = "POWER"
    rimp.inputs[1].default_value = 4.0
    rimp.location = (0, -600)
    nt.links.new(lw.outputs["Facing"], rimp.inputs[0])
    sd = sun_dir()
    neg = nt.nodes.new("ShaderNodeVectorMath")
    neg.operation = "SCALE"
    neg.inputs["Scale"].default_value = -1.0
    neg.location = (-400, -800)
    nt.links.new(geo.outputs["Incoming"], neg.inputs[0])
    bdot = nt.nodes.new("ShaderNodeVectorMath")
    bdot.operation = "DOT_PRODUCT"
    bdot.inputs[1].default_value = (sd.x, sd.y, sd.z)
    bdot.location = (-200, -800)
    nt.links.new(neg.outputs[0], bdot.inputs[0])
    back = nt.nodes.new("ShaderNodeMapRange")
    back.location = (0, -800)
    back.interpolation_type = "SMOOTHSTEP"
    back.inputs["From Min"].default_value = 0.35
    back.inputs["From Max"].default_value = 0.95
    nt.links.new(bdot.outputs["Value"], back.inputs["Value"])
    rim = nt.nodes.new("ShaderNodeMath")
    rim.operation = "MULTIPLY"
    rim.location = (200, -700)
    nt.links.new(rimp.outputs[0], rim.inputs[0])
    nt.links.new(back.outputs[0], rim.inputs[1])
    rimc = nt.nodes.new("ShaderNodeMath")
    rimc.operation = "MINIMUM"
    rimc.inputs[1].default_value = 1.0
    rimc.location = (350, -700)
    rim2 = nt.nodes.new("ShaderNodeMath")
    rim2.operation = "MULTIPLY"
    rim2.inputs[1].default_value = 2.5
    rim2.location = (300, -800)
    nt.links.new(rim.outputs[0], rim2.inputs[0])
    nt.links.new(rim2.outputs[0], rimc.inputs[0])
    mixr = nt.nodes.new("ShaderNodeMix")
    mixr.data_type = "RGBA"
    mixr.blend_type = "MIX"
    mixr.location = (450, 0)
    nt.links.new(rimc.outputs[0], mixr.inputs["Factor"])
    nt.links.new(mix.outputs[2], mixr.inputs[6])
    mixr.inputs[7].default_value = srgb("#ffd79a")
    em = nt.nodes.new("ShaderNodeEmission")
    em.location = (700, 0)
    nt.links.new(mixr.outputs[2], em.inputs["Color"])
    nt.links.new(em.outputs[0], out.inputs[0])
    m["cw_cloud"] = 1
    return m


def _metaball_cloud(name, balls, resolution):
    mb = bpy.data.metaballs.new(name)
    mb.resolution = resolution
    mb.render_resolution = resolution
    mb.threshold = 0.6
    for (x, y, z, r) in balls:
        e = mb.elements.new()
        e.co = (x, y, z)
        e.radius = r
    ob = bpy.data.objects.new(name, mb)
    collection("sky").objects.link(ob)
    return ob


def _to_mesh(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    mo = bpy.data.objects.new(ob.name + "_m", me)
    collection("sky").objects.link(mo)
    mo.matrix_world = ob.matrix_world.copy()
    mb = ob.data
    bpy.data.objects.remove(ob)
    bpy.data.metaballs.remove(mb)
    return mo


def cumulus(name, center, width, height, seed, tower=False, anvil=False, lumpiness=1.0):
    """A cloud mass as metaballs: a flat base, stacked domes (tower), cauliflower lumps over the top surface."""
    r = rng(seed)
    cx, cy, cz = center
    balls = []
    # Base layer: wide, flattened row.
    n_base = max(4, int(width / (height * 0.35 + 1)))
    for i in range(n_base):
        t = (i + 0.5) / n_base - 0.5
        rad = height * (0.30 + 0.12 * r.random())
        balls.append((cx + t * width, cy + (r.random() - 0.5) * width * 0.25, cz + rad * 0.55, rad))
    if tower:
        levels = 7
        for k in range(levels):
            f = k / (levels - 1)
            rad = height * (0.26 - 0.07 * f) * (1.0 + 0.2 * r.random())
            off = (r.random() - 0.5) * width * 0.12
            balls.append((cx + off, cy + (r.random() - 0.5) * width * 0.1, cz + height * (0.25 + 0.68 * f), rad))
            for side in (-1, 1):
                balls.append((cx + off + side * rad * (0.7 + 0.3 * r.random()), cy + (r.random() - 0.5) * rad, cz + height * (0.22 + 0.66 * f), rad * 0.75))
    else:
        for k in range(int(n_base * 1.5)):
            t = r.random() - 0.5
            rad = height * (0.22 + 0.16 * r.random())
            balls.append((cx + t * width * 0.8, cy + (r.random() - 0.5) * width * 0.2, cz + height * (0.45 + 0.3 * r.random()) * (1 - abs(t)), rad))
    if anvil:
        top = cz + height * 0.95
        for k in range(14):
            t = (k / 13) - 0.35
            rad = height * 0.12
            balls.append((cx + t * width * 1.25, cy + (r.random() - 0.5) * width * 0.15, top + (r.random() - 0.3) * height * 0.04, rad))
    # Cauliflower lumps on the upper surfaces, then smaller lumps on those.
    def lumps(src, count, lo, hi, reach):
        out = []
        for (x, y, z, rad) in src:
            for j in range(count):
                a = r.random() * 2 * math.pi
                el = r.uniform(-0.1, 1.35)
                d = Vector((math.cos(a) * math.cos(el), math.sin(a) * math.cos(el) * 0.7, math.sin(el)))
                out.append((x + d.x * rad * reach, y + d.y * rad * reach, z + d.z * rad * reach, rad * r.uniform(lo, hi)))
        return out
    l1 = lumps(list(balls), int(3 * lumpiness), 0.32, 0.62, 0.78)
    l2 = lumps(r.sample(l1, len(l1) // 3), 1, 0.4, 0.6, 0.75)
    balls += l1 + l2
    ob = _metaball_cloud(name, [(x - cx, y - cy, z - cz, rr) for (x, y, z, rr) in balls], resolution=height * 0.016)
    ob.location = (cx, cy, cz)
    mo = _to_mesh(ob)
    mo.data.materials.append(_cloud_material(name + "_mat", cz, cz + height))
    for p in mo.data.polygons:
        p.use_smooth = True
    mo["cw_piece"] = "sky"
    mo.visible_shadow = False
    return mo


def place(az_deg, dist, alt):
    a = math.radians(az_deg)
    return (EYE.x + math.sin(a) * dist, EYE.y + math.cos(a) * dist, alt)


def build_clouds():
    obs = []
    # The tower to the south-south-east, lit on its sun (right) side.
    tx, ty, tz = place(168, 2100, 40)
    obs.append(cumulus("cloud_tower", (tx, ty, tz), 640, 860, seed=7, tower=True, anvil=True, lumpiness=1.2))
    # A second, smaller tower to its left.
    x, y, z = place(141, 2250, 60)
    obs.append(cumulus("cloud_tower2", (x, y, z), 420, 560, seed=11, tower=True, lumpiness=1.0))
    # Horizon bank: low broken cumulus from east to west.
    r = rng(5)
    for i, az in enumerate([100, 110, 121, 133, 147, 158, 181, 190, 199, 208, 218, 228, 240, 266, 276, 288]):
        d = 2250 + r.uniform(-100, 120)
        w = r.uniform(240, 420)
        h = r.uniform(90, 190)
        x, y, z = place(az, d, r.uniform(25, 60))
        obs.append(cumulus(f"cloud_bank{i}", (x, y, z), w, h, seed=100 + i, lumpiness=0.8))
    # Mid-height puffs.
    for i, (az, el_alt) in enumerate([(176, 330), (194, 420), (139, 470), (205, 260), (120, 300)]):
        x, y, z = place(az, 2100, el_alt)
        obs.append(cumulus(f"cloud_puff{i}", (x, y, z), r.uniform(120, 220), r.uniform(50, 90), seed=200 + i, lumpiness=0.7))
    # Behind the town (north and east): sunlit cumulus over the hills, seen from the stair and the harbour.
    for i, (az, d, alt, w, h) in enumerate([(5, 1900, 120, 520, 380), (40, 2000, 90, 420, 300), (330, 2050, 140, 380, 260), (70, 2100, 70, 300, 160), (300, 2100, 100, 260, 150)]):
        x, y, z = place(az, d, alt)
        obs.append(cumulus(f"cloud_north{i}", (x, y, z), w, h, seed=300 + i, tower=(i == 0), lumpiness=1.0))
    return obs


def build_light():
    sd = sun_dir()
    ld = bpy.data.lights.new("sun", "SUN")
    ld.energy = 8.0
    ld.color = srgb("#ffc48a")[:3]
    ld.angle = math.radians(0.6)
    ob = bpy.data.objects.new("sun", ld)
    collection("lights").objects.link(ob)
    # The light points along -its local Z; aim it from the sun direction.
    ob.rotation_mode = "QUATERNION"
    ob.rotation_quaternion = (-sd).to_track_quat("-Z", "Y")
    ob["cw_piece"] = "light"
    w = bpy.context.scene.world or bpy.data.worlds.new("World")
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = srgb("#9a93c8")
    bg.inputs["Strength"].default_value = 0.22
    return ob


def build():
    build_dome()
    build_light()
    build_clouds()
