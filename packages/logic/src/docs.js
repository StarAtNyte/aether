/**
 * Agent-facing documentation: the behavior catalog and compact rule docs.
 */
import { BuiltinBehavior } from '@aether/core';
import { BEHAVIORS } from './behaviors';
/** Every built-in behavior with its parameters, description and requirements (World IR enum order). */
export const BEHAVIOR_CATALOG = BuiltinBehavior.options.map((type) => {
    const def = BEHAVIORS[type];
    if (!def)
        throw new Error(`@aether/logic: missing behavior '${type}'`);
    const entry = { type, description: def.description, params: def.params };
    if (def.requires)
        entry.requires = def.requires;
    return entry;
});
/** Compact, precise documentation of rule triggers, conditions and actions for the agent prompt. */
export const RULE_DOCS = `RULES — world-level logic: { id, description?, when: Trigger, if?: Condition[], then: Action[] (≥1), once?: false, enabled?: true }
Selectors: "entity-id" | "#tag" | "player" | "*" (every entity). State keys: "score" (world state) or "door-1.open" (entity state; nested "e.a.b" allowed).
Conditions: { key, op: "=="|"!="|">"|"<"|">="|"<=", value } — all must hold. No type coercion; unset keys only satisfy "!=".
Limits: ≤64 rule firings per tick; emit chains deeper than 8 are dropped; ≤256 delayed events; a rule with once:true fires at most once per play session.

TRIGGERS (when):
- start — once when play begins. {"on":"start"}
- tick — every N seconds. {"on":"tick","every":1}
- timer — once at t seconds after start. {"on":"timer","at":30}
- collision — physics contact begins between a match of a and of b (order-free), impulse ≥ minImpulse. {"on":"collision","a":"#ball","b":"#pin","minImpulse":2}
- enter — who (default "player") enters a zone entity's volume (physics sensor contact or the entity's scaled shape). {"on":"enter","zone":"finish-zone","who":"player"}
- exit — who leaves a zone entity's volume. {"on":"exit","zone":"safe-zone","who":"#sheep"}
- key — key pressed (edge; "e", "space", "arrowup", "1"…). {"on":"key","key":"e"}
- click — entity clicked/tapped. {"on":"click","target":"button-1"}
- state — condition becomes true (edge-triggered; fires again only after it was false). {"on":"state","key":"score","op":">=","value":10}
- event — a named event emitted by an emit action/behavior. {"on":"event","name":"alarm"}
- fallBelow — a target's y drops below a height (once per fall). {"on":"fallBelow","target":"player","y":-5}

ACTIONS (then):
- set — {"do":"set","key":"door-1.open","value":true}
- add — {"do":"add","key":"score","amount":1}
- spawn — clone a template entity (template:true) with ids "<template>-1", "-2"…; at = [x,y,z] or a selector (default: template position); count 1–500; spread = random horizontal radius. {"do":"spawn","template":"crate","at":[0,5,0],"count":3,"spread":2}
- destroy — {"do":"destroy","target":"#enemy"}
- impulse — momentum kick on dynamic bodies (N·s). {"do":"impulse","target":"ball","vector":[0,8,0]}
- setVelocity — {"do":"setVelocity","target":"cart","vector":[3,0,0]}
- teleport — to [x,y,z] or a selector's position. {"do":"teleport","target":"player","to":"start-pad"}
- setProperty — presentational property: "visible", "material.color", "material.emissiveIntensity", "material.opacity", "light.intensity", "light.color". {"do":"setProperty","target":"lamp","path":"light.intensity","value":0}
- enableBehavior — toggle behaviors of a type on targets. {"do":"enableBehavior","target":"fan","behavior":"spin","enabled":false}
- explode — radial impulse at a point/selector. {"do":"explode","at":"barrel-2","force":25,"radius":6}
- setGravity — {"do":"setGravity","vector":[0,-1.6,0]}
- emit — fire 'event' rules now or after delay seconds. {"do":"emit","event":"alarm","delay":2}
- message — on-screen text. {"do":"message","text":"The gate opens!","duration":3}
- sound — pickup|hit|explosion|win|lose|click|whoosh|bell. {"do":"sound","sound":"bell"}
- win — end the session victorious. {"do":"win","text":"All coins collected!"}
- lose — end the session in defeat. {"do":"lose","text":"Out of time!"}
- reset — restart the world from its initial state. {"do":"reset"}

TIPS: per-object pickups/hazards/goals are better as behaviors (collectible, hazard, goal) than rules — a rule's "#coin" target means EVERY coin.
Example: {"id":"win-at-10","when":{"on":"state","key":"score","op":">=","value":10},"then":[{"do":"sound","sound":"win"},{"do":"win","text":"10 coins!"}]}`;
