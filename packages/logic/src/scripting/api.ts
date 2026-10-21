/**
 * TypeScript declaration of the script API, embedded in the agent prompt so
 * the coding model writes scripts against the exact contract.
 */

/** `.d.ts` text describing `ctx` and the intents a script may return. */
export const SCRIPT_API_DTS = `// Aether behavior script API.
// A script's source is the BODY of: function update(ctx: ScriptContext): Intent[]
// It runs once per fixed tick (60 Hz) for every entity whose behavior is
// { "type": "script", "params": { "script": "<script-id>" } }.
// Sandbox: plain JavaScript (ES2020) in QuickJS. No DOM, no fetch, no timers,
// no Date, no eval, no RegExp, no Promise. Math.random() is seeded/deterministic.
// Budget: ~2 ms per call; scripts that exceed it 3 times are disabled.
// Keep memory in ctx.self.state via setSelfState (top-level variables reset every call).

type Vec3 = [number, number, number];
type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

interface ScriptContext {
  dt: number;                 // seconds since last tick (fixed, e.g. 1/60)
  time: number;               // seconds since play started
  self: {
    id: string;
    position: Vec3;           // world position (meters, Y up)
    velocity: Vec3;           // m/s ([0,0,0] for non-physics entities)
    state: Record<string, Json>; // this entity's state (persisted via setSelfState; readable by rules as "<id>.<key>")
  };
  player?: { position: Vec3 }; // absent when there is no player
  world: Record<string, Json>; // global state (score, lives, flags…) — read-only here, change with set/add
  nearby: Array<{ id: string; tags: string[]; position: Vec3 }>; // up to 16 closest entities within 15 m
  input: { forward: number; right: number; jump: boolean; action: boolean }; // player input (-1..1)
}

// Selectors: "some-id", "#tag", "player", "*", and (scripts only) "self".
type Selector = string;

type Intent =
  | { do: 'moveTo'; target: Vec3; speed: number }          // move self toward target this tick (m/s)
  | { do: 'setSelfState'; key: string; value: Json }      // persist a value on self (key without dots)
  | { do: 'set'; key: string; value: Json }               // world/entity state: "score" or "door-1.open"
  | { do: 'add'; key: string; amount: number }
  | { do: 'spawn'; template: string; at?: Vec3 | Selector; count?: number; spread?: number }
  | { do: 'destroy'; target: Selector }
  | { do: 'impulse'; target: Selector; vector: Vec3 }      // dynamic bodies only
  | { do: 'setVelocity'; target: Selector; vector: Vec3 }
  | { do: 'teleport'; target: Selector; to: Vec3 | Selector }
  | { do: 'setProperty'; target: Selector; path: string; value: Json } // "material.color", "visible", "light.intensity"
  | { do: 'enableBehavior'; target: Selector; behavior: string; enabled: boolean }
  | { do: 'explode'; at: Vec3 | Selector; force?: number; radius?: number }
  | { do: 'setGravity'; vector: Vec3 }
  | { do: 'emit'; event: string; delay?: number }          // triggers rules with when: { on: 'event', name }
  | { do: 'message'; text: string; duration?: number }
  | { do: 'sound'; sound: 'pickup' | 'hit' | 'explosion' | 'win' | 'lose' | 'click' | 'whoosh' | 'bell' }
  | { do: 'win'; text?: string }
  | { do: 'lose'; text?: string }
  | { do: 'reset' };

// Return at most 32 intents per call; invalid intents are dropped and logged.
// Example (circle around the start point, flash when the player is near):
//   const home = ctx.self.state.home || ctx.self.position;
//   const out = [];
//   if (!ctx.self.state.home) out.push({ do: 'setSelfState', key: 'home', value: home });
//   const a = ctx.time * 0.8;
//   out.push({ do: 'moveTo', target: [home[0] + Math.cos(a) * 3, home[1], home[2] + Math.sin(a) * 3], speed: 4 });
//   if (ctx.player) {
//     const dx = ctx.player.position[0] - ctx.self.position[0], dz = ctx.player.position[2] - ctx.self.position[2];
//     if (dx * dx + dz * dz < 4) out.push({ do: 'setProperty', target: 'self', path: 'material.emissiveIntensity', value: 3 });
//   }
//   return out;
`;
