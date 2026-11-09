"""Procedural PBR material library for photoreal vignettes. No image textures: every surface is built from noise, voronoi,
wave and bevel/AO nodes so it renders the same on any machine. Import from a Blender script:

    sys.path.insert(0, os.path.dirname(__file__)); import matlib as M
    mat = M.oak(); obj.data.materials.append(mat)

Every material has: albedo variation at two scales, roughness variation, a bump from real micro-structure, an edge-wear
mask (Bevel node) and a crevice-dirt mask (AO node). Each function takes colour/scale arguments so one recipe gives many
looks (limewash vs stone, oak vs painted pine).
"""
import bpy


# ---------------------------------------------------------------- node helpers
class NB:
    """Tiny node builder: nb.n('ShaderNodeTexNoise', scale=4) returns a node; nb.l(a_out, b_in) links sockets."""

    def __init__(self, name, volume=False):
        self.mat = bpy.data.materials.new(name)
        self.mat.use_nodes = True
        self.nt = self.mat.node_tree
        self.nt.nodes.clear()
        self.out = self.nt.nodes.new("ShaderNodeOutputMaterial")
        self.out.location = (1800, 0)
        self.x = 0

    def n(self, kind, inputs=None, **props):
        nd = self.nt.nodes.new(kind)
        for k, v in props.items():
            setattr(nd, k, v)
        for k, v in (inputs or {}).items():
            if k in nd.inputs:
                nd.inputs[k].default_value = v
        self.x += 180
        nd.location = (self.x - 900, 0)
        return nd

    def l(self, a, b):
        self.nt.links.new(a, b)

    def tex_noise(self, vec, scale, detail=5.0, rough=0.55, distortion=0.0, dim="3D"):
        t = self.n("ShaderNodeTexNoise", {"Scale": scale, "Detail": detail, "Roughness": rough, "Distortion": distortion},
                   noise_dimensions=dim)
        self.l(vec, t.inputs["Vector"])
        return t

    def voronoi(self, vec, scale, feature="F1", metric="EUCLIDEAN", rand=1.0):
        t = self.n("ShaderNodeTexVoronoi", {"Scale": scale, "Randomness": rand}, feature=feature, distance=metric)
        self.l(vec, t.inputs["Vector"])
        return t

    def ramp(self, fac, stops, interp="LINEAR"):
        r = self.n("ShaderNodeValToRGB")
        r.color_ramp.interpolation = interp
        while len(r.color_ramp.elements) < len(stops):
            r.color_ramp.elements.new(0.5)
        for e, (p, c) in zip(r.color_ramp.elements, stops):
            e.position = p
            e.color = c if len(c) == 4 else (*c, 1.0)
        self.l(fac, r.inputs["Fac"])
        return r

    def mix(self, a, b, fac, blend="MIX"):
        m = self.n("ShaderNodeMixRGB", blend_type=blend)
        if isinstance(fac, (int, float)):
            m.inputs["Fac"].default_value = fac
        else:
            self.l(fac, m.inputs["Fac"])
        for sock, v in (("Color1", a), ("Color2", b)):
            if hasattr(v, "node"):
                self.l(v, m.inputs[sock])
            else:
                m.inputs[sock].default_value = v if len(v) == 4 else (*v, 1.0)
        return m.outputs["Color"]

    def math(self, op, a, b=None, clamp=False):
        m = self.n("ShaderNodeMath", operation=op, use_clamp=clamp)
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if hasattr(v, "node"):
                self.l(v, m.inputs[i])
            else:
                m.inputs[i].default_value = v
        return m.outputs[0]

    def mapping(self, scale=(1, 1, 1), loc=(0, 0, 0), rot=(0, 0, 0), src="Object"):
        tc = self.n("ShaderNodeTexCoord")
        mp = self.n("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = scale
        mp.inputs["Location"].default_value = loc
        mp.inputs["Rotation"].default_value = rot
        self.l(tc.outputs[src], mp.inputs["Vector"])
        return mp.outputs["Vector"]

    def bump(self, height, strength=0.3, dist=0.01, normal=None):
        b = self.n("ShaderNodeBump", {"Strength": strength, "Distance": dist})
        self.l(height, b.inputs["Height"])
        if normal is not None:
            self.l(normal, b.inputs["Normal"])
        return b.outputs["Normal"]

    def edge_mask(self, radius=0.01, power=3.0):
        """1 on convex bevelled edges, 0 on flats: wear and chipped paint."""
        bv = self.n("ShaderNodeBevel", {"Radius": radius}, samples=6)
        geo = self.n("ShaderNodeNewGeometry")
        d = self.n("ShaderNodeVectorMath", operation="DOT_PRODUCT")
        self.l(bv.outputs["Normal"], d.inputs[0])
        self.l(geo.outputs["Normal"], d.inputs[1])
        inv = self.math("SUBTRACT", 1.0, d.outputs["Value"])
        return self.math("MULTIPLY", inv, 40.0 * power / 3.0, clamp=True)

    def ao(self, dist=0.05, inside=False):
        a = self.n("ShaderNodeAmbientOcclusion", {"Distance": dist}, inside=inside, samples=8)
        return a.outputs["AO"]

    def bsdf(self, base=None, rough=None, **kw):
        b = self.n("ShaderNodeBsdfPrincipled")
        self.l(b.outputs["BSDF"], self.out.inputs["Surface"])
        for k, v in kw.items():
            k = k.replace("_", " ")
            if k in b.inputs:
                b.inputs[k].default_value = v
        for sock, v in (("Base Color", base), ("Roughness", rough)):
            if v is None:
                continue
            if hasattr(v, "node"):
                self.l(v, b.inputs[sock])
            elif sock == "Base Color":
                b.inputs[sock].default_value = v if len(v) == 4 else (*v, 1.0)
            else:
                b.inputs[sock].default_value = v
        return b


def _obj_random(nb):
    oi = nb.n("ShaderNodeObjectInfo")
    return oi.outputs["Random"]


# ---------------------------------------------------------------- materials
def stone(name="Stone", tint=(0.42, 0.38, 0.32), whitewash=0.0, scale=1.0):
    """Rough limestone rubble. Per-object random shifts value; optional limewash coating by world noise and height."""
    nb = NB(name)
    rnd = _obj_random(nb)
    obj_c = nb.mapping((scale * 6,) * 3)
    big = nb.tex_noise(nb.mapping((scale * 2.0,) * 3), 1.0, 4, 0.6)
    fine = nb.tex_noise(obj_c, 30.0, 8, 0.65)
    vor = nb.voronoi(nb.mapping((scale * 40,) * 3), 1.0, "F1")
    r1 = nb.ramp(big.outputs["Fac"], [(0.35, (0.55, 0.52, 0.46)), (0.65, (1.0, 0.95, 0.85))])
    shift = nb.math("MULTIPLY", rnd, 0.9)
    hue = nb.ramp(rnd, [(0.0, (0.62, 0.55, 0.40)), (0.4, (0.50, 0.47, 0.42)), (0.7, (0.42, 0.36, 0.30)), (1.0, (0.55, 0.50, 0.44))]).outputs["Color"]
    base = nb.mix(tint, hue, 0.75)
    base = nb.mix(base, (tint[0] * 0.5, tint[1] * 0.47, tint[2] * 0.45), nb.math("MULTIPLY", shift, 0.5))
    base = nb.mix(base, r1.outputs["Color"], 0.45, "MULTIPLY")
    base = nb.mix(base, (0.12, 0.10, 0.08), nb.math("MULTIPLY", nb.ramp(fine.outputs["Fac"], [(0.55, (0, 0, 0)), (0.8, (1, 1, 1))]).outputs["Color"].node.outputs[0], 0.5), "MIX")
    ao = nb.ao(0.08)
    base = nb.mix((0.04, 0.035, 0.03), base, nb.math("MULTIPLY", ao, 1.0), "MIX")
    if whitewash > 0:
        wp = nb.n("ShaderNodeNewGeometry")
        wn = nb.tex_noise(wp.outputs["Position"], 3.5 * scale, 6, 0.6, 0.3)
        sep = nb.n("ShaderNodeSeparateXYZ")
        nb.l(wp.outputs["Position"], sep.inputs[0])
        zf = nb.math("MULTIPLY", sep.outputs["Z"], 0.5)
        cov = nb.math("ADD", wn.outputs["Fac"], nb.math("SUBTRACT", zf, 0.55 - whitewash))
        mask = nb.ramp(cov, [(0.5, (0, 0, 0)), (0.56, (1, 1, 1))]).outputs["Color"]
        mask = nb.math("MULTIPLY", mask.node.outputs[0], 1.0)
        chalk = nb.mix((0.80, 0.76, 0.68), (0.62, 0.58, 0.5), nb.ramp(fine.outputs["Fac"], [(0.3, (0, 0, 0)), (0.7, (1, 1, 1))]).outputs["Color"].node.outputs[0])
        chalk = nb.mix(chalk, (0.32, 0.28, 0.22), nb.math("MULTIPLY", nb.math("SUBTRACT", 1.0, ao), 0.9))
        base = nb.mix(base, chalk, mask)
    rough = nb.ramp(fine.outputs["Fac"], [(0.3, (0.7, 0.7, 0.7)), (0.7, (0.95, 0.95, 0.95))]).outputs["Color"].node.outputs[0]
    h = nb.math("ADD", nb.math("MULTIPLY", vor.outputs["Distance"], 0.5), fine.outputs["Fac"])
    nrm = nb.bump(h, 0.8, 0.02)
    b = nb.bsdf(base, rough, Specular_IOR_Level=0.35)
    nb.l(nrm, b.inputs["Normal"])
    return nb.mat


def plaster(name="Plaster", color=(0.74, 0.69, 0.60), grime=0.5, scale=1.0):
    """Hand-trowelled lime plaster: large soft undulation, trowel mottling, hairline cracks, grime near crevices."""
    nb = NB(name)
    big = nb.tex_noise(nb.mapping((scale * 1.2,) * 3), 1.0, 3, 0.5, 0.2)
    mid = nb.tex_noise(nb.mapping((scale * 5,) * 3), 1.0, 6, 0.6, 0.4)
    fine = nb.tex_noise(nb.mapping((scale * 120,) * 3), 1.0, 3, 0.5)
    cr = nb.voronoi(nb.mapping((scale * 3,) * 3), 1.0, "DISTANCE_TO_EDGE")
    crack = nb.ramp(cr.outputs["Distance"], [(0.0, (0.5, 0.5, 0.5)), (0.006, (0, 0, 0))]).outputs["Color"].node.outputs[0]
    base = nb.mix(color, (color[0] * 0.8, color[1] * 0.77, color[2] * 0.72), nb.ramp(mid.outputs["Fac"], [(0.35, (0, 0, 0)), (0.65, (1, 1, 1))]).outputs["Color"].node.outputs[0])
    base = nb.mix(base, (color[0] * 1.08, color[1] * 1.08, color[2] * 1.08), nb.ramp(big.outputs["Fac"], [(0.5, (0, 0, 0)), (0.8, (1, 1, 1))]).outputs["Color"].node.outputs[0])
    ao = nb.ao(0.35)
    base = nb.mix((0.2, 0.17, 0.13), base, nb.math("ADD", ao, 1.0 - grime), "MIX")
    base = nb.mix(base, (0.25, 0.22, 0.18), nb.math("MULTIPLY", crack, 0.5))
    h = nb.math("ADD", nb.math("ADD", big.outputs["Fac"], nb.math("MULTIPLY", mid.outputs["Fac"], 0.25)), nb.math("MULTIPLY", fine.outputs["Fac"], 0.08))
    h = nb.math("SUBTRACT", h, nb.math("MULTIPLY", crack, 0.15))
    b = nb.bsdf(base, 0.85, Specular_IOR_Level=0.3)
    nb.l(nb.bump(h, 0.6, 0.03), b.inputs["Normal"])
    return nb.mat


def wood(name="Oak", light=(0.42, 0.27, 0.14), dark=(0.20, 0.11, 0.05), grain_axis=0, scale=1.0, wear=0.6,
         paint=None, gloss=0.45, stains=True):
    """Aged wood: stretched noise fibres, wave growth rings distorted by noise, pores, edge wear to pale wood, water-ring
    stains and crevice dirt. If paint is a colour, a chipped paint coat covers it and wear reveals the wood."""
    nb = NB(name)
    sc = [30.0 * scale] * 3
    sc[grain_axis] = 1.2 * scale
    co = nb.mapping(tuple(sc))
    fibre = nb.tex_noise(co, 8.0, 8, 0.65, 0.2)
    ringsc = [8.0 * scale] * 3
    ringsc[grain_axis] = 0.3 * scale
    rco = nb.mapping(tuple(ringsc))
    dist = nb.tex_noise(rco, 1.5, 3, 0.5)
    wv = nb.n("ShaderNodeTexWave", {"Scale": 1.0, "Distortion": 6.0, "Detail": 2.0, "Detail Scale": 1.5}, wave_type="BANDS", bands_direction="DIAGONAL")
    nb.l(rco, wv.inputs["Vector"])
    ringmask = nb.ramp(wv.outputs["Fac"], [(0.2, (0, 0, 0)), (0.8, (1, 1, 1))]).outputs["Color"].node.outputs[0]
    tone = nb.math("ADD", nb.math("MULTIPLY", ringmask, 0.4), nb.math("MULTIPLY", fibre.outputs["Fac"], 0.6))
    base = nb.mix(light, dark, nb.ramp(tone, [(0.45, (0, 0, 0)), (0.95, (1, 1, 1))]).outputs["Color"].node.outputs[0])
    psc = [260.0 * scale] * 3
    psc[grain_axis] = 25.0 * scale
    pores = nb.voronoi(nb.mapping(tuple(psc)), 1.0, "F1")
    pore = nb.ramp(pores.outputs["Distance"], [(0.0, (1, 1, 1)), (0.22, (0, 0, 0))]).outputs["Color"].node.outputs[0]
    base = nb.mix(base, (0.05, 0.03, 0.015), nb.math("MULTIPLY", pore, 0.35))
    ao = nb.ao(0.04)
    base = nb.mix((0.06, 0.04, 0.025), base, nb.math("ADD", nb.math("MULTIPLY", ao, 0.5), 0.5))
    ssc = [700.0 * scale] * 3
    ssc[grain_axis] = 5.0 * scale
    sn = nb.tex_noise(nb.mapping(tuple(ssc)), 1.0, 2, 0.5)
    scratch = nb.ramp(sn.outputs["Fac"], [(0.6, (0, 0, 0)), (0.68, (1, 1, 1))]).outputs["Color"].node.outputs[0]
    base = nb.mix(base, (0.62, 0.5, 0.36), nb.math("MULTIPLY", scratch, 0.22))
    edge = nb.edge_mask(0.006)
    wearn = nb.tex_noise(nb.mapping((14 * scale,) * 3), 1.0, 5, 0.6)
    wear_mask = nb.math("MULTIPLY", edge, nb.ramp(wearn.outputs["Fac"], [(0.35, (0, 0, 0)), (0.6, (1, 1, 1))]).outputs["Color"].node.outputs[0])
    wear_mask = nb.math("MULTIPLY", wear_mask, wear * 1.6, clamp=True)
    pale = (min(1, light[0] * 1.4), min(1, light[1] * 1.35), min(1, light[2] * 1.25))
    rough_base = nb.math("ADD", nb.math("MULTIPLY", fibre.outputs["Fac"], 0.25), gloss)
    if stains:
        sp = nb.tex_noise(nb.mapping((2.5 * scale,) * 3), 1.0, 3, 0.5)
        ring = nb.voronoi(nb.mapping((6 * scale,) * 3, loc=(0.4, 0.2, 0)), 1.0, "F1")
        stain = nb.ramp(sp.outputs["Fac"], [(0.55, (0, 0, 0)), (0.75, (1, 1, 1))]).outputs["Color"].node.outputs[0]
        base = nb.mix(base, (0.12, 0.07, 0.035), nb.math("MULTIPLY", stain, 0.35))
    if paint:
        pn = nb.tex_noise(nb.mapping((18 * scale,) * 3), 1.0, 6, 0.6)
        chip = nb.math("ADD", wear_mask, nb.math("MULTIPLY", nb.ramp(pn.outputs["Fac"], [(0.62, (0, 0, 0)), (0.72, (1, 1, 1))]).outputs["Color"].node.outputs[0], 0.55 * wear), clamp=True)
        pcol = nb.mix(paint, (paint[0] * 0.8, paint[1] * 0.8, paint[2] * 0.8), nb.ramp(fibre.outputs["Fac"], [(0.4, (0, 0, 0)), (0.7, (1, 1, 1))]).outputs["Color"].node.outputs[0])
        pcol = nb.mix(pcol, (0.15, 0.12, 0.09), nb.math("MULTIPLY", nb.math("SUBTRACT", 1.0, ao), 0.6))
        base = nb.mix(pcol, base, chip)
        rough_base = nb.math("ADD", rough_base, nb.math("MULTIPLY", chip, -0.1))
    else:
        base = nb.mix(base, pale, nb.math("MULTIPLY", wear_mask, 0.8))
    h = nb.math("ADD", nb.math("MULTIPLY", fibre.outputs["Fac"], 0.5), nb.math("MULTIPLY", ringmask, 0.15))
    h = nb.math("SUBTRACT", h, nb.math("MULTIPLY", pore, 0.18))
    h = nb.math("SUBTRACT", h, nb.math("MULTIPLY", scratch, 0.2))
    b = nb.bsdf(base, nb.math("MULTIPLY", rough_base, 1.0, clamp=True), Specular_IOR_Level=0.5, Coat_Weight=0.08, Coat_Roughness=0.35)
    nb.l(nb.bump(h, 0.9, 0.004), b.inputs["Normal"])
    return nb.mat


def ceramic(name="Glaze", color=(0.86, 0.84, 0.78), rim=(0.18, 0.28, 0.36), scale=1.0, height=0.0, lip=(0.16, 0.08, 0.04)):
    """Glazed stoneware: glossy clearcoat over a slightly speckled body, pooled darker glaze toward the lower edge, crazing."""
    nb = NB(name)
    co = nb.mapping((scale * 12,) * 3)
    sp = nb.voronoi(nb.mapping((scale * 300,) * 3), 1.0, "F1")
    speck = nb.ramp(sp.outputs["Distance"], [(0.0, (1, 1, 1)), (0.1, (0, 0, 0))]).outputs["Color"].node.outputs[0]
    n = nb.tex_noise(co, 1.0, 4, 0.5)
    geo = nb.n("ShaderNodeNewGeometry")
    sep = nb.n("ShaderNodeSeparateXYZ")
    tc = nb.n("ShaderNodeTexCoord")
    nb.l(tc.outputs["Object"], sep.inputs[0])
    pool = nb.ramp(nb.math("ADD", nb.math("MULTIPLY", sep.outputs["Z"], -8.0), nb.math("MULTIPLY", n.outputs["Fac"], 0.8)),
                   [(0.15, (0, 0, 0)), (0.9, (1, 1, 1))]).outputs["Color"].node.outputs[0]
    base = nb.mix(color, rim, nb.math("MULTIPLY", pool, 0.9, clamp=True))
    base = nb.mix(base, (0.25, 0.2, 0.15), nb.math("MULTIPLY", speck, 0.5))
    if height:  # iron-brown lip where the glaze breaks over the rim, bare buff clay at the foot
        top = nb.ramp(sep.outputs["Z"], [(height * 0.93, (0, 0, 0)), (height * 0.985, (1, 1, 1))]).outputs["Color"].node.outputs[0]
        foot = nb.ramp(sep.outputs["Z"], [(0.0035, (1, 1, 1)), (0.0075, (0, 0, 0))]).outputs["Color"].node.outputs[0]
        base = nb.mix(base, lip, nb.math("MULTIPLY", top, nb.math("ADD", n.outputs["Fac"], 0.35), clamp=True))
        base = nb.mix(base, (0.62, 0.5, 0.38), foot)
    h = nb.math("MULTIPLY", n.outputs["Fac"], 0.3)
    b = nb.bsdf(base, nb.math("ADD", nb.math("MULTIPLY", n.outputs["Fac"], 0.08), 0.12), Coat_Weight=0.6, Coat_Roughness=0.03, Specular_IOR_Level=0.6)
    nb.l(nb.bump(h, 0.1, 0.001), b.inputs["Normal"])
    return nb.mat


def linen(name="Linen", color=(0.78, 0.74, 0.66), threads=140.0):
    """Woven cloth: two crossed wave patterns give warp and weft, slub noise varies thread thickness, sheen, no specular."""
    nb = NB(name)
    uv = nb.n("ShaderNodeTexCoord")
    mp = nb.n("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (threads, threads, threads)
    nb.l(uv.outputs["UV"], mp.inputs["Vector"])
    w1 = nb.n("ShaderNodeTexWave", {"Scale": 1.0, "Distortion": 0.6, "Detail": 0.0}, wave_type="BANDS", bands_direction="X", wave_profile="SIN")
    w2 = nb.n("ShaderNodeTexWave", {"Scale": 1.0, "Distortion": 0.6, "Detail": 0.0}, wave_type="BANDS", bands_direction="Y", wave_profile="SIN")
    nb.l(mp.outputs["Vector"], w1.inputs["Vector"])
    nb.l(mp.outputs["Vector"], w2.inputs["Vector"])
    weave = nb.math("ADD", w1.outputs["Fac"], w2.outputs["Fac"])
    slub = nb.tex_noise(nb.mapping((6, 80, 6), src="UV"), 1.0, 4, 0.5)
    slub2 = nb.tex_noise(nb.mapping((80, 6, 6), src="UV"), 1.0, 4, 0.5)
    base = nb.mix(color, (color[0] * 0.78, color[1] * 0.76, color[2] * 0.7), nb.math("ADD", slub.outputs["Fac"], slub2.outputs["Fac"]))
    base = nb.mix(base, (color[0] * 0.8, color[1] * 0.8, color[2] * 0.8), nb.math("MULTIPLY", weave, 0.5))
    ao = nb.ao(0.05)
    base = nb.mix((0.15, 0.12, 0.09), base, nb.math("ADD", nb.math("MULTIPLY", ao, 0.4), 0.6))
    ux = nb.n("ShaderNodeSeparateXYZ")
    nb.l(uv.outputs["UV"], ux.inputs[0])
    edge_d = nb.math("MINIMUM", ux.outputs["X"], nb.math("SUBTRACT", 1.0, ux.outputs["X"]))
    stripe = nb.ramp(nb.math("ABSOLUTE", nb.math("SUBTRACT", edge_d, 0.07)), [(0.0, (1, 1, 1)), (0.014, (0, 0, 0))], "LINEAR").outputs["Color"].node.outputs[0]
    stripe = nb.math("MULTIPLY", stripe, nb.math("ADD", slub.outputs["Fac"], 0.4), clamp=True)
    base = nb.mix(base, (0.07, 0.11, 0.25), stripe)
    b = nb.bsdf(base, 0.9, Sheen_Weight=0.5, Sheen_Roughness=0.4, Specular_IOR_Level=0.1, Subsurface_Weight=0.1)
    nb.l(nb.bump(nb.math("ADD", weave, nb.math("MULTIPLY", slub.outputs["Fac"], 0.5)), 0.35, 0.002), b.inputs["Normal"])
    return nb.mat


def bread_crust(name="Crust"):
    """Sourdough: baked gradient from pale at the score ears to deep brown, blistered micro-bump, dusting of flour, rough."""
    nb = NB(name)
    tc = nb.n("ShaderNodeTexCoord")
    n1 = nb.tex_noise(nb.mapping((9, 9, 9)), 1.0, 5, 0.6)
    blis = nb.voronoi(nb.mapping((55, 55, 55)), 1.0, "F1")
    fine = nb.tex_noise(nb.mapping((160, 160, 160)), 1.0, 4, 0.6)
    bake = nb.ramp(n1.outputs["Fac"], [(0.35, (0.36, 0.17, 0.065)), (0.55, (0.55, 0.3, 0.12)), (0.75, (0.72, 0.45, 0.2))]).outputs["Color"]
    bake = nb.mix(bake, (0.14, 0.06, 0.02), nb.math("MULTIPLY", nb.ramp(blis.outputs["Distance"], [(0.0, (1, 1, 1)), (0.35, (0, 0, 0))]).outputs["Color"].node.outputs[0], 0.5))
    flour_n = nb.tex_noise(nb.mapping((14, 14, 14)), 1.0, 6, 0.6)
    flour = nb.ramp(flour_n.outputs["Fac"], [(0.52, (0, 0, 0)), (0.68, (1, 1, 1))]).outputs["Color"].node.outputs[0]
    flour = nb.math("MULTIPLY", flour, nb.ramp(fine.outputs["Fac"], [(0.25, (0.5, 0.5, 0.5)), (0.6, (1, 1, 1))]).outputs["Color"].node.outputs[0])
    base = nb.mix(bake, (0.88, 0.84, 0.76), nb.math("MULTIPLY", flour, 0.85))
    gr = nb.n("ShaderNodeAttribute", attribute_name="groove", attribute_type="GEOMETRY")  # 1 in score cuts (set per vertex)
    base = nb.mix(base, (0.8, 0.62, 0.36), nb.math("MULTIPLY", gr.outputs["Fac"], 0.85, clamp=True))
    h = nb.math("ADD", nb.math("MULTIPLY", blis.outputs["Distance"], 0.6), nb.math("MULTIPLY", fine.outputs["Fac"], 0.3))
    b = nb.bsdf(base, nb.math("ADD", nb.math("MULTIPLY", flour, 0.3), 0.55), Subsurface_Weight=0.15, Specular_IOR_Level=0.3)
    b.inputs["Subsurface Radius"].default_value = (0.6, 0.3, 0.15)
    b.inputs["Subsurface Scale"].default_value = 0.01
    nb.l(nb.bump(h, 0.5, 0.004), b.inputs["Normal"])
    return nb.mat


def glass(name="Glass", tint=(0.93, 0.97, 0.95), smudge=0.5, thin=True):
    """Window glass. Shadow rays pass straight through so sunlight reaches the room (the standard interior trick), camera
    and bounce rays refract with IOR 1.45. A wiped-smudge roughness map and faint dust layer give it a lived-in look."""
    nb = NB(name)
    isshadow = nb.n("ShaderNodeLightPath")
    tr = nb.n("ShaderNodeBsdfTransparent", {"Color": (*tint, 1.0)})
    gl = nb.n("ShaderNodeBsdfGlass", {"IOR": 1.45}, distribution="MULTI_GGX")
    gl.inputs["Color"].default_value = (*tint, 1.0)
    sm = nb.tex_noise(nb.mapping((3, 3, 3)), 1.0, 5, 0.6, 1.5)
    swipe = nb.n("ShaderNodeTexWave", {"Scale": 3.0, "Distortion": 8.0, "Detail": 3.0}, wave_type="BANDS", bands_direction="DIAGONAL")
    nb.l(nb.mapping((1, 1, 1)), swipe.inputs["Vector"])
    smudge_m = nb.math("MULTIPLY", nb.ramp(sm.outputs["Fac"], [(0.45, (0, 0, 0)), (0.7, (1, 1, 1))]).outputs["Color"].node.outputs[0], smudge)
    rough = nb.math("ADD", nb.math("MULTIPLY", smudge_m, 0.18), 0.01)
    nb.l(rough, gl.inputs["Roughness"])
    dust = nb.n("ShaderNodeBsdfDiffuse", {"Color": (0.8, 0.78, 0.7, 1.0)})
    gl_d = nb.n("ShaderNodeMixShader", {"Fac": 0.0})
    nb.l(gl.outputs[0], gl_d.inputs[1])
    nb.l(dust.outputs[0], gl_d.inputs[2])
    nb.l(nb.math("MULTIPLY", smudge_m, 0.08), gl_d.inputs["Fac"])
    mx = nb.n("ShaderNodeMixShader")
    nb.l(isshadow.outputs["Is Shadow Ray"], mx.inputs["Fac"])
    nb.l(gl_d.outputs[0], mx.inputs[1])
    nb.l(tr.outputs[0], mx.inputs[2])
    nb.l(mx.outputs[0], nb.out.inputs["Surface"])
    return nb.mat


def terracotta(name="Terracotta", color=(0.55, 0.22, 0.10)):
    nb = NB(name)
    n = nb.tex_noise(nb.mapping((6, 6, 6)), 1.0, 6, 0.6)
    fine = nb.tex_noise(nb.mapping((120, 120, 120)), 1.0, 4, 0.6)
    base = nb.mix(color, (color[0] * 0.6, color[1] * 0.6, color[2] * 0.6), nb.ramp(n.outputs["Fac"], [(0.4, (0, 0, 0)), (0.7, (1, 1, 1))]).outputs["Color"].node.outputs[0])
    salt = nb.ramp(nb.tex_noise(nb.mapping((4, 4, 4)), 1.0, 5, 0.6).outputs["Fac"], [(0.6, (0, 0, 0)), (0.75, (1, 1, 1))]).outputs["Color"].node.outputs[0]
    base = nb.mix(base, (0.75, 0.7, 0.62), nb.math("MULTIPLY", salt, 0.45))
    ao = nb.ao(0.03)
    base = nb.mix((0.08, 0.05, 0.03), base, nb.math("ADD", nb.math("MULTIPLY", ao, 0.5), 0.5))
    b = nb.bsdf(base, nb.math("ADD", nb.math("MULTIPLY", fine.outputs["Fac"], 0.15), 0.78), Specular_IOR_Level=0.3)
    nb.l(nb.bump(nb.math("ADD", fine.outputs["Fac"], n.outputs["Fac"]), 0.4, 0.003), b.inputs["Normal"])
    return nb.mat


def soil(name="Soil"):
    nb = NB(name)
    n = nb.tex_noise(nb.mapping((60, 60, 60)), 1.0, 6, 0.7)
    base = nb.mix((0.05, 0.03, 0.02), (0.14, 0.09, 0.055), n.outputs["Fac"])
    b = nb.bsdf(base, 0.95)
    nb.l(nb.bump(n.outputs["Fac"], 1.0, 0.004), b.inputs["Normal"])
    return nb.mat


def leaf(name="Leaf", color=(0.10, 0.30, 0.05), vein=(0.4, 0.55, 0.2), glossy=0.35):
    """Plant leaf: UV-driven midrib and side veins, colour from base to tip, subsurface plus diffuse transmission so
    backlit leaves glow, waxy specular, per-object colour jitter."""
    nb = NB(name)
    rnd = _obj_random(nb)
    uv = nb.n("ShaderNodeTexCoord")
    sep = nb.n("ShaderNodeSeparateXYZ")
    nb.l(uv.outputs["UV"], sep.inputs[0])
    mid = nb.ramp(nb.math("ABSOLUTE", nb.math("SUBTRACT", sep.outputs["X"], 0.5)), [(0.0, (1, 1, 1)), (0.035, (0, 0, 0))]).outputs["Color"].node.outputs[0]
    side = nb.n("ShaderNodeTexWave", {"Scale": 14.0, "Distortion": 0.5}, wave_type="BANDS", bands_direction="Y")
    veins_c = nb.mapping((1, 1, 1), src="UV")
    nb.l(veins_c, side.inputs["Vector"])
    sidem = nb.math("MULTIPLY", nb.ramp(side.outputs["Fac"], [(0.85, (0, 0, 0)), (1.0, (1, 1, 1))]).outputs["Color"].node.outputs[0], 0.5)
    veinmask = nb.math("MAXIMUM", mid, sidem)
    n = nb.tex_noise(nb.mapping((14, 14, 14)), 1.0, 4, 0.5)
    shade = nb.mix(color, (color[0] * 1.6, color[1] * 1.5, color[2] * 0.9), nb.math("ADD", nb.math("MULTIPLY", sep.outputs["Y"], 0.6), nb.math("MULTIPLY", rnd, 0.4)))
    shade = nb.mix(shade, (0.2, 0.2, 0.05), nb.math("MULTIPLY", n.outputs["Fac"], 0.3))
    base = nb.mix(shade, vein, nb.math("MULTIPLY", veinmask, 0.6))
    b = nb.bsdf(base, nb.math("ADD", nb.math("MULTIPLY", n.outputs["Fac"], 0.15), glossy), Subsurface_Weight=0.5,
                Specular_IOR_Level=0.5, Coat_Weight=0.1, Coat_Roughness=0.3)
    b.inputs["Subsurface Radius"].default_value = (0.6, 1.0, 0.2)
    b.inputs["Subsurface Scale"].default_value = 0.02
    # diffuse transmission through the leaf (the backlit glow): mix a translucent shader
    tl = nb.n("ShaderNodeBsdfTranslucent")
    tcol = nb.mix(base, (0.45, 0.7, 0.12), 0.5)
    nb.l(tcol, tl.inputs["Color"])
    mx = nb.n("ShaderNodeMixShader", {"Fac": 0.4})
    nb.l(b.outputs[0], mx.inputs[1])
    nb.l(tl.outputs[0], mx.inputs[2])
    nb.l(mx.outputs[0], nb.out.inputs["Surface"])
    nb.l(nb.bump(nb.math("ADD", veinmask, 0.0), 0.3, 0.002), b.inputs["Normal"])
    return nb.mat


def metal(name="Brass", color=(0.78, 0.55, 0.25), rough=0.3, patina=0.4):
    nb = NB(name)
    n = nb.tex_noise(nb.mapping((10, 10, 10)), 1.0, 6, 0.6)
    fine = nb.tex_noise(nb.mapping((200, 4, 4)), 1.0, 5, 0.6)
    base = nb.mix(color, (color[0] * 0.45, color[1] * 0.35, color[2] * 0.2), nb.math("MULTIPLY", n.outputs["Fac"], patina * 2))
    b = nb.bsdf(base, nb.math("ADD", nb.math("MULTIPLY", n.outputs["Fac"], 0.25), rough), Metallic=1.0)
    nb.l(nb.bump(fine.outputs["Fac"], 0.15, 0.0008), b.inputs["Normal"])
    return nb.mat


def liquid(name="Coffee", color=(0.025, 0.012, 0.006)):
    nb = NB(name)
    b = nb.bsdf(color, 0.03, Specular_IOR_Level=0.6, IOR=1.33)
    return nb.mat


def steam_volume(name="Steam", density=1.6):
    """Rising vapour. Object-space box with x,y in +-0.5 and z in 0..1. Density = turbulent noise (domain-warped, scrolling
    upward with the frame number via a driver) masked by a plume that starts narrow at the cup and widens and thins with height."""
    nb = NB(name)
    tc = nb.n("ShaderNodeTexCoord")
    sep = nb.n("ShaderNodeSeparateXYZ")
    nb.l(tc.outputs["Object"], sep.inputs[0])
    warp = nb.n("ShaderNodeTexNoise", {"Scale": 3.0, "Detail": 3.0, "Roughness": 0.5}, noise_dimensions="4D")
    nb.l(tc.outputs["Object"], warp.inputs["Vector"])
    d = warp.inputs["W"].driver_add("default_value")
    d.driver.expression = "frame*0.012"
    wv = nb.n("ShaderNodeVectorMath", operation="SCALE")
    wc = nb.n("ShaderNodeVectorMath", operation="SUBTRACT")
    wc.inputs[1].default_value = (0.5, 0.5, 0.5)
    nb.l(warp.outputs["Color"], wc.inputs[0])
    nb.l(wc.outputs[0], wv.inputs[0])
    wv.inputs["Scale"].default_value = 0.5
    wadd = nb.n("ShaderNodeVectorMath", operation="ADD")
    nb.l(tc.outputs["Object"], wadd.inputs[0])
    nb.l(wv.outputs[0], wadd.inputs[1])
    mp = nb.n("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (9.0, 9.0, 5.0)
    nb.l(wadd.outputs[0], mp.inputs["Vector"])
    dz = mp.inputs["Location"].driver_add("default_value", 2)
    dz.driver.expression = "-frame*0.03"
    nt = nb.tex_noise(mp.outputs["Vector"], 1.0, 5, 0.6, 0.6)
    sepw = nb.n("ShaderNodeSeparateXYZ")
    nb.l(wadd.outputs[0], sepw.inputs[0])
    xy = nb.n("ShaderNodeCombineXYZ")
    nb.l(sepw.outputs["X"], xy.inputs["X"])
    nb.l(sepw.outputs["Y"], xy.inputs["Y"])
    rad = nb.n("ShaderNodeVectorMath", operation="LENGTH")
    nb.l(xy.outputs[0], rad.inputs[0])
    z = sep.outputs["Z"]
    width = nb.math("ADD", 0.06, nb.math("MULTIPLY", z, 0.42))      # plume radius grows with height
    rel = nb.math("DIVIDE", rad.outputs["Value"], width)
    radial = nb.ramp(rel, [(0.0, (1, 1, 1)), (1.0, (0, 0, 0))], "EASE").outputs["Color"].node.outputs[0]
    zf = nb.ramp(z, [(0.0, (0.0, 0.0, 0.0)), (0.04, (1, 1, 1)), (0.55, (0.55, 0.55, 0.55)), (1.0, (0, 0, 0))]).outputs["Color"].node.outputs[0]
    cut = nb.ramp(nt.outputs["Fac"], [(0.38, (0, 0, 0)), (0.68, (1, 1, 1))]).outputs["Color"].node.outputs[0]
    dens = nb.math("MULTIPLY", nb.math("MULTIPLY", cut, radial), zf)
    dens = nb.math("MULTIPLY", dens, density)
    pv = nb.n("ShaderNodeVolumePrincipled", {"Color": (0.95, 0.95, 0.95, 1.0), "Anisotropy": 0.45})
    nb.l(dens, pv.inputs["Density"])
    nb.l(pv.outputs[0], nb.out.inputs["Volume"])
    return nb.mat


def dust_air(name="RoomAir", density=0.012, aniso=0.55, edge_fade=False):
    """Room-filling thin atmosphere: noise-varied density so sun shafts show structure; forward scattering."""
    nb = NB(name)
    tc = nb.n("ShaderNodeTexCoord")
    n = nb.tex_noise(nb.mapping((0.9, 0.9, 0.9), src="Object"), 1.0, 3, 0.5, 0.3)
    dens = nb.math("MULTIPLY", nb.ramp(n.outputs["Fac"], [(0.3, (0.4, 0.4, 0.4)), (0.7, (1, 1, 1))]).outputs["Color"].node.outputs[0], density)
    if edge_fade:  # unit cube -0.5..0.5: density eases to zero at every face so a local shaft box has no visible edges
        ab = nb.n("ShaderNodeVectorMath", operation="ABSOLUTE")
        nb.l(tc.outputs["Object"], ab.inputs[0])
        sp = nb.n("ShaderNodeSeparateXYZ")
        nb.l(ab.outputs[0], sp.inputs[0])
        mx = nb.math("MAXIMUM", nb.math("MAXIMUM", sp.outputs["X"], sp.outputs["Y"]), sp.outputs["Z"])
        fade = nb.ramp(mx, [(0.28, (1, 1, 1)), (0.5, (0, 0, 0))], "EASE").outputs["Color"].node.outputs[0]
        dens = nb.math("MULTIPLY", dens, fade)
    pv = nb.n("ShaderNodeVolumePrincipled", {"Color": (1.0, 0.97, 0.9, 1.0), "Anisotropy": aniso})
    nb.l(dens, pv.inputs["Density"])
    nb.l(pv.outputs[0], nb.out.inputs["Volume"])
    return nb.mat


def mote(name="Mote"):
    nb = NB(name)
    b = nb.bsdf((0.9, 0.88, 0.8), 0.6, Emission_Strength=0.0)
    return nb.mat


def flagstone(name="Flagstone", tint=(0.36, 0.33, 0.29)):
    nb = NB(name)
    rnd = _obj_random(nb)
    big = nb.tex_noise(nb.mapping((3, 3, 3)), 1.0, 5, 0.6, 0.2)
    fine = nb.tex_noise(nb.mapping((50, 50, 50)), 1.0, 7, 0.65)
    base = nb.mix(tint, (tint[0] * 0.65, tint[1] * 0.65, tint[2] * 0.62), nb.math("MULTIPLY", rnd, 1.0))
    base = nb.mix(base, (tint[0] * 1.3, tint[1] * 1.25, tint[2] * 1.15), nb.ramp(big.outputs["Fac"], [(0.4, (0, 0, 0)), (0.7, (1, 1, 1))]).outputs["Color"].node.outputs[0])
    ao = nb.ao(0.15)
    base = nb.mix((0.04, 0.035, 0.03), base, nb.math("ADD", nb.math("MULTIPLY", ao, 0.7), 0.3))
    # worn polish: smoother where foot traffic (large noise)
    rough = nb.math("ADD", nb.math("MULTIPLY", big.outputs["Fac"], -0.35), 0.78)
    b = nb.bsdf(base, nb.math("ADD", rough, nb.math("MULTIPLY", fine.outputs["Fac"], 0.1)), Specular_IOR_Level=0.4)
    nb.l(nb.bump(nb.math("ADD", fine.outputs["Fac"], nb.math("MULTIPLY", big.outputs["Fac"], 0.6)), 0.5, 0.01), b.inputs["Normal"])
    return nb.mat


def mortar(name="Mortar"):
    nb = NB(name)
    n = nb.tex_noise(nb.mapping((20, 20, 20)), 1.0, 6, 0.65)
    base = nb.mix((0.05, 0.045, 0.04), (0.2, 0.18, 0.15), n.outputs["Fac"])
    b = nb.bsdf(base, 0.95)
    nb.l(nb.bump(n.outputs["Fac"], 0.6, 0.01), b.inputs["Normal"])
    return nb.mat


def paper(name="Paper", color=(0.82, 0.78, 0.68)):
    nb = NB(name)
    n = nb.tex_noise(nb.mapping((300, 300, 300)), 1.0, 3, 0.5)
    b = nb.bsdf(nb.mix(color, (color[0] * 0.8, color[1] * 0.8, color[2] * 0.75), n.outputs["Fac"]), 0.85, Subsurface_Weight=0.2)
    nb.l(nb.bump(n.outputs["Fac"], 0.3, 0.0005), b.inputs["Normal"])
    return nb.mat


def simple(name, color, rough=0.5, metallic=0.0):
    nb = NB(name)
    nb.bsdf(color, rough, Metallic=metallic)
    return nb.mat


def crumb(name="Crumb"):
    """Bread crumb: cream colour, voronoi air holes as bump and darker pits, a little subsurface."""
    nb = NB(name)
    v = nb.voronoi(nb.mapping((90, 90, 90)), 1.0, "F1")
    v2 = nb.voronoi(nb.mapping((30, 30, 30)), 1.0, "F1")
    n = nb.tex_noise(nb.mapping((10, 10, 10)), 1.0, 4, 0.5)
    holes = nb.ramp(v.outputs["Distance"], [(0.0, (1, 1, 1)), (0.3, (0, 0, 0))]).outputs["Color"].node.outputs[0]
    holes2 = nb.ramp(v2.outputs["Distance"], [(0.0, (1, 1, 1)), (0.22, (0, 0, 0))]).outputs["Color"].node.outputs[0]
    base = nb.mix((0.86, 0.74, 0.5), (0.7, 0.55, 0.32), n.outputs["Fac"])
    base = nb.mix(base, (0.35, 0.24, 0.12), nb.math("MULTIPLY", nb.math("ADD", holes, holes2), 0.35, clamp=True))
    b = nb.bsdf(base, 0.8, Subsurface_Weight=0.3, Specular_IOR_Level=0.2)
    b.inputs["Subsurface Radius"].default_value = (0.8, 0.5, 0.3)
    b.inputs["Subsurface Scale"].default_value = 0.01
    nb.l(nb.bump(nb.math("ADD", nb.math("MULTIPLY", holes, -1.0), nb.math("MULTIPLY", holes2, -0.8)), 0.8, 0.004), b.inputs["Normal"])
    return nb.mat


def grass(name="Grass"):
    """Spring meadow seen far away: large-scale colour drift between fresh and dry greens, blossom flecks, soft bump."""
    nb = NB(name)
    big = nb.tex_noise(nb.mapping((0.35, 0.35, 0.35)), 1.0, 4, 0.5)
    mid = nb.tex_noise(nb.mapping((3.0, 3.0, 3.0)), 1.0, 5, 0.6)
    fine = nb.tex_noise(nb.mapping((60.0, 60.0, 60.0)), 1.0, 5, 0.6)
    base = nb.mix((0.16, 0.34, 0.06), (0.36, 0.40, 0.10), big.outputs["Fac"])
    base = nb.mix(base, (0.07, 0.16, 0.035), nb.ramp(mid.outputs["Fac"], [(0.4, (0, 0, 0)), (0.7, (1, 1, 1))]).outputs["Color"].node.outputs[0])
    flecks = nb.ramp(fine.outputs["Fac"], [(0.72, (0, 0, 0)), (0.76, (1, 1, 1))]).outputs["Color"].node.outputs[0]
    base = nb.mix(base, (0.9, 0.85, 0.8), nb.math("MULTIPLY", flecks, 0.7))
    b = nb.bsdf(base, 0.9)
    nb.l(nb.bump(fine.outputs["Fac"], 0.5, 0.01), b.inputs["Normal"])
    return nb.mat


def lemon(name="Lemon"):
    nb = NB(name)
    v = nb.voronoi(nb.mapping((420, 420, 420)), 1.0, "F1")
    n = nb.tex_noise(nb.mapping((6, 6, 6)), 1.0, 4, 0.5)
    pits = nb.ramp(v.outputs["Distance"], [(0.0, (1, 1, 1)), (0.3, (0, 0, 0))]).outputs["Color"].node.outputs[0]
    base = nb.mix((0.92, 0.70, 0.07), (0.78, 0.60, 0.05), n.outputs["Fac"])
    base = nb.mix(base, (0.55, 0.45, 0.05), nb.math("MULTIPLY", pits, 0.4))
    b = nb.bsdf(base, nb.math("ADD", nb.math("MULTIPLY", pits, 0.15), 0.38), Subsurface_Weight=0.35, Specular_IOR_Level=0.5)
    b.inputs["Subsurface Radius"].default_value = (1.0, 0.6, 0.1)
    b.inputs["Subsurface Scale"].default_value = 0.004
    nb.l(nb.bump(nb.math("ADD", nb.math("MULTIPLY", pits, -1.0), n.outputs["Fac"]), 0.5, 0.0007), b.inputs["Normal"])
    return nb.mat
