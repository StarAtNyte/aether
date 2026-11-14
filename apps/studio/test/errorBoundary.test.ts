import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ErrorBoundary, classifyFailure, failureCopy, reloadForStaleDeploy } from '../src/components/ErrorBoundary';

describe('error boundary', () => {
  it('classifies chunk-load failures by connectivity', () => {
    const e = new TypeError('Failed to fetch dynamically imported module: https://x/assets/EditorRoute-abc.js');
    expect(classifyFailure(e, false)).toBe('offline');
    expect(classifyFailure(e, true)).toBe('chunk');
    expect(classifyFailure(new Error('Loading chunk 12 failed.'), true)).toBe('chunk');
    expect(classifyFailure(new RangeError('boom'), true)).toBe('crash');
    expect(classifyFailure('weird', true)).toBe('crash');
  });

  it('has friendly copy for every failure', () => {
    expect(failureCopy('offline', 'editor').title).toMatch(/offline/i);
    expect(failureCopy('chunk', 'editor').text).toMatch(/reload/i);
    expect(failureCopy('crash', 'editor').text).toMatch(/saved on this device/i);
  });

  it('renders a retry state instead of nothing', () => {
    const b = new ErrorBoundary({ children: null, what: 'editor' });
    b.state = ErrorBoundary.getDerivedStateFromError(new TypeError('Failed to fetch dynamically imported module'));
    const html = renderToStaticMarkup(b.render() as ReturnType<typeof createElement>);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Try again');
    expect(html).toContain('Back to projects');
    expect(html.length).toBeGreaterThan(200);
  });

  it('renders children while nothing failed', () => {
    const b = new ErrorBoundary({ children: createElement('p', null, 'fine') });
    expect(renderToStaticMarkup(b.render() as ReturnType<typeof createElement>)).toBe('<p>fine</p>');
  });

  it('the inline variant has no page-level actions', () => {
    const b = new ErrorBoundary({ children: null, variant: 'inline' });
    b.state = { error: new Error('x'), failed: true };
    const html = renderToStaticMarkup(b.render() as ReturnType<typeof createElement>);
    expect(html).toContain('Try again');
    expect(html).not.toContain('Back to projects');
  });
});

describe('stale deploy', () => {
  it('reloads once when a dynamic import of a replaced build fails, never in a loop, never for a crash', () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    let reloads = 0;
    const reload = (): void => void reloads++;
    const stale = new TypeError('Failed to fetch dynamically imported module: https://x/assets/PlayerApp-abc.js');
    expect(reloadForStaleDeploy(new Error('boom'), store, reload, 1_000)).toBe(false);
    expect(reloadForStaleDeploy(stale, store, reload, 1_000)).toBe(true);
    expect(reloadForStaleDeploy(stale, store, reload, 30_000)).toBe(false);
    expect(reloadForStaleDeploy(stale, store, reload, 120_000)).toBe(true);
    expect(reloads).toBe(2);
  });
});
