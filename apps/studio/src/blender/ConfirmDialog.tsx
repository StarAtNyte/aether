/**
 * The Blender confirmation dialog: the exact Python a Blender action will run,
 * with "Allow once", "Allow for this session" and "Cancel". Rendered into its
 * own root on demand (loaded only when Blender asks for the first time).
 */
import { memo, useState, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Dialog } from '../components/ui/Dialog';
import { CodeBlock } from '../components/CodeBlock';
import type { GateChoice, GateRequest } from './gate';

const ACTION_TEXT: Record<GateRequest['action'], string> = {
  execute_blender_code: 'The assistant wants to run this Python in your Blender.',
  export_glb: 'Export the Blender scene as a GLB and import it into this project.',
  render: 'Render the Blender scene camera with Cycles.',
  bake: 'Bake a texture of one object with Cycles in your Blender.',
  get_scene_info: 'Read the Blender scene.',
  look: 'Look at the Blender scene.',
};

/** The dialog body. */
export const BlenderConfirm = memo(function BlenderConfirm({ request, onChoice }: { request: GateRequest; onChoice: (c: GateChoice) => void }): ReactElement {
  const [open, setOpen] = useState(true);
  const choose = (c: GateChoice): void => {
    setOpen(false);
    onChoice(c);
  };
  return (
    <Dialog
      open={open}
      onClose={() => choose('cancel')}
      title="Run Python in Blender?"
      description={`${ACTION_TEXT[request.action]} It runs with your user's rights on this computer. Read it before allowing.`}
      size="lg"
      footer={
        <>
          <button type="button" className="btn" onClick={() => choose('cancel')} data-testid="blender-cancel">
            Cancel
          </button>
          <button type="button" className="btn" onClick={() => choose('session')} data-testid="blender-allow-session">
            Allow for this session
          </button>
          <button type="button" className="btn btn--primary" onClick={() => choose('once')} data-testid="blender-allow-once">
            Allow once
          </button>
        </>
      }
    >
      <div style={{ maxHeight: '55vh', overflow: 'auto' }} data-testid="blender-code">
        <CodeBlock code={request.code} lang="python" title="Python" collapsible={false} />
      </div>
    </Dialog>
  );
});

/** Show the dialog and resolve with the user's choice. */
export function askBlenderConfirm(request: GateRequest): Promise<GateChoice> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    let done = false;
    const onChoice = (c: GateChoice): void => {
      if (done) return;
      done = true;
      resolve(c);
      setTimeout(() => {
        root.unmount();
        host.remove();
      }, 0);
    };
    root.render(<BlenderConfirm request={request} onChoice={onChoice} />);
  });
}
