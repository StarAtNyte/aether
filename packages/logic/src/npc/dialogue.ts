/**
 * Dialogue trees: a small deterministic state machine over a validated
 * {@link Dialogue}. It knows nothing about input or rendering; the system
 * feeds it keys / taps and shows its {@link DialogueView}.
 */
import { compare, type Dialogue, type DialogueChoice, type DialogueCondition, type DialogueEffect, type DialogueNode, type EntityId } from '@aether/core';

/** Services a conversation needs from the runtime. */
export interface DialogueHost {
  /** Read a world/entity state value (`coins`, `guard.angry`). */
  read(key: string): string | number | boolean | null | undefined;
  /** Execute one effect on behalf of NPC `npc`. */
  apply(effect: DialogueEffect, npc: EntityId): void;
}

/** What the UI shows. The object is reused; `version` bumps whenever it changes. */
export interface DialogueView {
  npc: EntityId;
  speaker: string;
  text: string;
  /** Visible choices, in order (numbered 1..n in the UI). */
  choices: string[];
  mode: 'talk' | 'trade';
  node: string;
  version: number;
  /** The character can hold a free conversation (a model may be connected). */
  chat: boolean;
  /** `text` is a free reply, not the node's authored text. */
  free: boolean;
}

/** True when every condition holds. */
export function conditionsHold(list: readonly DialogueCondition[], read: DialogueHost['read']): boolean {
  for (const c of list) {
    const v = read(c.key);
    if (v === undefined || v === null || !compare(v, c.op, c.value)) return false;
  }
  return true;
}

/** One running conversation. */
export class DialogueSession {
  readonly view: DialogueView;
  ended = false;
  private node: DialogueNode | undefined;
  private nodeId = '';
  private visible: DialogueChoice[] = [];
  private visibleIdx: number[] = [];
  private readonly read: DialogueHost['read'];

  constructor(
    private readonly npc: EntityId,
    private readonly name: string,
    private readonly tree: Dialogue,
    private readonly host: DialogueHost,
    /** Choices already taken with `once` ("node#index"); shared across sessions with this NPC. */
    private readonly used: Set<string>,
  ) {
    this.read = (key) => host.read(key);
    this.view = { npc, speaker: name, text: '', choices: [], mode: 'talk', node: '', version: 0, chat: false, free: false };
    this.enter(tree.start);
  }

  private enter(id: string | null): void {
    if (id === null || !Object.hasOwn(this.tree.nodes, id)) {
      this.ended = true;
      return;
    }
    const node = this.tree.nodes[id] as DialogueNode;
    this.node = node;
    this.nodeId = id;
    // Effects first (a node can hand over the key it is about to mention).
    for (const fx of node.effects) this.host.apply(fx, this.npc);
    let text = node.text;
    for (const v of node.variants) {
      if (conditionsHold(v.if, this.read)) {
        text = v.text;
        break;
      }
    }
    this.visible = [];
    this.visibleIdx = [];
    node.choices.forEach((c, i) => {
      if (c.once && this.used.has(`${id}#${i}`)) return;
      if (!conditionsHold(c.if, this.read)) return;
      this.visible.push(c);
      this.visibleIdx.push(i);
    });
    const v = this.view;
    v.speaker = node.speaker ?? this.name;
    v.text = text;
    v.choices = this.visible.map((c) => c.text);
    v.mode = node.mode;
    v.node = id;
    v.free = false;
    v.version++;
  }

  /** Take visible choice `i` (0-based). Returns false when there is no such choice. */
  choose(i: number): boolean {
    if (this.ended || !Number.isInteger(i) || i < 0 || i >= this.visible.length) return false;
    const c = this.visible[i] as DialogueChoice;
    if (c.once) this.used.add(`${this.nodeId}#${this.visibleIdx[i] as number}`);
    for (const fx of c.effects) this.host.apply(fx, this.npc);
    this.enter(c.next);
    return true;
  }

  /** Continue a node without choices (next node, or end). Returns false when choices are pending. */
  advance(): boolean {
    if (this.ended || !this.node) return false;
    if (this.visible.length > 0) return false;
    this.enter(this.node.next);
    return true;
  }

  /** Replace the shown text with a free reply (the node's choices stay available). */
  say(text: string): void {
    if (this.ended) return;
    this.view.text = text;
    this.view.free = true;
    this.view.version++;
  }

  /** True while a choice must be made. */
  get awaitingChoice(): boolean {
    return !this.ended && this.visible.length > 0;
  }

  /** Close the conversation. */
  end(): void {
    this.ended = true;
  }

  /** Walk every node reachable from the start; used by the static checks. */
  static reachable(tree: Dialogue): Set<string> {
    const seen = new Set<string>();
    const stack = [tree.start];
    let hops = 0;
    while (stack.length > 0 && hops++ < 4096) {
      const id = stack.pop() as string;
      if (seen.has(id) || !Object.hasOwn(tree.nodes, id)) continue;
      seen.add(id);
      const n = tree.nodes[id] as DialogueNode;
      if (n.next !== null) stack.push(n.next);
      for (const c of n.choices) if (c.next !== null) stack.push(c.next);
    }
    return seen;
  }
}

