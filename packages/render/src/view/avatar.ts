/**
 * Stylized player avatar: capsule body, head, visor and backpack. Its origin
 * is at the FEET (matches `CharacterController.position`) and it faces −Z at
 * yaw 0 (matches `CharacterController.move`).
 */
import { BoxGeometry, CapsuleGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, type BufferGeometry, type Material } from 'three';

/** Player avatar object with owned resources. */
export class Avatar {
  readonly group = new Group();
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private placed = false;
  private hidden = false;

  constructor() {
    this.group.name = 'aether:avatar';
    const suit = this.material(new MeshStandardMaterial({ color: '#4f7cff', roughness: 0.55, metalness: 0.1 }));
    const skin = this.material(new MeshStandardMaterial({ color: '#ffd2a8', roughness: 0.7 }));
    const visor = this.material(new MeshStandardMaterial({ color: '#141a28', roughness: 0.15, metalness: 0.6, emissive: '#35e0ff', emissiveIntensity: 0.6 }));
    const pack = this.material(new MeshStandardMaterial({ color: '#ff9d3c', roughness: 0.6 }));

    const body = new Mesh(this.geometry(new CapsuleGeometry(0.3, 0.75, 6, 16)), suit);
    body.position.y = 0.3 + 0.375 + 0.02;
    const head = new Mesh(this.geometry(new SphereGeometry(0.22, 20, 14)), skin);
    head.position.y = 1.5;
    const face = new Mesh(this.geometry(new BoxGeometry(0.3, 0.1, 0.1)), visor);
    face.position.set(0, 1.52, -0.17);
    const backpack = new Mesh(this.geometry(new BoxGeometry(0.36, 0.42, 0.16)), pack);
    backpack.position.set(0, 0.95, 0.3);
    for (const m of [body, head, face, backpack]) {
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    }
    this.group.visible = false;
  }

  private geometry<G extends BufferGeometry>(g: G): G {
    this.geometries.push(g);
    return g;
  }

  private material<M extends Material>(m: M): M {
    this.materials.push(m);
    return m;
  }

  /** Place at a feet position with a yaw in degrees. Non-finite input is ignored. */
  set(x: number, y: number, z: number, yawDeg: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    this.group.position.set(x, y, z);
    if (Number.isFinite(yawDeg)) this.group.rotation.set(0, (yawDeg * Math.PI) / 180, 0);
    this.placed = true;
    this.group.visible = !this.hidden;
  }

  /** True once a position has been set. */
  get isPlaced(): boolean {
    return this.placed;
  }

  /** Current yaw in radians. */
  get yaw(): number {
    return this.group.rotation.y;
  }

  /** Hide (first-person view) or show the avatar. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.group.visible = this.placed && !hidden;
  }

  /** Release resources. */
  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.group.removeFromParent();
  }
}
