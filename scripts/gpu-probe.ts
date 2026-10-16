/**
 * What does this machine's Chromium give a page? Launches with candidate GPU flag sets and prints, per set, whether
 * `navigator.gpu.requestAdapter()` answers (10 tries) and the adapter, plus WebGL2's renderer string.
 *
 *   npx tsx scripts/gpu-probe.ts
 */
import { chromium } from 'playwright';
import { findChrome } from '../tests/e2e/support/env';

const SETS: Record<string, string[]> = {
  software: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader'],
  'gpu-vulkan': ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan', '--ignore-gpu-blocklist'],
  'gpu-native': ['--enable-unsafe-webgpu', '--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan', '--use-angle=vulkan', '--ignore-gpu-blocklist', '--disable-vulkan-surface'],
};

async function main(): Promise<void> {
  const only = process.argv[2];
  for (const [name, args] of Object.entries(SETS)) {
    if (only && only !== name) continue;
    const browser = await chromium.launch({ executablePath: findChrome(), args });
    try {
      const page = await browser.newPage();
      await page.route('http://localhost/', (r) => r.fulfill({ contentType: 'text/html', body: '<html></html>' }));
      await page.goto('http://localhost/');
      const res = await page.evaluate(async () => {
        const gpu = (navigator as unknown as { gpu?: { requestAdapter(o?: object): Promise<{ info?: Record<string, unknown>; isFallbackAdapter?: boolean } | null> } }).gpu;
        const got: Array<string | null> = [];
        if (gpu) {
          for (let i = 0; i < 10; i++) {
            const a = await gpu.requestAdapter({ powerPreference: 'high-performance' });
            got.push(a ? `${String(a.info?.['vendor'])} ${String(a.info?.['architecture'])} ${a.isFallbackAdapter === true || a.info?.['isFallbackAdapter'] === true ? '(fallback)' : ''}` : null);
          }
        }
        const gl = document.createElement('canvas').getContext('webgl2');
        const ext = gl?.getExtension('WEBGL_debug_renderer_info');
        return { hasGpu: !!gpu, got, gl: gl ? String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : null };
      });
      process.stdout.write(`${name}: navigator.gpu=${res.hasGpu} adapters=${res.got.filter(Boolean).length}/${res.got.length} ${res.got.find(Boolean) ?? ''} | webgl2=${res.gl}\n`);
    } finally {
      await browser.close();
    }
  }
}

void main();
