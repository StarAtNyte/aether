/**
 * Release the GPU buffer of an attribute nothing draws any more, for code that replaces an attribute of a live geometry
 * (three frees a geometry's attributes when the geometry is disposed, but not one it was given in place of another).
 */
interface Renderer {
  _attributes?: { delete(attribute: object): unknown };
}

const renderers: Array<WeakRef<Renderer>> = [];

/** Register a renderer whose attributes {@link releaseGpuAttribute} frees. */
export function trackAttributeOwner(renderer: unknown): void {
  if (renderer && typeof (renderer as Renderer)._attributes?.delete === 'function') renderers.push(new WeakRef(renderer as Renderer));
}

/** Free `attribute`'s GPU buffer in every live renderer (it is uploaded again if something draws it after all). */
export function releaseGpuAttribute(attribute: object): void {
  for (let i = renderers.length - 1; i >= 0; i--) {
    const r = renderers[i]!.deref();
    if (!r) renderers.splice(i, 1);
    else r._attributes?.delete(attribute);
  }
}
