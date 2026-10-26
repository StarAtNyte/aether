/** Placeholder and processing feedback while the editor code or a project loads. */
import type { ReactElement } from 'react';
import { ViewportLoading } from '../components/viewport/ViewportLoading';

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
            <ViewportLoading text="Loading editor…" />
          </div>
        </div>
      </div>
    </div>
  );
}
