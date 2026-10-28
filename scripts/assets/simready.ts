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
import { closeSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  if (cmd === 'add') {
    // Fetch one package and record it in assets/sources.json (the pin the library build checks); prints the row to add.
    if (!rest[0]) throw new Error('usage: add <owner>/<dataset>@<40-hex revision>/<package> [--title="..."]');
    const ref = parseTarget(rest[0]);
    const got = await fetchPackage(ref, { onProgress: (m) => process.stdout.write(`${m}\n`) });
    if (got.licence !== 'CC0-1.0' && got.licence !== 'CC-BY-4.0') throw new Error(`licence ${got.licence} cannot be pinned (CC0-1.0 or CC-BY-4.0 only)`);
    if (!got.packageHash) throw new Error('the package publishes no package hash');
    const path = resolve(import.meta.dirname, '../../assets/sources.json');
    const id = `simready-${ref.owner.toLowerCase()}-${ref.pkg.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.replace(/-+$/, '');
    // Several `add` runs may finish together: a lock file keeps the read-modify-write of sources.json whole.
    const lock = `${path}.lock`;
    for (let i = 0; ; i++) {
      try {
        closeSync(openSync(lock, 'wx'));
        break;
      } catch {
        if (i > 600) throw new Error(`${lock} is held; remove it if no other add is running`);
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    try {
      const file = JSON.parse(readFileSync(path, 'utf8')) as { simready: { packages: Array<Record<string, unknown>> } };
      const licenceCode = got.licence === 'CC0-1.0' ? 'cc0-1.0' : 'cc-by-4.0';
      const entry = {
        id,
        provider: 'NVIDIA SimReady Central (Hugging Face)',
        title: arg('title') ?? ref.pkg,
        dataset: ref.repo,
        revision: ref.rev,
        package: ref.pkg,
        author: `${got.author} (Hugging Face user ${ref.owner})`,
        licence: got.licence,
        licenceUrl: got.licence === 'CC0-1.0' ? 'https://creativecommons.org/publicdomain/zero/1.0/' : 'https://creativecommons.org/licenses/by/4.0/',
        licenceEvidence: `com.nvidia.simready.packaging.json of the package: "license": "${got.licenceRaw.packaging ?? ''}"; dataset card (huggingface.co/api/datasets/${ref.repo}) cardData.license: ${got.licenceRaw.card ?? licenceCode}`,
        page: `https://huggingface.co/datasets/${ref.repo}/tree/${ref.rev}/${ref.pkg}`,
        url: `https://huggingface.co/datasets/${ref.repo}/resolve/${ref.rev}/${ref.pkg}/${got.usd.path}`,
        usd: got.usd.path,
        bytes: got.usd.bytes,
        sha256: got.usd.sha256,
        packageHash: got.packageHash,
        retrieved: new Date().toISOString().slice(0, 10),
      };
      const at = file.simready.packages.findIndex((p) => p['id'] === id);
      if (at >= 0) file.simready.packages[at] = entry;
      else file.simready.packages.push(entry);
      writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
    } finally {
      rmSync(lock, { force: true });
    }
    console.log(`pinned ${id} in assets/sources.json (${got.licence}, usd sha256 ${got.usd.sha256})`);
    return;
  }
  console.error('usage: assets:simready -- search "<text>" [--limit=8] [--max-size=2] [--json]\n       assets:simready -- fetch <owner>/<dataset>@<40-hex revision>/<package>\n       assets:simready -- add <owner>/<dataset>@<40-hex revision>/<package> [--title="..."]   (fetch and pin in assets/sources.json)');
  process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
