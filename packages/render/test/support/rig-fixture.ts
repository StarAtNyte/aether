/** Headless people for tests: a real cast body and motion set loaded without textures, wrapped in a CharacterRig. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { Object3D } from 'three';
import { clipTable, motionSet, resolveLook, type ResolvedLook } from '@aether/assets';
import { cloneModel } from '../../src/geometry/model-loader';
import { CharacterRig } from '../../src/characters/rig';

const LIB = resolve(__dirname, '../../../../assets/lib/');

/** A GLB without images and textures (node has no image decoder; geometry, skeleton and clips are what tests need). */
function stripTextures(buf: Buffer): ArrayBuffer {
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as Record<string, unknown>;
  delete json['images'];
  delete json['textures'];
  delete json['samplers'];
  const strip = (o: unknown): void => {
    if (!o || typeof o !== 'object') return;
    for (const k of Object.keys(o)) {
      if (/Texture$/.test(k)) delete (o as Record<string, unknown>)[k];
      else strip((o as Record<string, unknown>)[k]);
    }
  };
  strip(json['materials']);
  let js = Buffer.from(JSON.stringify(json), 'utf8');
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const rest = buf.subarray(20 + jsonLen);
  const head = Buffer.alloc(20);
  buf.copy(head, 0, 0, 12);
  head.writeUInt32LE(js.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16);
  const out = Buffer.concat([head, js, rest]);
  out.writeUInt32LE(out.length, 8);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.length);
}

function parse(file: string): Promise<{ scene: Object3D; animations: import('three').AnimationClip[] }> {
  const raw = readFileSync(resolve(LIB, file));
  return new Promise((ok, fail) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(stripTextures(raw), '', (g) => ok(g), fail));
}

export interface Fixture {
  rig: CharacterRig;
  look: ResolvedLook;
}

/** A rig of the default traveller (or of `seed`'s body). */
export async function loadRig(seed = 'tester', opts: { castShadow?: boolean; ownedClone?: boolean } = {}): Promise<Fixture> {
  const look = resolveLook({ wardrobe: 'traveller' }, seed);
  const set = motionSet(look.body.gender);
  if (!set) throw new Error('no motion set');
  const [body, motions] = await Promise.all([parse(look.body.file), parse(set.file)]);
  const rig = new CharacterRig({
    scene: opts.ownedClone ? cloneModel(body.scene) : body.scene,
    clips: motions.animations,
    table: clipTable(look.body.gender),
    look,
    faces: look.body.faces,
    hip: look.body.hip,
    motionHip: set.hip,
    castShadow: opts.castShadow ?? false,
  });
  return { rig, look };
}
