/**
 * On-screen play controls for touch screens (shown by CSS on coarse
 * pointers only): a virtual stick on the left, Jump and Act buttons on the
 * right. The stick writes straight into the simulation's input (no React
 * render per move); the knob moves with a transform.
 */
import { memo, useRef, type PointerEvent, type ReactElement } from 'react';
import { useSimulation } from '../../app/context';
import { Icon } from '../Icon';

/** Stick travel radius (px). */
const RADIUS = 40;

/** Normalized stick vector for a pointer offset (pure; exported for tests). */
export function stickVector(dx: number, dy: number, radius: number = RADIUS): { forward: number; right: number; x: number; y: number } {
  const len = Math.hypot(dx, dy);
  const k = len > radius ? radius / len : 1;
  const x = dx * k;
  const y = dy * k;
  return { forward: radius > 0 ? -y / radius : 0, right: radius > 0 ? x / radius : 0, x, y };
}

/** Touch controls. */
export const TouchControls = memo(function TouchControls(): ReactElement {
  const sim = useSimulation();
  const knob = useRef<HTMLSpanElement>(null);
  const origin = useRef<{ x: number; y: number; id: number } | null>(null);

  const move = (e: PointerEvent<HTMLDivElement>): void => {
    const o = origin.current;
    if (!o || e.pointerId !== o.id) return;
    const v = stickVector(e.clientX - o.x, e.clientY - o.y);
    sim?.setVirtualStick(v.forward, v.right);
    if (knob.current) knob.current.style.transform = `translate(${v.x}px, ${v.y}px)`;
  };
  const end = (): void => {
    origin.current = null;
    sim?.setVirtualStick(0, 0);
    if (knob.current) knob.current.style.transform = '';
  };

  return (
    <div className="touch">
      <div
        className="touch__stick"
        aria-label="Move"
        role="application"
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          const r = e.currentTarget.getBoundingClientRect();
          origin.current = { x: r.left + r.width / 2, y: r.top + r.height / 2, id: e.pointerId };
          move(e);
        }}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <span className="touch__knob" ref={knob} />
      </div>
      <div className="touch__buttons">
        <button
          type="button"
          className="touch__btn"
          aria-label="Act"
          onPointerDown={(e) => {
            e.stopPropagation();
            sim?.tapVirtual('KeyE');
          }}
        >
          <Icon name="hand" size={20} />
        </button>
        <button
          type="button"
          className="touch__btn touch__btn--primary"
          aria-label="Jump"
          onPointerDown={(e) => {
            e.stopPropagation();
            sim?.tapVirtual('Space');
          }}
        >
          <Icon name="jump" size={20} />
        </button>
      </div>
    </div>
  );
});
