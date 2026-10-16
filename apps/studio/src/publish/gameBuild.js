/**
 * Game publishing: a standalone, static web build of the current world,
 * produced entirely in the browser.
 *
 *   index.html            the player page (from the studio's `play.html`), with a
 *                         strict Content-Security-Policy meta tag, title,
 *                         description, web-app manifest and icons
 *   assets/…              exactly the player's files (`play-manifest.json`:
 *                         renderer, physics, logic, block game; no editor, no agent)
 *   assets/lib/…          the library models / textures / skies the world uses
 *   assets/user/…         the user's own imports the world uses
 *   game.json             world (with its generator and script source), title-screen
 *                         text, music, imports, optional block-world save
 *   saves/world.aethersave optional block-world save
 *   manifest.webmanifest, sw.js, icon-192.png, icon-512.png, cover.png, screenshot.png
 *   project/<name>.aether.json, CREDITS.txt, README.md, .nojekyll
 *
 * The layout is what itch.io ("HTML" project, index.html at the root),
 * GitHub Pages, Netlify, Vercel and any static host expect; every path is
 * relative, so the build also works from a sub-folder.
 */
import { z } from 'zod';
import { catalogEntry, creditsFor, creditsText, getCatalog, isUserAssetId, libraryUrl, loadCatalog, worldAssetIds } from '@aether/assets';
import { safeEntryName, writeZip } from '@aether/assets/zip';
import { exportFileName, exportWorld } from '../lib/worldIO';
import { escapeXml } from './floorplan';
import { gameJson } from './manifest';
import { serviceWorkerSource } from '../player/offline';
/** The player's file list written by the build (`scripts/vite/player-manifest.ts`). */
const PlayerFiles = z.object({
    version: z.literal(1),
    entry: z.literal('play.html'),
    files: z.array(z.string().max(200)).min(2).max(1000),
});
/** Largest build (bytes, before compression). */
export const MAX_BUILD_BYTES = 400 * 1024 * 1024;
/**
 * Content-Security-Policy of published builds (a meta tag: static hosts set
 * no headers). Same-origin code only, WebAssembly allowed, no inline or
 * eval'd script on the page; the generator sandbox worker gets its own
 * policy from its response (or none on plain static hosts), never the page's.
 */
export const BUILD_CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'none'";
const ITCH_COVER = [630, 500];
/** Browser canvas image kit. */
export function canvasImageKit() {
    return {
        async crop(image, w, h, stamp) {
            const bitmap = await createImageBitmap(image);
            try {
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                if (!ctx)
                    throw new Error('2D canvas unavailable');
                const s = Math.max(w / bitmap.width, h / bitmap.height);
                const dw = bitmap.width * s;
                const dh = bitmap.height * s;
                ctx.fillStyle = '#07080b';
                ctx.fillRect(0, 0, w, h);
                ctx.drawImage(bitmap, (w - dw) / 2, (h - dh) / 2, dw, dh);
                if (stamp)
                    drawStamp(ctx, stamp, w, h);
                const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
                canvas.width = 0;
                canvas.height = 0;
                if (!blob)
                    throw new Error('could not encode image');
                return new Uint8Array(await blob.arrayBuffer());
            }
            finally {
                bitmap.close();
            }
        },
    };
}
/** A small caption pill in the lower-left corner of a share card. */
function drawStamp(ctx, text, w, h) {
    const size = Math.max(11, Math.round(h * 0.034));
    const pad = Math.round(size * 0.7);
    ctx.font = `600 ${size}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
    const width = Math.min(w - pad * 2, ctx.measureText(text).width + pad * 2);
    const height = size + pad;
    const x = pad;
    const y = h - pad - height;
    ctx.fillStyle = 'rgba(7, 8, 11, 0.78)';
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, height / 2);
    ctx.fill();
    ctx.fillStyle = '#7ee0a8';
    ctx.beginPath();
    ctx.arc(x + pad * 0.9, y + height / 2, size * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f2f4f8';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + pad * 1.5, y + height / 2 + 1, width - pad * 2);
}
/** Caption of a sealed share card (never claims more than a recorded replay). */
export function sealStamp(proof) {
    if (!proof || !proof.claim.passed)
        return undefined;
    return `Replay-sealed · ${proof.hash.slice(7, 15)}`;
}
async function defaultFetch(path) {
    const res = await fetch(`/${path}`, { cache: 'force-cache', credentials: 'same-origin' });
    if (!res.ok)
        throw new Error(`${path}: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
}
/** A short content id for a build (FNV-1a over the game JSON and file list). */
export function buildId(gameText, files) {
    let h = 0x811c9dc5;
    const feed = (s) => {
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
        }
    };
    feed(gameText);
    for (const f of files)
        feed(f);
    return (h >>> 0).toString(36);
}
/** The published index.html from the player page. */
export function publishedIndexHtml(playHtml, game) {
    const title = escapeXml(game.title.slice(0, 80) || 'Untitled game');
    const desc = escapeXml((game.description || `${game.title} — a playable 3D world made with Aether.`).replace(/\s+/g, ' ').slice(0, 300));
    // Function replacers: a replacement STRING would expand `$'`, `$&`, `$1` … typed into a title,
    // pasting the rest of the page into an attribute (markup injection).
    let html = playHtml.replace(/<title>[^<]*<\/title>/, () => `<title>${title}</title>`).replace(/<meta name="description" content="[^"]*"\s*\/?>/, () => `<meta name="description" content="${desc}" />`);
    const head = [
        `<meta http-equiv="Content-Security-Policy" content="${BUILD_CSP}" />`,
        '<link rel="manifest" href="manifest.webmanifest" />',
        '<link rel="apple-touch-icon" href="icon-192.png" />',
        `<meta property="og:title" content="${title}" />`,
        `<meta property="og:description" content="${desc}" />`,
        ...(game.proof && game.proof.claim.passed && /^sha256:[0-9a-f]{64}$/.test(game.proof.hash) ? [`<meta name="aether:proof" content="${game.proof.hash}" />`] : []),
    ].join('\n    ');
    // The CSP must come before anything it governs: right after the charset.
    html = html.replace(/(<meta charset="UTF-8"\s*\/?>)/i, (charset) => `${charset}\n    ${head}`);
    return html;
}
/** `manifest.webmanifest` of a published game. */
export function webManifest(title, description) {
    return JSON.stringify({
        name: title.slice(0, 80),
        short_name: title.slice(0, 24),
        description: description.slice(0, 300),
        start_url: './',
        scope: './',
        display: 'fullscreen',
        orientation: 'any',
        background_color: '#07080b',
        theme_color: '#0b0c10',
        icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
    }, null, 2);
}
/** README.md of a build: what it is and how to put it online. */
export function buildReadme(game, credits, sealed = false) {
    return [
        `# ${game.title}`,
        '',
        game.author ? `By ${game.author}.` : '',
        '',
        game.description,
        '',
        '## Controls',
        '',
        game.controls,
        '',
        '## Play it',
        '',
        'This folder is a complete static website. Serve it over HTTP (browsers do not run it from `file://`):',
        '',
        '- **itch.io**: create an "HTML" project, upload this zip and tick "This file will be played in the browser". `cover.png` (630×500) is the cover image.',
        '- **GitHub Pages**: push the files to a repository and enable Pages for its branch.',
        '- **Netlify / Vercel / Cloudflare Pages**: deploy this folder as a static site.',
        '- **On your computer**: `npx serve .` (or any static server), then open the printed address.',
        '',
        'It works offline after the first visit and can be installed as an app.',
        '',
        ...(sealed
            ? [
                '## Replay seal',
                '',
                'This game ships a replay proof (`proof.json`, also inside `game.json`): a record that re-simulating the world with its physics and rules reproduced the author\'s checks. The title screen has a "Check it yourself" button, or run `npx aether-verify game.json` from the Aether repository. It is a deterministic replay check, not a formal proof that the game is correct.',
                '',
            ]
            : []),
        '## Credits',
        '',
        '```',
        credits.trim(),
        '```',
        '',
        'Made with Aether. `project/` holds the world as an Aether project file you can open in the studio again.',
        '',
    ]
        .filter((l, i, a) => !(l === '' && a[i - 1] === ''))
        .join('\n');
}
function extOf(mime) {
    switch (mime) {
        case 'model/gltf-binary':
            return 'glb';
        case 'image/png':
            return 'png';
        case 'image/jpeg':
            return 'jpg';
        case 'image/webp':
            return 'webp';
        default:
            return 'hdr';
    }
}
function abortIf(signal) {
    if (signal?.aborted)
        throw new DOMException('cancelled', 'AbortError');
}
/** Build the game (see module docs). */
export async function buildGame(input) {
    const fetchFile = input.fetchFile ?? defaultFetch;
    const enc = new TextEncoder();
    const signal = input.signal;
    const progress = (done, total, label) => input.onProgress?.(done, total, label);
    progress(0, 1, 'Reading the player build…');
    let manifest;
    try {
        manifest = PlayerFiles.parse(JSON.parse(new TextDecoder().decode(await fetchFile('play-manifest.json'))));
    }
    catch (e) {
        throw new Error(`The player build is missing (${e instanceof Error ? e.message.slice(0, 120) : 'error'}). Run the production build of the studio to publish games.`);
    }
    const playerFiles = manifest.files.filter((f) => f !== 'play.html');
    for (const f of manifest.files)
        if (!safeEntryName(f))
            throw new Error(`unsafe file in the player manifest: ${f.slice(0, 60)}`);
    await loadCatalog();
    const world = input.world;
    const libraryFiles = [];
    const want = (path) => {
        if (typeof path === 'string' && path && !libraryFiles.includes(path))
            libraryFiles.push(path);
    };
    for (const id of worldAssetIds(world)) {
        if (isUserAssetId(id))
            continue;
        const e = catalogEntry(id);
        if (!e)
            continue;
        want(e.file);
        for (const l of e.lods)
            want(l.file);
    }
    // Photographed surface finishes (architecture) the world's materials use.
    const finishes = new Set();
    for (const e of Object.values(world.entities))
        if (e.material?.finish)
            finishes.add(e.material.finish);
    for (const e of getCatalog()?.entries ?? []) {
        if (e.kind === 'material' && e.material && finishes.has(e.material.finish)) {
            want(e.material.maps.albedo);
            want(e.material.maps.orm);
            want(e.material.maps.normal);
        }
    }
    const entries = [];
    let bytes = 0;
    const add = (name, data) => {
        bytes += data.byteLength;
        if (bytes > MAX_BUILD_BYTES)
            throw new Error('The game is too large to publish (over 400 MB).');
        entries.push({ name, data });
    };
    const total = playerFiles.length + libraryFiles.length + 1;
    let done = 0;
    // Player files, a few at a time.
    const queue = [...playerFiles];
    const fetched = new Map();
    const workers = Array.from({ length: 4 }, async () => {
        for (;;) {
            const f = queue.shift();
            if (!f)
                return;
            abortIf(signal);
            fetched.set(f, await fetchFile(f));
            progress(++done, total, 'Packing the player…');
        }
    });
    await Promise.all(workers);
    for (const f of playerFiles)
        add(f, fetched.get(f));
    for (const path of libraryFiles) {
        abortIf(signal);
        const data = await fetchFile(libraryUrl(path).replace(/^\/+/, ''));
        add(`assets/lib/${path}`, data);
        progress(++done, total, 'Packing models and textures…');
    }
    const imports = [];
    for (const imp of input.imports ?? []) {
        if (!isUserAssetId(imp.meta.id))
            continue;
        const file = `assets/user/${imp.meta.id}.${extOf(imp.meta.mime)}`;
        add(file, imp.data);
        imports.push({ meta: imp.meta, file });
    }
    const game = {
        title: input.title.trim().slice(0, 80) || world.name,
        description: input.description.trim().slice(0, 600),
        author: input.author.trim().slice(0, 60),
        controls: input.controls.trim().slice(0, 300),
        publishedAt: input.now ?? Date.now(),
        music: input.music,
        ...(input.proof ? { proof: input.proof } : {}),
        ...(input.save && input.save.byteLength > 0 ? { save: 'saves/world.aethersave' } : {}),
        ...(imports.length > 0 ? { imports } : {}),
        world,
    };
    const gameText = gameJson(game);
    add('game.json', enc.encode(gameText));
    if (game.save && input.save)
        add(game.save, input.save);
    const playHtml = new TextDecoder().decode(await fetchFile('play.html'));
    add('index.html', enc.encode(publishedIndexHtml(playHtml, { title: game.title, description: game.description, ...(input.proof ? { proof: input.proof } : {}) })));
    try {
        add('favicon.svg', await fetchFile('favicon.svg'));
    }
    catch {
        /* optional */
    }
    const images = input.images ?? (typeof document !== 'undefined' ? canvasImageKit() : null);
    if (input.cover && images) {
        progress(done, total, 'Cutting covers and icons…');
        const stamp = sealStamp(input.proof);
        add('cover.png', await images.crop(input.cover, ITCH_COVER[0], ITCH_COVER[1], stamp));
        add('screenshot.png', await images.crop(input.cover, 1280, 720, stamp));
        add('icon-192.png', await images.crop(input.cover, 192, 192));
        add('icon-512.png', await images.crop(input.cover, 512, 512));
    }
    add('manifest.webmanifest', enc.encode(webManifest(game.title, game.description)));
    const credits = creditsText(game.title, creditsFor(world, getCatalog()));
    add('CREDITS.txt', enc.encode(credits));
    add('README.md', enc.encode(buildReadme(game, credits, input.proof !== undefined)));
    add(`project/${exportFileName(world)}`, enc.encode(exportWorld(world)));
    if (input.proof)
        add('proof.json', enc.encode(JSON.stringify(input.proof, null, 2)));
    add('.nojekyll', new Uint8Array(0));
    const files = entries.map((e) => e.name).sort();
    const id = buildId(gameText, files);
    // The offline cache lists every file except the service worker itself.
    add('sw.js', enc.encode(serviceWorkerSource(id, files.filter((f) => f !== '.nojekyll' && !f.startsWith('project/') && f !== 'README.md'))));
    progress(total, total, 'Compressing…');
    abortIf(signal);
    const zip = await writeZip(entries);
    const slug = exportFileName(world).replace(/\.aether\.json$/, '');
    return { zip, fileName: `${slug}-web.zip`, files: entries.map((e) => e.name).sort(), bytes, id };
}
