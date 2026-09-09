// SPDX-License-Identifier: AGPL-3.0-only
// Delegation (Wave 4c section 9.12): the concierge hands a brief to a
// station and gets a task id back, at once. The station runs as its own
// agent instance, a child conversation keyed under the parent's, with the
// parent's token; its verdict lands in the store like any run's, and the
// host wakes the parent with a signal when it settles, so the concierge
// renders the result from the store and never predicts it.

import { type AgentReply, init, type JsonValue } from "@flue/runtime";
import type { Verdict } from "../stations/verdict.ts";
import { tokens, verdicts } from "./for.ts";

type AgentFn = Parameters<typeof init>[0];

export interface Delegation {
  task: string;
  parent: string;
  station: string;
  child: string;
  brief: string;
  state: "queued" | "running" | "settled" | "failed" | "aborted";
  started_at: string;
  settled_at: string | null;
  /** The delegate's settled verdict, from the store; null until then. */
  verdict: Verdict | null;
  error: string | null;
}

const agents = new Map<string, AgentFn>();
const byParent = new Map<string, Delegation[]>();

/** The station code the host loaded, by manifest id; a delegation names one of these or is refused. */
export function registerAgent(id: string, agent: AgentFn): void {
  agents.set(id, agent);
}
export function agentOf(id: string): AgentFn | null {
  return agents.get(id) ?? null;
}
export function agentIds(): string[] {
  return [...agents.keys()];
}

export function delegationsOf(parent: string): Delegation[] {
  return byParent.get(parent) ?? [];
}
export function delegation(parent: string, task: string): Delegation | null {
  return delegationsOf(parent).find((d) => d.task === task) ?? null;
}

/** Wake the parent conversation with a signal; the parent's own agent decides what to do with it. */
async function wake(parentAgent: AgentFn, parent: string, body: string): Promise<void> {
  try {
    await init(parentAgent, { id: parent }).dispatch({ message: { kind: "signal", type: "delegate", body } });
  } catch (e) {
    console.error(`nils-assistant: could not wake ${parent}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Start a delegation: the child conversation is dispatched and the task id answered at once. */
export function delegate(o: {
  parent: string;
  parentAgent: AgentFn;
  station: string;
  brief: string;
}): Delegation {
  const agent = agents.get(o.station);
  if (!agent)
    throw new Error(`no station named ${o.station} is loaded; the stations are ${agentIds().join(", ")}`);
  const list = byParent.get(o.parent) ?? [];
  const n = list.length + 1;
  const task = `task-${n}`;
  const child = `${o.parent}-${o.station}-${n}`;
  const d: Delegation = {
    task,
    parent: o.parent,
    station: o.station,
    child,
    brief: o.brief,
    state: "queued",
    started_at: new Date().toISOString(),
    settled_at: null,
    verdict: null,
    error: null,
  };
  list.push(d);
  byParent.set(o.parent, list);
  const token = tokens.get(o.parent);
  if (token) tokens.put(child, token);
  const handle = init(agent, { id: child });
  handle
    .dispatch(o.brief)
    .then((receipt) => {
      d.state = "running";
      return handle.read(receipt);
    })
    .then((reply: AgentReply) => {
      d.state = "settled";
      d.settled_at = new Date().toISOString();
      d.verdict = verdicts.get(child) ?? null;
      const r = d.verdict?.result as { document?: unknown; sentence?: unknown } | undefined;
      const terminal = (reply.metadata as { terminal?: string } | undefined)?.terminal ?? "settled";
      const body = d.verdict
        ? `${task} (${o.station}) settled${typeof r?.document === "number" ? ` on document ${r.document}` : ""}${typeof r?.sentence === "string" ? `: ${r.sentence}` : ""}. Read it with delegation_status and settle with what it found.`
        : `${task} (${o.station}) ended without a verdict: ${terminal}. Tell the person, do not guess what it would have found.`;
      return wake(o.parentAgent, o.parent, body);
    })
    .catch((e: unknown) => {
      d.state = "failed";
      d.settled_at = new Date().toISOString();
      d.error = e instanceof Error ? e.message : String(e);
      return wake(o.parentAgent, o.parent, `${task} (${o.station}) failed: ${d.error}. Tell the person.`);
    });
  return d;
}

/** What a delegation shows a model: never a row, never a guess. */
export function delegationView(d: Delegation): Record<string, JsonValue> {
  const r = d.verdict?.result as Record<string, JsonValue> | undefined;
  return {
    task: d.task,
    station: d.station,
    state: d.state,
    started_at: d.started_at,
    settled_at: d.settled_at,
    error: d.error,
    result: r
      ? {
          document: r.document ?? null,
          hash: r.hash ?? null,
          sentence: r.sentence ?? null,
          choices: r.choices ?? [],
          declaration: r.declaration ?? null,
        }
      : null,
    terminal: d.verdict?.terminal ?? null,
    checks: (d.verdict?.checks ?? []) as unknown as JsonValue,
  } as Record<string, JsonValue>;
}
