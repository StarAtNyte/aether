import { describe, expect, it } from 'vitest';
import { playerManifest, reachableFiles, PLAYER_MANIFEST } from '../../../scripts/vite/player-manifest';
const bundle = {
    'play.html': { type: 'asset', fileName: 'play.html', source: '<script type="module" src="./assets/play-a1.js"></script><link href="./assets/play-c3.css">' },
    'index.html': { type: 'asset', fileName: 'index.html', source: '<script src="/assets/index-z.js"></script>' },
    'assets/play-a1.js': { type: 'chunk', fileName: 'assets/play-a1.js', code: 'import "./three-b2.js"; const w = new URL("./sandbox.worker-q9.js", import.meta.url); import("./physics-p1.js");' },
    'assets/three-b2.js': { type: 'chunk', fileName: 'assets/three-b2.js', code: 'export const x = 1;' },
    'assets/physics-p1.js': { type: 'chunk', fileName: 'assets/physics-p1.js', code: 'fetch(new URL("rapier_bg-w1.wasm", import.meta.url))' },
    'assets/rapier_bg-w1.wasm': { type: 'asset', fileName: 'assets/rapier_bg-w1.wasm', source: new Uint8Array([0, 97, 115, 109]) },
    'assets/sandbox.worker-q9.js': { type: 'chunk', fileName: 'assets/sandbox.worker-q9.js', code: 'self.onmessage = () => {};' },
    'assets/play-c3.css': { type: 'asset', fileName: 'assets/play-c3.css', source: '.x{background:url(./icon-i1.png)}' },
    'assets/icon-i1.png': { type: 'asset', fileName: 'assets/icon-i1.png', source: new Uint8Array([1]) },
    'assets/index-z.js': { type: 'chunk', fileName: 'assets/index-z.js', code: 'import("./EditorRoute-e1.js")' },
    'assets/EditorRoute-e1.js': { type: 'chunk', fileName: 'assets/EditorRoute-e1.js', code: '' },
};
describe('player manifest (build plugin)', () => {
    it('follows imports, workers, wasm and stylesheet assets from play.html only', () => {
        expect(reachableFiles(bundle, 'play.html')).toEqual(['assets/icon-i1.png', 'assets/physics-p1.js', 'assets/play-a1.js', 'assets/play-c3.css', 'assets/rapier_bg-w1.wasm', 'assets/sandbox.worker-q9.js', 'assets/three-b2.js', 'play.html']);
    });
    it('emits the manifest and fails the build when editor code becomes reachable', () => {
        const emitted = [];
        const ctx = {
            emitFile: (f) => void emitted.push(f),
            error: (msg) => {
                throw new Error(msg);
            },
        };
        playerManifest().generateBundle.call(ctx, {}, bundle);
        expect(emitted[0]?.fileName).toBe(PLAYER_MANIFEST);
        expect(JSON.parse(emitted[0]?.source ?? '{}').files).toContain('assets/three-b2.js');
        const leaky = { ...bundle, 'assets/three-b2.js': { type: 'chunk', fileName: 'assets/three-b2.js', code: 'import("./EditorRoute-e1.js")' } };
        expect(() => playerManifest().generateBundle.call(ctx, {}, leaky)).toThrow(/editor-only code/);
    });
});
