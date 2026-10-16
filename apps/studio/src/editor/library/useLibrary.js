/** React bindings for the asset controller's library store. */
import { useStore } from 'zustand';
import { useStudio } from '../../app/context';
/** Select a slice of the library state. */
export function useLibrary(selector) {
    return useStore(useStudio().assets.state, selector);
}
/** Drag-and-drop MIME type of library tiles (payload: asset id). */
export const ASSET_DRAG_TYPE = 'application/x-aether-asset';
/** Accept-list of the import file picker. */
export const IMPORT_ACCEPT = '.glb,.gltf,.png,.jpg,.jpeg,.webp,.hdr,.zip,model/gltf-binary,model/gltf+json,image/png,image/jpeg,image/webp,application/zip';
/** Asset id being dragged from the library (drag data cannot be read during dragover). */
export const dragState = { asset: null };
