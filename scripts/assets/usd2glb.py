"""Dev-time converter: a SimReady (OpenUSD) package -> one full-detail GLB. Not part of the studio or CI.

    <venv>/bin/python -I scripts/assets/usd2glb.py <in.usd> <out.glb> [--max-tex=1024] [--report=<out.json>]

The venv needs `usd-core` (pxr), `numpy` and `pillow`; it lives outside the repository
(~/.local/share/aether/simready/venv). The input is untrusted data: this script only READS geometry, material inputs
and image files (never runs anything from the package), and always runs with `python -I`.

What it does
  - world-space transforms of every visible, renderable mesh (instances and references resolved by USD),
    metres (stage metersPerUnit), Z-up -> Y-up (glTF);
  - triangulates, welds, keeps normals and the `st` UVs (face-varying, vertex or indexed), honours orientation;
  - one primitive per material: per-face materials from GeomSubsets (materialBind family), else the mesh's binding;
  - PBR from the surface network: the UsdPreviewSurface when it carries textures, else the OmniPBR (MDL) inputs next
    to it (diffuse/normal/emissive/opacity textures, metallic and roughness constants and maps). MDL-only effects
    (clear coat, subsurface, anisotropy, texture projection) are skipped and listed in the report;
  - --resmooth=<degrees>: weld coincident positions and recompute smooth normals with that crease angle, for CAD-style
    sources whose normals and UVs split every vertex (the split topology cannot be simplified); default off;
  - textures are resized to at most --max-tex px (default 1024), identical images are stored once, an opacity map is
    folded into the base colour alpha (MASK when binary, BLEND otherwise).
Joints and articulation are ignored (the model stays in its authored rest pose).
"""
import hashlib
import io
import json
import struct
import sys

import numpy as np
from PIL import Image
from pxr import Gf, Sdf, Usd, UsdGeom, UsdShade

args = [a for a in sys.argv[1:] if not a.startswith("--")]
opts = dict(a[2:].split("=", 1) for a in sys.argv[1:] if a.startswith("--") and "=" in a)
if len(args) != 2:
    sys.exit(__doc__)
SRC, DST = args
MAX_TEX = int(opts.get("max-tex", "1024"))
RESMOOTH = float(opts["resmooth"]) if "resmooth" in opts else None
report = {"skipped": [], "warnings": []}

stage = Usd.Stage.Open(SRC)
if not stage:
    sys.exit(f"cannot open {SRC}")
mpu = UsdGeom.GetStageMetersPerUnit(stage) or 1.0
up = UsdGeom.GetStageUpAxis(stage)


def to_world(p3):
    """Row vectors in stage units -> metres, Y up."""
    p = p3 * mpu
    if up == "Z":
        return np.stack([p[:, 0], p[:, 2], -p[:, 1]], axis=1)
    return p


def dirs_to_yup(n):
    if up == "Z":
        return np.stack([n[:, 0], n[:, 2], -n[:, 1]], axis=1)
    return n


def np3(v):
    return np.asarray(v, dtype=np.float64).reshape(-1, 3)


# ---------------------------------------------------------------------------------------------- textures
images = []  # (bytes, mime)
image_index = {}


def add_image(im, fmt):
    buf = io.BytesIO()
    if fmt == "PNG":
        im.save(buf, "PNG", optimize=True)
    else:
        im.convert("RGB").save(buf, "JPEG", quality=88, optimize=True)
    data = buf.getvalue()
    key = hashlib.sha256(data).hexdigest()
    if key not in image_index:
        image_index[key] = len(images)
        images.append((data, "image/png" if fmt == "PNG" else "image/jpeg"))
    return image_index[key]


def load_image(path):
    im = Image.open(path)
    im.load()
    if max(im.size) > MAX_TEX:
        s = MAX_TEX / max(im.size)
        im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
    return im


def asset_path(attr_value):
    if attr_value is None:
        return None
    p = attr_value.resolvedPath or ""
    return p if p else None


# ---------------------------------------------------------------------------------------------- materials
materials = []  # glTF material dicts
material_key = {}
textures = []  # {"source": image index}
texture_key = {}


def texture_ref(image_idx):
    if image_idx not in texture_key:
        texture_key[image_idx] = len(textures)
        textures.append({"source": image_idx, "sampler": 0})
    return {"index": texture_key[image_idx], "texCoord": 0}


def inputs_of(shader):
    return {i.GetBaseName(): i for i in shader.GetInputs()}


def traced(inp):
    """Value of a shader input, following one UsdUVTexture connection: ('tex', file, channel, scale, bias) or ('val', v)."""
    src = inp.GetConnectedSource()
    if src:
        prim = src[0].GetPrim()
        sh = UsdShade.Shader(prim)
        ident = sh.GetIdAttr().Get() if sh.GetIdAttr() else None
        if ident == "UsdUVTexture":
            f = sh.GetInput("file")
            fp = asset_path(f.Get()) if f else None
            ch = str(src[1]) if len(src) > 1 else "rgb"
            sc = sh.GetInput("scale").Get() if sh.GetInput("scale") else None
            bi = sh.GetInput("bias").Get() if sh.GetInput("bias") else None
            return ("tex", fp, ch, sc, bi)
        return ("val", None)
    v = inp.Get()
    return ("val", v)


def surface_shaders(mat):
    """(UsdPreviewSurface shader or None, OmniPBR shader or None) of a material."""
    preview, omni = None, None
    for child in mat.GetPrim().GetChildren():
        if not child.IsA(UsdShade.Shader):
            continue
        sh = UsdShade.Shader(child)
        ident = sh.GetIdAttr().Get() if sh.GetIdAttr() else None
        if ident == "UsdPreviewSurface":
            preview = sh
        else:
            a = child.GetAttribute("info:mdl:sourceAsset")
            name = (a.Get().path if a and a.Get() else "") or ""
            sub = child.GetAttribute("info:mdl:sourceAsset:subIdentifier")
            if "OmniPBR" in name or (sub and "OmniPBR" in str(sub.Get())):
                omni = sh
    return preview, omni


def tint(v):
    return [float(v[0]), float(v[1]), float(v[2])] if v is not None else [1.0, 1.0, 1.0]


def read_material(mat):
    """-> dict(base=RGB factor, baseTex=PIL|None, alphaTex=PIL|None, metallic, roughness, normalTex, emissive..., uv=(scale, translate))"""
    out = dict(base=[1, 1, 1], baseTex=None, alphaTex=None, alpha=1.0, metallic=0.0, roughness=0.5, normalTex=None, emissiveTex=None,
               emissive=[0, 0, 0], mrTex=None, uv=((1.0, 1.0), (0.0, 0.0)), name=mat.GetPrim().GetName())
    preview, omni = surface_shaders(mat)
    use_preview = False
    if preview is not None:
        pin = inputs_of(preview)
        use_preview = omni is None or any(traced(i)[0] == "tex" for i in pin.values())
    if use_preview:
        pin = inputs_of(preview)

        def val(name, default):
            i = pin.get(name)
            if i is None:
                return ("val", default)
            t = traced(i)
            return t if (t[0] == "tex" or t[1] is not None) else ("val", default)

        t = val("diffuseColor", (0.5, 0.5, 0.5))
        if t[0] == "tex" and t[1]:
            out["baseTex"] = load_image(t[1])
        elif t[0] == "val":
            out["base"] = tint(t[1])
        t = val("metallic", 0.0)
        out["metallic"] = float(t[1]) if t[0] == "val" else 1.0
        t = val("roughness", 0.5)
        out["roughness"] = float(t[1]) if t[0] == "val" else 1.0
        t = val("normal", None)
        if t[0] == "tex" and t[1]:
            out["normalTex"] = load_image(t[1])
        t = val("opacity", 1.0)
        if t[0] == "val":
            out["alpha"] = float(t[1])
        elif t[1]:
            out["alphaTex"] = load_image(t[1]).convert("RGBA").getchannel("A" if t[2] == "a" else "R")
        t = val("emissiveColor", (0, 0, 0))
        if t[0] == "tex" and t[1]:
            out["emissiveTex"] = load_image(t[1])
            out["emissive"] = [1, 1, 1]
        elif t[0] == "val":
            out["emissive"] = tint(t[1])
        return out
    if omni is None:
        report["warnings"].append(f"{out['name']}: no surface network understood, default grey")
        return out
    d = {k: i.Get() for k, i in inputs_of(omni).items()}

    def tex(name):
        p = asset_path(d.get(name))
        return p

    p = tex("diffuse_texture")
    if p:
        out["baseTex"] = load_image(p)
        out["base"] = tint(d.get("diffuse_tint") or (1, 1, 1))
    else:
        out["base"] = tint(d.get("diffuse_color_constant") or (0.8, 0.8, 0.8))
    out["metallic"] = float(d.get("metallic_constant", 0.0) or 0.0)
    out["roughness"] = float(d.get("reflection_roughness_constant", 0.5) if d.get("reflection_roughness_constant") is not None else 0.5)
    mt, rt = tex("metallic_texture"), tex("reflectionroughness_texture") or tex("roughness_texture")
    if mt or rt:
        out["mrTex"] = (load_image(mt).convert("L") if mt else None, load_image(rt).convert("L") if rt else None)
        out["metallic"], out["roughness"] = (1.0 if mt else out["metallic"]), (1.0 if rt else out["roughness"])
    p = tex("normalmap_texture")
    if p:
        out["normalTex"] = load_image(p)
    if d.get("enable_emission"):
        p = tex("emissive_color_texture") or tex("emissive_mask_texture")
        if p:
            out["emissiveTex"] = load_image(p)
            out["emissive"] = [1, 1, 1]
        else:
            out["emissive"] = tint(d.get("emissive_color") or (0, 0, 0))
            # emissive_intensity is in cd/m2 (OmniPBR default 40): a glTF factor is 0..1.
            if (d.get("emissive_intensity") or 0) <= 0:
                out["emissive"] = [0, 0, 0]
    if d.get("enable_opacity"):
        p = tex("opacity_texture")
        if p and d.get("enable_opacity_texture"):
            out["alphaTex"] = load_image(p).convert("RGBA").getchannel("R")
        else:
            out["alpha"] = float(d.get("opacity_constant", 1.0))
    sc, tr = d.get("texture_scale"), d.get("texture_translate")
    out["uv"] = ((float(sc[0]), float(sc[1])) if sc else (1.0, 1.0), (float(tr[0]), float(tr[1])) if tr else (0.0, 0.0))
    if d.get("texture_rotate"):
        report["warnings"].append(f"{out['name']}: texture_rotate ignored")
    src = omni.GetPrim().GetAttribute("info:mdl:sourceAsset")
    if src and src.Get() and "ClearCoat" in src.Get().path:
        report["skipped"].append(f"{out['name']}: clear coat")
    for k in ("enable_retroreflection", "enable_anisotropy", "enable_sss"):
        if d.get(k):
            report["skipped"].append(f"{out['name']}: {k}")
    return out


def gltf_material(info, double_sided):
    key = (info["name"], double_sided)
    if key in material_key:
        return material_key[key]
    m = {"name": info["name"], "pbrMetallicRoughness": {"metallicFactor": min(1.0, max(0.0, info["metallic"])), "roughnessFactor": min(1.0, max(0.0, info["roughness"]))}}
    pbr = m["pbrMetallicRoughness"]
    base = info["base"] + [info["alpha"]]
    bt, at = info["baseTex"], info["alphaTex"]
    alpha_mode = "OPAQUE"
    if bt is not None or at is not None:
        rgb = (bt.convert("RGB") if bt is not None else Image.new("RGB", at.size, tuple(int(max(0, min(1, c)) ** (1 / 2.2) * 255) for c in info["base"])))
        if at is not None:
            a = at.resize(rgb.size, Image.BILINEAR) if at.size != rgb.size else at
            arr = np.asarray(a)
            mid = float(((arr > 12) & (arr < 243)).mean())
            alpha_mode = "BLEND" if mid > 0.05 else "MASK"
            rgba = rgb.convert("RGBA")
            rgba.putalpha(a)
            idx = add_image(rgba, "PNG")
            if alpha_mode == "MASK":
                m["alphaCutoff"] = 0.5
            base = [1, 1, 1, 1] if bt is not None else base
        else:
            idx = add_image(rgb, "JPEG")
        pbr["baseColorTexture"] = texture_ref(idx)
    elif info["alpha"] < 0.999:
        alpha_mode = "BLEND"
    pbr["baseColorFactor"] = [float(x) for x in base]
    if alpha_mode != "OPAQUE":
        m["alphaMode"] = alpha_mode
    if info["normalTex"] is not None:
        m["normalTexture"] = texture_ref(add_image(info["normalTex"].convert("RGB"), "PNG"))
    if info["mrTex"] is not None:
        mt, rt = info["mrTex"]
        size = (mt or rt).size
        r = np.asarray(rt.resize(size)) if rt is not None else np.full((size[1], size[0]), 255, np.uint8)
        mm = np.asarray(mt.resize(size)) if mt is not None else np.full((size[1], size[0]), 255, np.uint8)
        arr = np.stack([np.full_like(r, 255), r, mm], axis=2)
        pbr["metallicRoughnessTexture"] = texture_ref(add_image(Image.fromarray(arr, "RGB"), "PNG"))
    if info["emissiveTex"] is not None:
        m["emissiveTexture"] = texture_ref(add_image(info["emissiveTex"].convert("RGB"), "JPEG"))
    if any(info["emissive"]):
        m["emissiveFactor"] = [float(x) for x in info["emissive"]]
    if double_sided:
        m["doubleSided"] = True
    materials.append(m)
    material_key[key] = len(materials) - 1
    return material_key[key]


mat_cache = {}


def material_info(path):
    if path not in mat_cache:
        mat_cache[path] = read_material(UsdShade.Material(stage.GetPrimAtPath(path))) if path else None
    return mat_cache[path]


# ---------------------------------------------------------------------------------------------- geometry
def primvar_array(prim_api, name, n_corners, n_vertices, n_faces, fv_idx, vert_idx, face_of_slot):
    """Per face-varying slot values of a primvar, or None."""
    pv = prim_api.GetPrimvar(name)
    if not pv or not pv.HasValue():
        return None
    vals = pv.ComputeFlattened()
    if vals is None or len(vals) == 0:
        return None
    a = np.asarray(vals, dtype=np.float64)
    interp = pv.GetInterpolation()
    return per_slot(a, interp, n_corners, vert_idx, face_of_slot)


def per_slot(a, interp, n_corners, vert_idx, face_of_slot):
    if interp == "faceVarying":
        return a if len(a) == n_corners else None
    if interp in ("vertex", "varying"):
        return a[vert_idx]
    if interp == "uniform":
        return a[face_of_slot]
    if interp == "constant":
        return np.repeat(a[:1], n_corners, axis=0)
    return None



def resmooth(P, crease_deg):
    """Crease-angle smooth normals for unwelded triangle corners P (3T x 3, consecutive triples are triangles)."""
    T = len(P) // 3
    q = np.round(P / 1e-5).astype(np.int64)
    _, canon = np.unique(q, axis=0, return_inverse=True)
    canon = canon.reshape(-1)
    a, b, c = P[0::3], P[1::3], P[2::3]
    fn = np.cross(b - a, c - a)
    ln = np.linalg.norm(fn, axis=1, keepdims=True)
    un = fn / np.where(ln < 1e-30, 1, ln)

    def ang(u, v):
        lu, lv = np.linalg.norm(u, axis=1), np.linalg.norm(v, axis=1)
        return np.arccos(np.clip((u * v).sum(1) / np.maximum(lu * lv, 1e-30), -1, 1))

    w = np.stack([ang(b - a, c - a), ang(c - b, a - b), ang(a - c, b - c)], axis=1).reshape(-1)  # per corner
    face = np.repeat(np.arange(T), 3)
    order = np.argsort(canon, kind="stable")
    cs = canon[order]
    starts = np.flatnonzero(np.r_[True, cs[1:] != cs[:-1]])
    sizes = np.diff(np.r_[starts, len(cs)])
    gstart = np.repeat(starts, sizes)
    gsize = np.repeat(sizes, sizes)
    pos_in = np.arange(len(cs)) - gstart
    cos_t = np.cos(np.radians(crease_deg))
    my_face = face[order]
    acc = np.zeros((len(cs), 3))
    for d in range(0, int(sizes.max())):
        sel = d < gsize
        j = gstart + (pos_in + d) % gsize
        nf = face[order[j]]
        ok = sel & ((un[my_face] * un[nf]).sum(1) > cos_t)
        acc += np.where(ok[:, None], w[order[j]][:, None] * un[nf], 0.0)
    out = np.zeros((len(cs), 3))
    out[order] = acc
    ln = np.linalg.norm(out, axis=1, keepdims=True)
    out = out / np.where(ln < 1e-30, 1, ln)
    return np.round(out * 1024) / 1024


# per material -> list of (pos, nrm, uv) chunks
groups = {}
tri_total = 0
tri_in = 0

purposes = {UsdGeom.Tokens.default_, UsdGeom.Tokens.render}
xc = UsdGeom.XformCache(Usd.TimeCode.Default())
for prim in Usd.PrimRange(stage.GetPseudoRoot(), Usd.TraverseInstanceProxies()):
    if not prim.IsA(UsdGeom.Mesh):
        continue
    img = UsdGeom.Imageable(prim)
    if img.ComputeVisibility() == UsdGeom.Tokens.invisible or img.ComputePurpose() not in purposes:
        report["skipped"].append(f"{prim.GetPath()}: hidden or guide/proxy purpose")
        continue
    mesh = UsdGeom.Mesh(prim)
    counts = np.asarray(mesh.GetFaceVertexCountsAttr().Get(), dtype=np.int64)
    fvi = np.asarray(mesh.GetFaceVertexIndicesAttr().Get(), dtype=np.int64)
    pts = np3(mesh.GetPointsAttr().Get())
    if len(counts) == 0 or len(pts) == 0:
        continue
    nF, nC = len(counts), int(counts.sum())
    starts = np.cumsum(counts) - counts
    # triangulate (fan) into corner SLOTS (indices into the face-vertex arrays)
    nt = np.maximum(counts - 2, 0)
    f_rep = np.repeat(np.arange(nF), nt)
    k = np.arange(int(nt.sum())) - np.repeat(np.cumsum(nt) - nt, nt)
    s0 = starts[f_rep]
    slots = np.stack([s0, s0 + k + 1, s0 + k + 2], axis=1)
    M = np.array(xc.GetLocalToWorldTransform(prim), dtype=np.float64)
    flip = (mesh.GetOrientationAttr().Get() == UsdGeom.Tokens.leftHanded) ^ (np.linalg.det(M[:3, :3]) < 0)
    if flip:
        slots = slots[:, [0, 2, 1]]
    face_of_slot = np.repeat(np.arange(nF), counts)
    vert_idx = fvi
    flat_slots = slots.reshape(-1)
    tri_in += len(slots)
    # attributes per slot
    P = pts[vert_idx]
    P = to_world(P @ M[:3, :3] + M[3, :3])
    nrm = None
    na = mesh.GetNormalsAttr()
    if na.HasValue():
        nv = np3(na.Get())
        pvn = UsdGeom.PrimvarsAPI(prim).GetPrimvar("normals")
        if pvn and pvn.HasValue() and pvn.GetIndices():
            nv = np3(pvn.ComputeFlattened())
        nrm = per_slot(nv, mesh.GetNormalsInterpolation(), nC, vert_idx, face_of_slot)
    if nrm is not None:
        nrm = dirs_to_yup(nrm @ np.linalg.inv(M[:3, :3]).T)
        ln = np.linalg.norm(nrm, axis=1, keepdims=True)
        nrm = nrm / np.where(ln < 1e-12, 1, ln)
    uv = None
    papi = UsdGeom.PrimvarsAPI(prim)
    for name in ("st", "uv", "UVMap"):
        uv = primvar_array(papi, name, nC, len(pts), nF, fvi, vert_idx, face_of_slot)
        if uv is not None:
            break
    # per-face material
    face_mat = np.full(nF, -1, dtype=np.int64)
    mats = []
    base_mat = UsdShade.MaterialBindingAPI(prim).ComputeBoundMaterial()[0]
    mats.append(base_mat.GetPath().pathString if base_mat else "")
    face_mat[:] = 0
    for sub in UsdGeom.Subset.GetAllGeomSubsets(mesh):
        if sub.GetElementTypeAttr().Get() != UsdGeom.Tokens.face:
            continue
        b = UsdShade.MaterialBindingAPI(sub.GetPrim()).ComputeBoundMaterial()[0]
        ids = np.asarray(sub.GetIndicesAttr().Get(), dtype=np.int64)
        if not b or len(ids) == 0:
            continue
        mats.append(b.GetPath().pathString)
        face_mat[ids] = len(mats) - 1
    tri_mat = face_mat[f_rep]
    ds = bool(mesh.GetDoubleSidedAttr().Get())
    for mi in np.unique(tri_mat):
        sel = slots[tri_mat == mi].reshape(-1)
        n = nrm[sel] if nrm is not None else None
        if n is None:
            a, b2, c = P[sel[0::3]], P[sel[1::3]], P[sel[2::3]]
            fn = np.cross(b2 - a, c - a)
            ln = np.linalg.norm(fn, axis=1, keepdims=True)
            n = np.repeat(fn / np.where(ln < 1e-20, 1, ln), 3, axis=0)
        if RESMOOTH is not None:
            n = resmooth(P[sel], RESMOOTH)
        u = uv[sel] if uv is not None else np.zeros((len(sel), 2))
        groups.setdefault((mats[mi], ds), []).append((P[sel], n, u))

if not groups:
    sys.exit("no renderable meshes found")

# ---------------------------------------------------------------------------------------------- output
bin_chunks = []
views = []
accessors = []
prims_json = []


def add_view(data, target=None):
    pad = (-sum(len(c) for c in bin_chunks)) % 4
    if pad:
        bin_chunks.append(b"\0" * pad)
    off = sum(len(c) for c in bin_chunks)
    bin_chunks.append(data)
    v = {"buffer": 0, "byteOffset": off, "byteLength": len(data)}
    if target:
        v["target"] = target
    views.append(v)
    return len(views) - 1


def add_accessor(arr, ctype, atype, target, minmax=False):
    vi = add_view(arr.tobytes(), target)
    a = {"bufferView": vi, "componentType": ctype, "count": int(len(arr)), "type": atype}
    if minmax:
        a["min"] = [float(x) for x in arr.min(axis=0)]
        a["max"] = [float(x) for x in arr.max(axis=0)]
    accessors.append(a)
    return len(accessors) - 1


total_tris = total_verts = 0
bmin = np.full(3, np.inf)
bmax = np.full(3, -np.inf)
for (mpath, ds), chunks in sorted(groups.items(), key=lambda kv: kv[0][0]):
    P = np.concatenate([c[0] for c in chunks]).astype(np.float32)
    N = np.concatenate([c[1] for c in chunks]).astype(np.float32)
    U = np.concatenate([c[2] for c in chunks]).astype(np.float64)
    info = material_info(mpath) if mpath else None
    if info is None:
        info = dict(base=[0.6, 0.6, 0.6], baseTex=None, alphaTex=None, alpha=1.0, metallic=0.0, roughness=0.6, normalTex=None, emissiveTex=None, emissive=[0, 0, 0], mrTex=None, uv=((1.0, 1.0), (0.0, 0.0)), name="default")
    (su, sv), (tu, tv) = info["uv"]
    U = np.stack([U[:, 0] * su + tu, 1.0 - (U[:, 1] * sv + tv)], axis=1).astype(np.float32)
    # weld identical corners
    key = np.ascontiguousarray(np.concatenate([P, N, U], axis=1))
    void = key.view(np.dtype((np.void, key.dtype.itemsize * key.shape[1]))).ravel()
    _, first, inverse = np.unique(void, return_index=True, return_inverse=True)
    inverse = inverse.reshape(-1)
    P, N, U = P[first], N[first], U[first]
    idx = inverse.astype(np.uint32).reshape(-1)
    # drop degenerate triangles
    t = idx.reshape(-1, 3)
    ok = (t[:, 0] != t[:, 1]) & (t[:, 1] != t[:, 2]) & (t[:, 0] != t[:, 2])
    t = t[ok]
    total_tris += len(t)
    total_verts += len(P)
    bmin = np.minimum(bmin, P.min(axis=0))
    bmax = np.maximum(bmax, P.max(axis=0))
    ia = add_accessor(t.reshape(-1).astype(np.uint32 if len(P) > 65535 else np.uint16), 5125 if len(P) > 65535 else 5123, "SCALAR", 34963)
    pa = add_accessor(P, 5126, "VEC3", 34962, minmax=True)
    na_ = add_accessor(N, 5126, "VEC3", 34962)
    ua = add_accessor(U, 5126, "VEC2", 34962)
    prims_json.append({"attributes": {"POSITION": pa, "NORMAL": na_, "TEXCOORD_0": ua}, "indices": ia, "material": gltf_material(info, ds), "mode": 4})

image_json = []
for data, mime in images:
    image_json.append({"bufferView": add_view(data), "mimeType": mime})

name = SRC.rsplit("/", 1)[-1].rsplit(".", 1)[0]
doc = {
    "asset": {"version": "2.0", "generator": "aether usd2glb"},
    "scene": 0,
    "scenes": [{"nodes": [0]}],
    "nodes": [{"name": name, "mesh": 0}],
    "meshes": [{"name": name, "primitives": prims_json}],
    "materials": materials,
    "accessors": accessors,
    "bufferViews": views,
    "buffers": [{"byteLength": sum(len(c) for c in bin_chunks)}],
}
if textures:
    doc["textures"] = textures
    doc["images"] = image_json
    doc["samplers"] = [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}]
jb = json.dumps(doc, separators=(",", ":")).encode()
jb += b" " * ((-len(jb)) % 4)
bb = b"".join(bin_chunks)
bb += b"\0" * ((-len(bb)) % 4)
with open(DST, "wb") as f:
    f.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(jb) + 8 + len(bb)))
    f.write(struct.pack("<II", len(jb), 0x4E4F534A) + jb)
    f.write(struct.pack("<II", len(bb), 0x004E4942) + bb)

report.update(
    triangles_in=int(tri_in), triangles=int(total_tris), vertices=int(total_verts), materials=len(materials), images=len(images),
    size_m=[round(float(x), 4) for x in (bmax - bmin)], min=[round(float(x), 4) for x in bmin], max=[round(float(x), 4) for x in bmax],
    bytes=len(jb) + len(bb) + 28, source_up_axis=up, meters_per_unit=mpu,
)
if "report" in opts:
    with open(opts["report"], "w") as f:
        json.dump(report, f, indent=1)
print(json.dumps({k: v for k, v in report.items() if k not in ("skipped", "warnings")}))
for k in ("skipped", "warnings"):
    for line in report[k][:20]:
        print(f"{k}: {line}")
