// SPDX-License-Identifier: AGPL-3.0-only
// Headless station runs (Wave 4c §9.2): POST /stations/{id}/runs dispatches
// one message to a fresh conversation of the station's agent and answers
// the run id; GET /runs/{id} answers its state and, once settled, the reply.
// A run is a conversation like any other, keyed so the desk can read it.

import { type AgentReply, AgentRunError, init } from "@flue/runtime";

export interface Run {
  id: string;
  station: string;
  conversation: string;
  state: "queued" | "running" | "settled" | "failed" | "aborted";
  started_at: string;
  settled_at: string | null;
  reply: AgentReply | null;
  error: string | null;
}

export class Runs {
  private readonly runs = new Map<string, Run>();

  start(station: string, agent: Parameters<typeof init>[0], message: string, conversation: string): Run {
    const id = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const run: Run = {
      id,
      station,
      conversation,
      state: "queued",
      started_at: new Date().toISOString(),
      settled_at: null,
      reply: null,
      error: null,
    };
    this.runs.set(id, run);
    const handle = init(agent, { id: conversation });
    handle
      .dispatch(message)
      .then((receipt) => {
        run.state = "running";
        return handle.read(receipt);
      })
      .then((reply) => {
        run.state = "settled";
        run.reply = reply;
        run.settled_at = new Date().toISOString();
      })
      .catch((e: unknown) => {
        run.state = e instanceof AgentRunError && e.outcome === "aborted" ? "aborted" : "failed";
        run.error = e instanceof Error ? e.message : String(e);
        run.settled_at = new Date().toISOString();
      });
    return run;
  }

  get(id: string): Run | null {
    return this.runs.get(id) ?? null;
  }
}
