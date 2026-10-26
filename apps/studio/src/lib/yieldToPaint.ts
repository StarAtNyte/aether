/** Let a newly committed processing indicator paint before starting expensive work. */
export function yieldToPaint(): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  if (document.visibilityState === 'hidden' || typeof requestAnimationFrame !== 'function') {
    return new Promise(resolve => setTimeout(resolve, 0));
  }
  return new Promise(resolve => {
    let first = 0, second = 0;
    const finish = (): void => {
      clearTimeout(timeout);
      cancelAnimationFrame(first); cancelAnimationFrame(second);
      resolve();
    };
    // A tab can become hidden between the two frames; background work must still proceed.
    const timeout = setTimeout(finish, 100);
    first = requestAnimationFrame(() => { second = requestAnimationFrame(finish); });
  });
}
