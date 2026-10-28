# Contributing to Aether

Thanks for helping. This page is the short route from clone to merged change.

## Setup

- Node.js 24 (see `.nvmrc`; `nvm use`), npm 10 or newer.
- `git clone https://github.com/StarAtNyte/aether && cd aether && npm ci`
- Work on the studio with hot reload: `npm run dev:server` in one terminal, `npm run dev` in another.
- Browser suites need `npx playwright install chromium firefox` once.
- Git worktrees are optional but handy for parallel branches: `git worktree add ../aether-fix origin/main`, then `npm ci` inside it.

No API key is needed. CI and the tests use the offline planner (`AETHER_PROVIDER=mock`) and never call a paid model.

## Gates

Run these before you open a pull request. CI runs the same set.

```bash
npm run typecheck                    # tsc across every package, app, script and test
npm test                             # Vitest; for one package: npx vitest run packages/core
npm run smoke                        # the real agent loop on every featured prompt, offline
npm run showcase:bake -- --check     # saved featured worlds still match what their prompts build
npm run showcase:lightmaps -- --verify   # bundled lightmaps still match their worlds
npm run budget                       # first-visit download size
npm run licences                     # production dependency licences vs docs/THIRD_PARTY.md
```

### When to rebake the bundled worlds

The featured worlds in `apps/studio/public/templates/worlds/` are what the offline planner builds from each prompt, saved
to disk. CI runs `npm run showcase:bake -- --check` and fails when one differs. Rebake (`npm run showcase:bake`, or with a
slug to limit it) after any change to: a furniture, dwelling, facade or garden generator or its defaults and sizes
(`packages/arch`), a procgen generator or finish, the planner, catalogs or aliases, the World IR defaults, or a featured
prompt in `apps/studio/src/showcase/manifest.ts`. Read the diff before committing it: the change must be one you meant.
If a world with a bundled lightmap changed (`apps/studio/public/templates/lightmaps/`), run `npm run build` then
`npm run showcase:lightmaps` and commit the new `.lmap` and `index.json`; check with `showcase:lightmaps -- --verify`.
Game worlds keep their sealed proofs: a rebake must not change them.

Then the browser suite closest to your change, for example `npm run e2e`, `npm run e2e:arch`, `npm run e2e:refine` or
`npm run e2e:gameplay`. If you change the room-from-photo flow (`packages/agent/src/photo`, the photo tools or the chat
cards), run `npm run e2e:photo` (about 2 minutes, scripted model, no quota). If you change rendering, also run
`npm run e2e:render`. If you change what the photo flow measures (perception, room geometry, the instance raster, the
measured comparison), run `npm run bench:photo-selftest`: it scores the measuring stages (camera, room box, depth, masks,
back-projection, colour, the projection and comparison oracles) against worlds whose truth we know, with no model call.
It renders its fixtures first when they are missing (Chromium, `GEN_GPU=intel`; a few minutes) and then takes about four
minutes on the CPU (`--reuse` skips the models). It is not part of CI. See `docs/PHOTO_TO_ROOM_HARNESS.md`
("Ground-truth self-test").

## Rules of the road

- Keep changes small and focused. One idea per commit.
- Add or update tests with the code. Add a line to `CHANGELOG.md` for anything a user would notice.
- New bundled assets (models, textures, fonts, HDRIs) must be CC0, MIT, Apache-2.0, OFL or similar, and be recorded in
  `docs/THIRD_PARTY.md` with source and licence. `npm run licences` checks dependencies.
- Never commit secrets, `.env` files, generated render output or the demo video.
- The World IR is validated by `packages/core`; change it only with a schema version note in `docs/CONTRACTS.md`.

## Commit style

Short imperative subject in sentence case, no prefix, under about 100 characters, for example
`Brief: one retry when the provider fails once`. Use the body for why and for measurements.

## Pull request checklist

- [ ] `npm run typecheck`, `npm test` and `npm run smoke` pass
- [ ] Bake, lightmap, budget and licence checks pass when the change touches worlds, rendering, assets or dependencies
- [ ] Tests added or updated; a browser suite run when the UI or renderer changed
- [ ] `CHANGELOG.md` and the relevant document under `docs/` updated
- [ ] No secrets, large binaries or new assets without a licence entry

## Reporting problems

Use the issue templates. For security problems read [SECURITY.md](SECURITY.md) first and do not open a public issue.

## Live model runs in the test scripts

The live scripts (`eval-photo`, `eval-design`, `eval-agent`, `brief-probe`, `bench`, ...) call an Anthropic API key through
`scripts/lib/live-provider.ts`. Put your key in `AETHER_ANTHROPIC_API_KEY` or in `~/.config/aether/anthropic.key`
(mode 600, outside the repo; never commit a key). The scripts' `--backend=` option is ignored; the Codex and Claude Code
CLI backends run only with `AETHER_ALLOW_CLI=1`. Set `AETHER_LIVE_MODEL` to change the model (default `claude-sonnet-5-5`).
The studio and the bridge are unchanged: they keep their own connections.
