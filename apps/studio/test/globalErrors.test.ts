import { describe, expect, it } from 'vitest';
import { installGlobalErrorReporting, serverErrorReporter } from '../src/lib/globalErrors';

function harness() {
  const handlers = new Map<string, (e: never) => void>();
  const target = { addEventListener: (t: string, l: (e: never) => void) => { handlers.set(t, l); }, removeEventListener: (t: string) => { handlers.delete(t); } };
  let clock = 0;
  const toasts: string[] = [], logs: string[] = [];
  const g = installGlobalErrorReporting(target as never, { toast: t => toasts.push(t), now: () => clock, log: m => logs.push(m), toastEveryMs: 1000 });
  return { g, handlers, toasts, logs, tick: (ms: number) => { clock += ms; } };
}
describe('global error reporting', () => {
  it('records a rejection, logs it and shows one toast per interval', () => {
    const h = harness();
    h.handlers.get('unhandledrejection')?.({ reason: new Error('boom') } as never);
    h.handlers.get('unhandledrejection')?.({ reason: new Error('other') } as never);
    expect(h.g.recent().map(e => e.message)).toEqual(['Error: boom', 'Error: other']);
    expect(h.toasts).toHaveLength(1);
    h.tick(1500);
    h.handlers.get('error')?.({ error: new Error('third'), message: 'third' } as never);
    expect(h.toasts).toHaveLength(2);
    expect(h.logs).toHaveLength(3);
  });
  it('ignores aborts, the resize-observer notice and repeats', () => {
    const h = harness();
    h.handlers.get('unhandledrejection')?.({ reason: new DOMException('stop', 'AbortError') } as never);
    h.handlers.get('error')?.({ message: 'ResizeObserver loop completed with undelivered notifications.' } as never);
    h.handlers.get('unhandledrejection')?.({ reason: 'same' } as never);
    h.handlers.get('unhandledrejection')?.({ reason: 'same' } as never);
    expect(h.g.recent()).toHaveLength(1);
  });
  it('removes its listeners', () => {
    const h = harness(); h.g.dispose();
    expect(h.handlers.size).toBe(0);
  });
});

describe('serverErrorReporter', () => {
  it('posts errors to the server when it answers the health probe, at most max times', async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push({ url, ...(typeof init?.body === 'string' ? { body: init.body } : {}) });
      return new Response(null, { status: url === '/api/health' ? 200 : 204 });
    }) as unknown as typeof fetch;
    const report = serverErrorReporter({ fetch: fake, max: 2, page: () => '#/editor' });
    for (let i = 0; i < 4; i++) report({ at: i, kind: 'error', message: `boom ${i}` });
    await new Promise((r) => setTimeout(r, 0));
    const posts = calls.filter((c) => c.url === '/api/errors');
    expect(posts).toHaveLength(2);
    expect(JSON.parse(posts[0]!.body!)).toEqual({ kind: 'error', message: 'boom 0', page: '#/editor' });
    expect(calls.filter((c) => c.url === '/api/health')).toHaveLength(1);
  });

  it('sends nothing on a static host with no server', async () => {
    const calls: string[] = [];
    const fake = (async (url: string) => {
      calls.push(url);
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;
    const report = serverErrorReporter({ fetch: fake });
    report({ at: 0, kind: 'error', message: 'boom' });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual(['/api/health']);
  });
});
