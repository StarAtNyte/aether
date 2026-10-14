/**
 * `game.json`: what a published game carries next to the player build — the
 * world, the title-screen text, the soundtrack choice and an optional block
 * world save. Shared by the builder (studio) and the player, which treats it
 * as untrusted: zod for the envelope, `validateWorld` for the world, caps on
 * every string. Custom generator and script code inside the world only ever
 * runs in the player's sandboxes.
 */
import { z } from 'zod';
import type { WorldDoc } from '@aether/core';
import { validateImportedValue } from '../lib/worldIO';
import { cleanLine, cleanText } from './share';
import { MOODS, type Mood } from './video/music';

/** Format marker of `game.json`. */
export const GAME_FORMAT = 'aether-game';
/** Largest `game.json` the player reads (bytes). */
export const MAX_GAME_JSON_BYTES = 16 * 1024 * 1024;
/** Path pattern of a bundled block-world save. */
export const SAVE_PATH = /^saves\/[a-z0-9-]{1,40}\.aethersave$/;
/** Path pattern of a bundled user import (content-addressed id). */
export const IMPORT_PATH = /^assets\/user\/(user-[0-9a-f]{12})\.(glb|png|jpg|webp|hdr)$/;
/** Most bundled user imports. */
export const MAX_GAME_IMPORTS = 64;

const Envelope = z
  .object({
    format: z.literal(GAME_FORMAT),
    v: z.literal(1),
    title: z.string().max(200),
    description: z.string().max(2000).default(''),
    author: z.string().max(200).default(''),
    controls: z.string().max(600).default(''),
    publishedAt: z.number().int().nonnegative().max(8.64e15).optional(),
    music: z.enum(MOODS).nullable().default(null),
    save: z.string().regex(SAVE_PATH).optional(),
    /** User imports (models, posters, skies) shipped with the build; metadata is validated by the player. */
    imports: z.array(z.object({ meta: z.unknown(), file: z.string().regex(IMPORT_PATH) }).strict()).max(MAX_GAME_IMPORTS).default([]),
    world: z.unknown(),
  })
  .strict();

/** A validated game. */
export interface GameManifest {
  title: string;
  description: string;
  author: string;
  controls: string;
  publishedAt?: number;
  music: Mood | null;
  save?: string;
  /** Bundled user imports (metadata still untrusted: the player validates it and the file). */
  imports?: Array<{ meta: unknown; file: string }>;
  world: WorldDoc;
}

/** Result of {@link parseGameManifest}. */
export type GameParseResult = { ok: true; game: GameManifest } | { ok: false; error: string };

/** Validate an untrusted `game.json` value. Never throws. */
export function parseGameManifest(value: unknown): GameParseResult {
  const env = Envelope.safeParse(value);
  if (!env.success) return { ok: false, error: 'This is not an Aether game (game.json is missing fields or has unknown ones).' };
  const w = validateImportedValue(env.data.world);
  if (!w.ok) return { ok: false, error: w.error };
  const e = env.data;
  return {
    ok: true,
    game: {
      title: cleanLine(e.title, 80) ?? (cleanLine(w.world.name, 80) || 'Untitled game'),
      description: cleanText(e.description, 600) ?? '',
      author: cleanLine(e.author, 60) ?? '',
      controls: cleanLine(e.controls, 300) ?? '',
      ...(e.publishedAt !== undefined ? { publishedAt: e.publishedAt } : {}),
      music: e.music,
      ...(e.save ? { save: e.save } : {}),
      ...(e.imports.length > 0 ? { imports: e.imports.map((i) => ({ meta: i.meta, file: i.file })) } : {}),
      world: w.world,
    },
  };
}

/** Serialize a game for `game.json`. */
export function gameJson(game: GameManifest): string {
  return JSON.stringify({
    format: GAME_FORMAT,
    v: 1,
    title: game.title,
    description: game.description,
    author: game.author,
    controls: game.controls,
    ...(game.publishedAt !== undefined ? { publishedAt: game.publishedAt } : {}),
    music: game.music,
    ...(game.save ? { save: game.save } : {}),
    ...(game.imports && game.imports.length > 0 ? { imports: game.imports } : {}),
    world: game.world,
  });
}

/** Longest default controls line (the title screen's `controls` cap). */
const MAX_CONTROLS_CHARS = 300;
/** Longest default description (the title screen's `description` cap). */
const MAX_DESCRIPTION_CHARS = 600;

/** Title-screen title: the world's title card when it has one, else its name. */
export function defaultTitle(world: WorldDoc): string {
  return (world.intro?.title ?? world.name).slice(0, 80);
}

/** Title-screen description: the title card's tagline and objective (empty without a card). */
export function defaultDescription(world: WorldDoc): string {
  const intro = world.intro;
  if (!intro) return '';
  return [intro.tagline, intro.objective ?? ''].filter((t) => t.trim().length > 0).join(' — ').slice(0, MAX_DESCRIPTION_CHARS);
}

/**
 * Controls text: the title card's own control lines when the world has
 * them, else derived from how the world is played.
 */
export function defaultControls(world: WorldDoc): string {
  const lines = world.intro?.controls ?? [];
  if (lines.length > 0) return lines.join(' · ').slice(0, MAX_CONTROLS_CHARS);
  if (world.voxel) return 'WASD move · Space jump · mouse look · left click break · right click place · E inventory · 1–9 hotbar · Esc pause';
  switch (world.player.mode) {
    case 'firstPerson':
      return 'WASD move · mouse look · Space jump · E interact · Esc pause';
    case 'thirdPerson':
      return 'WASD move · arrows or drag to turn · Space jump · E interact · Esc pause';
    case 'vehicle':
      return 'W/S throttle · A/D steer · Space brake · Esc pause';
    default:
      return 'Drag to orbit · scroll to zoom · click objects · Esc pause';
  }
}
