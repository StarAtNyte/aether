# Image generation for textures: what exists, what is wired, what is optional

Written 2026-10-22. Aether never needs an image model. Photo-derived and procedural textures work offline; an image model only adds
a third, optional source that the assistant may ask for with `make_texture {prompt}`.

## What was checked on this machine

| Path | Finding | Status in Aether |
| --- | --- | --- |
| Codex CLI 0.163.0, ChatGPT login | `codex features list` shows `image_generation  stable  true`: the model has a built-in `image_gen` tool. Under `codex exec` the picture is written to `$CODEX_HOME/generated_images/<thread id>/exec-<uuid>.png` (`~/.codex/generated_images/` holds one such file from a 2026-09-16 session, a 1254 x 1254 PNG; the session log shows the built-in `image_gen` mode and that save path). | Wired: `apps/bridge/src/backends/codex-image.ts`, bridge `POST /v1/image`, local app `POST /api/local/image`. **Not run live**: the Codex usage limit resets on 27 October, so every test here uses a stand-in `codex` script that behaves like the CLI (writes the picture where Codex does, emits `thread.started`, or fails with a usage-limit event). The first live run is the thing to check after the reset (see "First live check"). |
| Existing bridge text backend | Switches `image_generation` off on purpose (read-only, no tools). | Unchanged. The image backend is a separate run that keeps only the image tool. |
| OpenAI-compatible Images API | `POST {base}/v1/images/generations` (prompt, size, `gpt-image-1`) and `/v1/images/edits` (multipart, reference picture). Needs the user's own API key; none is configured here, nothing was called. | Wired: `createOpenAiImageGenerator` in `packages/agent/src/images.ts`; the studio uses an OpenAI key the user already entered (Settings, AI connection), capped at 12 pictures per browser session. |
| Anthropic / Claude Code | No image generation. | Not used for pictures. |
| Local models | Ollama has `qwen3.6:27b` (text and vision), `glm-ocr` and two cloud chat models: no image generator. PyTorch 2.9 (CUDA) and `diffusers` 0.35 are installed on the RTX 4090, but no diffusion weights are cached. | Not wired. A local diffusion model would be a fourth `ImageGenerator` behind the same interface; model weights carry licences of their own and none would be bundled. |

## How it is used

`make_texture` (tool, offered whenever the host can store pictures) tries in this order and **states which source it used and why
the others were not**:

1. an image model, when the call has a `prompt` and a generator is connected (Codex image tool first, then an OpenAI key);
   with `from_photo_region` a crop of the user's photo goes along as a reference, so the model refines the real surface;
2. the user's photograph (floors and walls rectified through the solved camera; pieces cropped from their boxes);
3. the procedural library (the nearest finish; any older texture is removed).

Whatever the source, the picture goes through the same pipeline: take the large-scale light out, make the tile seamless
(offset blend, only when the seam shows), derive occlusion, roughness and normal maps, store three tiers (256 / 512 / 1024 px WebP)
in the project's asset store. Provenance is stored on the texture set and shown in Credits and in the package's `CREDITS.txt`:
**photographed**, **AI-generated** (with prompt and model), **procedural**.

The assistant, not a metric, decides whether a texture is good: the result tells it to compare the next render with the photo
(grain or weave scale, colour, sheen) and to keep, redo or revert (`source: "procedural"`).

## Safety and cost

- The Codex image run uses an allowlisted environment (no API keys), a fresh empty working directory, `--ignore-user-config`
  (the user's MCP servers and skills do not load), read-only sandbox, every tool but image generation disabled; the prompt goes
  through stdin; only a PNG, JPEG or WebP file under `generated_images/` is read back, by header and size (12 MB).
- A reference picture is passed as a file, never as a path or an argument from the page.
- A subscription login is not metered by Aether; an OpenAI key is, so it has a per-session cap and the studio says when the cap is hit.
- Generated and photo-derived textures belong to the user's project. Nothing third-party is added; see `docs/THIRD_PARTY.md`
  (example rooms: the textures are derived from the CC0 and public-domain photographs credited there).

## First live check (after the Codex limit resets)

```
codex login status
npx tsx -e "import { createCodexImageBackend } from './apps/bridge/src/backends/codex-image'; \
  const b = createCodexImageBackend(); \
  b.generate({ prompt: 'a flat top-down photograph of pale oak floorboards, seamless, even light' }).then(r => console.log(r.mime, r.bytes.length))"
```

If the event names differ from what `scanEvents` expects, the backend still finds the picture by the thread id folder and by
newest file under `generated_images/`, so only a changed save location would need a fix (`codexImageArgs` and `scanEvents` are
the two places).
