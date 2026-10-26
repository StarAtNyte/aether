/** Aether-owned colour nodes whose alpha only follows the material/map, never time or RGB-detail uniforms. */
const known = new WeakSet<object>();
export function staticShadowAlpha<T>(node: T): T {
  if (node !== null && (typeof node === 'object' || typeof node === 'function')) known.add(node);
  return node;
}
export function hasStaticShadowAlpha(node: unknown): boolean {
  return node !== null && (typeof node === 'object' || typeof node === 'function') && known.has(node);
}
