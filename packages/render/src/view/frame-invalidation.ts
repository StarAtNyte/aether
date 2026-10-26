/** Redraw readiness is not user motion and must not restart the motion/rest quality clock. */
export class FrameInvalidation {
  dirty = true;
  motion = true;
  animating = false;

  /** An external camera/content/quality change. */
  change(): void { this.dirty = true; this.motion = true; }
  /** Self-animating content needs a draw without moving the camera. */
  animate(): void { this.dirty = true; this.animating = true; }
  /** Resources finished preparing; retain any real change already waiting. */
  prepared(): void { this.dirty = true; }
  clear(): void { this.dirty = false; this.motion = false; this.animating = false; }
}
