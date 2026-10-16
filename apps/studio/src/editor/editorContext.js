/** Editor-level services: the open project and leaving the editor cleanly. */
import { createContext, useContext } from 'react';
/** Context (null outside an editor route, e.g. in unit tests). */
export const EditorContext = createContext(null);
/** Editor services, or null when the editor runs without a project host. */
export function useEditor() {
    return useContext(EditorContext);
}
