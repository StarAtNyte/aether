---
license: mit
pretty_name: Aether cooked worlds
tags:
  - 3d
  - webgl
---

# Aether cooked worlds

Cooked packages of the template worlds that ship with [Aether](https://github.com/StarAtNyte/aether), an open-source
editor for 3D worlds in the browser. The Aether player reads a world's package from here and draws it without running
the generators: it downloads geometry that was already generated and a list of shader programs to compile first.

## Layout

```
<slug>/manifest.json                 which cook the player opens for this world (the only file that changes)
<slug>/<id>/packs/<nnnn>.bin         generated geometry, packed by grid cell
<slug>/<id>/programs/<tier>.json     shader programs of one render tier
```

`<id>` is derived from the world's content and the generator code version. Files under an id never change. A new cook
of a world gets a new id, and its manifest is uploaded only after all of its files are in place. The format is
documented in `docs/ARCHITECTURE-STREAMING.md` ("Cooked package format") in the Aether repository.

The files are made by `scripts/cook.ts` and uploaded by `scripts/cook-upload.ts`. They are build artefacts: the template
worlds themselves (`apps/studio/public/templates/worlds/`) are the source.

## Licence

MIT, the same as Aether (© 2026 Nitiz Khanal). The packages contain only:

- geometry that Aether's own generators produce from the template worlds;
- GLSL shader source that three.js (MIT) generates for those materials.

They contain no textures, models, sounds or other third-party media. The library assets a world uses (CC0-1.0,
CC-BY-4.0 with credit, or MIT, listed in `docs/THIRD_PARTY.md`) are loaded from the Aether site, not from this dataset.
