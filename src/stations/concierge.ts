// SPDX-License-Identifier: AGPL-3.0-only
// The concierge (Wave 4c §9.12): a fourth agent, deliberately weak. It
// holds the conversation, reads what exists (describe, a handle, its
// rows, the capabilities, the jobs), asks one typed choice with counts
// when a pick, a scope or a grain is open, and delegates the work to a
// station by brief, text plus a task id back. It writes nothing. When a
// delegate settles, the host wakes it with a signal and it renders the
// verdict from the store: the settle carries the delegate's document and
// sentence, and the framework emits the proposal to the desk.

import type { JsonValue } from "@flue/runtime";
import * as v from "valibot";
import type { Answer, Seam } from "../seam/client.ts";
import { toolResult } from "../seam/client.ts";
import { agentIds, delegate, delegation, delegationsOf, delegationView } from "../seam/delegations.ts";
import { type StationDefinition, type StationTool, stationAgent } from "./agent.ts";
import type { Manifest } from "./manifest.ts";
import type { Check, Verdict } from "./verdict.ts";

const handleOf = (a: Answer): number[] =>
  a.kind === "ok" && typeof (a.body as { handle?: unknown })?.handle === "number"
    ? [(a.body as { handle: number }).handle]
    : [];

export function conciergeTools(): StationTool[] {
  const door = (
    name: string,
    description: string,
    input: v.GenericSchema<Record<string, unknown>, unknown>,
    dial: (seam: Seam, args: Record<string, unknown>, toolCallId: string, phase: string) => Promise<Answer>,
    salient?: string[],
  ): StationTool => ({
    name,
    description,
    input,
    phases: ["hold"],
    salient,
    async run(args, ctx) {
      const a = await dial(ctx.seam, args, ctx.toolCallId, ctx.state.phase);
      return { output: toolResult(a).output, evidence: { handles: handleOf(a) } };
    },
  });
  return [
    door(
      "nils_capabilities",
      "What this deployment serves: the doors, the packs, the epoch. Read it when the person asks what is possible.",
      v.object({}),
      (s, _a, id, phase) => s.call({ method: "GET", path: "/api/capabilities", toolCallId: id, phase }),
    ),
    door(
      "nils_describe",
      "One sentence per set and the declaration block of a stored document, by id.",
      v.object({ document_id: v.number() }),
      (s, a, id, phase) =>
        s.call({
          method: "POST",
          path: "/api/ask/describe",
          body: { document_id: a.document_id },
          toolCallId: id,
          phase,
        }),
      ["document_id"],
    ),
    door(
      "nils_handle",
      "A result handle: its grain, row count, declaration and whether it is truncated. Never the rows themselves unless asked for a page.",
      v.object({ handle: v.number() }),
      (s, a, id, phase) =>
        s.call({ method: "GET", path: `/api/ask/handles/${Number(a.handle)}`, toolCallId: id, phase }),
      ["handle"],
    ),
    door(
      "nils_rows",
      "One page of a handle's rows, at most twenty, to answer a question about a result the person already has.",
      v.object({ handle: v.number(), page: v.optional(v.number()) }),
      (s, a, id, phase) =>
        s.call({
          method: "GET",
          path: `/api/ask/handles/${Number(a.handle)}/rows?page=${Number(a.page ?? 1)}`,
          toolCallId: id,
          phase,
          rows: 20,
        }),
      ["handle", "page"],
    ),
    door(
      "nils_jobs",
      "The engine's jobs, read only: what is running, queued or done.",
      v.object({}),
      (s, _a, id, phase) => s.call({ method: "GET", path: "/api/jobs", toolCallId: id, phase }),
    ),
    {
      name: "delegate",
      description:
        "Hand the work to a station by a brief in the person's own terms, and get a task id back at once. The station runs on its own; you will be woken when it settles. Stations: ask-help (words to a document, or one step of a document tuned; name the base document in the brief when there is one).",
      input: v.object({ station: v.string(), brief: v.string() }),
      phases: ["hold"],
      salient: ["station"],
      async run(args, ctx) {
        const station = String(args.station);
        const brief = String(args.brief);
        if (/\b(select|count\(\*\)|sql|query)\b/iu.test(brief))
          return {
            output: {
              refused: true,
              why: "the brief is the person's request in their own words, never SQL or a query; say what they asked",
            } as JsonValue,
          };
        if (!agentIds().includes(station) || station === ctx.machine.manifest.id)
          return {
            output: {
              refused: true,
              why: `no station named ${station} takes a brief; the stations are ${agentIds()
                .filter((s) => s !== ctx.machine.manifest.id)
                .join(", ")}`,
            } as JsonValue,
          };
        const d = delegate({
          parent: ctx.conversation,
          parentStation: ctx.machine.manifest.id,
          station,
          brief,
        });
        return {
          output: {
            task: d.task,
            station: d.station,
            state: d.state,
            text: `${d.task} is with ${station}. Tell the person it is working; do not guess its result.`,
          } as JsonValue,
        };
      },
    },
    {
      name: "delegation_status",
      description:
        "Where a task stands, from the store: queued, running, settled with its document and sentence, or failed. Never read a running task's output.",
      input: v.object({ task: v.optional(v.string()) }),
      phases: ["hold"],
      salient: ["task"],
      async run(args, ctx) {
        if (typeof args.task === "string") {
          const d = delegation(ctx.conversation, args.task);
          return {
            output: (d
              ? delegationView(d)
              : { refused: true, why: `no task ${args.task} in this conversation` }) as JsonValue,
          };
        }
        return { output: { tasks: delegationsOf(ctx.conversation).map(delegationView) } as JsonValue };
      },
    },
  ];
}

export function conciergeChecks(): Record<string, Check> {
  return {
    // SQL is a SELECT followed by FROM, or a writing statement; the word "from" in a sentence is not SQL
    no_sql: (verdict: Verdict) =>
      /\bselect\b[\s\S]{0,600}?\bfrom\b|\b(?:insert\s+into|delete\s+from|update\s+\w+\s+set|create\s+table|drop\s+table)\b/iu.test(
        JSON.stringify(verdict.result),
      )
        ? "the verdict carries SQL"
        : null,
    no_identifier_value: (verdict: Verdict) => {
      const text = JSON.stringify(verdict.result);
      return /\b\d{8}-?\d{4}\b/u.test(text) || /\b\d+(?:\.\d+){5,}\b/u.test(text)
        ? "the verdict carries an identifier value"
        : null;
    },
    /** A clarification fires only at a pick, a scope or a grain (section 9.12); the schema says so too, this check says it in words. */
    clarification_axis: (verdict: Verdict) => {
      const choices = Array.isArray(verdict.result.choices)
        ? (verdict.result.choices as { axis?: unknown }[])
        : [];
      const bad = choices.find((c) => !["pick", "scope", "grain"].includes(String(c.axis)));
      return bad
        ? `a clarification fires only at a pick, a scope or a grain, not at ${JSON.stringify(bad.axis ?? null).slice(0, 40)}`
        : null;
    },
    /** A document the concierge names came from a delegate's settled verdict, never from its own hand. */
    from_a_delegate: (verdict: Verdict, ctx) => {
      const document = verdict.result.document;
      if (document === undefined || document === null) return null;
      const conversation = String((ctx as { conversation?: string }).conversation ?? "");
      const settled = delegationsOf(conversation).filter((d) => d.state === "settled" && d.verdict);
      return settled.some(
        (d) => d.verdict !== null && (d.verdict.result as { document?: unknown }).document === document,
      )
        ? null
        : `document ${String(document)} is not what any settled delegate found`;
    },
  };
}

export function concierge(manifest: Manifest, brief: string, model: string): ReturnType<typeof stationAgent> {
  const def: StationDefinition = {
    manifest,
    brief,
    model,
    instructions:
      "You are the concierge. You hold the conversation and you do not do the work: you read what exists, you ask one typed choice when a pick, a scope or a grain is open and the person has not said it, and you delegate to a station by a brief in the person's own words. In the turn you delegate, settle at once with a sentence saying the task is working; never poll delegation_status in that turn, you will be woken by a signal when the task settles. In a woken turn, read the task with delegation_status and settle with its document and sentence, word for word. Give status, never a guess.",
    tools: conciergeTools(),
    checks: conciergeChecks(),
    briefInline: true,
    settle: { phases: ["hold", "finish"] },
  };
  return stationAgent(def);
}
