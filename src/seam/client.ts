// SPDX-License-Identifier: AGPL-3.0-only
// The seam (Wave 4c §9.3): the only place in the service that speaks to the
// engine. It holds the person's token for the turn, applies the calling
// station's grant before it dials, sets the ceiling and the actor headers,
// derives the idempotency key from the tool call id, and writes every call
// and its outcome to its ledger. Nothing else may import an HTTP client,
// which a test proves by grepping. A blocked call returns a reason the
// model reads and adapts to, not a crash.

import type { JsonValue } from "@flue/runtime";
import type { paths } from "./engine.d.ts";
import { type Decision, type Grant, GrantKeeper, operationOf } from "./grant.ts";
import {
  type Actor,
  actorHeader,
  argumentDigest,
  type Ceiling,
  IDEMPOTENT,
  idempotencyKey,
} from "./headers.ts";
import type { Ledger } from "./ledger.ts";
import { admitDocument, admitHandle, admitPath, type ContentClass } from "./redactor.ts";

export type EnginePath = keyof paths;

export interface Station {
  id: string;
  version: string;
  grant: Grant;
  ceiling: Ceiling;
  content: ContentClass;
  model: string;
}

export interface Call {
  method: "GET" | "POST" | "PUT";
  path: string;
  body?: unknown;
  /** The tool call this engine call serves: the idempotency key's source. */
  toolCallId: string;
  phase: string;
  /** The rows the call asks for, for the cap. */
  rows?: number;
}

export type Answer =
  | { kind: "ok"; status: number; body: unknown }
  | { kind: "blocked"; reason: string; operation: string }
  | { kind: "refused"; status: number; body: unknown }
  | { kind: "error"; reason: string };

export interface SeamOptions {
  engine: string;
  station: Station;
  conversation: string;
  /** The person's token for this turn, or null when the desk has not handed one. */
  token: () => string | null;
  /** The engine serves with its authentication off, so a turn without a token is not a refusal; false when unknown. */
  authOff?: () => boolean;
  ledger: Ledger;
  fetch?: typeof fetch;
  /** The engine's own idempotency doors see a key; a repeat of one tool call repeats the answer. */
  now?: () => number;
}

/** One seam per station run: its grant keeper counts calls for the run's life. */
export class Seam {
  private readonly keeper: GrantKeeper;
  private readonly dial: typeof fetch;
  private readonly now: () => number;
  constructor(private readonly o: SeamOptions) {
    this.keeper = new GrantKeeper(o.station.grant);
    this.dial = o.fetch ?? fetch;
    this.now = o.now ?? Date.now;
  }

  /** The grant's counts start over: a follow-up turn is a new run (section 7.7). */
  resetGrant(): void {
    this.keeper.reset();
  }

  get counts(): Record<string, number> {
    return this.keeper.counts();
  }

  private actor(): Actor {
    return {
      kind: "agent",
      name: this.o.station.id,
      model: this.o.station.model,
      version: this.o.station.version,
      conversation: this.o.conversation,
    };
  }

  private record(
    operation: string,
    c: Call,
    decision: Decision,
    outcome: "ok" | "refused" | "blocked" | "error",
    status: number | null,
    handle: number | null,
    ms: number,
    key: string | null,
  ): void {
    this.o.ledger.record({
      at: this.now(),
      conversation: this.o.conversation,
      station: this.o.station.id,
      phase: c.phase,
      operation,
      argument_digest: argumentDigest(c.body),
      granted: decision.allowed,
      reason: decision.reason,
      outcome,
      status,
      handle,
      ms,
      ceiling: this.o.station.ceiling,
      idempotency_key: key,
    });
  }

  async call(c: Call): Promise<Answer> {
    const started = this.now();
    const path = admitPath(c.path);
    if (!path.ok) {
      const operation = operationOf(c.method, c.path);
      this.record(
        operation,
        c,
        { allowed: false, operation, reason: path.why },
        "blocked",
        null,
        null,
        0,
        null,
      );
      return { kind: "blocked", reason: path.why, operation };
    }
    // the context rule, before the call: a document that projects identifiers never goes out
    const doc = (c.body as { document?: unknown } | undefined)?.document;
    if (doc !== undefined) {
      const a = admitDocument(doc, this.o.station.content);
      if (!a.ok) {
        const operation = operationOf(c.method, c.path);
        this.record(
          operation,
          c,
          { allowed: false, operation, reason: a.why },
          "blocked",
          null,
          null,
          0,
          null,
        );
        return { kind: "blocked", reason: a.why, operation };
      }
    }
    const decision = this.keeper.decide(c.method, c.path, c.rows);
    if (!decision.allowed) {
      this.record(decision.operation, c, decision, "blocked", null, null, 0, null);
      return { kind: "blocked", reason: decision.reason ?? "blocked", operation: decision.operation };
    }
    const token = this.o.token();
    if (!token && !this.o.authOff?.()) {
      this.record(decision.operation, c, decision, "error", null, null, 0, null);
      return { kind: "error", reason: "token_unavailable" };
    }
    const headers: Record<string, string> = {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "content-type": "application/json",
      "x-nils-ceiling": this.o.station.ceiling,
      "x-nils-actor": actorHeader(this.actor()),
    };
    let key: string | null = null;
    if (IDEMPOTENT.has(decision.operation)) {
      key = idempotencyKey(c.toolCallId, decision.operation);
      headers["idempotency-key"] = key;
    }
    let r: Response;
    try {
      r = await this.dial(`${this.o.engine.replace(/\/+$/u, "")}${c.path}`, {
        method: c.method,
        headers,
        body: c.body === undefined ? undefined : JSON.stringify(c.body),
      });
    } catch (e) {
      this.record(decision.operation, c, decision, "error", null, null, this.now() - started, key);
      return {
        kind: "error",
        reason: `the engine did not answer: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    const text = await r.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { error: "the engine's answer was not JSON" };
    }
    const handle =
      typeof (body as { handle?: unknown })?.handle === "number"
        ? (body as { handle: number }).handle
        : typeof (body as { id?: unknown })?.id === "number" && decision.operation === "handles/{id}"
          ? (body as { id: number }).id
          : null;
    if (!r.ok) {
      this.record(decision.operation, c, decision, "refused", r.status, null, this.now() - started, key);
      return { kind: "refused", status: r.status, body };
    }
    // the context rule, after the call: a handle above the station's class is not handed to the model
    if (decision.operation === "handles/{id}" || decision.operation === "run") {
      const a = admitHandle(
        (body ?? {}) as { disclosure?: string; suppression?: { classes?: string[] } },
        this.o.station.content,
      );
      if (!a.ok) {
        this.record(decision.operation, c, decision, "blocked", r.status, handle, this.now() - started, key);
        return { kind: "blocked", reason: a.why, operation: decision.operation };
      }
    }
    this.record(decision.operation, c, decision, "ok", r.status, handle, this.now() - started, key);
    return { kind: "ok", status: r.status, body };
  }

  /** A typed door: the path names a contract path, the body its request. */
  door<P extends EnginePath>(
    path: P,
    method: "GET" | "POST" | "PUT",
    body: unknown,
    ctx: { toolCallId: string; phase: string; rows?: number; params?: Record<string, string | number> },
  ): Promise<Answer> {
    let p: string = path;
    for (const [k, v] of Object.entries(ctx.params ?? {}))
      p = p.replace(`{${k}}`, encodeURIComponent(String(v)));
    return this.call({ method, path: p, body, toolCallId: ctx.toolCallId, phase: ctx.phase, rows: ctx.rows });
  }
}

/** What a tool returns to the model when the seam did not dial: a reason, never a stack. */
export function toolResult(a: Answer): { output: JsonValue } {
  switch (a.kind) {
    case "ok":
      return { output: (a.body ?? null) as JsonValue };
    case "blocked":
      return { output: { blocked: true, operation: a.operation, reason: a.reason } };
    case "refused":
      return {
        output: {
          refused: true,
          status: a.status,
          error: ((a.body as { error?: unknown })?.error ?? a.body ?? null) as JsonValue,
        },
      };
    case "error":
      return { output: { error: a.reason } };
  }
}
