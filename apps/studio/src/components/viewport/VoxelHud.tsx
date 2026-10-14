/**
 * Voxel game HUD: crosshair, hotbar with textured block icons, hearts,
 * hunger and breath, the day clock, the inventory + crafting screen, the
 * death screen and the loading state. Purely presentational: it renders
 * the session's {@link VoxelHudState} snapshot and calls back into the
 * running {@link VoxelPlay} for actions. Never renders untrusted HTML.
 */
import { memo, useCallback, useMemo, useState, type CSSProperties, type ReactElement } from 'react';
import { useSimulation, useUI } from '../../app/context';
import type { HudRecipe, HudSlot, ItemIcon, VoxelHudState } from '../../voxel/hudState';
import '../../styles/voxel.css';

const TILES = 16;

/** Block (isometric cube from the atlas) or item (pixel icon) picture. */
const Icon = memo(function Icon({ icon, hud, size = 30 }: { icon: ItemIcon; hud: VoxelHudState; size?: number }): ReactElement {
  if (icon.kind === 'item') {
    const n = Math.max(1, hud.itemCount);
    const style: CSSProperties = {
      width: size,
      height: size,
      backgroundImage: hud.itemsUrl ? `url(${hud.itemsUrl})` : undefined,
      backgroundSize: `${n * 100}% 100%`,
      backgroundPosition: `${n > 1 ? (icon.index / (n - 1)) * 100 : 0}% 0%`,
    };
    return <span className="vx-icon vx-icon--item" style={style} aria-hidden="true" />;
  }
  const tile = (t: number): CSSProperties => ({
    backgroundImage: hud.atlasUrl ? `url(${hud.atlasUrl})` : undefined,
    backgroundSize: `${TILES * 100}% ${TILES * 100}%`,
    backgroundPosition: `${((t % TILES) / (TILES - 1)) * 100}% ${(Math.floor(t / TILES) / (TILES - 1)) * 100}%`,
  });
  if (icon.flat) return <span className="vx-icon vx-icon--item" style={{ width: size, height: size, ...tile(icon.top) }} aria-hidden="true" />;
  const f = Math.round(size * 0.62);
  return (
    <span className="vx-cube" style={{ width: size, height: size, ['--f' as string]: `${f}px` } as CSSProperties} aria-hidden="true">
      <span className="vx-cube__body">
        <span className="vx-cube__face vx-cube__face--top" style={tile(icon.top)} />
        <span className="vx-cube__face vx-cube__face--front" style={tile(icon.side)} />
        <span className="vx-cube__face vx-cube__face--right" style={tile(icon.side)} />
      </span>
    </span>
  );
});

/** One slot (hotbar or inventory). */
function Slot({ slot, hud, selected, onClick, onContext, index, picked }: {
  slot: HudSlot | null; hud: VoxelHudState; selected?: boolean; picked?: boolean; index: number;
  onClick?: (i: number) => void; onContext?: (i: number) => void;
}): ReactElement {
  const label = slot ? `${slot.label}${slot.count > 1 ? ` × ${slot.count}` : ''}` : 'Empty slot';
  const cls = `vx-slot${selected ? ' is-selected' : ''}${picked ? ' is-picked' : ''}`;
  const body = (
    <>
      {slot && <Icon icon={slot.icon} hud={hud} />}
      {slot && slot.count > 1 && <span className="vx-slot__count">{slot.count}</span>}
    </>
  );
  if (!onClick) {
    return (
      <span className={cls} title={label}>
        {body}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={cls}
      aria-label={label}
      title={label}
      onClick={() => onClick(index)}
      onContextMenu={(e) => {
        e.preventDefault();
        onContext?.(index);
      }}
    >
      {body}
    </button>
  );
}

/** Ten pixel hearts / drumsticks. */
function Meter({ value, kind }: { value: number; kind: 'heart' | 'food' | 'air' }): ReactElement {
  const items: ReactElement[] = [];
  const v = Math.max(0, Math.min(20, value));
  const count = kind === 'air' ? 10 : 10;
  for (let i = 0; i < count; i++) {
    const fill = kind === 'air' ? (i < v ? 2 : 0) : Math.max(0, Math.min(2, v - i * 2));
    items.push(<span key={i} className={`vx-pip vx-pip--${kind} is-${fill === 2 ? 'full' : fill === 1 ? 'half' : 'empty'}`} />);
  }
  const label = kind === 'heart' ? `Health ${v / 2} of 10` : kind === 'food' ? `Hunger ${v / 2} of 10` : `Breath ${v} of 10`;
  return (
    <span className={`vx-meter vx-meter--${kind}${kind === 'heart' && v <= 6 ? ' is-low' : ''}`} role="img" aria-label={label}>
      {items}
    </span>
  );
}

function clock(hour: number): string {
  const h = Math.floor(hour) % 24;
  const m = Math.floor((hour - Math.floor(hour)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function RecipeCard({ r, hud, onCraft }: { r: HudRecipe; hud: VoxelHudState; onCraft: (id: string) => void }): ReactElement {
  return (
    <li className={`vx-recipe${r.craftable ? ' is-ready' : ''}`}>
      <span className="vx-recipe__out">
        <Icon icon={r.icon} hud={hud} size={34} />
        {r.count > 1 && <span className="vx-slot__count">{r.count}</span>}
      </span>
      <span className="vx-recipe__body">
        <span className="vx-recipe__name">
          {r.label}
          {r.needsTable && <span className="vx-badge" title="Needs a crafting table nearby">Table</span>}
        </span>
        <span className="vx-recipe__inputs">
          {r.inputs.map((i) => (
            <span key={i.label} className={`vx-input${i.have >= i.count ? ' is-ok' : ''}`} title={`${i.label}: ${Math.min(i.have, 999)} / ${i.count}`}>
              <Icon icon={i.icon} hud={hud} size={18} />
              <span>
                {i.count} {i.label}
              </span>
            </span>
          ))}
        </span>
      </span>
      <button type="button" className="btn btn--sm btn--primary vx-recipe__craft" disabled={!r.craftable} onClick={() => onCraft(r.id)} aria-label={`Craft ${r.label}`}>
        Craft
      </button>
    </li>
  );
}

/** The inventory + crafting screen. */
function InventoryScreen({ hud }: { hud: VoxelHudState }): ReactElement {
  const sim = useSimulation();
  const play = sim?.voxel?.game ?? null;
  const [picked, setPicked] = useState<number | null>(null);
  const [filter, setFilter] = useState('');
  const onSlot = useCallback(
    (i: number) => {
      if (!play) return;
      if (picked === null) {
        if (hud.slots[i]) setPicked(i);
        return;
      }
      play.moveSlot(picked, i, false);
      setPicked(null);
    },
    [play, picked, hud.slots],
  );
  const onHalf = useCallback(
    (i: number) => {
      if (!play) return;
      if (picked === null) return;
      play.moveSlot(picked, i, true);
      setPicked(null);
    },
    [play, picked],
  );
  const recipes = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? hud.recipes.filter((r) => r.label.toLowerCase().includes(q)) : hud.recipes;
  }, [hud.recipes, filter]);
  return (
    <div className="vx-screen" role="dialog" aria-modal="true" aria-label="Inventory and crafting">
      <div className="vx-screen__panel">
        <section className="vx-screen__inv" aria-label="Inventory">
          <header className="vx-screen__head">
            <h2>Inventory</h2>
            <span className="vx-screen__hint">Click an item, then a slot to move it · right-click splits a stack</span>
          </header>
          <div className="vx-grid">
            {hud.slots.slice(9).map((s, k) => (
              <Slot key={k + 9} index={k + 9} slot={s} hud={hud} picked={picked === k + 9} onClick={onSlot} onContext={onHalf} />
            ))}
          </div>
          <div className="vx-grid vx-grid--hotbar">
            {hud.slots.slice(0, 9).map((s, k) => (
              <Slot key={k} index={k} slot={s} hud={hud} picked={picked === k} selected={hud.selected === k} onClick={onSlot} onContext={onHalf} />
            ))}
          </div>
        </section>
        <section className="vx-screen__craft" aria-label="Crafting">
          <header className="vx-screen__head">
            <h2>Crafting</h2>
            <span className={`vx-table${hud.nearTable ? ' is-near' : ''}`}>{hud.nearTable ? 'Crafting table nearby' : 'No crafting table nearby'}</span>
          </header>
          <input className="input vx-search" type="search" placeholder="Search recipes" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Search recipes" />
          <ul className="vx-recipes">
            {recipes.map((r) => (
              <RecipeCard key={r.id} r={r} hud={hud} onCraft={(id) => play?.craft(id)} />
            ))}
          </ul>
        </section>
        <button type="button" className="btn vx-screen__close" onClick={() => play?.setInventoryOpen(false)}>
          Close <kbd>E</kbd>
        </button>
      </div>
    </div>
  );
}

/** The HUD. */
export const VoxelHud = memo(function VoxelHud(): ReactElement | null {
  const hud = useUI((s) => s.voxelHud);
  const mode = useUI((s) => s.mode);
  const sim = useSimulation();
  if (!hud || mode !== 'play') return null;
  const play = sim?.voxel?.game ?? null;
  const survival = hud.mode === 'survival';
  const night = hud.hour < 5 || hud.hour >= 19.5;
  return (
    <div className={`vx-hud${hud.inventoryOpen ? ' is-ui' : ''}`} data-testid="voxel-hud">
      {hud.loading !== null && (
        <div className="vx-loading" role="status">
          <span className="vx-loading__bar" style={{ ['--p' as string]: `${Math.round(hud.loading * 100)}%` } as CSSProperties} />
          <span>Generating terrain… {Math.round(hud.loading * 100)}%</span>
        </div>
      )}
      {hud.loading === null && !hud.dead && !hud.inventoryOpen && <span className="vx-crosshair" aria-hidden="true" />}
      <div className="vx-top">
        <span className={`vx-pill vx-clock${night ? ' is-night' : ''}`} title={`Day ${hud.day + 1}`}>
          <span className="vx-clock__orb" aria-hidden="true" />
          Day {hud.day + 1} · {clock(hud.hour)}
        </span>
        {hud.mode !== 'survival' && <span className="vx-pill vx-mode">{hud.mode === 'creative' ? (hud.flying ? 'Creative · flying' : 'Creative') : 'Explore'}</span>}
        <span className="vx-pill vx-coords" title="Position">
          {hud.position[0]}, {hud.position[1]}, {hud.position[2]}
        </span>
      </div>
      {hud.target && !hud.inventoryOpen && <span className="vx-target">{hud.target}</span>}
      {hud.toast && <span className="vx-toast" key={hud.toast}>{hud.toast}</span>}
      {hud.mode !== 'explore' && (
        <div className="vx-bottom">
          {survival && (
            <div className="vx-stats">
              <Meter value={hud.health} kind="heart" />
              <span className="vx-stats__right">
                {hud.air < 10 && <Meter value={hud.air} kind="air" />}
                <Meter value={hud.hunger} kind="food" />
              </span>
            </div>
          )}
          <div className="vx-hotbar" role="toolbar" aria-label="Hotbar">
            {hud.slots.slice(0, 9).map((s, i) => (
              <Slot key={i} index={i} slot={s} hud={hud} selected={hud.selected === i} onClick={(k) => play?.select(k)} />
            ))}
          </div>
        </div>
      )}
      {!hud.locked && !hud.inventoryOpen && !hud.dead && hud.loading === null && (
        <button type="button" className="vx-capture" onClick={() => play?.lockPointer()}>
          <b>Click to play</b>
          <span>
            <kbd>WASD</kbd> move · <kbd>Space</kbd> jump · <kbd>Left</kbd> break · <kbd>Right</kbd> place · <kbd>E</kbd> inventory · <kbd>1–9</kbd> hotbar · <kbd>V</kbd> view · <kbd>Esc</kbd> exit
          </span>
        </button>
      )}
      {hud.inventoryOpen && <InventoryScreen hud={hud} />}
      {hud.dead && (
        <div className="vx-death" role="dialog" aria-modal="true" aria-label="You died">
          <h2>You died</h2>
          <p>{deathText(hud.deathCause)}</p>
          <button type="button" className="btn btn--primary" autoFocus onClick={() => play?.respawn()}>
            Respawn
          </button>
        </div>
      )}
    </div>
  );
});

function deathText(cause: string): string {
  switch (cause) {
    case 'fall':
      return 'You hit the ground too hard.';
    case 'lava':
      return 'You tried to swim in lava.';
    case 'drown':
      return 'You ran out of air.';
    case 'starve':
      return 'You starved.';
    case 'mob':
      return 'Something got you in the dark.';
    case 'void':
      return 'You fell out of the world.';
    default:
      return 'Your items are where you fell.';
  }
}
