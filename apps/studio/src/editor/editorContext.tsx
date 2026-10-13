/** Editor-level services: the open project and leaving the editor cleanly. */
import { createContext, useContext } from 'react';

/** What the editor chrome needs from the route that hosts it. */
export interface EditorServices {
  projectId: string;
  /** Save, capture a thumbnail and go back to the projects home. */
  leave(): Promise<void>;
  /** Save, then open the "New project" dialog on the home page. */
  newProject(): Promise<void>;
  /** Duplicate the open project (after saving) and open the copy. */
  duplicate(): Promise<void>;
}

/** Context (null outside an editor route, e.g. in unit tests). */
export const EditorContext = createContext<EditorServices | null>(null);

/** Editor services, or null when the editor runs without a project host. */
export function useEditor(): EditorServices | null {
  return useContext(EditorContext);
}
