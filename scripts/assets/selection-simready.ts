/**
 * Models imported from NVIDIA SimReady Central (USD packages on Hugging Face), one row per package. Each is pinned to a
 * dataset revision, checked against the SHA-256 recorded in `assets/sources.json` (`simready.packages`), converted by the
 * dev-time `usd2glb.py` and then built exactly like the Poly Haven interior rows (same budgets, tiers and catalog facts).
 *
 * Find candidates with `npm run assets:simready -- search "<text>"`, import with `-- fetch <repo>@<revision>/<package>`,
 * add the source to `assets/sources.json` and a row here, then `npx tsx scripts/assets/build.ts --simready`.
 * Only licences the library accepts (CC0-1.0, CC-BY-4.0) can be added; `assets/sources.json` is validated on every read.
 */
import type { InteriorRow } from './selection-interior';

export interface SimreadyItem {
  /** `[package folder, library id, interior type, category, styles, name, options]` (the Poly Haven row shape). */
  row: InteriorRow;
  /** `id` of the matching `simready.packages` entry in `assets/sources.json`. */
  source: string;
  /** Extra `usd2glb.py` options. `--resmooth=<deg>` welds the positions and recomputes crease-angle normals (CAD tessellation). */
  convert?: readonly string[];
  /** Colour names the finder ranks on, when the measured dominant colour of the largest material misleads (a black body is not "dark-brown"). */
  colors?: readonly string[];
}

export const SIMREADY: readonly SimreadyItem[] = [
  {
    source: 'simready-lgelectronics-cooking-ldgl6924s',
    convert: ['--resmooth=50'],
    colors: ['black', 'silver'],
    row: [
      'cooking_ldgl6924s',
      'simready-range-cooker-lg',
      'cooker',
      'kitchen',
      'modern contemporary',
      'Range cooker',
      { tex: 512, tris: 20000, rot: 270, tags: 'range cooker stove cooktop oven range cooker hob kitchen appliance freestanding lg stainless steel' },
    ],
  },
];
