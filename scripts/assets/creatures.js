/**
 * Animals for the asset library: properly shaped, skinned and animated
 * models in place of the cube-shaped stand-ins.
 *
 *   npx tsx scripts/assets/creatures.ts            # convert + merge into assets/catalog.json
 *
 * Sources (cached outside the repository in `~/.cache/aether-asset-src/creatures`):
 *  - "Farm Animals" by Quaternius (FBX, skinned, Idle / Walk / Run / Death / Jump clips).
 *    The archive carries its own `License.txt` that states CC0 1.0, which is the
 *    condition for vendoring anything from this author (see docs/THIRD_PARTY.md:
 *    the "Animals Pack" and "Animal Pack Vol.2" archives ship no licence file and are NOT used).
 *  - "Fox" from the Khronos glTF sample assets (CC0 model, CC-BY 4.0 rig and animation:
 *    credit is generated into the credits panel). A grey, larger recolour of it is the wolf.
 *
 * Output: content-hashed `assets/lib/m/<id>.<hash>.glb`, and `assets/creatures.json`
 * (the catalog entries and provenance), which `build.ts` merges on every library build.
 * Entries whose id the old cube-pet models used replace them.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { Bone, Matrix4, Quaternion, SkinnedMesh, Vector3 } from 'three';
import { Catalog } from '../../packages/assets/src/schema';
import { pickRoles } from '../../packages/assets/src/info';
import { deflateSync } from 'node:zlib';
import { decodePng } from '../../tests/e2e/support/png';
import { readFbx } from '../characters/fbx-node';
import { colliderFor, tagsFor } from './describe';
import { hullPoints, normaliseAnimated, sceneBounds, scenePositions } from './process';
const ROOT = resolve(import.meta.dirname, '../..');
const LIB = join(ROOT, 'assets', 'lib');
const SRC = join(homedir(), '.cache', 'aether-asset-src', 'creatures');
const FARM_SHA = '9ff42b7e2445eaf259e4734c08172637db92e4b59a6145909ac56d946152c39b';
const FOX_SHA = 'd97044e701822bac5a62696459b27d7b375aada5de8574ed4362edbba94771f7';
const sha = (d) => createHash('sha256').update(d).digest('hex');
const FARM_CLIPS = { Idle: 'idle', Walk: 'walk', WalkSlow: 'walk-slow', Run: 'run', Death: 'death', Jump: 'jump' };
/** Real-world sizes (shoulder to head tip bounding height). */
export const CREATURES = [
    { id: 'cow', name: 'Cow', file: 'Cow.fbx', h: 1.55, tags: 'cattle bull farm animal livestock', clips: FARM_CLIPS },
    { id: 'horse', name: 'Horse', file: 'Horse.fbx', h: 2.1, tags: 'stallion mare pony farm animal ride', clips: FARM_CLIPS },
    { id: 'zebra', name: 'Zebra', file: 'Zebra.fbx', h: 1.6, tags: 'savanna safari striped animal', clips: FARM_CLIPS },
    { id: 'sheep', name: 'Sheep', file: 'Sheep.fbx', h: 0.95, tags: 'lamb ram flock wool farm animal', clips: FARM_CLIPS },
    { id: 'pig', name: 'Pig', file: 'Pig.fbx', h: 0.85, tags: 'hog boar swine farm animal', clips: FARM_CLIPS },
    { id: 'llama', name: 'Llama', file: 'Llama.fbx', h: 1.75, tags: 'alpaca andes farm animal', clips: FARM_CLIPS },
    { id: 'dog', name: 'Dog (pug)', file: 'Pug.fbx', h: 0.42, tags: 'pug puppy hound pet companion', clips: FARM_CLIPS },
    { id: 'fox', name: 'Fox', file: 'Fox.glb', h: 0.5, tags: 'vixen woodland predator animal', authors: ['PixelMannen (model, CC0)', 'tomkranis (rig and animation, CC-BY 4.0)', '@AsoboStudio and @scurest (glTF conversion, CC-BY 4.0)'] },
    { id: 'wolf', name: 'Wolf', file: 'Fox.glb', h: 0.8, tags: 'hound predator pack howl animal', grey: true, authors: ['PixelMannen (model, CC0)', 'tomkranis (rig and animation, CC-BY 4.0)', '@AsoboStudio and @scurest (glTF conversion, CC-BY 4.0)'] },
];
/** Ids this script defines (the build drops the older cube-pet entries with the same id). */
export const CREATURE_IDS = CREATURES.map((c) => c.id);
const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++)
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});
function crc32(buf) {
    let c = 0xffffffff;
    for (const b of buf)
        c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    out.set(data, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
}
/** Recolour a coat texture to a cool grey-brown (keeps the light/dark pattern, the white belly stays pale). */
function greyTexture(png) {
    const img = decodePng(png);
    const raw = Buffer.alloc((img.width * 4 + 1) * img.height);
    for (let y = 0; y < img.height; y++) {
        raw[y * (img.width * 4 + 1)] = 0;
        for (let x = 0; x < img.width; x++) {
            const i = (y * img.width + x) * 4;
            const r = img.data[i];
            const g = img.data[i + 1];
            const b = img.data[i + 2];
            const lum = 0.3 * r + 0.59 * g + 0.11 * b;
            // Orange fur becomes grey-brown; near-white stays near-white.
            const pale = Math.min(1, Math.max(0, (Math.min(r, g, b) - 150) / 90));
            const k = 0.78 + 0.22 * pale;
            const o = y * (img.width * 4 + 1) + 1 + x * 4;
            raw[o] = Math.min(255, lum * k * 0.98 + 6 * (1 - pale));
            raw[o + 1] = Math.min(255, lum * k * 0.98 + 6 * (1 - pale));
            raw[o + 2] = Math.min(255, lum * k * 1.04 + 9 * (1 - pale));
            raw[o + 3] = img.data[i + 3];
        }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(img.width, 0);
    ihdr.writeUInt32BE(img.height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))]);
}
async function io() {
    await MeshoptEncoder.ready;
    await MeshoptDecoder.ready;
    return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
}
/** Convert one skinned FBX (cm or arbitrary units, any facing) into a glTF document in loader-world units. */
function fbxToDocument(file, id, rename) {
    const g = readFbx(file);
    g.updateMatrixWorld(true);
    let sm = null;
    g.traverse((o) => {
        if (o instanceof SkinnedMesh && !sm)
            sm = o;
    });
    if (!sm)
        throw new Error(`${file}: no skinned mesh`);
    const mesh = sm;
    g.updateMatrixWorld(true);
    const skeleton = mesh.skeleton;
    const doc = new Document();
    const buffer = doc.createBuffer();
    const scene = doc.createScene(id);
    // The skeleton as glTF nodes in the loader's world units (the normalising root rescales to metres later).
    // The armature object above the root bone carries a rotation and the unit scale: its rotation and position
    // become a node and its scale is folded into the bones' translations, so animation tracks apply unchanged.
    let rootBone = skeleton.bones[0];
    while (rootBone?.parent instanceof Bone)
        rootBone = rootBone.parent;
    if (!rootBone)
        throw new Error('no root bone');
    const nodeOf = new Map();
    const worldOf = new Map();
    const armatureWorld = new Matrix4();
    const armatureNode = doc.createNode('armature');
    if (rootBone.parent) {
        const p = new Vector3();
        const q = new Quaternion();
        rootBone.parent.matrixWorld.decompose(p, q, new Vector3());
        armatureWorld.compose(p, q, new Vector3(1, 1, 1));
        armatureNode.setTranslation([p.x, p.y, p.z]).setRotation([q.x, q.y, q.z, q.w]);
    }
    scene.addChild(armatureNode);
    const addBone = (b, parent, parentWorld) => {
        const parentScale = b.parent ? new Vector3().setFromMatrixScale(b.parent.matrixWorld).x : 1;
        const lp = new Vector3().copy(b.position).multiplyScalar(parentScale);
        const n = doc.createNode(b.name.replace(/[^A-Za-z0-9_.-]/g, '_')).setTranslation([lp.x, lp.y, lp.z]).setRotation([b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w]);
        const world = new Matrix4().copy(parentWorld).multiply(new Matrix4().compose(lp, b.quaternion, new Vector3(1, 1, 1)));
        worldOf.set(b, world);
        nodeOf.set(b, n);
        parent.addChild(n);
        for (const c of b.children)
            if (c instanceof Bone)
                addBone(c, n, world);
    };
    addBone(rootBone, armatureNode, armatureWorld);
    const joints = skeleton.bones.map((b) => nodeOf.get(b));
    const ibm = new Float32Array(joints.length * 16);
    // Inverse bind matrices from the FBX bind pose (scale removed: positions are already in world units).
    const bp = new Vector3();
    const bq = new Quaternion();
    skeleton.boneInverses.forEach((inv, i) => {
        new Matrix4().copy(inv).invert().decompose(bp, bq, new Vector3());
        ibm.set(new Matrix4().compose(bp, bq, new Vector3(1, 1, 1)).invert().elements, i * 16);
    });
    const skin = doc.createSkin(`${id}-skin`).setSkeleton(nodeOf.get(rootBone));
    skin.setInverseBindMatrices(doc.createAccessor('ibm', buffer).setType('MAT4').setArray(ibm));
    for (const j of joints)
        skin.addJoint(j);
    // Geometry, baked to world space at bind, one primitive per material (flat colours).
    const geo = mesh.geometry;
    const P = geo.attributes['position'];
    const N = geo.attributes['normal'];
    const SI = geo.attributes['skinIndex'];
    const SW = geo.attributes['skinWeight'];
    const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]);
    const groups = geo.groups.length > 0 ? geo.groups : [{ start: 0, count: geo.index?.count ?? P.count, materialIndex: 0 }];
    const normalMatrix = new Matrix4().extractRotation(mesh.bindMatrix);
    const gm = doc.createMesh(id);
    const byMat = new Map();
    for (const gr of groups) {
        const list = byMat.get(gr.materialIndex ?? 0) ?? [];
        byMat.set(gr.materialIndex ?? 0, list);
        for (let k = gr.start; k < gr.start + gr.count; k++)
            list.push(geo.index ? geo.index.getX(k) : k);
    }
    const v = new Vector3();
    const nrm = new Vector3();
    for (const [mi, ids] of byMat) {
        const remap = new Map();
        const op = [];
        const on = [];
        const oj = [];
        const ow = [];
        const oi = [];
        for (const vi of ids) {
            let o = remap.get(vi);
            if (o === undefined) {
                o = op.length / 3;
                remap.set(vi, o);
                v.set(P.getX(vi), P.getY(vi), P.getZ(vi)).applyMatrix4(mesh.bindMatrix);
                op.push(v.x, v.y, v.z);
                nrm.set(N.getX(vi), N.getY(vi), N.getZ(vi)).applyMatrix4(normalMatrix).normalize();
                on.push(nrm.x, nrm.y, nrm.z);
                oj.push(SI.getX(vi), SI.getY(vi), SI.getZ(vi), SI.getW(vi));
                const w = [SW.getX(vi), SW.getY(vi), SW.getZ(vi), SW.getW(vi)];
                const s = w[0] + w[1] + w[2] + w[3] || 1;
                ow.push(w[0] / s, w[1] / s, w[2] / s, w[3] / s);
            }
            oi.push(o);
        }
        const src = mats[mi];
        const m = doc
            .createMaterial(`${id}-${src.name || mi}`)
            .setBaseColorFactor([src.color.r, src.color.g, src.color.b, 1])
            .setMetallicFactor(0)
            .setRoughnessFactor(0.85);
        gm.addPrimitive(doc
            .createPrimitive()
            .setMaterial(m)
            .setIndices(doc.createAccessor('idx', buffer).setType('SCALAR').setArray(new Uint32Array(oi)))
            .setAttribute('POSITION', doc.createAccessor('pos', buffer).setType('VEC3').setArray(new Float32Array(op)))
            .setAttribute('NORMAL', doc.createAccessor('nor', buffer).setType('VEC3').setArray(new Float32Array(on)))
            .setAttribute('JOINTS_0', doc.createAccessor('jnt', buffer).setType('VEC4').setArray(new Uint16Array(oj)))
            .setAttribute('WEIGHTS_0', doc.createAccessor('wgt', buffer).setType('VEC4').setArray(new Float32Array(ow))));
    }
    scene.addChild(doc.createNode(`${id}-body`).setMesh(gm).setSkin(skin));
    // Clips: rotation and translation tracks (translation scaled by the parent's accumulated scale).
    const clips = g.animations;
    for (const clip of clips) {
        const short = clip.name.includes('|') ? clip.name.split('|').pop() : clip.name;
        const name = rename[short];
        if (!name)
            continue;
        const anim = doc.createAnimation(name);
        for (const t of clip.tracks) {
            const dot = t.name.lastIndexOf('.');
            const boneName = t.name.slice(0, dot);
            const prop = t.name.slice(dot + 1);
            const bone = skeleton.bones.find((b) => b.name === boneName);
            const node = bone ? nodeOf.get(bone) : undefined;
            if (!bone || !node || (prop !== 'quaternion' && prop !== 'position'))
                continue;
            let values = Float32Array.from(t.values);
            if (prop === 'position') {
                const parentScale = bone.parent ? new Vector3().setFromMatrixScale(bone.parent.matrixWorld).x : 1;
                values = values.map((x) => x * parentScale);
            }
            const input = doc.createAccessor('t', buffer).setType('SCALAR').setArray(Float32Array.from(t.times));
            const output = doc.createAccessor('v', buffer).setType(prop === 'quaternion' ? 'VEC4' : 'VEC3').setArray(values);
            const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
            anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(prop === 'quaternion' ? 'rotation' : 'translation').setSampler(sampler));
        }
    }
    // Which way does the head point along Z?
    const head = skeleton.bones.find((b) => /^Head$/i.test(b.name));
    const hips = skeleton.bones.find((b) => /^(Hips|Torso|Body)$/i.test(b.name));
    const hz = head ? head.getWorldPosition(new Vector3()).z : 0;
    const bz = hips ? hips.getWorldPosition(new Vector3()).z : 0;
    return { doc, headForward: hz >= bz ? 1 : -1 };
}
async function encode(nio, doc) {
    const plain = await nio.writeBinary(doc);
    try {
        const copy = await nio.readBinary(plain);
        copy.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
        const packed = await nio.writeBinary(copy);
        return packed.byteLength < plain.byteLength ? packed : plain;
    }
    catch {
        return plain;
    }
}
function checkSources() {
    const farmZip = join(SRC, 'farm-animals.zip');
    if (!existsSync(farmZip) || sha(readFileSync(farmZip)) !== FARM_SHA)
        throw new Error(`${farmZip} missing or its SHA-256 differs (expected ${FARM_SHA})`);
    const lic = readFileSync(join(SRC, 'farm-animals', 'License.txt'), 'utf8');
    if (!/CC0 1\.0 Universal/.test(lic))
        throw new Error('Farm Animals License.txt does not state CC0 1.0');
    const fox = join(SRC, 'Fox.glb');
    if (!existsSync(fox) || sha(readFileSync(fox)) !== FOX_SHA)
        throw new Error(`${fox} missing or its SHA-256 differs (expected ${FOX_SHA})`);
}
async function main() {
    checkSources();
    const nio = await io();
    const entries = [];
    const assets = [];
    for (const c of CREATURES) {
        const farm = c.file.endsWith('.fbx');
        let doc;
        let headForward = -1;
        if (farm) {
            const r = fbxToDocument(join(SRC, 'farm-animals', 'FBX', c.file), c.id, c.clips ?? FARM_CLIPS);
            doc = r.doc;
            headForward = r.headForward;
        }
        else {
            doc = await nio.read(join(SRC, c.file));
            headForward = 1;
            // Rename the Fox clips to the shared role names.
            const map = { Survey: 'idle', Walk: 'walk', Run: 'run' };
            for (const a of doc.getRoot().listAnimations())
                a.setName(map[a.getName()] ?? a.getName().toLowerCase());
        }
        if (c.grey)
            for (const t of doc.getRoot().listTextures())
                t.setImage(greyTexture(t.getImage()));
        const b = sceneBounds(doc);
        const sy = b.max[1] - b.min[1];
        const scale = c.h / sy;
        const offset = [-((b.min[0] + b.max[0]) / 2) * scale, -b.min[1] * scale, -((b.min[2] + b.max[2]) / 2) * scale];
        // Everything faces −Z in the library: turn models whose head points to +Z.
        const tris = normaliseAnimated(doc, scale, offset, headForward === 1);
        const clips = doc.getRoot().listAnimations().map((a) => a.getName());
        const positions = scenePositions(doc);
        const size = (() => {
            let mnx = Infinity, mxx = -Infinity, mnz = Infinity, mxz = -Infinity, mxy = -Infinity;
            for (let i = 0; i < positions.length; i += 3) {
                mnx = Math.min(mnx, positions[i]);
                mxx = Math.max(mxx, positions[i]);
                mxy = Math.max(mxy, positions[i + 1]);
                mnz = Math.min(mnz, positions[i + 2]);
                mxz = Math.max(mxz, positions[i + 2]);
            }
            const r = (x) => Math.round(x * 1000) / 1000;
            return [r(mxx - mnx), r(mxy), r(mxz - mnz)];
        })();
        const glb = await encode(nio, doc);
        const h = sha(glb);
        const rel = `m/${c.id}.${h.slice(0, 8)}.glb`;
        mkdirSync(join(LIB, 'm'), { recursive: true });
        // Drop older builds of this id (the previous cube-pet model, earlier conversions).
        for (const f of readdirSync(join(LIB, 'm')))
            if (new RegExp(`^${c.id}\\.[0-9a-f]{8}\\.glb$`).test(f) && `m/${f}` !== rel)
                unlinkSync(join(LIB, 'm', f));
        writeFileSync(join(LIB, rel), glb);
        const entry = {
            id: c.id,
            name: c.name,
            kind: 'model',
            category: 'animals',
            tags: tagsFor(c.id, c.name, 'animals', `${c.tags} animated realistic`, 'stylised'),
            style: 'stylised',
            pack: farm ? 'quaternius-farm-animals' : 'khronos-fox',
            size,
            tris,
            bytes: glb.byteLength,
            file: rel,
            lods: [],
            collider: colliderFor('hull', positions, hullPoints),
            placement: 'floor',
            facing: '-z',
            source: farm ? `quaternius/farm-animals/FBX/${c.file}` : 'khronos/glTF-Sample-Assets/Models/Fox/glTF-Binary/Fox.glb',
            ...(c.authors ? { authors: c.authors } : {}),
        };
        if (clips.length > 0)
            entry.anims = { ...pickRoles(clips), clips };
        entries.push(entry);
        assets.push({ id: c.id, pack: entry.pack, licence: farm ? 'CC0-1.0' : 'CC0-1.0 AND CC-BY-4.0', authors: c.authors ?? null, source: { archive: farm ? 'Farm Animals by Quaternius (opengameart.org/content/lowpoly-animated-farm-animal-pack)' : 'KhronosGroup/glTF-Sample-Assets Models/Fox', path: entry.source }, files: [{ path: rel, sha256: h, bytes: glb.byteLength }] });
        console.log(`${c.id}: ${tris} tris, ${(glb.byteLength / 1024).toFixed(0)} KB, size ${size.join(' x ')}, clips ${clips.join(',')}`);
    }
    Catalog.shape.entries.parse(entries);
    const out = {
        $comment: 'Animals shipped with the library. Generated by scripts/assets/creatures.ts; merged into catalog.json and manifest.json by build.ts.',
        packs: [
            { id: 'quaternius-farm-animals', title: 'Farm Animals (Quaternius)', author: 'Quaternius', licence: 'CC0-1.0', licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', url: 'https://opengameart.org/content/lowpoly-animated-farm-animal-pack', version: '2018-06' },
            { id: 'khronos-fox', title: 'Fox (glTF sample assets)', author: 'PixelMannen, tomkranis, AsoboStudio, scurest', licence: 'CC-BY-4.0', licenceUrl: 'https://creativecommons.org/licenses/by/4.0/', url: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Fox', version: 'main' },
        ],
        sources: [
            { id: 'quaternius-farm-animals', provider: 'Quaternius via OpenGameArt', title: 'Farm Animals', version: '2018-06', author: 'Quaternius', licence: 'CC0-1.0', licenceEvidence: 'License.txt inside the archive: "CC0 1.0 Universal (CC0 1.0) Public Domain Dedication"', archive: 'https://opengameart.org/sites/default/files/Farm%20Animals%20by%20%40Quaternius.zip', sha256: FARM_SHA, retrieved: '2026-10-16' },
            { id: 'khronos-fox', provider: 'Khronos glTF sample assets', title: 'Fox', version: 'main', author: 'PixelMannen (model, CC0), tomkranis (rig and animation, CC-BY 4.0), @AsoboStudio and @scurest (conversion, CC-BY 4.0)', licence: 'CC-BY-4.0', licenceEvidence: 'LICENSE.md of the model directory lists CC0-1.0 and CC-BY-4.0', archive: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Fox/glTF-Binary/Fox.glb', sha256: FOX_SHA, retrieved: '2026-10-16' },
        ],
        entries,
        assets,
    };
    writeFileSync(join(ROOT, 'assets', 'creatures.json'), `${JSON.stringify(out, null, 1)}\n`);
    mergeIntoCatalog(out);
}
/** Merge a creatures file into `assets/catalog.json` and `assets/manifest.json` (ids replaced, the rest untouched). */
export function mergeIntoCatalog(c) {
    const catalogPath = join(ROOT, 'assets', 'catalog.json');
    const manifestPath = join(ROOT, 'assets', 'manifest.json');
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const ids = new Set(c.entries.map((e) => e.id));
    const packIds = new Set(c.packs.map((p) => p['id']));
    // Keep a previous thumbnail pass for entries whose model did not change.
    const prevThumb = new Map(catalog.entries.filter((e) => e.thumb && e.file).map((e) => [`${e.id}|${e.file}`, e.thumb]));
    for (const e of c.entries) {
        const t = prevThumb.get(`${e.id}|${e.file}`);
        if (t && existsSync(join(LIB, t)))
            e.thumb = t;
    }
    catalog.entries = [...catalog.entries.filter((e) => !ids.has(e.id)), ...c.entries];
    catalog.entries.sort((a, b) => (a.category === b.category ? (a.id < b.id ? -1 : 1) : (a.category ?? '') < (b.category ?? '') ? -1 : 1));
    // Variants: drop references to ids that no longer exist.
    const known = new Set(catalog.entries.map((e) => e.id));
    for (const e of catalog.entries)
        if (e.variants)
            e.variants = e.variants.filter((v) => known.has(v));
    catalog.packs = [...catalog.packs.filter((p) => !packIds.has(p.id)), ...c.packs];
    Catalog.parse(catalog);
    manifest.assets = [...manifest.assets.filter((a) => !ids.has(a.id)), ...c.assets];
    const srcIds = new Set(c.sources.map((s) => s.id));
    manifest.sources = [...manifest.sources.filter((s) => !srcIds.has(s.id)), ...c.sources];
    writeFileSync(catalogPath, `${JSON.stringify(catalog)}\n`);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 1)}\n`);
    console.log(`${c.entries.length} creatures merged into the catalog`);
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
    main().catch((err) => {
        console.error(err instanceof Error ? (err.stack ?? err.message) : err);
        process.exit(1);
    });
}
