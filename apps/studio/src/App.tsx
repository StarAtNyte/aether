import { type ReactElement } from 'react';
import { useUI } from './app/context';
import { useShortcuts } from './app/useShortcuts';
import { ChatPanel } from './components/chat/ChatPanel';
import { RightPanel } from './components/panels/RightPanel';
import { SettingsDialog } from './components/SettingsDialog';
import { Toasts } from './components/Toasts';
import { TopBar } from './components/TopBar';
import { Viewport } from './components/viewport/Viewport';

/** Studio shell: top bar, chat | viewport | inspector panels, overlays. */
export function App(): ReactElement {
  const left = useUI((s) => s.panels.left);
  const right = useUI((s) => s.panels.right);
  const mode = useUI((s) => s.mode);
  useShortcuts();
  return (
    <div className="app" data-mode={mode}>
      <TopBar />
      <main className={`workspace${left ? ' has-left' : ''}${right ? ' has-right' : ''}`}>
        {left && <ChatPanel />}
        <Viewport />
        {right && <RightPanel />}
      </main>
      <Toasts />
      <SettingsDialog />
    </div>
  );
}
