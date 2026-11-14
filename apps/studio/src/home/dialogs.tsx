/** Home dialogs: new project, rename. */
import { memo, useEffect, useRef, useState, type ReactElement } from 'react';
import { MAX_PROMPT_CHARS } from '../config';
import { WORLD_TEMPLATES, templateThumbnail } from '../lib/examples';
import { MAX_PROJECT_NAME } from '../projects/model';
import type { BlankKind } from '../projects/create';
import { Icon, type IconName } from '../components/Icon';
import { Dialog } from '../components/ui/Dialog';
import { Thumb } from './cards';
import { NO_ASSETS_TIP } from './Hero';

const BLANKS: ReadonlyArray<{ kind: BlankKind; title: string; hint: string; icon: IconName }> = [
  { kind: 'empty', title: 'Empty scene', hint: 'Ground and sky only', icon: 'square' },
  { kind: 'starter', title: 'Starter scene', hint: 'A small forest camp', icon: 'mountain' },
];

/** "New project" dialog: from a prompt, blank, a template, or an imported file. */
export const NewProjectDialog = memo(function NewProjectDialog({
  open,
  onClose,
  onPrompt,
  onBlank,
  onTemplate,
  onImport,
  noAssets = false,
  onNoAssets,
}: {
  open: boolean;
  onClose: () => void;
  onPrompt: (prompt: string) => void;
  onBlank: (kind: BlankKind) => void;
  onTemplate: (slug: string) => void;
  onImport: () => void;
  /** The "No assets" AI preference (shared with the hero, the editor and Settings). */
  noAssets?: boolean;
  onNoAssets?: (on: boolean) => void;
}): ReactElement {
  const [prompt, setPrompt] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (open) {
      setPrompt('');
      requestAnimationFrame(() => ref.current?.focus());
    }
  }, [open]);
  const submit = (): void => {
    const t = prompt.trim();
    if (!t) return;
    onClose();
    onPrompt(t);
  };
  const pick = (fn: () => void): void => {
    onClose();
    fn();
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New project"
      description="Describe a world, or start from a blank scene or a template."
      size="lg"
      className="new-project"
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={() => pick(onImport)}>
            <Icon name="fileImport" /> Import file…
          </button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <form
        className="prompt-box"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={ref}
          className="prompt-box__input"
          value={prompt}
          rows={3}
          maxLength={MAX_PROMPT_CHARS}
          placeholder="A lighthouse on a stormy cliff with crashing waves…"
          aria-label="Describe your world"
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="prompt-box__bar">
          <span className="prompt-box__hint">The agent builds it, checks the physics and opens the editor.</span>
          {onNoAssets && (
            <button type="button" className={`chip hero-bar__noassets${noAssets ? ' is-on' : ''}`} aria-pressed={noAssets} data-tip={NO_ASSETS_TIP} aria-label={`No assets: ${NO_ASSETS_TIP}`} data-testid="new-project-no-assets" onClick={() => onNoAssets(!noAssets)}>
              <Icon name="shapes" />
              <span className="hero-bar__noassets-label">No assets</span>
            </button>
          )}
          <button type="submit" className="btn btn--primary" disabled={prompt.trim() === ''}>
            Create
          </button>
        </div>
      </form>
      <h3 className="dialog__section">Start blank</h3>
      <div className="blank-grid">
        {BLANKS.map((b) => (
          <button key={b.kind} type="button" className="blank-card" onClick={() => pick(() => onBlank(b.kind))}>
            <span className="blank-card__icon">
              <Icon name={b.icon} size={20} />
            </span>
            <span className="blank-card__text">
              <span className="blank-card__title">{b.title}</span>
              <span className="blank-card__hint">{b.hint}</span>
            </span>
          </button>
        ))}
      </div>
      <h3 className="dialog__section">From a template</h3>
      <div className="mini-templates">
        {WORLD_TEMPLATES.map((t) => (
          <button key={t.slug} type="button" className="mini-template" onClick={() => pick(() => onTemplate(t.slug))} aria-label={`Template: ${t.title}`}>
            <Thumb src={templateThumbnail(t.slug)} alt="" />
            <span className="mini-template__title">{t.title}</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
});

/** Rename dialog. */
export const RenameDialog = memo(function RenameDialog({ open, name, onClose, onSave }: { open: boolean; name: string; onClose: () => void; onSave: (name: string) => void }): ReactElement {
  const [draft, setDraft] = useState(name);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      setDraft(name);
      requestAnimationFrame(() => ref.current?.select());
    }
  }, [open, name]);
  const save = (): void => {
    const t = draft.trim();
    if (!t) return;
    onSave(t);
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Rename project"
      size="sm"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={save} disabled={draft.trim() === ''}>
            Save
          </button>
        </>
      }
    >
      <input
        ref={ref}
        className="input"
        value={draft}
        maxLength={MAX_PROJECT_NAME}
        aria-label="Project name"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
        }}
      />
    </Dialog>
  );
});
