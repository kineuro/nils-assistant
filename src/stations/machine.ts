// SPDX-License-Identifier: AGPL-3.0-only
// The station as a guarded phase machine (Wave 4c §9.4): a durable phase
// value, tools mounted per phase and gated with a check that returns
// refusal text, one terminal reason per run, the budget counted in run
// state, and the loop-detection rules ported from the prototype: an
// order-independent hash of a tool call's salient keys, warn at three
// repeats, stop at five, the counter in run state and the interventions as
// typed events.

import { createHash } from "node:crypto";
import type { Budget, Manifest, TerminalReason } from "./manifest.ts";

/** The run state a station keeps in durable storage, whole, so a compaction cannot lose it (§9.9). */
export interface RunState {
  phase: string;
  turns: number;
  tool_calls: number;
  input_tokens: number;
  started_at: number;
  terminal: TerminalReason | null;
  /** The loop detector's counts, by call hash. */
  repeats: Record<string, number>;
  /** Typed interventions, in order. */
  events: Intervention[];
  /** Handles and ids read, never rows (§9.6). */
  evidence: { handles: number[]; documents: number[] };
}

export type Intervention =
  | { kind: "loop_warning"; tool: string; repeats: number; at: number }
  | { kind: "loop_stopped"; tool: string; repeats: number; at: number }
  | { kind: "phase"; from: string; to: string; at: number }
  | { kind: "follow_up"; from: string; to: string; at: number }
  | { kind: "budget"; which: keyof Budget; at: number }
  | { kind: "refused"; tool: string; why: string; at: number };

export function initialState(m: Manifest, now = Date.now()): RunState {
  return {
    phase: m.phases.initial,
    turns: 0,
    tool_calls: 0,
    input_tokens: 0,
    started_at: now,
    terminal: null,
    repeats: {},
    events: [],
    evidence: { handles: [], documents: [] },
  };
}

export const LOOP_WARN = 3;
export const LOOP_STOP = 5;

/**
 * The salient keys of a call: the argument keys the station names for the
 * tool, else every key; values sorted so the hash is order independent.
 */
export function callHash(tool: string, args: Record<string, unknown>, salient?: string[]): string {
  const keys = (salient ?? Object.keys(args)).filter((k) => k in args).sort();
  const parts = keys.map((k) => `${k}=${JSON.stringify(args[k])}`);
  return createHash("sha256")
    .update(`${tool}\n${parts.join("\n")}`)
    .digest("hex")
    .slice(0, 16);
}

export class Machine {
  constructor(
    readonly manifest: Manifest,
    public state: RunState,
    private readonly now: () => number = Date.now,
  ) {}

  /** The phases a tool is mounted in, from the station's own table. */
  allowed(tool: string, table: Record<string, string[]>): { ok: true } | { ok: false; why: string } {
    if (this.state.terminal) return { ok: false, why: `the run ended: ${this.state.terminal}` };
    const phases = table[tool];
    if (!phases) return { ok: false, why: `${tool} is not a tool of ${this.manifest.id}` };
    if (!phases.includes(this.state.phase))
      return {
        ok: false,
        why: `${tool} is not open in the ${this.state.phase} phase; it opens in ${phases.join(", ")}`,
      };
    return { ok: true };
  }

  /**
   * A follow-up turn (section 7.7): the person spoke again after the run
   * settled. The budget starts over, the loop detector forgets, the phase
   * re-enters where the manifest says, and the evidence and the events stay.
   */
  followUp(to: string): void {
    this.state.events.push({ kind: "follow_up", from: this.state.phase, to, at: this.now() });
    this.state.phase = to;
    this.state.turns = 0;
    this.state.tool_calls = 0;
    this.state.input_tokens = 0;
    this.state.started_at = this.now();
    this.state.terminal = null;
    this.state.repeats = {};
  }

  /** A move between phases the manifest names; anything else is refused. */
  advance(to: string): { ok: true } | { ok: false; why: string } {
    const t = this.manifest.phases.transitions.find((x) => x.from === this.state.phase && x.to === to);
    if (!t)
      return {
        ok: false,
        why: `no transition from ${this.state.phase} to ${to}; the manifest allows ${
          this.manifest.phases.transitions
            .filter((x) => x.from === this.state.phase)
            .map((x) => x.to)
            .join(", ") || "none"
        }`,
      };
    this.state.events.push({ kind: "phase", from: this.state.phase, to, at: this.now() });
    this.state.phase = to;
    return { ok: true };
  }

  /** One tool call against the budget and the loop detector; the reason when the run must end. */
  call(
    tool: string,
    args: Record<string, unknown>,
    salient?: string[],
  ): { ok: true; warning: string | null } | { ok: false; why: string; terminal: TerminalReason | null } {
    if (this.state.terminal)
      return { ok: false, why: `the run ended: ${this.state.terminal}`, terminal: this.state.terminal };
    this.state.tool_calls += 1;
    const budget = this.budget();
    if (budget) return { ok: false, why: `the budget of ${budget} is spent`, terminal: budget };
    const h = callHash(tool, args, salient);
    const n = (this.state.repeats[h] ?? 0) + 1;
    this.state.repeats[h] = n;
    if (n >= LOOP_STOP) {
      this.state.events.push({ kind: "loop_stopped", tool, repeats: n, at: this.now() });
      this.state.terminal = "loop_stopped";
      return {
        ok: false,
        why: `${tool} was called ${n} times with the same salient arguments; the run stops`,
        terminal: "loop_stopped",
      };
    }
    if (n >= LOOP_WARN) {
      this.state.events.push({ kind: "loop_warning", tool, repeats: n, at: this.now() });
      return {
        ok: true,
        warning: `${tool} was called ${n} times with the same salient arguments; change the arguments or finish`,
      };
    }
    return { ok: true, warning: null };
  }

  /** A model turn against the budget. */
  turn(inputTokens: number): TerminalReason | null {
    this.state.turns += 1;
    this.state.input_tokens += inputTokens;
    return this.budget();
  }

  /** The first budget that is spent, recorded as terminal; null while all hold. */
  budget(): TerminalReason | null {
    if (this.state.terminal) return this.state.terminal;
    const b = this.manifest.budget;
    const over: [boolean, TerminalReason, keyof Budget][] = [
      [this.state.turns > b.turns, "budget_turns", "turns"],
      [this.state.tool_calls > b.tool_calls, "budget_tools", "tool_calls"],
      [
        this.now() - this.state.started_at > b.wall_clock_seconds * 1000,
        "budget_wall_clock",
        "wall_clock_seconds",
      ],
      [this.state.input_tokens > b.input_tokens, "budget_tokens", "input_tokens"],
    ];
    for (const [spent, reason, which] of over) {
      if (spent) {
        this.state.events.push({ kind: "budget", which, at: this.now() });
        this.state.terminal = reason;
        return reason;
      }
    }
    return null;
  }

  end(reason: TerminalReason): void {
    if (!this.state.terminal) this.state.terminal = reason;
  }

  refuse(tool: string, why: string): void {
    this.state.events.push({ kind: "refused", tool, why, at: this.now() });
  }
}
