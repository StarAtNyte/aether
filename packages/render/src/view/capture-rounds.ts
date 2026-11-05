/**
 * Rounds of a pose capture until the picture is complete.
 *
 * A capture draws into a target of its own size, which is a render context of its own: every object it sees is prepared
 * again for that context, in the time-sliced preparation queue, and a draw whose object is still preparing is held back
 * (nothing is drawn for it). The first pass queues that work and is dropped. The next pass is complete only if the queue
 * has drained by then: on a busy machine, or while a compile walk holds the queue right after a world loads, it has not,
 * and a pass that holds back every draw (the sky too) reads back a black picture.
 *
 * So the pass is drawn again after the queue settles until a pass holds back nothing (or `rounds` passes were drawn).
 */

/** One drawn pass: its images and the draws it held back. */
export interface CapturePass<T> {
  images: T;
  /** Draws held back during this pass because their object was still being prepared for the capture's render context. */
  held: number;
}

/**
 * Draw `pass` once to prime it, then again after `settle` until a pass holds back no draw. At most `rounds` passes after
 * the priming one; the last one is returned even when it still held draws back.
 */
export async function captureUntilComplete<T>(pass: () => Promise<CapturePass<T>>, settle: () => Promise<void>, rounds = 4): Promise<CapturePass<T> & { passes: number }> {
  await pass();
  let passes = 1;
  for (;;) {
    await settle();
    const p = await pass();
    passes++;
    if (p.held === 0 || passes > rounds) return { ...p, passes };
  }
}
