/**
 * Assets imported on demand by the local server (`POST /api/assets/import`): the job states the studio shows, the record
 * the server keeps for each finished import and the credit line that travels with it. Pure (no Node, no network), so the
 * server, the agent tool and the studio share one contract.
 *
 * An imported record's `entry` has the shape of a library catalog entry (content-hashed `s/<id>.<hash>.glb` paths, real
 * metres, base on y = 0), so the same readers work on it. Its files are served by the server under `base`; they are not
 * in the shipped library. The studio turns one into a user asset (bytes stored with the project, embedded in exports
 * and published games) so a world never depends on the local server after the import.
 */
import { z } from 'zod';
import { AssetId, CatalogEntry } from './schema';

/** Ids of imported assets: `sr-` + a slug of the package + 6 hex characters of the USD's SHA-256. */
export const IMPORT_ID_RE = /^sr-[a-z0-9][a-z0-9-]{0,50}-[0-9a-f]{6}$/;
/** Ids of import jobs: 16 random hex characters. */
export const IMPORT_JOB_RE = /^[0-9a-f]{16}$/;

/** Where a job is. `ready` and `failed` are final. */
export const IMPORT_STAGES = ['queued', 'searching', 'licence', 'downloading', 'converting', 'optimising', 'ready', 'failed'] as const;
export type ImportStage = (typeof IMPORT_STAGES)[number];

/** Rough share of the job each stage ends at (for a progress bar; the download refines its own span). */
export const STAGE_PROGRESS: Readonly<Record<ImportStage, number>> = { queued: 0, searching: 0.05, licence: 0.1, downloading: 0.2, converting: 0.6, optimising: 0.85, ready: 1, failed: 1 };

/** The credit a CC-BY (or other attribution) licence needs, as the studio shows it. */
export const ImportCredit = z.object({
  /** One line for the credits panel, `CREDITS.txt` and the end-of-game screen (at most 200 characters, the user-asset limit). */
  text: z.string().min(1).max(200),
  author: z.string().min(1).max(120),
  licence: z.enum(['CC0-1.0', 'CC-BY-4.0', 'MIT']),
  licenceUrl: z.string().url().max(200),
  /** The dataset page the package comes from. */
  page: z.string().url().max(200),
});
export type ImportCredit = z.infer<typeof ImportCredit>;

const Sha = z.string().regex(/^[0-9a-f]{64}$/);

export const ImportedAsset = z.object({
  /** Same as `entry.id`. */
  id: z.string().regex(IMPORT_ID_RE),
  entry: CatalogEntry,
  /** URL path the entry's files are served under (`/api/assets/imported/files/<id>/`). */
  base: z.string().max(200).regex(/^\/(?:[A-Za-z0-9._~-]+\/)*$/),
  credit: ImportCredit,
  provenance: z.object({
    repo: z.string().max(260),
    revision: z.string().regex(/^[0-9a-f]{40}$/),
    package: z.string().max(130),
    usdSha256: Sha,
    packageHash: Sha.nullable(),
    /** SHA-256 of every file the server serves for this asset, by library path. */
    files: z.record(z.string().max(120), Sha),
  }),
  /** The words the import was asked for. */
  query: z.string().max(120),
  createdAt: z.number().int().min(0),
});
export type ImportedAsset = z.infer<typeof ImportedAsset>;

export const ImportJobView = z.object({
  id: z.string().regex(IMPORT_JOB_RE),
  stage: z.enum(IMPORT_STAGES),
  /** What is happening, in words (no paths, no secrets). */
  message: z.string().max(300),
  progress: z.number().min(0).max(1),
  query: z.string().max(120),
  error: z.string().max(400).optional(),
  asset: ImportedAsset.optional(),
});
export type ImportJobView = z.infer<typeof ImportJobView>;

/** Request body of `POST /api/assets/import`: a search text, or an explicit pinned package. */
export const ImportRequest = z
  .object({
    query: z.string().trim().min(1).max(120).optional(),
    /** `<owner>/<dataset>@<40-hex revision>/<package>` (a pinned commit; the licence is checked like a search hit's). */
    ref: z.string().max(400).optional(),
    /** Largest side in metres the object may have (search filter). */
    maxSize: z.number().finite().positive().max(100).optional(),
  })
  .strict()
  .refine((v) => (v.query !== undefined) !== (v.ref !== undefined), 'send exactly one of query and ref');
export type ImportRequest = z.infer<typeof ImportRequest>;

export const LICENCE_URLS: Readonly<Record<string, string>> = {
  'CC0-1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
  'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/',
  MIT: 'https://opensource.org/license/mit',
};

const SHORT_LICENCE: Readonly<Record<string, string>> = { 'CC0-1.0': 'CC0', 'CC-BY-4.0': 'CC BY 4.0', MIT: 'MIT' };

/** Lowercase slug of a package name for ids (letters, digits, single dashes). */
export function slugOf(text: string, max = 40): string {
  const s = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/g, '');
  return s === '' ? 'model' : s;
}

/** The asset id of a package: slug + the first six hex characters of the USD's hash. */
export function importIdFor(pkg: string, usdSha256: string): string {
  return `sr-${slugOf(pkg, 44)}-${usdSha256.slice(0, 6)}`;
}

/** The one-line credit: `<name> by <author>, CC BY 4.0, NVIDIA SimReady (<dataset>); converted and reduced`. */
export function importCredit(opts: { name: string; author: string; licence: 'CC0-1.0' | 'CC-BY-4.0' | 'MIT'; repo: string }): ImportCredit {
  const tail = `, ${SHORT_LICENCE[opts.licence]}, NVIDIA SimReady Central (${opts.repo}); converted and reduced`;
  const author = opts.author.slice(0, 120) || 'unknown author';
  const room = 200 - tail.length - ' by '.length - author.length;
  const name = opts.name.slice(0, Math.max(8, room));
  return {
    text: `${name} by ${author}${tail}`.slice(0, 200),
    author,
    licence: opts.licence,
    licenceUrl: LICENCE_URLS[opts.licence]!,
    page: `https://huggingface.co/datasets/${opts.repo}`,
  };
}

/** True for a string that is an {@link IMPORT_ID_RE} id (and a valid asset id). */
export const isImportId = (id: string): boolean => IMPORT_ID_RE.test(id) && AssetId.safeParse(id).success;
