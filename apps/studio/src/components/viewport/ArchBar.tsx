/**
 * Architecture bar (top centre of the viewport, edit mode, only when the
 * world has a building): 3D / floor-plan switch, wall display (full,
 * cutaway, low), storeys (stacked, exploded, one storey) with a level
 * selector, x-ray, a section cut, the daylight study, the studio render
 * toggle and the walkthrough. Everything here is a view of the building;
 * nothing changes the document.
 */
import { memo, type ReactElement } from 'react';
import { useStudio, useUI } from '../../app/context';
import { Icon } from '../Icon';
import { Menu } from '../ui/Menu';
import { Popover } from '../ui/Popover';
import { Segmented } from '../ui/Segmented';
import { hourLabel, SECTION_RANGE, TIME_PRESETS, type ArchLevels, type ArchWalls } from '../../state/archUi';

const WALL_LABEL: Record<ArchWalls, string> = { up: 'Walls up', cutaway: 'Cutaway', down: 'Walls down' };
const LEVEL_LABEL: Record<ArchLevels, string> = { stacked: 'Stacked', exploded: 'Exploded', solo: 'One floor' };

/** Storey chip label: "Ground floor · 3.1 m". */
function levelText(name: string, height: number): string {
  return `${name} · ${height.toFixed(height % 1 === 0 ? 0 : 2).replace(/0$/, '')} m`;
}

/** The architecture bar. */
export const ArchBar = memo(function ArchBar(): ReactElement | null {
  const studio = useStudio();
  const a = useUI((s) => s.arch);
  const playing = useUI((s) => s.mode === 'play');
  if (!a.building || playing) return null;
  const set = studio.store.getState().setArch;
  const multi = a.levels.length > 1;
  const current = a.levels.find((l) => l.index === a.level) ?? a.levels[0];
  return (
    <div className="arch-bar" role="toolbar" aria-label="Building views">
      <Segmented<'3d' | 'plan'>
        label="View"
        size="sm"
        value={a.plan ? 'plan' : '3d'}
        onChange={(v) => set({ plan: v === 'plan' })}
        options={[
          ['3d', '3D'],
          ['plan', 'Plan'],
        ]}
        titles={{ '3d': '3D view', plan: 'Floor plan: rooms, areas, dimensions; draw rooms, doors and windows' }}
      />
      {!a.plan && (
        <Menu
          label="Walls"
          width={200}
          items={(['up', 'cutaway', 'down'] as const).map((w) => ({ id: w, label: WALL_LABEL[w], checked: a.walls === w, onSelect: () => set({ walls: w }) }))}
          trigger={(t) => (
            <button {...t} type="button" className={`vp-btn vp-btn--label${a.walls !== 'up' ? ' is-on' : ''}`} aria-label={`Walls: ${WALL_LABEL[a.walls]}`} data-tip="Walls: up, cutaway (doll's house) or down">
              <Icon name="walls" />
              <span>{WALL_LABEL[a.walls]}</span>
            </button>
          )}
        />
      )}
      {(multi || a.plan) && (
        <Menu
          label="Storeys"
          width={240}
          items={[
            ...(!a.plan && multi
              ? [
                  { kind: 'heading' as const, id: 'h-mode', label: 'Storeys' },
                  ...(['stacked', 'exploded', 'solo'] as const).map((m) => ({ id: m, label: LEVEL_LABEL[m], checked: a.levelMode === m, onSelect: () => set({ levelMode: m }) })),
                  { kind: 'separator' as const, id: 'sep' },
                ]
              : []),
            { kind: 'heading' as const, id: 'h-level', label: 'Floor' },
            ...[...a.levels].reverse().map((l) => ({ id: `l${l.index}`, label: levelText(l.name, l.height), checked: a.level === l.index, onSelect: () => set({ level: l.index, ...(a.plan || a.levelMode !== 'solo' ? {} : { levelMode: 'solo' as const }) }) })),
          ]}
          trigger={(t) => (
            <button {...t} type="button" className={`vp-btn vp-btn--label${a.levelMode !== 'stacked' && !a.plan ? ' is-on' : ''}`} aria-label="Storeys" data-tip="Storeys: stacked, exploded or one floor">
              <Icon name="layers" />
              <span>{a.plan || a.levelMode === 'solo' ? (current?.name ?? 'Floor') : LEVEL_LABEL[a.levelMode]}</span>
            </button>
          )}
        />
      )}
      {!a.plan && (
        <>
          <button type="button" className={`vp-btn${a.xray ? ' is-on' : ''}`} aria-pressed={a.xray} aria-label="X-ray" data-tip="X-ray: see-through structure, furniture and lights stay solid" onClick={() => set({ xray: !a.xray })}>
            <Icon name="xray" />
          </button>
          <Popover
            label="Section cut"
            side="bottom"
            width={240}
            trigger={(t) => (
              <button {...t} type="button" className={`vp-btn${a.section !== null ? ' is-on' : ''}`} aria-label="Section cut" data-tip="Section: cut the building horizontally">
                <Icon name="section" />
              </button>
            )}
          >
            <div className="arch-pop">
              <label className="arch-pop__row">
                <input type="checkbox" checked={a.section !== null} onChange={(e) => set({ section: e.target.checked ? 1.3 + a.level * 3 : null })} />
                <span>Section cut</span>
                <span className="arch-pop__value">{a.section !== null ? `${a.section.toFixed(1)} m` : 'off'}</span>
              </label>
              <input
                className="arch-pop__range"
                type="range"
                aria-label="Section height"
                min={SECTION_RANGE[0]}
                max={Math.max(3, Math.min(SECTION_RANGE[1], a.levels.reduce((s, l) => s + l.height, 0) + 0.5))}
                step={0.05}
                value={a.section ?? 1.3}
                onChange={(e) => set({ section: Number(e.target.value) })}
              />
            </div>
          </Popover>
        </>
      )}
      <span className="arch-bar__sep" aria-hidden="true" />
      <Popover
        label="Daylight study"
        side="bottom"
        width={260}
        trigger={(t) => (
          <button {...t} type="button" className={`vp-btn vp-btn--label${a.sunHour !== null ? ' is-on' : ''}`} aria-label="Daylight study" data-tip="Daylight study: move the sun through the day">
            <Icon name="sun" />
            <span>{a.sunHour === null ? 'Daylight' : hourLabel(a.sunHour)}</span>
          </button>
        )}
      >
        <div className="arch-pop">
          <div className="arch-pop__row">
            <span>Sun</span>
            <span className="arch-pop__value">{a.sunHour === null ? 'as built' : hourLabel(a.sunHour)}</span>
          </div>
          <input className="arch-pop__range" type="range" aria-label="Time of day" min={5} max={23} step={0.1} value={a.sunHour ?? 14} onChange={(e) => set({ sunHour: Number(e.target.value) })} />
          <div className="arch-pop__chips">
            {TIME_PRESETS.map((p) => (
              <button key={p.key} type="button" className={`chip${a.sunHour === p.hour ? ' is-on' : ''}`} onClick={() => set({ sunHour: p.hour })}>
                {p.label}
              </button>
            ))}
            <button type="button" className="chip" onClick={() => set({ sunHour: null })} disabled={a.sunHour === null}>
              Reset
            </button>
          </div>
        </div>
      </Popover>
      <button
        type="button"
        className={`vp-btn vp-btn--label${a.quality === 'studio' ? ' is-on' : ''}`}
        aria-pressed={a.quality === 'studio'}
        disabled={!a.studioAvailable}
        aria-label="Studio render"
        data-tip={a.studioAvailable ? 'Studio render: ambient occlusion, soft shadows, temporal anti-aliasing; refines while the view rests' : 'Studio render needs post-processing (off in low memory mode)'}
        onClick={() => set({ quality: a.quality === 'studio' ? 'realtime' : 'studio' })}
      >
        <Icon name="sparkles" />
        <span>Studio</span>
      </button>
      <button type="button" className="vp-btn vp-btn--label vp-btn--primary" aria-label="Walk through" data-tip="Walk through: WASD, E doors and lights, 1–4 time of day, P photo" onClick={() => void studio.togglePlay()}>
        <Icon name="walk" />
        <span>Walk</span>
      </button>
    </div>
  );
});
