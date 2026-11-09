/**
 * The browser the footage is rendered in: the real, headed Google Chrome on the real X display with a hardware GPU
 * (default), or the bundled headless Chromium of the e2e suites (`browser: 'headless'`). One place for the flags.
 *
 * gpu: `intel`  the display GPU (ANGLE over GL on Mesa)
 *      `nvidia` PRIME render offload onto the RTX (WebGL2 over ANGLE/GL on the NVIDIA EGL vendor)
 *      `nvidia-vulkan`  WebGL2 over ANGLE/Vulkan on the NVIDIA ICD
 *      `nvidia-webgpu`  as the above with WebGPU enabled (the engine then runs its WebGPU backend)
 * The window is small and tucked into a corner of the screen with no focus grab: the frames come from the page's own
 * canvas readback at the requested size, never from the screen.
 */
import { existsSync } from 'node:fs';
import { chromium, type Browser } from 'playwright';
import { CHROME_ARGS, findChrome } from '../../tests/e2e/support/env';

export interface FootageBrowserOptions {
  browser: string;
  gpu: string;
  headless?: boolean;
  /** Window size in CSS pixels (default 1920x1080). */
  size?: [number, number];
  /** Device scale factor (default 1). */
  scale?: number;
}

const NVIDIA_ENV: Record<string, string> = { __NV_PRIME_RENDER_OFFLOAD: '1', __GLX_VENDOR_LIBRARY_NAME: 'nvidia', __EGL_VENDOR_LIBRARY_FILENAMES: '/usr/share/glvnd/egl_vendor.d/10_nvidia.json', VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/nvidia_icd.json' };

export async function launchFootageBrowser(o: FootageBrowserOptions): Promise<Browser> {
  if (o.browser === 'headless') {
    return chromium.launch({ executablePath: findChrome(), headless: true, args: [...CHROME_ARGS] });
  }
  const chrome = process.env['AETHER_CHROME'] ?? '/usr/bin/google-chrome';
  if (!existsSync(chrome)) throw new Error(`${chrome} not found (AETHER_CHROME)`);
  const env: Record<string, string> = { ...(process.env as Record<string, string>), DISPLAY: process.env['DISPLAY'] ?? ':0' };
  const args = ['--no-first-run', '--no-default-browser-check', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--window-position=1500,800'];
  const [w, h] = o.size ?? [1920, 1080];
  args.push(`--window-size=${w},${h}`);
  if (o.scale && o.scale !== 1) args.push(`--force-device-scale-factor=${o.scale}`);
  switch (o.gpu) {
    case 'nvidia':
      Object.assign(env, NVIDIA_ENV);
      args.push('--use-angle=gl');
      break;
    case 'nvidia-vulkan':
      Object.assign(env, NVIDIA_ENV);
      args.push('--use-angle=vulkan', '--enable-features=Vulkan');
      break;
    case 'nvidia-webgpu':
      Object.assign(env, NVIDIA_ENV);
      args.push('--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=vulkan', '--enable-vulkan');
      break;
    default:
      args.push('--use-angle=gl', '--enable-unsafe-webgpu');
  }
  return chromium.launch({ executablePath: chrome, headless: o.headless === true, env, args, ignoreDefaultArgs: ['--enable-automation'] });
}
