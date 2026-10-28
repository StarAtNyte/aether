import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { rapierWasm } from '../../scripts/vite/rapier-wasm.ts';
import { assetLibrary, libraryCdn } from '../../scripts/vite/asset-library.ts';
import { playerManifest } from '../../scripts/vite/player-manifest.ts';
import { siteMeta } from '../../scripts/vite/site-meta.ts';
import { editorPrefetch } from '../../scripts/vite/editor-prefetch.ts';

/** The curated asset library (`npm run assets:build`), served at `/assets/lib/`. */
const LIBRARY_DIR = fileURLToPath(new URL('../../assets/lib', import.meta.url));

/** Backend (apps/server) used for `/api` during `vite dev` and `vite preview`. */
const API_TARGET = process.env.AETHER_API_TARGET ?? 'http://localhost:8787';

/**
 * Extra Host headers the dev and preview servers accept (comma separated, e.g. ".trycloudflare.com" for a quick tunnel).
 * Empty by default, so a plain dev server answers to localhost only and a DNS-rebinding page cannot reach it.
 */
const ALLOWED_HOSTS = (process.env.AETHER_DEV_ALLOWED_HOSTS ?? '').split(',').map(h => h.trim()).filter(Boolean);

const apiProxy = {
  '/api': { target: API_TARGET, changeOrigin: true },
};

/** The standalone player: `play.html` (published games, share links at `/play#w=…`). */
const PLAYER_HTML = fileURLToPath(new URL('./play.html', import.meta.url));
const STUDIO_HTML = fileURLToPath(new URL('./index.html', import.meta.url));

interface DevServerLike {
  middlewares: { use(fn: (req: { url?: string }, res: unknown, next: () => void) => void): void };
}

/** `/play` serves the player page in dev and preview too (static hosts and the server map it the same way). */
function playRoute() {
  const rewrite = (server: DevServerLike): void => {
    server.middlewares.use((req, _res, next) => {
      if (req.url === '/play' || req.url?.startsWith('/play?') || req.url?.startsWith('/play#')) req.url = `/play.html${req.url.slice(5)}`;
      next();
    });
  };
  return { name: 'aether-play-route', configureServer: rewrite, configurePreviewServer: rewrite };
}

export default defineConfig(async ({ command }) => {
  // A lean build (see scripts/vite/asset-library.ts) ships a subset of the library and fetches the rest from a pinned CDN copy.
  const libCdn = command === 'build' ? await libraryCdn(process.env, LIBRARY_DIR) : undefined;
  return {
  define: { __AETHER_LIB_LEAN__: JSON.stringify(libCdn !== undefined) },
  // Rapier's wasm ships as a cached `.wasm` file (streaming compile) instead of a 4 MB base64 string.
  plugins: [react(), rapierWasm({ warn: (m) => console.warn(m) }), assetLibrary(LIBRARY_DIR, libCdn), playRoute(), playerManifest(), siteMeta(), editorPrefetch()],
  experimental: {
    // The player page and every chunk reference files relative to themselves, so a published
    // build works from any sub-path (itch.io, GitHub Pages, a folder on any static host).
    renderBuiltUrl(filename: string, { hostType, hostId }: { hostType: 'js' | 'css' | 'html'; hostId: string }) {
      if (hostType === 'html') return hostId === 'play.html' ? `./${filename}` : undefined;
      return { relative: true };
    },
  },
  server: {
    port: 5173,
    allowedHosts: ALLOWED_HOSTS,
    proxy: apiProxy,
  },
  preview: {
    port: 4173,
    allowedHosts: ALLOWED_HOSTS,
    proxy: apiProxy,
  },
  worker: {
    format: 'es',
    // The verification worker loads Rapier too: same rewrite, same hashed wasm file.
    plugins: () => [rapierWasm({ warn: (m) => console.warn(m) })],
  },
  optimizeDeps: {
    // Rapier ships an inlined WASM blob; pre-bundling it only slows dev startup.
    exclude: ['@dimforge/rapier3d-compat'],
    // The workspace packages are linked sources: the dev server serves each of their ~700 files as its own request,
    // which is minutes on a tunnel or a weak machine. `AETHER_DEV_PREBUNDLE=1` (npm run dev:fast) pre-bundles them
    // into a handful of cached files (home page 373 requests down to 120, a world open 758 to 346). Off by default:
    // pre-bundled packages do not hot-reload, so editing one needs a restart (or `--force`).
    include: process.env['AETHER_DEV_PREBUNDLE'] === '1' ? ['@aether/core', '@aether/arch', '@aether/assets', '@aether/physics', '@aether/playtest', '@aether/render', '@aether/procgen', '@aether/logic', '@aether/verifier', '@aether/agent', '@aether/voxel'] : [],
  },
  build: {
    target: 'es2022',
    outDir: process.env['AETHER_OUTDIR'] ?? 'dist',
    emptyOutDir: true,
    sourcemap: false,
    // three.js and the opt-in WebLLM runtime (6.1 MB, lazy) are legitimately large;
    // Rapier's wasm is a separate .wasm asset (see scripts/vite/rapier-wasm.ts).
    chunkSizeWarningLimit: 6200,
    rolldownOptions: {
      input: { index: STUDIO_HTML, play: PLAYER_HTML },
      output: {
        codeSplitting: {
          groups: [
            // Vite's dynamic-import preload helper is used by the entry: keep it in the eager vendor chunk.
            { name: 'vendor', test: /vite[\\/]preload-helper/, priority: 40 },
            // The area-light lookup tables (about 315 kB of source) load the first time a world has an area light.
            { name: 'ltc', test: /[\\/]node_modules[\\/]three[\\/]examples[\\/]jsm[\\/]lights[\\/]RectAreaLightTexturesLib/, priority: 35 },
            // three's WebGL build (about 660 kB) is used only by the path tracer, which runs on its own WebGL2 context:
            // the shared core stays in the eager three chunk, the WebGL renderer goes to a lazy one.
            { name: 'three', test: /[\\/]node_modules[\\/]three[\\/]build[\\/]three\.core\.js/, priority: 45 },
            { name: 'three-webgl', test: /[\\/]node_modules[\\/]three[\\/]build[\\/]three\.module\.js/, priority: 40 },
            // three's exporters (glTF export, on demand) stay out of every group: they get their own lazy chunk.
            { name: 'three', test: /[\\/]node_modules[\\/]three[\\/](?!examples[\\/]jsm[\\/]exporters[\\/])/, priority: 30 },
            { name: 'rapier', test: /[\\/]node_modules[\\/]@dimforge[\\/]rapier3d-compat[\\/]/, priority: 30 },
            // QuickJS loads only when a world runs or validates a script: keep it out of the eager vendor chunk.
            { name: 'quickjs', test: /[\\/]node_modules[\\/](quickjs-emscripten-core|@jitl)[\\/]/, priority: 30 },
            // The opt-in on-device model runtime (multi-MB): only loaded from Settings → AI connection.
            { name: 'webllm', test: /[\\/]node_modules[\\/](@mlc-ai|loglevel)[\\/]/, priority: 30 },
            // onnxruntime-web (the photo depth/perception model runtime, ~300 kB) is only imported dynamically: keep it out of the eager vendor chunk.
            { name: 'ort', test: /[\\/]node_modules[\\/]onnxruntime-(web|common)[\\/]/, priority: 30 },
            // The path tracer (BVH, light-map unwrapping, tracing shaders) loads only when a path-traced still is requested.
            { name: 'pathtracer', test: /[\\/]node_modules[\\/](three-gpu-pathtracer|three-mesh-bvh|xatlas-web)[\\/]/, priority: 30 },
            { name: 'react', test: /[\\/]node_modules[\\/](react|react-dom|scheduler|zustand)[\\/]/, priority: 20 },
            { name: 'vendor', test: /[\\/]node_modules[\\/](?!three[\\/]examples[\\/]jsm[\\/]exporters[\\/])/, priority: 10 },
          ],
        },
      },
    },
  },
};
});
