import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Backend (apps/server) used for `/api` during `vite dev` and `vite preview`. */
const API_TARGET = 'http://localhost:8787';

const apiProxy = {
  '/api': { target: API_TARGET, changeOrigin: true },
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: apiProxy,
  },
  preview: {
    port: 4173,
    proxy: apiProxy,
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // Rapier ships an inlined WASM blob; pre-bundling it only slows dev startup.
    exclude: ['@dimforge/rapier3d-compat'],
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    // three.js and the Rapier WASM blob are legitimately large.
    chunkSizeWarningLimit: 4600,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // Vite's dynamic-import preload helper is used by the entry: keep it in the eager vendor chunk.
            { name: 'vendor', test: /vite[\\/]preload-helper/, priority: 40 },
            { name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/, priority: 30 },
            { name: 'rapier', test: /[\\/]node_modules[\\/]@dimforge[\\/]rapier3d-compat[\\/]/, priority: 30 },
            // QuickJS loads only when a world runs or validates a script: keep it out of the eager vendor chunk.
            { name: 'quickjs', test: /[\\/]node_modules[\\/](quickjs-emscripten-core|@jitl)[\\/]/, priority: 30 },
            // The opt-in on-device model runtime (multi-MB): only loaded from Settings → AI connection.
            { name: 'webllm', test: /[\\/]node_modules[\\/](@mlc-ai|loglevel)[\\/]/, priority: 30 },
            { name: 'react', test: /[\\/]node_modules[\\/](react|react-dom|scheduler|zustand)[\\/]/, priority: 20 },
            { name: 'vendor', test: /[\\/]node_modules[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
});
