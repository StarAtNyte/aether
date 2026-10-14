/**
 * 2D floor plan of the selected storey (an SVG drawing over the viewport):
 * walls as solid poche with their openings, door leaves and swing arcs,
 * windows, stairs, furniture footprints, room fills with label chips
 * (colour dot, name, area) and overall / per-room dimensions. Read back
 * from the World IR with `floorPlan2d`, so every edit shows up.
 *
 * Tools: select (click a room; Delete removes it), rectangle room (drag),
 * polygon room (click corners, close on the first one, Enter or a double
 * click), door and window (click a wall). Points snap to room corners,
 * edges and a 10 cm grid. Wheel zooms, right / middle drag (or dragging
 * empty space with the select tool) pans.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement, type WheelEvent as ReactWheelEvent } from 'react';
import { floorPlan2d, pickWall, planOf, pointInPolygon, snapPlanPoint, type BuildingPlan, type P2, type PlanLevel, type RoomType } from '@aether/arch';
import { useStudio, useUI, useWorld } from '../../app/context';
import { Icon, type IconName } from '../Icon';
import { areaLabel, closesPolygon, dragRect, fitPlan, lengthLabel, outlineArea, panBy, pathOf, roomColors, viewBox, zoomAt, type PlanCamera } from '../../lib/planView';
import type { PlanTool } from '../../state/archUi';

const TOOLS: ReadonlyArray<{ id: PlanTool; icon: IconName; label: string; hint: string }> = [
  { id: 'select', icon: 'pointer', label: 'Select', hint: 'Click a room to select it · Delete removes it · drag to pan' },
  { id: 'rect', icon: 'square', label: 'Rectangle room', hint: 'Drag a rectangle; rooms share walls with their neighbours' },
  { id: 'polygon', icon: 'polygon', label: 'Polygon room', hint: 'Click corners · click the first corner, Enter or double-click to close · Esc cancels' },
  { id: 'door', icon: 'door', label: 'Door', hint: 'Click a wall between two rooms, or an outside wall' },
  { id: 'window', icon: 'window', label: 'Window', hint: 'Click an outside wall' },
];

const ROOM_TYPES: ReadonlyArray<[RoomType, string]> = [
  ['living', 'Living room'],
  ['kitchen', 'Kitchen'],
  ['dining', 'Dining room'],
  ['bedroom', 'Bedroom'],
  ['bathroom', 'Bathroom'],
  ['office', 'Study'],
  ['hall', 'Hallway'],
  ['kids', "Kids' room"],
  ['storage', 'Storage'],
  ['laundry', 'Laundry'],
  ['meeting', 'Meeting room'],
  ['cafe', 'Café'],
  ['terrace', 'Terrace'],
];

/** The plan of the building, or null when it cannot be read. */
function readPlan(world: ReturnType<typeof useWorld>, building: string): BuildingPlan | null {
  try {
    return planOf(world, building);
  } catch {
    return null;
  }
}

/** Floor-plan overlay. */
export const PlanView = memo(function PlanView(): ReactElement | null {
  const studio = useStudio();
  const world = useWorld();
  const a = useUI((s) => s.arch);
  const hostRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState<[number, number]>([800, 600]);
  const [cam, setCam] = useState<PlanCamera | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<P2[]>([]);
  const [hover, setHover] = useState<P2 | null>(null);
  const [dragStart, setDragStart] = useState<P2 | null>(null);
  const panRef = useRef<{ x: number; y: number; id: number } | null>(null);
  const set = studio.store.getState().setArch;
  const building = a.building;
  const plan2d = useMemo(() => (building ? floorPlan2d(world, building, a.level) : null), [world, building, a.level]);
  const plan = useMemo(() => (building ? readPlan(world, building) : null), [world, building]);
  const level: PlanLevel | null = plan?.levels[a.level] ?? null;

  // Track the viewport size.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize([Math.max(1, el.clientWidth), Math.max(1, el.clientHeight)]));
    ro.observe(el);
    setSize([Math.max(1, el.clientWidth), Math.max(1, el.clientHeight)]);
    return () => ro.disconnect();
  }, []);

  // Fit when the plan opens, the storey or building changes, and on resizes until the user pans or zooms.
  const userMoved = useRef(false);
  const target = `${building ?? ''}|${a.level}`;
  const lastTarget = useRef('');
  if (lastTarget.current !== target) {
    lastTarget.current = target;
    userMoved.current = false;
  }
  const fitKey = `${target}|${userMoved.current ? 'user' : `${size[0]}x${size[1]}`}`;
  const fitted = useRef('');
  const margin = Math.min(72, Math.max(24, Math.min(size[0], size[1]) * 0.08));
  useEffect(() => {
    if (!plan2d || fitted.current === fitKey || userMoved.current) return;
    fitted.current = fitKey;
    setCam(fitPlan(plan2d.bounds, size[0], size[1], margin));
  }, [plan2d, fitKey, size, margin]);

  // Leaving a tool drops its draft.
  useEffect(() => {
    setDraft([]);
    setDragStart(null);
  }, [a.planTool, a.level]);

  const toPlan = useCallback(
    (clientX: number, clientY: number): P2 | null => {
      const svg = svgRef.current;
      const m = svg?.getScreenCTM();
      if (!svg || !m) return null;
      const pt = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
      return [pt.x, pt.y];
    },
    [],
  );

  const commitPolygon = useCallback(
    (points: readonly P2[]) => {
      setDraft([]);
      if (points.length >= 3) studio.arch.drawRoom(points);
    },
    [studio],
  );

  // Keyboard: Esc cancels a draft, Enter closes a polygon, Backspace drops the last point, Delete removes the selected room.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'Escape' && (draft.length > 0 || dragStart)) {
        e.preventDefault();
        e.stopPropagation();
        setDraft([]);
        setDragStart(null);
      } else if (e.key === 'Enter' && a.planTool === 'polygon' && draft.length >= 3) {
        e.preventDefault();
        commitPolygon(draft);
      } else if (e.key === 'Backspace' && draft.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        setDraft((d) => d.slice(0, -1));
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected && a.planTool === 'select') {
        e.preventDefault();
        e.stopPropagation();
        if (studio.arch.removeRoom(selected) === null) setSelected(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [draft, dragStart, a.planTool, selected, studio, commitPolygon]);

  if (!a.building || !a.plan) return null;
  const view = cam ?? (plan2d ? fitPlan(plan2d.bounds, size[0], size[1], margin) : { cx: 0, cz: 0, scale: 40 });
  const vb = viewBox(view, size[0], size[1]);
  const px = 1 / view.scale;
  const snap = (p: P2): P2 => snapPlanPoint(p, level);

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>): void => {
    const p = toPlan(e.clientX, e.clientY);
    if (!p) return;
    const panButton = e.button === 1 || e.button === 2;
    if (panButton) {
      panRef.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    const tool = a.planTool;
    if (tool === 'select') {
      const room = plan2d?.rooms.find((r) => pointInPolygon(p[0], p[1], r.polygon));
      setSelected(room?.id ?? null);
      if (!room) {
        panRef.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
        e.currentTarget.setPointerCapture(e.pointerId);
      }
    } else if (tool === 'rect') {
      setDragStart(snap(p));
      setHover(snap(p));
      e.currentTarget.setPointerCapture(e.pointerId);
    } else if (tool === 'polygon') {
      const q = snap(p);
      if (closesPolygon(draft, q)) commitPolygon(draft);
      else if (draft.length < 32) setDraft([...draft, q]);
    } else if (tool === 'door') {
      studio.arch.addDoor(p);
    } else if (tool === 'window') {
      studio.arch.addWindow(p);
    }
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>): void => {
    const pan = panRef.current;
    if (pan && pan.id === e.pointerId) {
      const dx = e.clientX - pan.x;
      const dy = e.clientY - pan.y;
      panRef.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
      userMoved.current = true;
      setCam(panBy(view, dx, dy));
      return;
    }
    const p = toPlan(e.clientX, e.clientY);
    if (!p) return;
    setHover(a.planTool === 'door' || a.planTool === 'window' ? p : snap(p));
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>): void => {
    if (panRef.current?.id === e.pointerId) {
      panRef.current = null;
      return;
    }
    if (a.planTool === 'rect' && dragStart) {
      const p = toPlan(e.clientX, e.clientY);
      const rect = p ? dragRect(dragStart, snap(p)) : [];
      setDragStart(null);
      if (rect.length === 4) studio.arch.drawRoom(rect);
    }
  };

  const onWheel = (e: ReactWheelEvent<SVGSVGElement>): void => {
    const r = e.currentTarget.getBoundingClientRect();
    const factor = Math.exp(-Math.max(-200, Math.min(200, e.deltaY)) * 0.0022);
    userMoved.current = true;
    setCam(zoomAt(view, factor, e.clientX - r.left, e.clientY - r.top, size[0], size[1]));
  };

  // Drawing preview.
  const preview: P2[] = a.planTool === 'rect' && dragStart && hover ? dragRect(dragStart, hover) : a.planTool === 'polygon' && draft.length > 0 && hover ? [...draft, hover] : [];
  const wallHint = (a.planTool === 'door' || a.planTool === 'window') && hover && level ? pickWall(level, hover) : null;
  const wallHintOk = wallHint !== null && (a.planTool === 'door' || wallHint.between[1] === 'outside');
  const tool = TOOLS.find((t) => t.id === a.planTool) ?? TOOLS[0];
  const totalArea = plan2d ? plan2d.rooms.reduce((s, r) => s + (r.kind === 'terrace' ? 0 : r.area), 0) : 0;

  return (
    <div className="plan-view" ref={hostRef} data-layout-ignore="">
      <svg
        ref={svgRef}
        className={`plan-view__svg plan-view__svg--${a.planTool}`}
        viewBox={vb.join(' ')}
        role="img"
        aria-label={`Floor plan of ${plan2d?.levelName ?? 'the building'}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={() => a.planTool === 'polygon' && draft.length >= 3 && commitPolygon(draft)}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          <pattern id="plan-grid" width="1" height="1" patternUnits="userSpaceOnUse">
            <path d="M1 0H0V1" fill="none" className="plan-grid" strokeWidth={px} />
          </pattern>
        </defs>
        <rect x={vb[0]} y={vb[1]} width={vb[2]} height={vb[3]} fill="url(#plan-grid)" />
        {plan2d && (
          <>
            <g className="plan-rooms">
              {plan2d.rooms.map((r) => (
                <path key={r.id} d={pathOf(r.polygon, true)} fill={roomColors(r.kind)[0]} className={`plan-room${selected === r.id ? ' is-selected' : ''}`} strokeWidth={selected === r.id ? 3 * px : 0} />
              ))}
            </g>
            <g className="plan-items" strokeWidth={px}>
              {plan2d.items.map((it) => (
                <path key={it.id} d={pathOf(it.polygon, true)} className={`plan-item plan-item--${it.kind}`} />
              ))}
            </g>
            <g className="plan-stairs" strokeWidth={1.2 * px}>
              {plan2d.stairs.map((s) => (
                <g key={s.id}>
                  <path d={pathOf(s.outline, true)} className="plan-stair" />
                  {s.treads.map((t, i) => (
                    <line key={i} x1={t[0][0]} y1={t[0][1]} x2={t[1][0]} y2={t[1][1]} className="plan-stair__tread" />
                  ))}
                  <line x1={s.arrow[0][0]} y1={s.arrow[0][1]} x2={s.arrow[1][0]} y2={s.arrow[1][1]} className="plan-stair__arrow" markerEnd="url(#plan-arrow)" />
                </g>
              ))}
            </g>
            <g className="plan-walls">
              {plan2d.walls.map((w) => w.pieces.map((q, i) => <path key={`${w.id}-${i}`} d={pathOf(q, true)} className={`plan-wall${w.exterior ? ' plan-wall--ext' : ''}`} />))}
            </g>
            <g className="plan-windows" strokeWidth={1.2 * px}>
              {plan2d.windows.map((w) => {
                const dx = w.b[0] - w.a[0];
                const dz = w.b[1] - w.a[1];
                const len = Math.hypot(dx, dz) || 1;
                const nx = (-dz / len) * (w.thickness / 2);
                const nz = (dx / len) * (w.thickness / 2);
                const quad: P2[] = [
                  [w.a[0] + nx, w.a[1] + nz],
                  [w.b[0] + nx, w.b[1] + nz],
                  [w.b[0] - nx, w.b[1] - nz],
                  [w.a[0] - nx, w.a[1] - nz],
                ];
                return (
                  <g key={w.id}>
                    <path d={pathOf(quad, true)} className="plan-window" />
                    <line x1={w.a[0]} y1={w.a[1]} x2={w.b[0]} y2={w.b[1]} className="plan-window__glass" />
                  </g>
                );
              })}
            </g>
            <g className="plan-doors" strokeWidth={1.2 * px}>
              {plan2d.doors.map((d) => {
                if (d.kind === 'swing' && d.hinge && d.open && d.closed) {
                  const r = Math.hypot(d.open[0] - d.hinge[0], d.open[1] - d.hinge[1]);
                  const cross = (d.open[0] - d.hinge[0]) * (d.closed[1] - d.hinge[1]) - (d.open[1] - d.hinge[1]) * (d.closed[0] - d.hinge[0]);
                  return (
                    <g key={d.id}>
                      <line x1={d.hinge[0]} y1={d.hinge[1]} x2={d.open[0]} y2={d.open[1]} className="plan-door__leaf" strokeWidth={2.2 * px} />
                      <path d={`M${d.open[0]} ${d.open[1]} A${r} ${r} 0 0 ${cross > 0 ? 1 : 0} ${d.closed[0]} ${d.closed[1]}`} className="plan-door__arc" strokeDasharray={`${4 * px} ${3 * px}`} />
                    </g>
                  );
                }
                if (d.kind === 'sliding') {
                  return <line key={d.id} x1={d.a[0]} y1={d.a[1]} x2={d.b[0]} y2={d.b[1]} className="plan-door__slide" strokeWidth={3 * px} />;
                }
                return null;
              })}
            </g>
            <g className="plan-dims" strokeWidth={px}>
              {plan2d.dimensions.map((d, i) => {
                const off = i < 2 ? 0.9 : 0.35;
                const a0: P2 = [d.a[0] + d.normal[0] * off, d.a[1] + d.normal[1] * off];
                const b0: P2 = [d.b[0] + d.normal[0] * off, d.b[1] + d.normal[1] * off];
                const mx = (a0[0] + b0[0]) / 2;
                const mz = (a0[1] + b0[1]) / 2;
                const vertical = Math.abs(d.b[1] - d.a[1]) > Math.abs(d.b[0] - d.a[0]);
                if (i >= 2 && view.scale < 26) return null;
                return (
                  <g key={i} className={i < 2 ? 'plan-dim plan-dim--overall' : 'plan-dim'}>
                    <line x1={a0[0]} y1={a0[1]} x2={b0[0]} y2={b0[1]} />
                    <line x1={a0[0] - 0.08} y1={a0[1] + 0.08} x2={a0[0] + 0.08} y2={a0[1] - 0.08} />
                    <line x1={b0[0] - 0.08} y1={b0[1] + 0.08} x2={b0[0] + 0.08} y2={b0[1] - 0.08} />
                    <text x={mx} y={mz} fontSize={11 * px} textAnchor="middle" dominantBaseline={vertical ? 'middle' : 'auto'} dy={vertical ? 0 : -4 * px} transform={vertical ? `rotate(-90 ${mx} ${mz})` : undefined}>
                      {d.label}
                    </text>
                  </g>
                );
              })}
            </g>
            <g className="plan-labels">
              {plan2d.rooms.map((r) => {
                const [, dot] = roomColors(r.kind);
                const name = r.name.length > 22 ? `${r.name.slice(0, 21)}…` : r.name;
                const text = `${name}  ${areaLabel(r.area)}`;
                const w = (text.length * 6.1 + 26) * px;
                const h = 20 * px;
                return (
                  <g key={r.id} transform={`translate(${r.label[0]} ${r.label[1]})`} className="plan-chip">
                    <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={h / 2} />
                    <circle cx={-w / 2 + 11 * px} cy={0} r={3.5 * px} fill={dot} />
                    <text x={-w / 2 + 20 * px} y={0} fontSize={11 * px} dominantBaseline="central">
                      <tspan className="plan-chip__name">{name}</tspan>
                      <tspan className="plan-chip__area" dx={6 * px}>
                        {areaLabel(r.area)}
                      </tspan>
                    </text>
                  </g>
                );
              })}
            </g>
          </>
        )}
        {preview.length >= 2 && (
          <g className="plan-draft" strokeWidth={2 * px}>
            <path d={pathOf(preview, a.planTool === 'rect')} />
            {preview.map((p, i) => {
              const q = preview[(i + 1) % preview.length];
              if (!q || (a.planTool === 'polygon' && i === preview.length - 1)) return null;
              const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
              if (len < 0.3) return null;
              return (
                <text key={i} x={(p[0] + q[0]) / 2} y={(p[1] + q[1]) / 2} fontSize={11 * px} textAnchor="middle" dy={-5 * px} className="plan-draft__len">
                  {lengthLabel(len)}
                </text>
              );
            })}
            {preview.length >= 3 && (
              <text x={preview.reduce((s, p) => s + p[0], 0) / preview.length} y={preview.reduce((s, p) => s + p[1], 0) / preview.length} fontSize={12 * px} textAnchor="middle" className="plan-draft__area">
                {areaLabel(outlineArea(preview))}
              </text>
            )}
          </g>
        )}
        {draft.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r={4 * px} className={`plan-vertex${i === 0 ? ' plan-vertex--first' : ''}`} />
        ))}
        {hover && (a.planTool === 'rect' || a.planTool === 'polygon') && <circle cx={hover[0]} cy={hover[1]} r={3 * px} className="plan-cursor" />}
        {wallHint && (
          <line
            x1={wallHint.span.edge.a[0] + wallHint.span.edge.dir[0] * wallHint.span.t0}
            y1={wallHint.span.edge.a[1] + wallHint.span.edge.dir[1] * wallHint.span.t0}
            x2={wallHint.span.edge.a[0] + wallHint.span.edge.dir[0] * wallHint.span.t1}
            y2={wallHint.span.edge.a[1] + wallHint.span.edge.dir[1] * wallHint.span.t1}
            className={`plan-wallhint${wallHintOk ? '' : ' is-bad'}`}
            strokeWidth={5 * px}
          />
        )}
        <defs>
          <marker id="plan-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" className="plan-stair__head" />
          </marker>
        </defs>
      </svg>
      <div className="plan-tools" role="toolbar" aria-label="Floor plan tools" aria-orientation="vertical">
        {TOOLS.map((t) => (
          <button key={t.id} type="button" className={`plan-tools__btn${a.planTool === t.id ? ' is-on' : ''}`} aria-pressed={a.planTool === t.id} aria-label={t.label} data-tip={t.label} data-tip-pos="right" onClick={() => set({ planTool: t.id })}>
            <Icon name={t.icon} />
          </button>
        ))}
        <span className="plan-tools__sep" aria-hidden="true" />
        <button type="button" className="plan-tools__btn" aria-label="Fit plan" data-tip="Fit plan" data-tip-pos="right" onClick={() => {
            userMoved.current = false;
            if (plan2d) setCam(fitPlan(plan2d.bounds, size[0], size[1], margin));
          }}>
          <Icon name="maximize" />
        </button>
      </div>
      <div className="plan-status">
        <span className="plan-status__title">
          {plan2d?.levelName ?? 'Floor'} · {areaLabel(totalArea)}
        </span>
        <span className="plan-status__hint">{tool?.hint}</span>
        {(a.planTool === 'rect' || a.planTool === 'polygon') && (
          <label className="plan-status__type">
            <span>Room</span>
            <select value={a.roomType} onChange={(e) => set({ roomType: e.target.value as RoomType })} aria-label="Type of the room to draw">
              {ROOM_TYPES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        )}
        {selected && a.planTool === 'select' && (
          <button type="button" className="chip chip--action" onClick={() => studio.arch.removeRoom(selected) === null && setSelected(null)}>
            <Icon name="trash" size={14} />
            Remove room
          </button>
        )}
      </div>
    </div>
  );
});
