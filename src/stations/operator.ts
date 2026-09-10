// SPDX-License-Identifier: AGPL-3.0-only
// The operator station (Wave 5 section 9.3, D70): the concierge delegates
// to it an instruction that names more than one act or a time; its verdict
// is a plan, an ordered list of verbs with their arguments and when each
// fires. The host maps the verbs to doors and reads each rung from the
// engine's own policy, so the model never has to know one: rung-two verbs
// become steps the scheduler runs under the person's standing grants once
// the person confirms the plan; rung-three verbs become proposals. The
// station runs nothing.

import type { JsonValue } from "@flue/runtime";
import * as v from "valibot";
import { type PolicyRow, planFrom, restate, rungOf, VERBS } from "../host/ladder.ts";
import type { LadderStore } from "../host/ladder-store.ts";
import type { Answer, Seam } from "../seam/client.ts";
import { toolResult } from "../seam/client.ts";
import { subjectOfConversation } from "../seam/for.ts";
import { type StationDefinition, type StationTool, stationAgent } from "./agent.ts";
import type { Manifest } from "./manifest.ts";
import type { Check, Verdict } from "./verdict.ts";

let store: (() => LadderStore) | null = null;
export function useLadderStore(f: () => LadderStore): void {
  store = f;
}

/** The engine's policy, read through the seam once per run. */
async function policyOf(seam: Seam, toolCallId: string, phase: string): Promise<PolicyRow[]> {
  const a = await seam.call({ method: "GET", path: "/api/capabilities", toolCallId, phase });
  if (a.kind !== "ok") return [];
  const rows = (a.body as { policy?: unknown }).policy;
  return Array.isArray(rows) ? (rows as PolicyRow[]) : [];
}

export function operatorTools(): StationTool[] {
  const door = (
    name: string,
    description: string,
    input: v.GenericSchema<Record<string, unknown>, unknown>,
    dial: (seam: Seam, args: Record<string, unknown>, toolCallId: string, phase: string) => Promise<Answer>,
  ): StationTool => ({
    name,
    description,
    input,
    phases: ["read"],
    async run(args, ctx) {
      return { output: toolResult(await dial(ctx.seam, args, ctx.toolCallId, ctx.state.phase)).output };
    },
  });
  return [
    door(
      "nils_capabilities",
      "What this deployment serves: the doors, the packs, the epoch.",
      v.object({}),
      (s, _a, id, phase) => s.call({ method: "GET", path: "/api/capabilities", toolCallId: id, phase }),
    ),
    door(
      "nils_batches",
      "The batches, newest first: their ids, names, states and when they finished.",
      v.object({}),
      (s, _a, id, phase) => s.call({ method: "GET", path: "/api/batches?limit=20", toolCallId: id, phase }),
    ),
    door(
      "nils_documents",
      "The stored questions, newest first: id, name, grain, last run, author.",
      v.object({}),
      (s, _a, id, phase) => s.call({ method: "GET", path: "/api/ask/documents", toolCallId: id, phase }),
    ),
    door(
      "nils_jobs",
      "The engine's jobs, read only: what is running, queued or done.",
      v.object({}),
      (s, _a, id, phase) => s.call({ method: "GET", path: "/api/jobs", toolCallId: id, phase }),
    ),
    {
      name: "plan",
      description:
        "Record the plan: the steps in order, each a verb with its arguments and when it fires. The host names each step's rung from the engine's policy and answers the plan id, the steps and the proposals; then settle with the sentence.",
      input: v.object({
        instruction: v.string(),
        steps: v.array(
          v.object({
            verb: v.string(),
            args: v.optional(v.record(v.string(), v.unknown())),
            when: v.optional(v.unknown()),
          }),
        ),
        items: v.number(),
      }),
      phases: ["read", "plan"],
      completes: "steps",
      async run(args, ctx) {
        const policy = await policyOf(ctx.seam, ctx.toolCallId, ctx.state.phase);
        if (policy.length === 0)
          return {
            output: {
              refused: true,
              why: "the engine's policy could not be read; no plan without it",
            } as JsonValue,
          };
        const planned = planFrom(args.steps, policy);
        if (planned.refused.length > 0 && planned.steps.length + planned.proposals.length === 0)
          return {
            output: { refused: true, why: planned.refused.map((r) => r.why).join("; ") } as JsonValue,
          };
        if (!store) return { output: { refused: true, why: "no ladder store" } as JsonValue };
        const id = `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        store().plan({
          id,
          conversation: ctx.conversation,
          subject: subjectOfConversation(ctx.conversation),
          instruction: String(args.instruction),
          planned,
        });
        return {
          output: {
            plan: id,
            steps: planned.steps.map((s) => ({
              n: s.n,
              rung: s.rung,
              verb: s.verb,
              door: s.door,
              when: s.when,
              words: s.words,
            })),
            proposals: planned.proposals.map((p) => ({
              n: p.n,
              rung: p.rung,
              verb: p.verb,
              door: p.door,
              words: p.words,
              closure_needed: true,
            })),
            refused: planned.refused,
            restated: restate(planned),
            text: "The plan is recorded and waits for the person to confirm it; settle with the sentence now.",
          } as JsonValue,
        };
      },
    },
  ];
}

export function operatorChecks(): Record<string, Check> {
  return {
    no_sql: (verdict: Verdict) =>
      /\bselect\b[\s\S]{0,600}?\bfrom\b|\b(?:insert\s+into|delete\s+from|update\s+\w+\s+set|create\s+table|drop\s+table)\b/iu.test(
        JSON.stringify(verdict.result),
      )
        ? "the verdict carries SQL"
        : null,
    /** The verdict names a plan the store holds for this conversation. */
    planned: (verdict: Verdict, ctx) => {
      const id = verdict.result.plan;
      if (typeof id !== "string" || !store) return "the verdict names no plan; call plan first";
      const p = store().planById(id);
      const conversation = String((ctx as { conversation?: string }).conversation ?? "");
      return p && p.conversation === conversation ? null : `plan ${id} is not this conversation's`;
    },
    /** Every step's rung is the policy's, and no rung-three verb sits among the steps. */
    rungs_from_policy: (verdict: Verdict) => {
      const id = verdict.result.plan;
      if (typeof id !== "string" || !store) return null;
      for (const s of store().steps(id)) {
        const spec = VERBS[s.verb];
        if (!spec) return `step ${s.n} names no verb`;
        if (
          s.rung === 2 &&
          rungOf({ door: s.door, role: "", writes: true, idempotent: false, cost: "job" }) === 3
        )
          return `step ${s.n} (${s.verb}) is a person's act and cannot be a step`;
      }
      return null;
    },
  };
}

export function operator(manifest: Manifest, brief: string, model: string): ReturnType<typeof stationAgent> {
  const def: StationDefinition = {
    manifest,
    brief,
    model,
    instructions:
      "You are the operator. You read what exists (the doors, the batches, the questions, the jobs), then call plan once with the steps in order, each a verb with its arguments and when it fires, then settle with one sentence restating the plan line by line. You run nothing and promise nothing: the person confirms the plan, the host runs its undoable steps under their standing grants, and the rest waits for them as proposals.",
    tools: operatorTools(),
    checks: operatorChecks(),
    briefInline: true,
    advance: false,
    settle: { phases: ["plan", "finish"] },
  };
  return stationAgent(def);
}
