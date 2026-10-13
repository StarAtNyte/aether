import { memo, type ReactElement } from 'react';

/**
 * Minimal stroke icon set drawn for Aether (24×24 grid, currentColor).
 * Hand-authored simple geometry — no third-party icon assets.
 */
const PATHS = {
  logo: ['M12 2.5 21 7.5v9L12 21.5 3 16.5v-9z', 'M12 2.5v19', 'M3 7.5l9 5 9-5'],
  undo: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
  redo: ['M15 14l5-5-5-5', 'M20 9H9.5a5.5 5.5 0 0 0 0 11H13'],
  play: ['M7 4.5v15l12-7.5z'],
  stop: ['M6.5 6.5h11v11h-11z'],
  share: ['M12 3v12', 'M7.5 7.5 12 3l4.5 4.5', 'M5 13v6.5h14V13'],
  download: ['M12 4v11', 'M7.5 10.5 12 15l4.5-4.5', 'M5 19.5h14'],
  upload: ['M12 15V4', 'M7.5 8.5 12 4l4.5 4.5', 'M5 19.5h14'],
  sun: ['M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4'],
  moon: ['M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z'],
  settings: ['M21.49 10.57 21.49 13.43 19.18 13.78 18.34 15.82 19.72 17.7 17.7 19.72 15.82 18.34 13.78 19.18 13.43 21.49 10.57 21.49 10.22 19.18 8.18 18.34 6.3 19.72 4.28 17.7 5.66 15.82 4.82 13.78 2.51 13.43 2.51 10.57 4.82 10.22 5.66 8.18 4.28 6.3 6.3 4.28 8.18 5.66 10.22 4.82 10.57 2.51 13.43 2.51 13.78 4.82 15.82 5.66 17.7 4.28 19.72 6.3 18.34 8.18 19.18 10.22z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  chevronUp: ['M6 15l6-6 6 6'],
  chevronDown: ['M6 9l6 6 6-6'],
  chevronRight: ['M9 6l6 6-6 6'],
  copy: ['M8.5 8.5h11v11h-11z', 'M15.5 8.5v-4h-11v11h4'],
  check: ['M4.5 12.5l5 5 10-11'],
  send: ['M4 12 20 4l-5 16-3.5-6.5z', 'M11.5 13.5 20 4'],
  trash: ['M4.5 6.5h15', 'M9.5 6.5V4h5v2.5', 'M6.5 6.5l1 13h9l1-13'],
  eye: ['M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z', 'M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'],
  eyeOff: ['M3 3l18 18', 'M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.7 3.4', 'M6.6 6.6C4 8.3 2.5 12 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.4-1.1'],
  search: ['M10.5 17.5a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M15.5 15.5 20.5 20.5'],
  target: ['M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  panelLeft: ['M3.5 4.5h17v15h-17z', 'M9.5 4.5v15'],
  panelRight: ['M3.5 4.5h17v15h-17z', 'M14.5 4.5v15'],
  sparkles: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z', 'M19 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z'],
  cube: ['M12 3 20 7.5v9L12 21l-8-4.5v-9z', 'M4 7.5l8 4.5 8-4.5', 'M12 12v9'],
  history: ['M3.5 12a8.5 8.5 0 1 0 2.5-6', 'M3.5 4v4h4', 'M12 7.5V12l3 2'],
  branch: ['M6.5 3.5v11', 'M6.5 20.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z', 'M17.5 9.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z', 'M17.5 9.5c0 4-5 4.5-11 6'],
  shield: ['M12 3 19.5 6v6c0 4.5-3.2 7.7-7.5 9-4.3-1.3-7.5-4.5-7.5-9V6z', 'M8.5 12l2.5 2.5 4.5-5'],
  alert: ['M12 3.5 21.5 20h-19z', 'M12 10v4.5', 'M12 17.2v.3'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v5.5', 'M12 7.7v.3'],
  x: ['M6 6l12 12', 'M18 6 6 18'],
  refresh: ['M20 11.5a8 8 0 0 0-14.5-4.5', 'M4 12.5a8 8 0 0 0 14.5 4.5', 'M5.5 3.5V7H9', 'M18.5 20.5V17H15'],
  camera: ['M3.5 7.5h4l2-2.5h5l2 2.5h4v12h-17z', 'M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z'],
  user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4.5 20.5c1-4 4-5.5 7.5-5.5s6.5 1.5 7.5 5.5'],
  bot: ['M5 8.5h14v11H5z', 'M12 4.5v4', 'M9 13.5v1.5M15 13.5v1.5', 'M2.5 13v3M21.5 13v3'],
  code: ['M8.5 7 3.5 12l5 5', 'M15.5 7l5 5-5 5', 'M13.5 4.5l-3 15'],
  list: ['M8.5 6.5h12M8.5 12h12M8.5 17.5h12', 'M4 6.5h.5M4 12h.5M4 17.5h.5'],
  zap: ['M13 2.5 4.5 13.5H12l-1 8 8.5-11H12z'],
  sliders: ['M4 7h10M18 7h2M4 17h4M12 17h8', 'M16 9.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z', 'M10 19.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'],
  plus: ['M12 5v14', 'M5 12h14'],
  wand: ['M4 20 15 9', 'M14 4.5v2M17.5 6.5l-1.4 1.4M19.5 10h-2M10 6.5 8.6 5.1'],
  gamepad: ['M6.5 8.5h11a4 4 0 0 1 4 4v1a3.5 3.5 0 0 1-6.3 2.1L14 14h-4l-1.2 1.6A3.5 3.5 0 0 1 2.5 13.5v-1a4 4 0 0 1 4-4z', 'M7.5 10.5v3M6 12h3', 'M16 11.5h.5M17.5 13h.5'],
} as const;

/** Name of an available icon. */
export type IconName = keyof typeof PATHS;

/** Inline SVG icon (decorative unless `label` is given). */
export const Icon = memo(function Icon({ name, size = 16, label, className }: { name: IconName; size?: number; label?: string; className?: string }): ReactElement {
  const paths = PATHS[name];
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
});
