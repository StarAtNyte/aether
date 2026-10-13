# Gaussian splats (desk evaluation)

**Hypothesis.** A splat renderer (e.g. `@sparkjsdev/spark`, MIT) could add
photographic backdrops or captured objects to generated worlds.

**Method.** Package metadata and integration constraints, no install:
`npm view @sparkjsdev/spark version license dist.unpackedSize peerDependencies`.

**Findings.**

| | |
| --- | --- |
| Version / licence | 2.3.1, MIT (compatible) |
| Size | 16.4 MB unpacked (includes a WebAssembly sorter) |
| Peer | three ≥ 0.180 |
| Renderer | targets three's `WebGLRenderer` and custom GLSL materials; Aether renders through `WebGPURenderer` (WebGPU or its WebGL2 backend) with node materials, so the splat pass would need a second renderer and canvas compositing or a port of its shaders to TSL |
| Content | the World IR has no splat asset type, and the offline/hosted demo ships no third-party captures; every geometry is procedural |
| Sorting | per-frame depth sort of 10⁵–10⁶ splats competes with the CPU budget the scatter fields and virtual geometry already use |

**Verdict: not integrated.** Licence-compatible, but it would add a
second rendering path (and > 1 MB of lazy-loaded code) for content the
product cannot produce yet. Revisit if a capture import (`model` shape
pointing at `.spz`/`.ply`) is added; the integration point would be a lazily
loaded layer composited over the WebGL2 backend only.
