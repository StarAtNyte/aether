/** In-app documentation: a short guide to the studio (static content). */
import { memo, type ReactElement } from 'react';
import { SHORTCUTS } from '../app/useShortcuts';

const SECTIONS: ReadonlyArray<{ id: string; title: string; body: ReadonlyArray<string> }> = [
  {
    id: 'start',
    title: 'Getting started',
    body: [
      'Create a project from a template, a blank scene or a prompt. Every project opens in the editor: the agent on the left, the world in the middle and the inspector on the right.',
      'Describe what you want in plain language — “a windmill on a hill at sunset”, “make the ball heavier”, “add a timer and a goal flag”. The agent plans the world, builds it, checks it with real physics and repairs what fails.',
    ],
  },
  {
    id: 'prompts',
    title: 'Writing prompts',
    body: [
      'Name the things, the mood and the rules: objects (“three tents and a campfire”), light (“at night with fog”) and goals (“collect 10 coins in 60 seconds”).',
      'Follow-up prompts edit the current world. Ask for one change at a time for the most predictable results; every change can be undone.',
    ],
  },
  {
    id: 'editing',
    title: 'Editing by hand',
    body: [
      'Click an object in the viewport or in Objects to select it; the inspector shows its transform, shape, material, physics and behaviours. Values commit on Enter.',
      'Assets places ready-made objects (primitives, nature, buildings, gameplay pieces, lights) at the centre of the view. With nothing selected the inspector edits the scene: sky, time of day, fog, light, gravity and the play camera.',
    ],
  },
  {
    id: 'play',
    title: 'Playing',
    body: [
      'Press Play to run the world: physics, rules and behaviours start, and Stop restores everything exactly. Move with WASD or the arrow keys, jump with Space, act with E; drag to look. On touch screens use the on-screen stick and buttons.',
    ],
  },
  {
    id: 'checks',
    title: 'Physics checks',
    body: [
      'Checks simulates the world headless and runs its tests — stability, reachability, overlaps — plus static diagnostics. Failing checks can be sent back to the agent with one click.',
    ],
  },
  {
    id: 'projects',
    title: 'Projects and files',
    body: [
      'Projects are saved automatically in this browser (IndexedDB). Export a project as a .aether.json file to back it up or move it to another browser, and import it from the home page — drag a file anywhere onto the page.',
      'Share uploads a copy of the world to the server and copies a link anyone can open.',
    ],
  },
];

/** Documentation page. */
export const Docs = memo(function Docs(): ReactElement {
  return (
    <div className="docs">
      <nav className="docs__toc" aria-label="On this page">
        <span className="docs__toc-title">On this page</span>
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#/docs`} onClick={(e) => {
            e.preventDefault();
            document.getElementById(`doc-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}>
            {s.title}
          </a>
        ))}
        <a href="#/docs" onClick={(e) => {
          e.preventDefault();
          document.getElementById('doc-shortcuts')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}>
          Keyboard shortcuts
        </a>
      </nav>
      <article className="docs__body">
        {SECTIONS.map((s) => (
          <section key={s.id} id={`doc-${s.id}`} className="docs__section">
            <h2>{s.title}</h2>
            {s.body.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </section>
        ))}
        <section id="doc-shortcuts" className="docs__section">
          <h2>Keyboard shortcuts</h2>
          <dl className="shortcut-list">
            {SHORTCUTS.map(([keys, what]) => (
              <div key={keys} className="shortcut-list__row">
                <dt>{what}</dt>
                <dd>
                  <kbd>{keys}</kbd>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </article>
    </div>
  );
});
