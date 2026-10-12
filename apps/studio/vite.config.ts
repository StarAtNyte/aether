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
            { name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/, priority: 30 },
            { name: 'rapier', test: /[\\/]node_modules[\\/]@dimforge[\\/]rapier3d-compat[\\/]/, priority: 30 },
            { name: 'react', test: /[\\/]node_modules[\\/](react|react-dom|scheduler|zustand)[\\/]/, priority: 20 },
            { name: 'vendor', test: /[\\/]node_modules[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
});
