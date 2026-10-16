/**
 * Dialogue trees: a small deterministic state machine over a validated
 * {@link Dialogue}. It knows nothing about input or rendering; the system
 * feeds it keys / taps and shows its {@link DialogueView}.
 */
import { compare } from '@aether/core';
/** True when every condition holds. */
export function conditionsHold(list, read) {
    for (const c of list) {
        const v = read(c.key);
        if (v === undefined || v === null || !compare(v, c.op, c.value))
            return false;
    }
    return true;
}
/** One running conversation. */
export class DialogueSession {
    npc;
    name;
    tree;
    host;
    used;
    view;
    ended = false;
    node;
    nodeId = '';
    visible = [];
    visibleIdx = [];
    read;
    constructor(npc, name, tree, host, 
    /** Choices already taken with `once` ("node#index"); shared across sessions with this NPC. */
    used) {
        this.npc = npc;
        this.name = name;
        this.tree = tree;
        this.host = host;
        this.used = used;
        this.read = (key) => host.read(key);
        this.view = { npc, speaker: name, text: '', choices: [], mode: 'talk', node: '', version: 0, chat: false, free: false };
        this.enter(tree.start);
    }
    enter(id) {
        if (id === null || !Object.hasOwn(this.tree.nodes, id)) {
            this.ended = true;
            return;
        }
        const node = this.tree.nodes[id];
        this.node = node;
        this.nodeId = id;
        // Effects first (a node can hand over the key it is about to mention).
        for (const fx of node.effects)
            this.host.apply(fx, this.npc);
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
            if (c.once && this.used.has(`${id}#${i}`))
                return;
            if (!conditionsHold(c.if, this.read))
                return;
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
    choose(i) {
        if (this.ended || !Number.isInteger(i) || i < 0 || i >= this.visible.length)
            return false;
        const c = this.visible[i];
        if (c.once)
            this.used.add(`${this.nodeId}#${this.visibleIdx[i]}`);
        for (const fx of c.effects)
            this.host.apply(fx, this.npc);
        this.enter(c.next);
        return true;
    }
    /** Continue a node without choices (next node, or end). Returns false when choices are pending. */
    advance() {
        if (this.ended || !this.node)
            return false;
        if (this.visible.length > 0)
            return false;
        this.enter(this.node.next);
        return true;
    }
    /** Replace the shown text with a free reply (the node's choices stay available). */
    say(text) {
        if (this.ended)
            return;
        this.view.text = text;
        this.view.free = true;
        this.view.version++;
    }
    /** True while a choice must be made. */
    get awaitingChoice() {
        return !this.ended && this.visible.length > 0;
    }
    /** Close the conversation. */
    end() {
        this.ended = true;
    }
    /** Walk every node reachable from the start; used by the static checks. */
    static reachable(tree) {
        const seen = new Set();
        const stack = [tree.start];
        let hops = 0;
        while (stack.length > 0 && hops++ < 4096) {
            const id = stack.pop();
            if (seen.has(id) || !Object.hasOwn(tree.nodes, id))
                continue;
            seen.add(id);
            const n = tree.nodes[id];
            if (n.next !== null)
                stack.push(n.next);
            for (const c of n.choices)
                if (c.next !== null)
                    stack.push(c.next);
        }
        return seen;
    }
}
