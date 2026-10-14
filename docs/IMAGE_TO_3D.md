# Optional: image → 3D mesh with TRELLIS.2

Aether's default way to turn a picture into an object is the **asset
forge**: a connected coding model writes an editable, parametric generator
and corrects it against renders (see [ASSETS.md](ASSETS.md#the-asset-forge)).
For organic shapes that are hard to express as code (a specific sculpture,
a plush toy) you can additionally plug in an image-to-mesh model.

The reference integration targets **TRELLIS.2** (Microsoft, MIT licence),
running on **your own** GPU or **your own** Modal account. It is **off by
default**: nothing is deployed, downloaded or paid for by this project, and
the hosted demo does not offer it.

## How it fits together

```
studio ──POST image──▶ Aether server /api/image-to-3d ──JSON──▶ your TRELLIS.2 wrapper
         ◀──── validated GLB ────                     ◀── GLB ──
```

- The server route exists only when `AETHER_IMAGE_TO_3D_URL` is set.
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

## Running TRELLIS.2 locally (NVIDIA GPU, ~16 GB+ VRAM)

1. Follow the TRELLIS.2 repository's install instructions (Python env,
   PyTorch with CUDA, model weights from the official release).
2. Wrap its image-to-3D pipeline in a ~30-line HTTP server (FastAPI or
   Flask) that implements the protocol above and exports the result with
   the repository's GLB exporter (textured, ≤ 500 k triangles).
3. Start it on `127.0.0.1:8000` and run Aether with:

   ```sh
   AETHER_IMAGE_TO_3D_URL=http://127.0.0.1:8000/generate npm start
   ```

## Running it on your own Modal account

Deploy the same wrapper as a Modal web endpoint on a GPU class of your
choice, protect it with a bearer token, and set:

```sh
AETHER_IMAGE_TO_3D_URL=https://<you>--trellis-generate.modal.run
AETHER_IMAGE_TO_3D_TOKEN=<your token>
```

Costs are billed to your Modal account only; stop the app when you are done.

## Licences

TRELLIS.2 code and weights are published under the MIT licence; check the
release you install. Models you generate are your own content — record
their origin if you share them (the in-app credits list imports as
"Your imports").
