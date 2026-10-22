/** One line for the View menu: the graphics tier in effect, and whether the renderer is holding back or climbing. */
export interface GraphicsRender {
  tier: string;
  auto: string;
  ladder?: number;
}

const NAMES: Readonly<Record<string, string>> = { low: 'Low', medium: 'Medium', high: 'High', ultra: 'Ultra' };

/** Null when nothing is known yet. */
export function graphicsSummary(render: GraphicsRender | null | undefined, choice: string): string | null {
  if (!render) return null;
  const name = NAMES[render.tier] ?? render.tier;
  if (choice !== 'auto') return `Graphics: ${name} (set in Settings)`;
  const held = (render.ladder ?? 0) > 0;
  return held ? `Graphics: ${name} (automatic, saving frames; climbs when smooth)` : `Graphics: ${name} (automatic)`;
}
