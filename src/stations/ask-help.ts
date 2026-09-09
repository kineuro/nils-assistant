// SPDX-License-Identifier: AGPL-3.0-only
// ask-help (Wave 4c §9.11): words to a document, or one step of a document
// tuned. The tools are the engine's ask doors through the seam, one per
// operation the grant names, opened by phase; the checks are the five the
// manifest names; the only write is a document version.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { JsonValue } from "@flue/runtime";
import * as v from "valibot";
import type { Answer, Seam } from "../seam/client.ts";
import { toolResult } from "../seam/client.ts";
import { subjectOfConversation } from "../seam/for.ts";
import { type StationDefinition, type StationTool, stationAgent } from "./agent.ts";
import type { Manifest } from "./manifest.ts";
import { catalogOf, prelude } from "./prelude.ts";
import { closest } from "./select.ts";
import type { Check, Verdict } from "./verdict.ts";

const handleOf = (a: Answer): number[] =>
  a.kind === "ok" && typeof (a.body as { handle?: unknown })?.handle === "number"
    ? [(a.body as { handle: number }).handle]
    : [];
const documentOf = (a: Answer): number[] =>
  a.kind === "ok" && typeof (a.body as { document?: unknown })?.document === "number"
    ? [(a.body as { document: number }).document]
    : [];

/** The preview compacted for a small model: the level, the columns and the first rows without the technical columns, never the declaration block. */
export function compactPreview(body: unknown): JsonValue {
  const b = body as {
    level?: string;
    columns?: (string | { name: string })[];
    rows?: unknown[][];
    truncated?: boolean;
  };
  const cols = (b.columns ?? []).map((c) => (typeof c === "string" ? c : c.name));
  const keep = cols.map((c) => !c.startsWith("_"));
  return {
    level: b.level ?? null,
    columns: cols.filter((_, i) => keep[i]),
    rows: (b.rows ?? []).slice(0, 10).map((r) => (Array.isArray(r) ? r.filter((_, i) => keep[i]) : r)),
    truncated: b.truncated ?? false,
  } as JsonValue;
}

/**
 * The tools of ask-help, five and no more (the refinement for the local
 * model): one draft that answers the handle, the diagnosis and a preview at
 * once, the value sampler, the stored document, and the two doors a
 * follow-up may still want on their own. The guide and the catalog are in
 * the instructions; options, apply, diff, validate and describe stay doors
 * of the seam for the checks and the settle, never a choice the model makes.
 */
export function askHelpTools(): StationTool[] {
  const door = (
    name: string,
    description: string,
    input: v.GenericSchema<Record<string, unknown>, unknown>,
    phases: string[],
    dial: (seam: Seam, args: Record<string, unknown>, toolCallId: string, phase: string) => Promise<Answer>,
    opts: { salient?: string[] } = {},
  ): StationTool => ({
    name,
    description,
    input,
    phases,
    salient: opts.salient,
    async run(args, ctx) {
      const a = await dial(ctx.seam, args, ctx.toolCallId, ctx.state.phase);
      return { output: toolResult(a).output, evidence: { handles: handleOf(a), documents: documentOf(a) } };
    },
  });
  const doc = {
    document_id: v.optional(v.number()),
    document: v.optional(v.record(v.string(), v.unknown())),
  };
  const withDoc = (args: Record<string, unknown>) =>
    args.document_id !== undefined ? { document_id: args.document_id } : { document: args.document };
  return [
    {
      name: "nils_draft",
      description:
        "Store a whole document written as YAML. It is repaired where it can be and stored when it validates, and the answer carries three things: the document's handle, its diagnosis (the funnel set by set) and a preview (the count, or the first rows). A refused draft names the path and the issue: fix exactly that and draft again.",
      input: v.object({ text: v.string() }),
      phases: ["shape", "refine"],
      async run(args, ctx) {
        const drafted = await ctx.seam.door(
          "/api/ask/draft",
          "POST",
          { text: args.text },
          { toolCallId: ctx.toolCallId, phase: ctx.state.phase },
        );
        const output = toolResult(drafted).output;
        const documents = documentOf(drafted);
        if (documents.length === 0) return { output, evidence: { handles: [], documents } };
        const previewed = await ctx.seam.door(
          "/api/ask/preview",
          "POST",
          { document_id: documents[0], rows: 10 },
          { toolCallId: `${ctx.toolCallId}-preview`, phase: ctx.state.phase, rows: 10 },
        );
        const preview: JsonValue =
          previewed.kind === "ok"
            ? compactPreview(previewed.body)
            : { unavailable: previewed.kind === "blocked" ? previewed.reason : previewed.kind };
        return {
          output: { ...(output as Record<string, JsonValue>), preview },
          evidence: { handles: handleOf(previewed), documents },
        };
      },
    },
    {
      name: "nils_values",
      description:
        "A sample of what one field holds at a level, under your own scope. An axis (base, technique, modifier, and the others the registry lists) is not a field: its values are answered from the registry as listed.",
      input: v.object({ level: v.string(), field: v.string(), limit: v.optional(v.number()) }),
      phases: ["resolve", "shape", "refine"],
      salient: ["level", "field"],
      async run(args, ctx) {
        const name = String(args.field).replace(/^axis\./u, "");
        const axis = catalogOf(subjectOfConversation(ctx.conversation))?.axes?.find((a) => a.name === name);
        if (axis)
          return {
            output: {
              axis: axis.name,
              values: axis.values.map((x) => x.id),
              note: 'an axis, answered from the registry; compare it with ["axis", {}, "' + axis.name + '"]',
            } as JsonValue,
          };
        const a = await ctx.seam.call({
          method: "GET",
          path: `/api/ask/catalog/${encodeURIComponent(String(args.level))}/${encodeURIComponent(String(args.field))}/values?limit=${Number(args.limit ?? 20)}`,
          toolCallId: ctx.toolCallId,
          phase: ctx.state.phase,
          rows: Number(args.limit ?? 20),
        });
        return { output: toolResult(a).output, evidence: { handles: handleOf(a), documents: documentOf(a) } };
      },
    },
    door(
      "nils_document",
      "A stored document by its handle, with its parent: the base of a follow-up.",
      v.object({ document_id: v.number() }),
      ["resolve", "shape", "refine", "check"],
      (s, a, id, phase) =>
        s.call({ method: "GET", path: `/api/ask/documents/${Number(a.document_id)}`, toolCallId: id, phase }),
      { salient: ["document_id"] },
    ),
    door(
      "nils_diagnose",
      "Why a stored document answers as it does: the funnel set by set, the drops, the ties, a zero-row explanation. The draft already answered this for the document it stored.",
      v.object(doc),
      ["check", "refine"],
      (s, a, id, phase) => s.door("/api/ask/diagnose", "POST", withDoc(a), { toolCallId: id, phase }),
      { salient: ["document_id"] },
    ),
    door(
      "nils_preview",
      "Ten rows of a stored document's answer, or its count. The draft already answered this for the document it stored.",
      v.object({ ...doc, rows: v.optional(v.number()) }),
      ["check"],
      (s, a, id, phase) =>
        s.door(
          "/api/ask/preview",
          "POST",
          { ...withDoc(a), rows: Math.min(10, Number(a.rows ?? 10)) },
          { toolCallId: id, phase, rows: 10 },
        ),
      { salient: ["document_id"] },
    ),
  ];
}

const SQL =
  /\bselect\b[\s\S]{0,600}?\bfrom\b|\b(?:insert\s+into|delete\s+from|update\s+\w+\s+set|create\s+table|drop\s+table)\b/iu;

/** The five checks of the manifest. */
export function askHelpChecks(): Record<string, Check> {
  return {
    validate_clean: async (verdict: Verdict, ctx) => {
      // a refusal carries no document to validate
      if (verdict.result.document === null || verdict.result.document === undefined) return null;
      const seam = ctx.seam as Seam;
      const a = await seam.call({
        method: "POST",
        path: "/api/ask/validate",
        body: { document_id: verdict.result.document, mode: "strict" },
        toolCallId: `check-${Date.now()}`,
        phase: "finish",
      });
      if (a.kind !== "ok")
        return `validate did not answer clean: ${a.kind === "blocked" ? a.reason : a.kind === "error" ? a.reason : JSON.stringify(a.body).slice(0, 200)}`;
      const body = a.body as { valid?: boolean; hash?: string; issues?: unknown[] };
      if (body.valid === false || (body.issues?.length ?? 0) > 0)
        return `the document has issues: ${JSON.stringify(body.issues).slice(0, 200)}`;
      if (body.hash && body.hash !== verdict.result.hash)
        return `the verdict's hash ${String(verdict.result.hash).slice(0, 12)} is not the document's ${body.hash.slice(0, 12)}`;
      return null;
    },
    declaration_full: (verdict: Verdict) => {
      if (verdict.result.document === null || verdict.result.document === undefined) return null;
      const d = verdict.result.declaration as Record<string, unknown> | undefined;
      const need = [
        "grain",
        "session_scheme",
        "membership",
        "key_namespace",
        "pick_rule",
        "denominator",
        "disclosure",
      ];
      if (!d) return "the declaration block is missing";
      const missing = need.filter((k) => d[k] === undefined || d[k] === null || d[k] === "");
      return missing.length ? `the declaration block lacks ${missing.join(", ")}` : null;
    },
    no_sql: (verdict: Verdict) =>
      SQL.test(JSON.stringify(verdict.result)) ? "the verdict carries SQL; a document is the answer" : null,
    no_truncated_handle: async (verdict: Verdict, ctx) => {
      const seam = ctx.seam as Seam;
      for (const h of verdict.evidence.handles) {
        const a = await seam.call({
          method: "GET",
          path: `/api/ask/handles/${h}`,
          toolCallId: `check-${h}`,
          phase: "finish",
        });
        if (a.kind === "ok" && (a.body as { truncated?: boolean }).truncated)
          return `handle ${h} is truncated and may not be cited`;
      }
      return null;
    },
    no_identifier_value: (verdict: Verdict) => {
      const text = JSON.stringify(verdict.result);
      if (/\b\d{8}-?\d{4}\b/u.test(text) || /\b\d+(?:\.\d+){5,}\b/u.test(text))
        return "the verdict carries an identifier value";
      return null;
    },
  };
}

/** The result completed mechanically: the hash from validate, the declaration from describe, on the document the model names. */
export async function completeResult(
  result: Record<string, unknown>,
  ctx: { seam: Seam; conversation: string },
): Promise<Record<string, unknown>> {
  // a refusal (section 9.11): no document, but the choices a person can take (the closest listed names); anything else needs a stored document
  if (result.document === undefined || result.document === null) {
    const choices = Array.isArray(result.choices) ? result.choices : [];
    if (choices.length === 0)
      throw new Error("document is the handle of a stored document; a refusal without one names the choices");
    return { ...result, document: null, hash: null, declaration: null };
  }
  const document = Number(result.document);
  if (!Number.isInteger(document)) throw new Error("document is the handle of a stored document");
  const validated = await ctx.seam.call({
    method: "POST",
    path: "/api/ask/validate",
    body: { document_id: document, mode: "strict" },
    toolCallId: `settle-validate-${document}`,
    phase: "finish",
  });
  if (validated.kind !== "ok") throw new Error(`validate did not answer for document ${document}`);
  const described = await ctx.seam.call({
    method: "POST",
    path: "/api/ask/describe",
    body: { document_id: document },
    toolCallId: `settle-describe-${document}`,
    phase: "finish",
  });
  if (described.kind !== "ok") throw new Error(`describe did not answer for document ${document}`);
  const hash = (validated.body as { hash?: string }).hash ?? result.hash;
  const declaration = (described.body as { declaration?: unknown }).declaration ?? result.declaration ?? {};
  return { ...result, document, hash, declaration };
}

/**
 * The cookbook: worked examples shipped beside the brief, each a question in
 * words and the document that answers it, in the YAML the draft tool takes.
 * They are the loop split of the bench and nothing from the held-out split,
 * which a test asserts; the model starts from the closest one and changes
 * only what the words change.
 */
export function cookbook(dir: string): { file: string; question: string; text: string }[] {
  let files: string[] = [];
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith(".ask.yml"))
      .sort();
  } catch {
    return [];
  }
  return files.map((file) => {
    const raw = readFileSync(join(dir, file), "utf8");
    const question = /^# question: (.*)$/mu.exec(raw)?.[1] ?? file;
    const text = raw
      .split("\n")
      .filter((l) => !l.startsWith("# SPDX") && !l.startsWith("# question:"))
      .join("\n")
      .trim();
    return { file, question, text };
  });
}

export function renderCookbook(
  items: { question: string; text: string }[],
  title = "Worked examples: a question in words, and the document that answers it",
): string {
  if (items.length === 0) return "";
  return `## ${title}\n${items
    .map((c, i) => `### Example ${i + 1}: ${c.question}\n\`\`\`yaml\n${c.text}\n\`\`\``)
    .join("\n\n")}`;
}

export function askHelp(manifest: Manifest, brief: string, model: string): ReturnType<typeof stationAgent> {
  const items = cookbook(join(manifest.dir, "cookbook"));
  const def: StationDefinition = {
    manifest,
    brief,
    model,
    instructions:
      "You are ask-help. Your brief follows, then the registry: its grains, the fields of each level, the axes and their values, the event kinds, the cohorts, the derived fields, and the engine's grounding. The worked examples closest to the question arrive with the question. Never SQL, never rows in your words, never a name the registry does not list.",
    tools: askHelpTools(),
    checks: askHelpChecks(),
    settle: { phases: ["shape", "check", "finish"] },
    advance: false,
    briefInline: true,
    complete: completeResult,
    context: (seam, ctx) => prelude(seam, subjectOfConversation(ctx.conversation), ctx),
    // the small-model selector: the four examples closest to the words, with the question, never the whole cookbook
    examples: (message) =>
      renderCookbook(
        closest(message, items, 4),
        "The worked examples closest to this question, the closest first: start from it",
      ),
  };
  return stationAgent(def);
}
