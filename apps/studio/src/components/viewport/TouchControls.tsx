/**
 * On-screen play controls for touch screens (shown by CSS on coarse
 * pointers only): a virtual stick on the left, Jump and Act buttons on the
 * right. The stick writes straight into the simulation's input (no React
 * render per move); the knob moves with a transform.
 */
import { memo, useRef, type PointerEvent, type ReactElement } from 'react';
import { useSimulation, useWorld } from '../../app/context';
import type { Simulation } from '../../engine/Simulation';
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

/** Touch controls of the studio's play mode. */
export const TouchControls = memo(function TouchControls(): ReactElement {
  const armed = useWorld().player.weapon !== undefined;
  return <TouchControlsView sim={useSimulation()} armed={armed} />;
});

/**
 * Touch controls driving `sim` (the studio and published games share it). `armed` (a world with a player weapon) adds
 * a Fire button (held: the trigger) and a Reload button; dragging on the view aims.
 */
export const TouchControlsView = memo(function TouchControlsView({ sim, armed = false }: { sim: Pick<Simulation, 'setVirtualStick' | 'tapVirtual' | 'setVirtualFire'> | null; armed?: boolean }): ReactElement {
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
        {armed && (
          <button
            type="button"
            className="touch__btn"
            aria-label="Reload"
            onPointerDown={(e) => {
              e.stopPropagation();
              sim?.tapVirtual('KeyR');
            }}
          >
            R
          </button>
        )}
        {armed && (
          <button
            type="button"
            className="touch__btn touch__btn--primary touch__btn--fire"
            aria-label="Fire"
            data-testid="touch-fire"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              sim?.setVirtualFire(true);
              try {
                // Keep the trigger while the thumb slides off the button.
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                /* an unknown pointer (synthetic events): the press still fires */
              }
            }}
            onPointerUp={() => sim?.setVirtualFire(false)}
            onPointerCancel={() => sim?.setVirtualFire(false)}
            onLostPointerCapture={() => sim?.setVirtualFire(false)}
          >
            Fire
          </button>
        )}
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
