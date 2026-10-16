# WebGPU and WebGL2

Chrome opens the studio on WebGPU, Firefox on WebGL2. Both run the same TSL shaders and the same post chain; the rule is
that WebGPU is never worse than WebGL2. This page records how the two are kept equal, how the backend is acquired, and
what each costs.

## Where the backends differ, and what was done about it

| Area | Difference | Resolution |
|---|---|---|
| Water, standard and high tiers | WebGL2 reads the scene behind the water by copying the frame buffer (`viewportDepthTexture`). WebGPU cannot copy a multisampled depth attachment into a single-sample texture (a validation error every frame), and cannot resolve depth in a render pass. | `materials/scene-backdrop.ts`: on WebGPU the renderer draws the scene without the water into a single-sample target with a depth texture before the frame; the water samples its depth (absorption, shore foam) and colour (refraction). WebGL2 keeps the frame-buffer copy. |
| Layered terrain | Twelve photographs per pixel need twelve sampler bindings; a WebGPU fragment stage allows 16 and lights take about five. A compact mode had dropped maps. | `materials/splat-arrays.ts`: the maps are packed as three texture arrays (albedo, roughness/occlusion, normal; one layer per surface). Three samplers, full quality, same code on both backends. The compact mode is gone. |
| Adapter | `requestAdapter()` answers `null` now and then on a healthy machine (9 of 10 requests on the development RTX 4090 under Chromium). three.js asked once, so the page silently fell to WebGL2. | `gpu/acquire.ts`, below. |

## Acquiring the backend

`createGpuRenderer` (gpu/backend.ts) decides with `pickBackend`, then on WebGPU:

1. `acquireAdapter`: up to three rounds over three option sets (discrete GPU, the browser's choice, compatibility
   feature level), 120 and 350 ms apart, each request limited to 4 s. The software adapter (`forceFallbackAdapter`) is only
   asked for when WebGPU was chosen explicitly.
2. `acquireDevice`: every feature the adapter has that three.js can use, limits raised to the adapter's (more sampled
   textures, bigger buffers, color attachment bytes for the post chain); if refused, features only, then defaults.
3. The device is handed to `WebGPURenderer`, so the retries and limits are ours, not three's single attempt.
4. Any failure falls back to WebGL2 with a warning log, a progress message and a recorded reason.

Every start produces a `BackendReport` (`renderer.gpu.report`): what was asked for, what runs, the reason
(`webgpu`, `requested`, `no-webgpu`, `blocked-after-crash`, `firefox-policy`, `no-adapter`, `no-device`, `init-failed`,
`device-lost`), adapter requests made, whether the adapter is the software one, the device request level and the event
lines. Settings shows it under Renderer (`data-testid="backend-indicator"`). A lost WebGPU device recreates the viewport on
WebGL2 with reason `device-lost` (Studio.handleContextLost).

## Feature audit on the real GPU

`tests/e2e/gpu-parity.e2e.ts` opens each world once per backend in the same configuration and writes side-by-side
PNGs, the frame cost, the effects that failed and the graphics errors. Run on the RTX 4090 (Chromium, Vulkan) for
highland-trail and sakura-river, in render tiers low to ultra and with each effect switched on alone (ambient occlusion,
SSGI, SSR, sun shafts, TAA), and the high water tier:

* no effect failed on either backend, no graphics error was logged on WebGPU;
* shadows, instancing, skinned characters, terrain layers, sky, clouds, decals, facade glow and wet ground are part of
  the worlds shot and match visually; the remaining image difference is animation (boats, lanterns, wave phase), not a
  rendering divergence;
* the path-traced still and the planar water mirror (high tier) use render targets and work on both.

## Frame cost (RTX 4090, 1600x900, median ms, camera orbiting, loop uncapped, other jobs sharing the GPU)

Water tier (`tests/e2e/water-bench.e2e.ts`):

| world | water | WebGPU | WebGL2 |
|---|---|---:|---:|
| sakura-river | off | 16.3 | 27.2 |
| | simple | 16.4 | 26.3 |
| | standard | 24.3 | 26.9 |
| | high | 34.5 | 40.0 |
| highland-trail | off | 11.4 | 18.0 |
| | simple | 12.6 | 18.2 |
| | standard | 16.7 | 20.4 |
| | high | 24.1 | 31.0 |

Render tier, 1280x720 (`gpu-parity`, standard water):

| world | low | medium | high | ultra |
|---|---:|---:|---:|---:|
| highland-trail WebGPU | 12.6 | 13.9 | 16.1 | 16.7 |
| highland-trail WebGL2 | 13.5 | 13.5 | 17.8 | 20.1 |
| sakura-river WebGPU | 18.4 | 18.9 | 22.9 | 24.3 |
| sakura-river WebGL2 | 17.8 | 17.7 | 22.4 | 25.1 |

WebGPU is equal or faster everywhere except the standard water tier, where the backdrop pass draws the scene a second
time (about 8 ms on sakura-river, 4 ms on highland-trail) while WebGL2 pays for a buffer copy. GPUs without the budget
(software, integrated) stay on the simple tier, which reads no scene.

## Tests

* `packages/render/test/acquire.test.ts`, `scene-backdrop.test.ts`, `splat-arrays.test.ts`, `apps/studio/test/backendLabel.test.ts`.
* `tests/e2e/backend.e2e.ts` (`npm run e2e:backend`): asserts the backend, reason, request count and the Settings
  indicator for the default run, a flaky adapter, a null adapter (simulated) and a WebGL2 choice. Run it with and
  without `AETHER_E2E_GPU=1`.
* `scripts/gpu-probe.ts`: which Chromium flag sets give a page a WebGPU adapter on this machine.
