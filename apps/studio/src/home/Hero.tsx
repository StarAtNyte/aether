/**
 * Home hero: the prompt bar front and centre ("speak a world into being"),
 * one-tap example prompts, and a stage of example worlds that drift through
 * on their own (cross-fade with a slow push-in; still with reduced motion,
 * paused while the tab is hidden). Submitting creates a project and the
 * editor sends the prompt.
 */
import { memo, useEffect, useRef, useState, type ReactElement } from 'react';
import { MAX_PROMPT_CHARS } from '../config';
import { TEMPLATES, templateThumbnail, type WorldTemplate } from '../lib/examples';
import { Icon } from '../components/Icon';

/** Seconds each example world stays on the stage. */
export const STAGE_SECONDS = 4.5;
/** Example worlds on the stage, in order. */
const STAGE: readonly WorldTemplate[] = TEMPLATES.filter((t) => ['lakeside-camp', 'coin-island', 'domino-run', 'haunted-forest', 'medieval-village', 'canyon-of-colossi'].includes(t.slug));
/** One-tap example prompts under the bar. */
export const HERO_EXAMPLES: readonly string[] = Object.freeze([
  'A coin collecting game on a tropical island',
  'A domino run that knocks over a bell tower',
  'A cozy lakeside camp at sunset with fireflies',
  'A two-storey villa with a pool',
]);

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Index of the stage slide shown at `elapsed` seconds (wraps). Pure. */
export function stageIndex(elapsed: number, count: number, seconds = STAGE_SECONDS): number {
  if (count <= 0 || !Number.isFinite(elapsed) || elapsed < 0) return 0;
  return Math.floor(elapsed / seconds) % count;
}

/** The cycling stage of example worlds. */
const Stage = memo(function Stage({ onPick }: { onPick: (t: WorldTemplate) => void }): ReactElement {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (prefersReducedMotion() || STAGE.length < 2) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = (): void => {
      if (timer === null) timer = setInterval(() => setIndex((i) => (i + 1) % STAGE.length), STAGE_SECONDS * 1000);
    };
    const stop = (): void => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const onVis = (): void => (document.visibilityState === 'hidden' ? stop() : start());
    start();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  const current = STAGE[index] ?? STAGE[0];
  return (
    <figure className="hero-stage" aria-label="Example worlds">
      <div className="hero-stage__frame">
        {STAGE.map((t, i) => (
          <img
            key={t.slug}
            className={`hero-stage__img${i === index ? ' is-on' : ''}`}
            src={templateThumbnail(t.slug)}
            alt={i === index ? `${t.title}: ${t.description}` : ''}
            aria-hidden={i === index ? undefined : true}
            width={640}
            height={360}
            loading={i < 2 ? 'eager' : 'lazy'}
            decoding="async"
            draggable={false}
          />
        ))}
        {current && (
          <button type="button" className="hero-stage__open" onClick={() => onPick(current)} aria-label={`Open the ${current.title} template`}>
            <span className="hero-stage__prompt">“{current.prompt}”</span>
            <span className="hero-stage__cta">
              Open <Icon name="external" />
            </span>
          </button>
        )}
      </div>
      <div className="hero-stage__dots" aria-hidden="true">
        {STAGE.map((t, i) => (
          <span key={t.slug} className={`hero-stage__dot${i === index ? ' is-on' : ''}`} />
        ))}
      </div>
    </figure>
  );
});

/** The hero. */
export const Hero = memo(function Hero({ onPrompt, onTemplate }: { onPrompt: (prompt: string) => void; onTemplate: (slug: string) => void }): ReactElement {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Grow with the text (every browser; `field-sizing` is not universal).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 24), 96)}px`;
  }, [draft]);
  const submit = (text: string): void => {
    const t = text.trim().slice(0, MAX_PROMPT_CHARS);
    if (!t) {
      inputRef.current?.focus();
      return;
    }
    onPrompt(t);
  };
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero__copy">
        <h2 id="hero-title" className="hero__title">
          Speak a world into being.
        </h2>
        <p className="hero__lead">Describe it in plain words. Aether builds it in 3D, proves the physics, and makes it playable, right here in your browser. Then keep refining it the same way: “make the sofa dark green”, “a bit more to the left”.</p>
        <form
          className="hero-bar"
          onSubmit={(e) => {
            e.preventDefault();
            submit(draft);
          }}
        >
          <Icon name="sparkles" className="hero-bar__icon" />
          <textarea
            ref={inputRef}
            id="hero-prompt"
            className="hero-bar__input"
            rows={1}
            value={draft}
            maxLength={MAX_PROMPT_CHARS}
            placeholder="Describe a world…"
            aria-label="Describe a world"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit(draft);
              }
            }}
          />
          <button type="submit" className="btn btn--primary hero-bar__go" data-kbd="↵">
            Build <Icon name="arrowUp" className="hero-bar__go-icon" />
          </button>
        </form>
        <div className="hero__examples" role="group" aria-label="Example prompts">
          {HERO_EXAMPLES.map((p) => (
            <button key={p} type="button" className="chip chip--action" onClick={() => submit(p)}>
              {p}
            </button>
          ))}
        </div>
      </div>
      <Stage onPick={(t) => onTemplate(t.slug)} />
    </section>
  );
});
