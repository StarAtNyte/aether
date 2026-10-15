import { describe, expect, it } from 'vitest';
import { isGeneratedServiceWorker, serviceWorkerSource } from '../src/offline-sw';

describe('offline service worker of published builds', () => {
  it('recognises exactly the generated worker', () => {
    const sw = serviceWorkerSource('k3x9', ['index.html', 'game.json', 'assets/play-1a.js']);
    expect(isGeneratedServiceWorker(sw)).toBe(true);
    expect(isGeneratedServiceWorker(serviceWorkerSource('', []))).toBe(true);
  });

  it('rejects anything else (exploit attempts)', () => {
    const sw = serviceWorkerSource('k3x9', ['index.html']);
    expect(isGeneratedServiceWorker(`${sw}fetch('/api/local/accounts');\n`)).toBe(false);
    expect(isGeneratedServiceWorker(sw.replace("if (req.method !== 'GET') return;", ''))).toBe(false);
    // Code smuggled into the file-list line is refused by the regenerate-and-compare check.
    expect(isGeneratedServiceWorker(sw.replace('const FILES = ["./","./index.html"];', 'const FILES = ["./"];fetch("/x");[];'))).toBe(false);
    expect(isGeneratedServiceWorker(sw.replace('"./index.html"', '"./../x"'))).toBe(false);
    expect(isGeneratedServiceWorker('')).toBe(false);
    expect(isGeneratedServiceWorker('x'.repeat(600 * 1024))).toBe(false);
  });

  it('drops unsafe file names from the cache list', () => {
    expect(serviceWorkerSource('id', ['ok.js', '../bad.js', 'a b.js', 'x"y.js'])).not.toMatch(/bad\.js|a b\.js|x"y/);
  });
});
