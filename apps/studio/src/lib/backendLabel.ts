/**
 * The words Settings uses for the graphics backend that is running: which one, and, when it is WebGL2 although WebGPU
 * was available or asked for, why. Pure, so the wording is tested.
 */
import type { BackendReport } from '@aether/render';

/** Headline: "WebGPU" / "WebGL2", with "(software)" when the adapter is the browser's software one. */
export function backendHeadline(report: Pick<BackendReport, 'active' | 'softwareAdapter'>): string {
  const name = report.active === 'webgpu' ? 'WebGPU' : 'WebGL2';
  return report.softwareAdapter ? `${name} (software adapter)` : name;
}

/** One sentence on why this backend runs; empty when WebGPU runs as it should. */
export function backendWhy(report: BackendReport): string {
  switch (report.reason) {
    case 'webgpu':
      return report.adapterAttempts > 1 ? `The GPU answered on request ${report.adapterAttempts}.` : '';
    case 'requested':
      return 'WebGL2 was chosen in Settings.';
    case 'no-webgpu':
      return 'This browser has no WebGPU, so WebGL2 runs.';
    case 'blocked-after-crash':
      return 'A previous WebGPU start did not finish, so WebGPU is off for this site. WebGL2 runs.';
    case 'firefox-policy':
      return 'Firefox runs WebGL2 unless it has a trusted GPU.';
    case 'no-adapter':
      return `The browser gave no WebGPU adapter after ${report.adapterAttempts} requests, so WebGL2 runs.`;
    case 'no-device':
      return 'The WebGPU adapter could not create a device, so WebGL2 runs.';
    case 'init-failed':
      return 'WebGPU failed to start, so WebGL2 runs.';
    case 'device-lost':
      return 'The WebGPU device was lost, so the viewport was restored on WebGL2.';
  }
}
