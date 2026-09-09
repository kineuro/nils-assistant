// SPDX-License-Identifier: AGPL-3.0-only
// ask-help (Wave 4c §9.11): words to a document, or one step of a document
// tuned. The tools are the engine's ask doors through the seam, one per
// operation the grant names, opened by phase; the checks are the five the
// manifest names; the only write is a document version.

import * as v from "valibot";
import type { Answer, Seam } from "../seam/client.ts";
import { toolResult } from "../seam/client.ts";
import { type StationDefinition, type StationTool, stationAgent } from "./agent.ts";
import type { Manifest } from "./manifest.ts";
import type { Check, Verdict } from "./verdict.ts";

const handleOf = (a: Answer): number[] =>
  a.kind === "ok" && typeof (a.body as { handle?: unknown })?.handle === "number"
    ? [(a.body as { handle: number }).handle]
    : [];
const documentOf = (a: Answer): number[] =>
  a.kind === "ok" && typeof (a.body as { document?: unknown })?.document === "number"
    ? [(a.body as { document: number }).document]
    : [];

/** The tools of ask-help: each names the door it dials and the phases it opens in. */
export function askHelpTools(): StationTool[] {
  const door = (
    name: string,
    description: string,
    input: v.GenericSchema<Record<string, unknown>, unknown>,
    phases: string[],
    dial: (seam: Seam, args: Record<string, unknown>, toolCallId: string, phase: string) => Promise<Answer>,
    opts: { salient?: string[]; completes?: string } = {},
  ): StationTool => ({
    name,
    description,
    input,
    phases,
    salient: opts.salient,
    completes: opts.completes,
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
    door(
      "nils_guide",
      "The rules a document obeys, two worked examples and the schema digest. Read it first.",
      v.object({}),
      ["resolve", "shape", "refine", "check"],
      (s, _a, id, phase) => s.door("/api/ask/guide", "GET", undefined, { toolCallId: id, phase }),
    ),
    door(
      "nils_catalog",
      "What the registry holds at one level: its fields, or every level when absent.",
      v.object({ level: v.optional(v.string()) }),
      ["resolve", "shape", "refine"],
      (s, a, id, phase) =>
        a.level
          ? s.call({
              method: "GET",
              path: `/api/ask/catalog/${encodeURIComponent(String(a.level))}`,
              toolCallId: id,
              phase,
            })
          : s.door("/api/ask/catalog", "GET", undefined, { toolCallId: id, phase }),
      { salient: ["level"] },
    ),
    door(
      "nils_values",
      "A sample of what a field holds at a level, under your own scope: resolve a name here before you use it.",
      v.object({ level: v.string(), field: v.string(), limit: v.optional(v.number()) }),
      ["resolve", "shape", "refine"],
      (s, a, id, phase) =>
        s.call({
          method: "GET",
          path: `/api/ask/catalog/${encodeURIComponent(String(a.level))}/${encodeURIComponent(String(a.field))}/values?limit=${Number(a.limit ?? 20)}`,
          toolCallId: id,
          phase,
          rows: Number(a.limit ?? 20),
        }),
      { salient: ["level", "field"] },
    ),
    door(
      "nils_store",
      "Store a whole document you composed, as JSON, and get its handle; a document that does not validate is refused with its issues. Start from the closest worked example and change only what the words change.",
      v.object({ document: v.record(v.string(), v.unknown()) }),
      ["shape", "refine"],
      (s, a, id, phase) =>
        s.door("/api/ask/documents", "POST", { document: a.document }, { toolCallId: id, phase }),
    ),
    door(
      "nils_draft",
      "A whole document as text (YAML or JSON) when you start from words or no move reaches what you need; repaired where it can be, stored when it validates, else its diagnosis.",
      v.object({ text: v.string() }),
      ["shape", "refine"],
      (s, a, id, phase) => s.door("/api/ask/draft", "POST", { text: a.text }, { toolCallId: id, phase }),
    ),
    door(
      "nils_validate",
      "Validate a document strictly: its hash, or the issues.",
      v.object({ ...doc, mode: v.optional(v.picklist(["strict", "repair"])) }),
      ["shape", "refine", "check"],
      (s, a, id, phase) =>
        s.door(
          "/api/ask/validate",
          "POST",
          { ...withDoc(a), mode: a.mode ?? "strict" },
          { toolCallId: id, phase },
        ),
      { salient: ["document_id"] },
    ),
    door(
      "nils_describe",
      "One sentence per set, the conventions, and the declaration block: the six decisions the document takes.",
      v.object(doc),
      ["shape", "refine", "check"],
      (s, a, id, phase) => s.door("/api/ask/describe", "POST", withDoc(a), { toolCallId: id, phase }),
      { salient: ["document_id"] },
    ),
    door(
      "nils_options",
      "The typed moves one set may take, with stable ids and legal fillers; apply by id, never by rewriting.",
      v.object({ document_id: v.number(), set: v.string() }),
      ["refine"],
      (s, a, id, phase) =>
        s.door(
          "/api/ask/options",
          "POST",
          { document_id: a.document_id, set: a.set },
          { toolCallId: id, phase },
        ),
      { salient: ["document_id", "set"] },
    ),
    door(
      "nils_apply",
      "Apply moves by id to a stored document, atomically, against the token options answered; a new document handle comes back. items counts the moves.",
      v.object({
        document_id: v.number(),
        epoch: v.number(),
        token: v.string(),
        set: v.string(),
        moves: v.array(
          v.object({ move_id: v.number(), args: v.optional(v.record(v.string(), v.unknown())) }),
        ),
        items: v.number(),
      }),
      ["refine"],
      (s, a, id, phase) =>
        s.door(
          "/api/ask/apply",
          "POST",
          { document_id: a.document_id, epoch: a.epoch, token: a.token, set: a.set, moves: a.moves },
          { toolCallId: id, phase },
        ),
      { salient: ["document_id", "set", "moves"], completes: "moves" },
    ),
    door(
      "nils_diagnose",
      "Why a document answers as it does: the funnel set by set, the drops, the ties, a zero-row explanation. Before anything changes.",
      v.object(doc),
      ["check", "refine"],
      (s, a, id, phase) => s.door("/api/ask/diagnose", "POST", withDoc(a), { toolCallId: id, phase }),
      { salient: ["document_id"] },
    ),
    door(
      "nils_preview",
      "Ten rows of the answer, or the count, by the document's level.",
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
    door(
      "nils_diff",
      "One diff over the canonical form of two documents, by id.",
      v.object({ a: v.number(), b: v.number() }),
      ["refine", "check"],
      (s, a, id, phase) =>
        s.door(
          "/api/ask/diff",
          "POST",
          { a: { document_id: a.a }, b: { document_id: a.b } },
          { toolCallId: id, phase },
        ),
    ),
    door(
      "nils_document",
      "A stored document by its handle, with its parent.",
      v.object({ document_id: v.number() }),
      ["resolve", "shape", "refine", "check"],
      (s, a, id, phase) =>
        s.call({ method: "GET", path: `/api/ask/documents/${Number(a.document_id)}`, toolCallId: id, phase }),
      { salient: ["document_id"] },
    ),
  ];
}

const SQL = /\b(select|from|where|join)\b[\s\S]*\b(select|from|where|join)\b/iu;

/** The five checks of the manifest. */
export function askHelpChecks(): Record<string, Check> {
  return {
    validate_clean: async (verdict: Verdict, ctx) => {
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

export function askHelp(manifest: Manifest, brief: string, model: string): ReturnType<typeof stationAgent> {
  const def: StationDefinition = {
    manifest,
    brief,
    model,
    instructions:
      "You are ask-help. Read the guide, resolve every name against the catalog, shape the smallest document by storing one composed from the closest worked example, refine it by moves, diagnose and preview, then settle with the document's handle and one sentence: the hash and the declaration block are filled in for you from validate and describe. Never SQL, never rows, never a guess at a name.",
    tools: askHelpTools(),
    checks: askHelpChecks(),
    settle: { phases: ["check", "finish"] },
    complete: completeResult,
  };
  return stationAgent(def);
}
