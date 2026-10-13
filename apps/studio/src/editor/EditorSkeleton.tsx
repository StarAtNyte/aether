/** Placeholder shown while the editor code or a project loads: the editor's frame, quiet skeleton surfaces, no spinner. */
import type { ReactElement } from 'react';

/** Editor loading skeleton (same frame as the editor, so nothing shifts when it arrives). */
export function EditorSkeleton(): ReactElement {
  return (
    <div className="editor editor--skeleton" aria-busy="true" aria-label="Opening project">
      <div className="topbar">
        <span className="skeleton skeleton--block" style={{ width: 120, height: 20 }} />
      </div>
      <div className="editor__body">
        <div className="editor__canvas">
          <div className="viewport">
            <span className="vp-loading__surface skeleton" />
          </div>
        </div>
      </div>
    </div>
  );
}
