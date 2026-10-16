import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { absolutizePreviewTags, siteMeta, siteOrigin } from '../../../scripts/vite/site-meta';
const STUDIO = fileURLToPath(new URL('..', import.meta.url));
const INDEX = readFileSync(`${STUDIO}index.html`, 'utf8');
describe('siteOrigin', () => {
    it('prefers VITE_AETHER_SITE_URL, then the Vercel production host', () => {
        expect(siteOrigin({ VITE_AETHER_SITE_URL: 'https://aether.example.com/', VERCEL_PROJECT_PRODUCTION_URL: 'x.vercel.app' })).toBe('https://aether.example.com');
        expect(siteOrigin({ VERCEL_PROJECT_PRODUCTION_URL: 'aether-studio.vercel.app' })).toBe('https://aether-studio.vercel.app');
        expect(siteOrigin({})).toBeNull();
    });
    it('ignores anything that is not a plain https origin (no markup injection)', () => {
        for (const bad of ['http://aether.example.com', 'https://a.example.com/path', 'https://a.example.com"><script>', 'javascript:alert(1)', 'https://']) {
            expect(siteOrigin({ VITE_AETHER_SITE_URL: bad })).toBeNull();
        }
        expect(siteOrigin({ VERCEL_PROJECT_PRODUCTION_URL: 'evil.com"/><script>' })).toBeNull();
    });
});
describe('absolutizePreviewTags', () => {
    it('rewrites the preview image and url tags of the studio entry', () => {
        const out = absolutizePreviewTags(INDEX, 'https://aether.example.com');
        expect(out).toContain('<meta property="og:image" content="https://aether.example.com/og.jpg" />');
        expect(out).toContain('<meta name="twitter:image" content="https://aether.example.com/og.jpg" />');
        expect(out).toContain('<meta property="og:url" content="https://aether.example.com/" />');
        // Nothing else changes (scripts, icons, stylesheet links stay root-relative).
        expect(out).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />');
        expect(absolutizePreviewTags(INDEX, null)).toBe(INDEX);
    });
    it('only touches index.html', () => {
        const plugin = siteMeta({ VITE_AETHER_SITE_URL: 'https://aether.example.com' });
        const tag = '<meta property="og:image" content="/og.jpg" />';
        expect(plugin.transformIndexHtml.handler(tag, { filename: '/x/apps/studio/index.html' })).toContain('https://aether.example.com/og.jpg');
        expect(plugin.transformIndexHtml.handler(tag, { filename: '/x/apps/studio/play.html' })).toBe(tag);
    });
});
describe('share and install metadata', () => {
    it('index.html has Open Graph and Twitter tags, icons and a manifest', () => {
        for (const needle of ['og:title', 'og:description', 'og:image', 'og:image:width', 'twitter:card', 'summary_large_image', 'apple-touch-icon', 'site.webmanifest', 'name="description"']) {
            expect(INDEX).toContain(needle);
        }
    });
    it('every referenced file exists in public/', () => {
        for (const f of ['og.jpg', 'favicon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'site.webmanifest', 'robots.txt', '404.html']) {
            expect(existsSync(`${STUDIO}public/${f}`), f).toBe(true);
        }
        const manifest = JSON.parse(readFileSync(`${STUDIO}public/site.webmanifest`, 'utf8'));
        expect(manifest.start_url).toBe('/');
        for (const icon of manifest.icons)
            expect(existsSync(`${STUDIO}public${icon.src}`)).toBe(true);
    });
    it('the share card is a 1200×630 JPEG', () => {
        const jpg = readFileSync(`${STUDIO}public/og.jpg`);
        expect(jpg[0]).toBe(0xff);
        expect(jpg[1]).toBe(0xd8);
        // Find the SOF0/SOF2 frame header: height and width follow the precision byte.
        let i = 2;
        let size = null;
        while (i < jpg.length - 9) {
            if (jpg[i] !== 0xff)
                break;
            const marker = jpg[i + 1];
            const len = jpg.readUInt16BE(i + 2);
            if (marker === 0xc0 || marker === 0xc2) {
                size = [jpg.readUInt16BE(i + 7), jpg.readUInt16BE(i + 5)];
                break;
            }
            i += 2 + len;
        }
        expect(size).toEqual([1200, 630]);
        expect(jpg.length).toBeLessThan(300 * 1024);
    });
    it('robots.txt keeps crawlers out of the API', () => {
        expect(readFileSync(`${STUDIO}public/robots.txt`, 'utf8')).toMatch(/Disallow: \/api\//);
    });
});
