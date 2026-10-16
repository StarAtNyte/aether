/**
 * Offline FBX reading for the character pipeline: three's FBXLoader driven
 * from Node (no DOM). Textures are never loaded here (they are converted
 * separately), so the texture loader is stubbed. Build-time only; nothing in
 * this folder ships to the browser.
 */
import { readFileSync } from 'node:fs';
import { Texture, TextureLoader } from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
let patched = false;
/** Parse an FBX file into a three.js scene graph (skinned meshes, bones, clips). */
export function readFbx(file) {
    if (!patched) {
        patched = true;
        TextureLoader.prototype.load = function load() {
            return new Texture();
        };
    }
    const buf = readFileSync(file);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return new FBXLoader().parse(ab, '');
}
