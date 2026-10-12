/**
 * LogicRuntime — the public, deterministic gameplay runtime.
 *
 * Drive it with a fixed step from the simulation loop:
 *
 * ```ts
 * const logic = new LogicRuntime(world, host, { scripts, seed: world.seed });
 * logic.start();
 * // every fixed step (e.g. 1/60 s), after stepping physics:
 * logic.tick(1 / 60, input, physicsEvents);
 * ```
 *
 * Same world + seed + inputs + events ⇒ identical state and log (scripts are
 * deterministic too, except that a script exceeding its wall-clock budget is
 * cut off). `tick` never throws: failures are recorded in `log`.
 */
import type { EntityId, Json, WorldDoc } from '@aether/core';
import { Engine, type GameStatus } from './engine';
import type { InputState, LogEntry, LogicHost, PhysicsEventLike, ScriptRunner } from './types';

/** Options for {@link LogicRuntime}. */
export interface LogicRuntimeOptions {
  /** Script runner for "script" behaviors (see `initScripting` / `createScriptRunner`). Owned by the caller. */
  scripts?: ScriptRunner;
  /** Seed for every random stream (defaults to `world.seed`). */
  seed?: number;
}

/** Deterministic gameplay runtime: built-in behaviors + rules + sandboxed scripts. */
export class LogicRuntime {
  private readonly engine: Engine;

  /**
   * Trace for the "why did this happen" panel: bounded ring buffer (500
   * entries, newest last). Rule firings carry the rule id and read like
   * "rule 'coin-pickup' fired: player entered coin-3 → score 2→3".
   */
  get log(): LogEntry[] {
    return this.engine.entries;
  }

  constructor(world: WorldDoc, host: LogicHost, opts: LogicRuntimeOptions = {}) {
    this.engine = new Engine(world, host, opts);
  }

  /** Fire 'start' rules (idempotent; also done automatically by the first tick). */
  start(): void {
    this.engine.start();
  }

  /**
   * Advance the simulation by one fixed step. `events` are the physics events
   * produced by the matching physics step. Never throws.
   */
  tick(dt: number, input: InputState, events: readonly PhysicsEventLike[]): void {
    this.engine.tick(dt, input, events);
  }

  /** Report a click/tap on an entity (handled at the next tick). */
  click(id: EntityId): void {
    this.engine.click(id);
  }

  /** Emit a named event from outside (handled at the next tick). */
  emit(event: string): void {
    this.engine.emitExternal(event);
  }

  /** World state (score, lives…). Live view — do not mutate. */
  get state(): Readonly<Record<string, Json>> {
    return this.engine.state;
  }

  /** An entity's state (e.g. door `open`). Live view — do not mutate. */
  entityState(id: EntityId): Readonly<Record<string, Json>> {
    return this.engine.entityState(id);
  }

  /** Read "score" or "door-1.open" (same semantics as `readStateKey`). */
  readState(key: string): Json | undefined {
    return this.engine.readState(key);
  }

  /** Simulated seconds since start (reset by the `reset` action). */
  get time(): number {
    return this.engine.time;
  }

  /** 'playing' until a win/lose action or behavior ends the session. */
  get status(): GameStatus {
    return this.engine.status;
  }

  /** Hot-reload rules, behaviors and entities while preserving runtime state. */
  updateWorld(world: WorldDoc): void {
    this.engine.updateWorld(world);
  }

  /** Release behaviors and internal state. Does not dispose the caller-owned ScriptRunner. */
  dispose(): void {
    this.engine.dispose();
  }
}
