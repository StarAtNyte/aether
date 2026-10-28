/**
 * NVIDIA SimReady Central as an asset source (dev tool; the studio never needs it).
 *
 *   npm run assets:simready -- search "range cooker" [--limit=8] [--max-size=2] [--min-size=0.2] [--json]
 *   npm run assets:simready -- fetch LGElectronics/simready-assets@<40-hex revision>/cooking_ldgl6924s
 *
 * search: asks the public SimReady Central service (semantic search over USD packages), looks up the licence of every
 *   hit (the package's own `com.nvidia.simready.packaging.json` and the dataset card) and prints ONLY the hits whose
 *   licence is on the allow-list (CC0, CC-BY-4.0 in all its spellings, MIT, Apache-2.0, BSD). Everything else is listed
 *   as rejected with the reason.
 * fetch: downloads one package at a pinned revision (never a branch) into
 *   `~/.cache/aether-asset-src/simready/<owner>/<dataset>/<revision>/<package>` (outside the repository, the package
 *   folder name unchanged), after re-checking the licence. Every file is verified: Git LFS sha256, Git blob id for the
 *   small files, then the package's own bill of materials (sha256 of every file), whose hash packaging.json pins.
 *   Downloaded files are untrusted data: nothing in them is ever run, and the converter reads them with `python -I`.
 *
 * Importing into the library afterwards: see docs/ASSETS.md, "SimReady Central".
 */
import { resolve } from 'node:path';
import { SIMREADY_ALLOWED, describeSimreadyHit, searchSimready } from '../../packages/assets/src/simready';
import { fetchPackage, packageDir, parseTarget, SIMREADY_DIR } from '../../packages/assets/src/simready-fetch';

// Re-exported for the build scripts.
export { packageDir, parseTarget, SIMREADY_DIR };

const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (cmd === 'search') {
    const query = rest.join(' ');
    const maxSize = arg('max-size');
    const minSize = arg('min-size');
    const r = await searchSimready({ query, limit: Number(arg('limit') ?? 8), ...(maxSize ? { maxSize: Number(maxSize) } : {}), ...(minSize ? { minSize: Number(minSize) } : {}) });
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify(r, null, 2));
      process.exit(r.ok ? 0 : 2);
    }
    if (!r.ok) {
      console.error(r.error);
      process.exit(2);
    }
    console.log(`SimReady Central: "${r.query}", ${r.considered} hits looked at, ${r.accepted.length} with an allowed licence (${SIMREADY_ALLOWED.join(', ')}), ${r.rejected.length} rejected.`);
    for (const h of r.accepted) console.log(`  ${describeSimreadyHit(h)}${h.reason ? `\n    note: ${h.reason}` : ''}\n    ${h.importable ? h.fetch : '(not importable until the catalog schema takes this licence)'}`);
    if (r.rejected.length > 0) {
      console.log('Rejected (not shown as results):');
      for (const h of r.rejected) console.log(`  ${h.ref.pkg} (${h.ref.repo}): ${h.reason}`);
    }
    return;
  }
  if (cmd === 'fetch') {
    if (!rest[0]) throw new Error('usage: fetch <owner>/<dataset>@<40-hex revision>/<package>');
    const got = await fetchPackage(parseTarget(rest[0]), { onProgress: (m) => process.stdout.write(`${m}\n`) });
    console.log(`ok ${got.dir}\n  licence ${got.licence} (package: ${got.licenceRaw.packaging}, dataset card: ${got.licenceRaw.card}), author ${got.author}\n  usd ${got.usd.path} ${got.usd.bytes} bytes sha256 ${got.usd.sha256}\n  package_hash ${got.packageHash}`);
    return;
  }
  console.error('usage: assets:simready -- search "<text>" [--limit=8] [--max-size=2] [--json]\n       assets:simready -- fetch <owner>/<dataset>@<40-hex revision>/<package>');
  process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
