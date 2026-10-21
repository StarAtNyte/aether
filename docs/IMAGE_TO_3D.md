# Optional: image → 3D mesh through your own model server

Aether's default way to turn a picture into an object is the **asset
forge**: a connected coding model writes an editable, parametric generator
and corrects it against renders (see [ASSETS.md](ASSETS.md#the-asset-forge)).
For organic shapes that are hard to express as code (a specific sculpture,
a plush toy) you can additionally plug in an image-to-mesh model.

The route is model-agnostic: Aether posts an image to an HTTP wrapper that
**you** run and gets a GLB back. The reference wrapper targets **TRELLIS.2**
(Microsoft); **TripoSG** (VAST) is a lower-VRAM alternative. Read
[Licences](#licences-read-before-you-run-a-wrapper) first: the model code
and weights are permissive, but some of the libraries their export paths
import are not.

It is **off by default**: nothing is deployed, downloaded or paid for by this
project, the hosted copy does not offer it, and the Aether code base contains
no model code, weights or Python dependencies of any of these projects. The
only shipped part is an HTTP client and the GLB validator.

## How it fits together

```
studio ──POST image──▶ Aether server /api/image-to-3d ──JSON──▶ your wrapper (TRELLIS.2, TripoSG, …)
         ◀──── validated GLB ────                     ◀── GLB ──
```

- The server route exists only when `AETHER_IMAGE_TO_3D_URL` is set; the
  server then logs a licence notice at startup (the wrapper's dependencies
  are yours to check).
- `/api/health` reports `imageTo3d: true` when it is.
- Every returned model is treated as untrusted and passes the same
  validation as a user import (`validateGltf`: no external references,
  size / triangle / node budgets, sanitised names, normalised pivot).
- One conversion runs at a time; images are capped at 12 MB.

## Wire protocol of the wrapper

```
POST <AETHER_IMAGE_TO_3D_URL>
Content-Type: application/json
Authorization: Bearer <AETHER_IMAGE_TO_3D_TOKEN>      (only when set)

{ "image": "<base64>", "mime": "image/png", "seed": 1, "format": "glb" }

→ 200  Content-Type: model/gltf-binary   body: GLB bytes
```

The endpoint must be `http://127.0.0.1:…` / `http://localhost:…`, or any
`https:` URL without embedded credentials. Redirects are refused.

## Choosing a model

| Model | Code / weights | GPU memory | Output | Notes |
| --- | --- | --- | --- | --- |
| **TRELLIS.2** (Microsoft, 4B) | MIT / MIT | **24 GB minimum** (upstream README; verified on A100 and H100). A 24 GB RTX 4090 is at the edge | Textured GLB with PBR (base colour, roughness, metallic, opacity) | The GLB export (`o_voxel.postprocess.to_glb`) imports **nvdiffrast**, and the PBR renderer uses **nvdiffrec**: both research / evaluation only (see below) |
| **TripoSG** (VAST) | MIT / MIT | **≥ 8 GB** | Shape only (untextured mesh) | Lower-VRAM option. Its reference inference imports `diso` (CC BY-NC 4.0), uses BRIA RMBG-1.4 for background removal (BRIA non-commercial licence) and `pymeshlab` (GPL-3.0) for decimation; see below |

Models evaluated and **not** recommended as the default for an MIT product:

- **Hunyuan3D-2 / 2mini / 2.1** (Tencent Hunyuan 3D Community Licence): the
  licence does not apply in the European Union, the United Kingdom or South
  Korea (no rights there at all), products above 1 million monthly active
  users need a separate licence from Tencent, and it carries attribution and
  notice duties.
- **Stable Fast 3D / SPAR3D** (Stability AI Community Licence): free only for
  individuals and organisations under US$1 million annual revenue; above that
  an enterprise licence is required.
- **InstantMesh** (code Apache-2.0): it runs on Zero123++ multi-view weights,
  which are **CC BY-NC 4.0** (non-commercial).
- **TRELLIS (v1)**: superseded by TRELLIS.2 and has the same nvdiffrast
  dependency.

## Running TRELLIS.2 locally (NVIDIA GPU, 24 GB VRAM or more)

1. Follow the TRELLIS.2 repository's install instructions (Python env,
   PyTorch with CUDA, model weights from the official release). Its setup
   script installs nvdiffrast and nvdiffrec; read their licences first.
2. Wrap its image-to-3D pipeline in a ~30-line HTTP server (FastAPI or
   Flask) that implements the protocol above and exports the result with
   the repository's GLB exporter (textured, ≤ 500 k triangles).
3. Start it on `127.0.0.1:8000` and run Aether with:

   ```sh
   AETHER_IMAGE_TO_3D_URL=http://127.0.0.1:8000/generate npm start
   ```

## Running TripoSG locally (NVIDIA GPU, 8 GB VRAM or more)

The same wrapper shape works: run `TripoSGPipeline` on the image and return
the mesh as a GLB (`trimesh` can export one). For a licence-clean wrapper,
cut the background out yourself (or send images that already have a plain
background) instead of downloading RMBG-1.4, extract the surface with the
scikit-image marching cubes path (`hierarchical_extract_geometry`) rather than
the `diso` one, and decimate with a permissive library rather than
`pymeshlab`. `triposg/inference_utils.py` imports `diso` at module level, so
it has to be installed (or the import stubbed) even when its path is unused.
The result is untextured: give it a material in the inspector, or refine it
with the asset forge.

## Running it on your own Modal account

Deploy the same wrapper as a Modal web endpoint on a GPU class of your
choice (24 GB or more for TRELLIS.2), protect it with a bearer token, and set:

```sh
AETHER_IMAGE_TO_3D_URL=https://<you>--trellis-generate.modal.run
AETHER_IMAGE_TO_3D_TOKEN=<your token>
```

Costs are billed to your Modal account only; stop the app when you are done.

## Licences (read before you run a wrapper)

- **TRELLIS.2** code and weights: MIT. **But** its texture and GLB export
  path depends on [nvdiffrast](https://github.com/NVlabs/nvdiffrast/blob/main/LICENSE.txt)
  (NVIDIA Source Code License: "only may be used or intended for use
  non-commercially … for research or evaluation purposes only and not for
  any direct or indirect monetary gain") and
  [nvdiffrec](https://github.com/NVlabs/nvdiffrec/blob/main/LICENSE.txt)
  (NVIDIA Source Code License, research or evaluation only). A TRELLIS.2
  wrapper as published upstream is therefore for research and evaluation,
  not for commercial use, unless you replace those two libraries.
- **TripoSG** code and weights: MIT. Its reference scripts pull in `diso`
  (CC BY-NC 4.0), BRIA RMBG-1.4 (BRIA's non-commercial model licence) and
  `pymeshlab` (GPL-3.0); avoid or replace them as described above.
- Hunyuan3D-2, SF3D / SPAR3D and InstantMesh: see [Choosing a model](#choosing-a-model).

None of this code runs in Aether: the shipped app, the hosted copy, the
local app's default configuration and every default code path only contain
the HTTP client and validator, and the route does not exist until you set
`AETHER_IMAGE_TO_3D_URL`. What you run behind that URL, and under which
licence, is your choice and your responsibility.

Models you generate are your own content; record their origin if you share
them (the in-app credits list imports as "Your imports").
