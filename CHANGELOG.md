# Changelog

Aether follows [Semantic Versioning](https://semver.org/) once it is published; until then every change lands on `main`
and `docs/REVIEW_LOG.md` carries the measured detail. Workspace packages share the version in the root `package.json`.

## Unreleased

### Studio
- Removed the Plan Reveal (the arch bar's Reveal button, the ink-on-paper plan overlay and the rising-walls animation). The Reveal video camera move in Publish stays.
- Project cards and rows show the actions button (…) at all times as a frosted 32 px button with a visible focus ring, plus a trash button. A Select mode deletes several projects with one confirmation and one Undo, with a message when some could not be deleted or restored. Delete or Backspace on a focused card opens the confirmation, Escape leaves Select, and the editor's Aether menu has Delete project….

### Security
- The dev and preview servers answer to localhost only. A tunnel host is allowed by naming it in `AETHER_DEV_ALLOWED_HOSTS`.
- Lockfile: `body-parser` 2.4.0 and `fast-uri` 3.1.9 clear the high-severity audit finding. `npm audit` reports 0 findings.

### Reliability
- Uncaught errors and unhandled promise rejections are logged once each and shown as at most one calm notice per 15 seconds.
- Frames are presented only when complete: scene and effect passes are prepared before the screen pass opens.
- Rendering resolution is preserved during CPU-bound slowdowns; shared shaders and procedural noise prepare off the UI thread.

### Tooling
- `three` stays pinned to an exact version; `packages/render/test/three-internals.test.ts` fails with the member name when an upgrade changes a private shape.
- `npm run budget` checks the first-visit download against `scripts/size-budget.json`; `npm run licences` checks production licences against `docs/THIRD_PARTY.md`.
- `docs/README.md` indexes the documentation.

## 0.1.0

First tagged state of the framework: natural language to verified, interactive 3D worlds in the studio, the CLI, the MCP server
and the local bridge.
