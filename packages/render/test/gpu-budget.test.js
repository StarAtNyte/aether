import { describe, expect, it } from 'vitest';
import { classifyGpu, effectivePixelRatio, estimateFramebufferMB, estimateShadowMB, MIN_PIXEL_RATIO, renderBudget } from '../src/gpu/budget';
import { adapterKnownGood, describeAdapter, parseBackendPreference, pickBackend } from '../src/gpu/backend';
describe('classifyGpu', () => {
    it.each([
        ['Mesa Intel(R) UHD Graphics 620 (KBL GT2)', 'integrated'],
        ['ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated'],
        ['Intel(R) HD Graphics, or similar', 'integrated'],
        ['AMD Radeon(TM) Graphics', 'integrated'],
        ['Mali-G78', 'integrated'],
        ['Adreno (TM) 740', 'integrated'],
        ['NVIDIA GeForce RTX 3060/PCIe/SSE2', 'discrete'],
        ['ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete'],
        ['AMD Radeon RX 6700 XT', 'discrete'],
        ['Intel(R) Arc(TM) A770 Graphics', 'discrete'],
        ['Apple M2, or similar', 'discrete'],
        ['apple metal-3', 'discrete'],
        ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', 'software'],
        ['llvmpipe (LLVM 17.0.6, 256 bits)', 'software'],
        ['Microsoft Basic Render Driver', 'software'],
        ['', 'unknown'],
        ['Some Future GPU 9000', 'unknown'],
    ])('%s → %s', (description, tier) => {
        expect(classifyGpu(description)).toBe(tier);
    });
    it('tolerates non-strings and huge inputs', () => {
        expect(classifyGpu(undefined)).toBe('unknown');
        expect(classifyGpu(null)).toBe('unknown');
        expect(classifyGpu(`${'x'.repeat(100_000)} NVIDIA`)).toBe('unknown');
    });
});
describe('renderBudget', () => {
    it('caps integrated GPUs at a 1.25 pixel ratio and every class at a 2048² shadow map', () => {
        expect(renderBudget('integrated', false).pixelRatioCap).toBe(1.25);
        expect(renderBudget('unknown', false)).toEqual(renderBudget('integrated', false));
        for (const tier of ['discrete', 'integrated', 'software', 'unknown']) {
            const b = renderBudget(tier, false);
            expect(b.shadowMapCap).toBeLessThanOrEqual(2048);
            expect(b.pixelRatioCap).toBeLessThanOrEqual(1.5);
        }
    });
    it('low-memory mode overrides every class: ratio 1, ~1 MP, no post, no MSAA, small caches', () => {
        for (const tier of ['discrete', 'integrated', 'software', 'unknown']) {
            const b = renderBudget(tier, true);
            expect(b).toMatchObject({ pixelRatioCap: 1, shadowMapCap: 1024, post: false, antialias: false });
            expect(b.maxPixels).toBeLessThanOrEqual(1.1e6);
            expect(b.generatorCacheBytes).toBeLessThan(renderBudget(tier, false).generatorCacheBytes);
            expect(b.maxInstances).toBeLessThan(renderBudget(tier, false).maxInstances);
            expect(b.voxelViewDistance).toBeLessThanOrEqual(renderBudget(tier, false).voxelViewDistance);
        }
    });
    it('caps block-terrain view distance by class (software still streams 8 chunks)', () => {
        expect(renderBudget('software', false).voxelViewDistance).toBe(8);
        expect(renderBudget('discrete', false).voxelViewDistance).toBe(16);
        expect(renderBudget('integrated', true).voxelViewDistance).toBe(6);
    });
});
describe('effectivePixelRatio', () => {
    const budget = renderBudget('integrated', false);
    it('takes the smallest of device ratio, class cap and pixel cap', () => {
        expect(effectivePixelRatio(1, 800, 600, budget)).toBe(1);
        expect(effectivePixelRatio(2, 800, 600, budget)).toBe(1.25);
        // A 1700×1300 viewport at DPR 2 would be 8.8 MP; the pixel cap brings it to ≤ 2.1 MP.
        const r = effectivePixelRatio(2, 1700, 1300, budget);
        expect(r).toBeLessThan(1.25);
        expect(1700 * 1300 * r * r).toBeLessThanOrEqual(budget.maxPixels);
    });
    it('never goes below the minimum ratio and survives invalid input', () => {
        expect(effectivePixelRatio(2, 10_000, 10_000, budget)).toBe(MIN_PIXEL_RATIO);
        expect(effectivePixelRatio(Number.NaN, 800, 600, budget)).toBe(1);
        expect(effectivePixelRatio(0, 800, 600, budget)).toBe(1);
        expect(effectivePixelRatio(2, 0, 600, budget)).toBe(1.25);
        expect(effectivePixelRatio(2, 800, 600, { pixelRatioCap: Number.NaN, maxPixels: Number.NaN })).toBe(1);
    });
    it('keeps the drawing buffer of a low-memory budget near 1 MP', () => {
        const low = renderBudget('discrete', true);
        const r = effectivePixelRatio(3, 1400, 900, low);
        expect(1400 * 900 * r * r).toBeLessThanOrEqual(low.maxPixels);
    });
});
describe('memory estimates', () => {
    it('scale with pixels and shadow texels', () => {
        expect(estimateFramebufferMB(1000, 1000, true)).toBeGreaterThan(estimateFramebufferMB(1000, 1000, false));
        expect(estimateFramebufferMB(2000, 1000, true)).toBeCloseTo(estimateFramebufferMB(1000, 1000, true) * 2);
        expect(estimateShadowMB(2048)).toBe(32);
        expect(estimateShadowMB(4096)).toBe(128);
        expect(estimateFramebufferMB(-5, 10, true)).toBe(0);
    });
});
describe('backend policy', () => {
    const chrome = { webgpuAvailable: true, webgpuBlocked: false, firefox: false, linux: true };
    const firefoxLinux = { webgpuAvailable: true, webgpuBlocked: false, firefox: true, linux: true };
    const firefoxWin = { webgpuAvailable: true, webgpuBlocked: false, firefox: true, linux: false };
    it('uses WebGPU on Chromium in auto mode and WebGL2 without navigator.gpu', () => {
        expect(pickBackend('auto', chrome)).toBe('webgpu');
        expect(pickBackend('auto', { ...chrome, webgpuAvailable: false })).toBe('webgl2');
    });
    it('prefers WebGL2 on Firefox: always on Linux, after an adapter check elsewhere', () => {
        expect(pickBackend('auto', firefoxLinux)).toBe('webgl2');
        expect(pickBackend('auto', firefoxWin)).toBe('probe');
    });
    it('honours forced preferences, except that the crash guard and missing WebGPU always win', () => {
        expect(pickBackend('webgpu', firefoxLinux)).toBe('webgpu');
        expect(pickBackend('webgl2', chrome)).toBe('webgl2');
        expect(pickBackend('webgpu', { ...chrome, webgpuBlocked: true })).toBe('webgl2');
        expect(pickBackend('webgpu', { ...chrome, webgpuAvailable: false })).toBe('webgl2');
    });
    it('trusts only real discrete or Apple adapters', () => {
        expect(adapterKnownGood({ vendor: 'nvidia', architecture: 'ampere' })).toBe(true);
        expect(adapterKnownGood({ vendor: 'amd' })).toBe(true);
        expect(adapterKnownGood({ vendor: 'apple', architecture: 'metal-3' })).toBe(true);
        expect(adapterKnownGood({ vendor: 'intel', architecture: 'gen-12lp' })).toBe(false);
        expect(adapterKnownGood({ vendor: '' })).toBe(false);
        expect(adapterKnownGood({ vendor: 'nvidia', isFallbackAdapter: true })).toBe(false);
        expect(adapterKnownGood(null)).toBe(false);
    });
    it('parses untrusted preference values and describes adapters', () => {
        expect(parseBackendPreference('webgl2')).toBe('webgl2');
        expect(parseBackendPreference('webgpu')).toBe('webgpu');
        expect(parseBackendPreference('WEBGPU')).toBe('auto');
        expect(parseBackendPreference(42)).toBe('auto');
        expect(describeAdapter({ vendor: 'intel', architecture: 'gen-12lp', description: '' })).toBe('intel gen-12lp');
        expect(describeAdapter(undefined)).toBe('');
    });
});
