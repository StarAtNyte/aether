/** Skin classification follows mounted content, never a reused entity ID or loading placeholder. */
import type { EntityNode } from '../sync/entity-node';
import type { Object3D } from 'three';

type Node = Pick<EntityNode, 'content' | 'token' | 'pending' | 'placeholder'>;
export class AssetSkinCache {
  private readonly entries = new WeakMap<Node, { token: number; skinned: boolean }>();
  hasSkin(node: Node): boolean {
    // Loading may replace a placeholder without changing the build token again.
    if (node.pending || node.placeholder) return false;
    const cached = this.entries.get(node);
    if (cached?.token === node.token) return cached.skinned;
    let skinned = false;
    node.content.traverse((object: Object3D) => {
      if ((object as Object3D & { isSkinnedMesh?: boolean }).isSkinnedMesh) skinned = true;
    });
    this.entries.set(node, { token: node.token, skinned });
    return skinned;
  }
}
