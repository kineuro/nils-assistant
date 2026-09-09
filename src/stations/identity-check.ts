// SPDX-License-Identifier: AGPL-3.0-only
// identity-check (Wave 4c §9.14): is the identity rule right for this
// batch, and should identity come from the path instead of the tag. Read
// what the deployment registers, probe the current rule and a candidate
// side by side over a pre-registered location through the engine's own
// door, which validates every rule it takes and answers shapes only, then
// propose one rule with the question a path source raises answered
// explicitly: a folder that is a personal number makes the path directly
// identifying. A re-digest under a changed rule is a person's act.

import type { JsonValue } from "@flue/runtime";
import * as v from "valibot";
import { toolResult } from "../seam/client.ts";
import { type StationDefinition, type StationTool, stationAgent } from "./agent.ts";
import type { Manifest } from "./manifest.ts";
import type { Check, Verdict } from "./verdict.ts";

export interface Probed {
  job: number;
  location: string;
  rules: Record<string, unknown>[];
  at: number;
}
export interface Proposed {
  rule: Record<string, unknown>;
  path_is_direct_identifier: boolean | null;
  why: string;
  at: number;
}

const probes = new Map<string, Probed[]>();
const proposals = new Map<string, Proposed>();

export function probesOf(conversation: string): Probed[] {
  return probes.get(conversation) ?? [];
}
export function proposedOf(conversation: string): Proposed | null {
  return proposals.get(conversation) ?? null;
}

/** A rule reads the path when any source names a path segment. */
export function usesPath(rule: Record<string, unknown>): boolean {
  const from = Array.isArray(rule.from) ? (rule.from as Record<string, unknown>[]) : [];
  return from.some((s) => s.path !== undefined);
}

/** A code-shaped token is a shape (every digit a nine, as the probe writes them) or it is a value, which the verdict may not carry. */
export function carriesValue(text: string): string | null {
  for (const m of text.matchAll(/\b[A-Z]{2,4}[0-9]{2,6}\b/gu)) {
    const digits = m[0].replace(/[A-Z]/gu, "");
    if (!/^9+$/u.test(digits)) return m[0];
  }
  const personal = text.match(/\b(?:19|20)\d{6}-?\d{4}\b/u);
  return personal ? personal[0] : null;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** What is wrong with a rule's shape, in the words the engine would use, or null. */
export function ruleComplaint(r: Record<string, unknown>): string | null {
  if (typeof r.id_type !== "string" || !/^[a-z][a-z0-9-]*$/u.test(r.id_type))
    return 'id_type is a name of lowercase letters, digits and hyphens, such as "patient-id" or "subject-code"';
  if (r.code !== undefined && r.code !== "verbatim") return 'code is "verbatim" or absent';
  if (!Array.isArray(r.from) || r.from.length === 0) return "from is a list of one source or more";
  for (const [i, src] of (r.from as Record<string, unknown>[]).entries()) {
    const hasField = typeof src?.field === "string";
    const seg = (src?.path as { segment?: unknown } | undefined)?.segment;
    const hasPath = typeof seg === "number" && Number.isInteger(seg) && seg >= 1;
    if (hasField === hasPath)
      return `from[${i}] is {"field": "<DICOM keyword>"} or {"path": {"segment": n}}, one of the two`;
    if (src.pattern !== undefined && (typeof src.pattern !== "string" || !src.pattern.includes("(?<id>")))
      return `from[${i}].pattern needs the named group (?<id>...) around the identifier`;
  }
  return null;
}

export function identityCheckTools(): StationTool[] {
  return [
    {
      name: "nils_capabilities",
      description:
        "What this deployment registers: the ingest locations by name (a probe takes a name, never a path), the packs, the doors.",
      input: v.object({}),
      phases: ["read"],
      async run(_args, ctx) {
        const a = await ctx.seam.call({
          method: "GET",
          path: "/api/capabilities",
          toolCallId: ctx.toolCallId,
          phase: ctx.state.phase,
        });
        if (a.kind !== "ok") return { output: toolResult(a).output };
        const body = a.body as { ingest_roots?: string[]; packs?: unknown; registry?: unknown };
        return {
          output: {
            ingest_roots: body.ingest_roots ?? [],
            packs: body.packs ?? [],
            registry: body.registry ?? null,
          } as unknown as JsonValue,
        };
      },
    },
    {
      name: "nils_probe",
      description:
        'Probe candidate identity rules side by side over a bounded sample of a registered location, as a job: the engine validates every rule, reads the sample once and traces each rule over it, and answers per candidate the shape histogram of each source, whether the identity is constant, the subject and study counts, never a value. Give the current rule first and the candidate second. A rule is an object {"id_type": a lowercase-and-hyphens name such as "patient-id" or "subject-code", "code": "verbatim" when the value is the subject code itself, "from": [sources tried in order]}; a source is {"field": "PatientID"} (a DICOM keyword) or {"path": {"segment": 1}} (the nth directory under the location, counted from one), each with an optional "pattern", a regular expression whose named group (?<id>...) is the identifier, for example "^(?<id>[A-Z]{3}[0-9]{3})$". The default rule is {"id_type": "patient-id", "from": [{"field": "PatientID"}]}.',
      input: v.object({
        location: v.string(),
        rules: v.array(v.record(v.string(), v.unknown())),
        sample: v.optional(v.number()),
      }),
      phases: ["diagnose"],
      salient: ["location", "rules"],
      async run(args, ctx) {
        const rules = args.rules as Record<string, unknown>[];
        for (const [i, r] of rules.entries()) {
          // the grammar, checked here so a malformed rule spends no call of the grant; the engine's validator is still the one that counts
          const bad = ruleComplaint(r);
          if (bad) return { output: { refused: true, why: `rules[${i}]: ${bad}` } as JsonValue };
        }
        if (rules.length < 2)
          return {
            output: {
              refused: true,
              why: "a probe compares the current rule and a candidate: two rules at least",
            } as JsonValue,
          };
        const a = await ctx.seam.call({
          method: "POST",
          path: "/api/ingest/probe",
          body: { location: String(args.location), sample: Number(args.sample ?? 500), rules },
          toolCallId: ctx.toolCallId,
          phase: ctx.state.phase,
        });
        if (a.kind !== "ok") return { output: toolResult(a).output };
        const job = Number((a.body as { job?: unknown }).job);
        const list = probes.get(ctx.conversation) ?? [];
        list.push({ job, location: String(args.location), rules, at: Date.now() });
        probes.set(ctx.conversation, list);
        return {
          output: {
            job,
            state: (a.body as { state?: string }).state ?? "queued",
            text: "read the job with nils_job until it is done; the result is shapes only",
          } as JsonValue,
        };
      },
    },
    {
      name: "nils_job",
      description:
        "A job by id: its state, and once done its result. For a probe: per candidate, per source, the shape histogram and how many files answered, were empty, unparsed or unread; identity_constant; subjects and studies.",
      input: v.object({ job: v.number() }),
      phases: ["diagnose", "propose"],
      salient: ["job"],
      async run(args, ctx) {
        const a = await ctx.seam.call({
          method: "GET",
          path: `/api/jobs/${Number(args.job)}`,
          toolCallId: ctx.toolCallId,
          phase: ctx.state.phase,
        });
        if (a.kind !== "ok") return { output: toolResult(a).output };
        const body = a.body as { state?: string; result?: unknown; error?: unknown };
        return {
          output: {
            job: Number(args.job),
            state: body.state ?? null,
            result: (body.result ?? null) as JsonValue,
            error: (body.error ?? null) as JsonValue,
          },
        };
      },
    },
    {
      name: "propose_rule",
      description:
        "The rule you propose for this batch, one of the rules the probe took (so the engine's own validator passed it), with why, and, when it reads a path segment, whether that segment is a direct identifier of the person (a folder that is a personal number makes the path directly identifying): true or false, never omitted.",
      input: v.object({
        rule: v.record(v.string(), v.unknown()),
        why: v.string(),
        path_is_direct_identifier: v.optional(v.nullable(v.boolean())),
      }),
      phases: ["propose"],
      async run(args, ctx) {
        const rule = args.rule as Record<string, unknown>;
        const probed = probesOf(ctx.conversation).flatMap((p) => p.rules);
        if (!probed.some((r) => same(r, rule)))
          return {
            output: {
              refused: true,
              why: "the proposed rule is not one the probe took; probe it first, so the engine's validator has passed it",
            } as JsonValue,
          };
        const pid = args.path_is_direct_identifier as boolean | null | undefined;
        if (usesPath(rule) && typeof pid !== "boolean")
          return {
            output: {
              refused: true,
              why: "the rule reads a path segment: say whether that segment is a direct identifier, true or false",
            } as JsonValue,
          };
        const p: Proposed = {
          rule,
          path_is_direct_identifier: typeof pid === "boolean" ? pid : null,
          why: String(args.why),
          at: Date.now(),
        };
        proposals.set(ctx.conversation, p);
        return { output: { recorded: true, proposed: p } as unknown as JsonValue };
      },
    },
  ];
}

export function identityCheckChecks(): Record<string, Check> {
  return {
    /** The proposed rule passed the engine's own validator, called: it is one the probe took. */
    rule_validated: (verdict: Verdict, ctx) => {
      const conversation = String(ctx.conversation ?? "");
      const p = proposedOf(conversation);
      if (!p) return "no rule was proposed";
      if (!same(verdict.result.proposed, p.rule))
        return "the result's proposed rule is not the one propose_rule recorded";
      return probesOf(conversation).some((pr) => pr.rules.some((r) => same(r, p.rule)))
        ? null
        : "the proposed rule was never probed";
    },
    /** The verdict names the rule it applied and what it saw: a source and a shape. */
    names_rule_and_saw: (verdict: Verdict) => {
      const s = String(verdict.result.sentence ?? "");
      const saw = verdict.result.saw;
      if (!/\b(PatientID|PatientName|path segment \d|field|segment)\b/u.test(s))
        return "the sentence names no source the rule read";
      if (!Array.isArray(saw) || saw.length === 0)
        return "saw is the list of what the probe showed per rule, shapes and counts";
      return null;
    },
    /** No identifier value anywhere: shapes only, as the probe answers them. */
    no_identifier_value: (verdict: Verdict) => {
      const found = carriesValue(JSON.stringify(verdict.result));
      return found ? `the verdict carries a value, not a shape: ${found.replace(/[0-9]/gu, "9")}` : null;
    },
    /** A path source answers the direct-identifier question explicitly. */
    path_answered: (verdict: Verdict, ctx) => {
      const p = proposedOf(String(ctx.conversation ?? ""));
      if (!p) return "no rule was proposed";
      if (usesPath(p.rule) && typeof verdict.result.path_is_direct_identifier !== "boolean")
        return "the rule reads a path segment and path_is_direct_identifier is not answered";
      return null;
    },
  };
}

export function identityCheck(
  manifest: Manifest,
  brief: string,
  model: string,
): ReturnType<typeof stationAgent> {
  const def: StationDefinition = {
    manifest,
    brief,
    model,
    instructions:
      "You are identity-check. Read the deployment's ingest locations; probe the current rule and one candidate side by side over the location you were given, the current rule first; read the job until it is done; propose the rule the shapes bear out with propose_rule, answering the path question when the rule reads a path; then settle with the location, the probe's job, what you saw per rule (shapes and counts, never a value), the proposed rule, the path answer and one sentence that names the source the rule reads and the shape it saw. A re-digest under the rule is a person's act, not yours.",
    tools: identityCheckTools(),
    checks: identityCheckChecks(),
    settle: { phases: ["check", "finish"] },
    complete: async (result, ctx) => {
      const p = proposedOf(ctx.conversation);
      const jobs = probesOf(ctx.conversation).map((x) => x.job);
      return {
        ...result,
        proposed: result.proposed ?? p?.rule ?? null,
        path_is_direct_identifier:
          typeof result.path_is_direct_identifier === "boolean"
            ? result.path_is_direct_identifier
            : (p?.path_is_direct_identifier ?? null),
        probe_jobs: jobs,
      };
    },
  };
  return stationAgent(def);
}
