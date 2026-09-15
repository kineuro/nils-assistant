// SPDX-License-Identifier: AGPL-3.0-only
// identity-check (Wave 4c §9.14, record 26): is the identity rule right for
// a dataset, and should identity come from the path instead of the tag. Read
// what the deployment registers and what the dataset declares, probe the
// current rule and a candidate side by side over the dataset's originals
// through the engine's own door, which validates every rule it takes and
// answers shapes only, read the identifier types the registry knows and the
// identifiers the dataset holds as shapes, then propose one rule that names
// a known type or a new one, with the question a path source raises
// answered explicitly: a folder that is a personal number makes the path
// directly identifying. The held shapes are read against the rule's: alike,
// they are unmapped identifiers of the rule's kind and a map releases them;
// unlike, a second kind of identifier is on this dataset. A re-digest under
// a changed rule, a map and a new type are a person's acts.

import type { JsonValue } from "@flue/runtime";
import * as v from "valibot";
import { toolResult } from "../seam/client.ts";
import { type StationDefinition, type StationTool, stationAgent } from "./agent.ts";
import type { Manifest } from "./manifest.ts";
import type { Check, Verdict } from "./verdict.ts";

/** One candidate of a probe's result, as the engine answers it: shapes and counts per source, never a value. */
export interface ProbeCandidate {
  label?: string;
  rule?: { id_type?: string; sources?: string[] };
  sources?: { source?: string; shapes?: Record<string, number>; answered?: number }[];
}

export interface Probed {
  job: number;
  /** The dataset whose originals the probe read, or null for a registered location. */
  dataset: string | null;
  location: string | null;
  rules: Record<string, unknown>[];
  at: number;
  /** The candidates the job answered, once read: the shapes each rule saw, in the order the rules were sent. */
  candidates: ProbeCandidate[] | null;
}
export interface NewType {
  name: string;
  description: string;
}
export interface Proposed {
  rule: Record<string, unknown>;
  path_is_direct_identifier: boolean | null;
  why: string;
  /** A type the registry does not know yet, proposed with the rule; a person makes it. */
  new_type: NewType | null;
  at: number;
}
/** An identifier a dataset holds, as the held door answers it: its shape, never its value. */
export interface HeldShape {
  shape: string;
  files: number;
  first_seen: string | null;
  batch: number | null;
}
/** What the held shapes are against the proposed rule's. */
export type HeldReading = "none" | "same_kind" | "second_kind" | "mixed" | "unknown";

const probes = new Map<string, Probed[]>();
const proposals = new Map<string, Proposed>();
/** The identifier types the run read, by conversation; absent when the door was never read. */
const typesRead = new Map<string, string[]>();
/** The held shapes the run read, by conversation; absent when the door was never read. */
const heldRead = new Map<string, HeldShape[]>();

export function probesOf(conversation: string): Probed[] {
  return probes.get(conversation) ?? [];
}
export function proposedOf(conversation: string): Proposed | null {
  return proposals.get(conversation) ?? null;
}
export function typesOf(conversation: string): string[] | null {
  return typesRead.get(conversation) ?? null;
}
export function heldOf(conversation: string): HeldShape[] | null {
  return heldRead.get(conversation) ?? null;
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

/** A dataset's name as the job and probe doors read it, with or without the @; null when it is not one name. */
export function datasetName(value: unknown): string | null {
  const name = typeof value === "string" ? value.trim().replace(/^@/u, "") : "";
  return name && !name.includes("/") ? name : null;
}

/** The root a probe over a dataset reads: its originals, never a path of the host (record 26). */
export function rootOf(dataset: string): string {
  return `@${dataset}/originals`;
}

/** The identifier types a types door answers, by name; a list of names or of {name}, bare or under types. */
export function typeNames(body: unknown): string[] {
  const list = Array.isArray(body) ? body : ((body as { types?: unknown } | null)?.types ?? []);
  return (Array.isArray(list) ? list : [])
    .map((t) => (typeof t === "string" ? t : String((t as { name?: unknown })?.name ?? "")))
    .filter((n) => /^[a-z][a-z0-9-]*$/u.test(n));
}

/** The shapes a held door answers, kept to shape and counts; a list, bare or under held. */
export function heldShapesOf(body: unknown): HeldShape[] {
  const list = Array.isArray(body) ? body : ((body as { held?: unknown } | null)?.held ?? []);
  return (Array.isArray(list) ? list : []).flatMap((h) => {
    const o = (h ?? {}) as Record<string, unknown>;
    if (typeof o.shape !== "string" || !o.shape) return [];
    return [
      {
        shape: o.shape,
        files: typeof o.files === "number" ? o.files : 0,
        first_seen: typeof o.first_seen === "string" ? o.first_seen : null,
        batch: typeof o.batch === "number" ? o.batch : null,
      },
    ];
  });
}

/** The shapes a candidate's sources answered with, from the probe's own result. */
export function shapesOf(candidate: ProbeCandidate | undefined): string[] {
  const out = new Set<string>();
  for (const s of candidate?.sources ?? []) for (const k of Object.keys(s.shapes ?? {})) out.add(k);
  return [...out];
}

/**
 * What the dataset's held identifiers are against the rule's shapes: none when nothing is held; the same kind
 * when every held shape is one the rule answered with, so a map releases them and no rule change would; a
 * second kind when none is, so another identifier is on this dataset; mixed when both; unknown when the
 * rule's shapes could not be read. A map is needed whenever identifiers of the rule's kind are held.
 */
export function heldReading(
  held: HeldShape[],
  ruleShapes: string[] | null,
): { reading: HeldReading; map_needed: boolean } {
  if (held.length === 0) return { reading: "none", map_needed: false };
  if (ruleShapes === null) return { reading: "unknown", map_needed: false };
  const alike = held.filter((h) => ruleShapes.includes(h.shape)).length;
  if (alike === held.length) return { reading: "same_kind", map_needed: true };
  if (alike === 0) return { reading: "second_kind", map_needed: false };
  return { reading: "mixed", map_needed: true };
}

/** The candidate of a probe that stands for a rule: by its place in the rules sent, the engine answering them in order. */
export function candidateFor(probed: Probed[], rule: Record<string, unknown>): ProbeCandidate | null {
  for (const p of probed) {
    const i = p.rules.findIndex((r) => same(r, rule));
    if (i >= 0 && p.candidates?.[i]) return p.candidates[i];
  }
  return null;
}

/** A dataset as the sources door lists it, kept to what the station may read: no path, no value. */
function datasetView(src: Record<string, unknown>): Record<string, unknown> {
  const trees = (src.trees ?? {}) as {
    originals?: Record<string, unknown> | null;
    anon?: Record<string, unknown>;
  };
  const count = (t: Record<string, unknown> | null | undefined, k: string) =>
    typeof t?.[k] === "number" ? (t[k] as number) : null;
  return {
    name: String(src.name ?? src.place ?? ""),
    arrives: src.arrives ?? null,
    identity: src.identity ?? null,
    unmapped: src.unmapped ?? null,
    held: src.held ?? null,
    originals: trees.originals ? { files: count(trees.originals, "files") } : null,
    anon: trees.anon ? { files: count(trees.anon, "files") } : null,
  };
}

/** A probe's candidates as the model reads them: the diagnostics' counts without their samples. */
function candidatesView(result: unknown): JsonValue {
  const doc = result as { candidates?: unknown } | null;
  if (!Array.isArray(doc?.candidates)) return (result ?? null) as JsonValue;
  return {
    ...(doc as Record<string, unknown>),
    candidates: doc.candidates.map((c) => {
      const cand = (c ?? {}) as Record<string, unknown>;
      const diagnostics = Object.fromEntries(
        Object.entries((cand.diagnostics ?? {}) as Record<string, { count?: unknown }>).map(([k, d]) => [
          k,
          { count: typeof d?.count === "number" ? d.count : 0 },
        ]),
      );
      return { ...cand, diagnostics };
    }),
  } as JsonValue;
}

export function identityCheckTools(): StationTool[] {
  return [
    {
      name: "nils_capabilities",
      description:
        "What this deployment registers: the ingest locations and datasets by name (a probe takes a name, never a path), the packs, the doors.",
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
      name: "nils_dataset",
      description:
        "A dataset as the registry declares it, by name: what arrives (identified, deidentified or coded), its current identity rule (the one the probe compares against), whether an unmapped identifier is held or coded, how many files and identifiers it holds, and whether it has an originals tree. Never a path.",
      input: v.object({ dataset: v.string() }),
      phases: ["read"],
      salient: ["dataset"],
      async run(args, ctx) {
        const name = datasetName(args.dataset);
        if (name === null)
          return { output: { refused: true, why: "a dataset is one name, as the sources door lists it" } };
        const a = await ctx.seam.call({
          method: "GET",
          path: "/api/sources",
          toolCallId: ctx.toolCallId,
          phase: ctx.state.phase,
        });
        if (a.kind !== "ok") return { output: toolResult(a).output };
        const body = a.body as { sources?: unknown } | unknown[];
        const list = (Array.isArray(body) ? body : (body?.sources ?? [])) as Record<string, unknown>[];
        const found = list.find((s) => String(s?.name ?? s?.place ?? "") === name);
        if (!found) {
          const names = list.map((s) => String(s?.name ?? s?.place ?? "")).filter(Boolean);
          return {
            output: {
              refused: true,
              why: `no dataset named ${name}; the datasets are ${names.join(", ") || "none"}`,
            } as JsonValue,
          };
        }
        return { output: datasetView(found) as JsonValue };
      },
    },
    {
      name: "nils_identifier_types",
      description:
        "The identifier types the registry knows, by name, with what each stands for. A proposed rule's id_type is one of them, or the proposal names a new type with a description for a person to make.",
      input: v.object({}),
      phases: ["read", "diagnose"],
      async run(_args, ctx) {
        const a = await ctx.seam.call({
          method: "GET",
          path: "/api/linkage/types",
          toolCallId: ctx.toolCallId,
          phase: ctx.state.phase,
        });
        if (a.kind !== "ok") return { output: toolResult(a).output };
        const names = typeNames(a.body);
        typesRead.set(ctx.conversation, names);
        const list = Array.isArray(a.body) ? a.body : ((a.body as { types?: unknown })?.types ?? []);
        const types = (Array.isArray(list) ? list : []).map((t) =>
          typeof t === "string"
            ? { name: t, description: null }
            : {
                name: String((t as { name?: unknown })?.name ?? ""),
                description: ((t as { description?: unknown })?.description ?? null) as JsonValue,
              },
        );
        return { output: { types } as JsonValue };
      },
    },
    {
      name: "nils_held",
      description:
        "The identifiers a dataset holds because the linkage store does not know them, as shapes (digits as 9, letters as A) with how many files each holds, when it was first seen and in which batch. Never a value. Read against the shape the rule answered with: alike, they are unmapped identifiers of the rule's kind and a map releases them; unlike, a second kind of identifier is on this dataset.",
      input: v.object({ dataset: v.string() }),
      phases: ["read", "diagnose"],
      salient: ["dataset"],
      async run(args, ctx) {
        const name = datasetName(args.dataset);
        if (name === null)
          return {
            output: {
              refused: true,
              why: "a dataset is one name, as the sources door lists it",
            } as JsonValue,
          };
        const a = await ctx.seam.call({
          method: "GET",
          path: `/api/linkage/held?place=${encodeURIComponent(name)}`,
          toolCallId: ctx.toolCallId,
          phase: ctx.state.phase,
        });
        if (a.kind !== "ok") return { output: toolResult(a).output };
        const held = heldShapesOf(a.body);
        heldRead.set(ctx.conversation, held);
        return {
          output: {
            dataset: name,
            held,
            text:
              held.length === 0
                ? "nothing is held on this dataset"
                : "compare each shape with the shape the rule's source answers in the probe",
          } as unknown as JsonValue,
        };
      },
    },
    {
      name: "nils_probe",
      description:
        'Probe candidate identity rules side by side over a bounded sample of a dataset\'s originals (or of a registered location), as a job: the engine validates every rule, reads the sample once and traces each rule over it, and answers per candidate the shape histogram of each source, whether the identity is constant, the subject and study counts, never a value. Give the current rule first (the dataset\'s own, or the default) and the candidate second. A rule is an object {"id_type": one of the registry\'s identifier types or a new lowercase-and-hyphens name, "code": "verbatim" when the value is the subject code itself, "from": [sources tried in order]}; a source is {"field": "PatientID"} (a DICOM keyword) or {"path": {"segment": 1}} (the nth directory under the root, counted from one), each with an optional "pattern", a regular expression whose named group (?<id>...) is the identifier, for example "^(?<id>[A-Z]{3}[0-9]{3})$". The default rule is {"id_type": "patient-id", "from": [{"field": "PatientID"}]}.',
      input: v.object({
        dataset: v.optional(v.string()),
        location: v.optional(v.string()),
        rules: v.array(v.record(v.string(), v.unknown())),
        sample: v.optional(v.number()),
      }),
      phases: ["diagnose"],
      salient: ["dataset", "location", "rules"],
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
        const dataset = args.dataset === undefined ? null : datasetName(args.dataset);
        const location =
          typeof args.location === "string" && args.location.trim() ? args.location.trim() : null;
        if (args.dataset !== undefined && dataset === null)
          return { output: { refused: true, why: "a dataset is one name, as the sources door lists it" } };
        if ((dataset === null) === (location === null))
          return {
            output: {
              refused: true,
              why: "a probe reads a dataset's originals by the dataset's name, or a registered location by its name: one of the two",
            } as JsonValue,
          };
        const where = dataset === null ? { location } : { root: rootOf(dataset) };
        const a = await ctx.seam.call({
          method: "POST",
          path: "/api/ingest/probe",
          body: { ...where, sample: Number(args.sample ?? 500), rules },
          toolCallId: ctx.toolCallId,
          phase: ctx.state.phase,
        });
        if (a.kind !== "ok") return { output: toolResult(a).output };
        const job = Number((a.body as { job?: unknown }).job);
        const list = probes.get(ctx.conversation) ?? [];
        list.push({ job, dataset, location, rules, at: Date.now(), candidates: null });
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
        // the shapes each rule saw, kept for the held reading at settle
        const probe = probesOf(ctx.conversation).find((p) => p.job === Number(args.job));
        const candidates = (body.result as { candidates?: unknown } | null)?.candidates;
        if (probe && body.state === "done" && Array.isArray(candidates))
          probe.candidates = candidates as ProbeCandidate[];
        return {
          output: {
            job: Number(args.job),
            state: body.state ?? null,
            result: probe ? candidatesView(body.result) : ((body.result ?? null) as JsonValue),
            error: (body.error ?? null) as JsonValue,
          },
        };
      },
    },
    {
      name: "propose_rule",
      description:
        "The rule you propose for this dataset, one of the rules the probe took (so the engine's own validator passed it), with why. Its id_type is one of the registry's identifier types, or new_type names it with a description for a person to make. When the rule reads a path segment, say whether that segment is a direct identifier of the person (a folder that is a personal number makes the path directly identifying): true or false, never omitted.",
      input: v.object({
        rule: v.record(v.string(), v.unknown()),
        why: v.string(),
        path_is_direct_identifier: v.optional(v.nullable(v.boolean())),
        new_type: v.optional(v.nullable(v.object({ name: v.string(), description: v.string() }))),
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
        const given = (args.new_type ?? null) as NewType | null;
        const newType =
          given?.name.trim() && given.description.trim()
            ? { name: given.name.trim(), description: given.description.trim() }
            : null;
        const types = typesOf(ctx.conversation);
        const idType = String(rule.id_type);
        if (types !== null && !types.includes(idType) && newType?.name !== idType)
          return {
            output: {
              refused: true,
              why: `the rule's id_type ${idType} is not a type the registry knows (${types.join(", ") || "none"}); name one of them, or propose it as new_type with a description`,
            } as JsonValue,
          };
        const p: Proposed = {
          rule,
          path_is_direct_identifier: typeof pid === "boolean" ? pid : null,
          why: String(args.why),
          new_type: types?.includes(idType) ? null : newType,
          at: Date.now(),
        };
        proposals.set(ctx.conversation, p);
        return { output: { recorded: true, proposed: p } as unknown as JsonValue };
      },
    },
  ];
}

/** The held reading of a conversation's proposal, from what the run read and the probe answered. */
export function heldVerdict(conversation: string): {
  held: { shapes: { shape: string; files: number }[]; reading: HeldReading } | null;
  map_needed: boolean | null;
} {
  const held = heldOf(conversation);
  if (held === null) return { held: null, map_needed: null };
  const p = proposedOf(conversation);
  const candidate = p ? candidateFor(probesOf(conversation), p.rule) : null;
  const r = heldReading(held, candidate ? shapesOf(candidate) : null);
  return {
    held: { shapes: held.map((h) => ({ shape: h.shape, files: h.files })), reading: r.reading },
    map_needed: r.map_needed,
  };
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
    /** The rule's id_type is a type the registry knows, or the verdict proposes it as a new type with a description. */
    type_named: (verdict: Verdict, ctx) => {
      const conversation = String(ctx.conversation ?? "");
      const p = proposedOf(conversation);
      if (!p) return "no rule was proposed";
      const types = typesOf(conversation);
      const overDataset = probesOf(conversation).some((pr) => pr.dataset !== null);
      if (types === null)
        return overDataset
          ? "the identifier types were not read; read them with nils_identifier_types so the rule names one"
          : null;
      const idType = String(p.rule.id_type);
      if (types.includes(idType)) return null;
      const nt = verdict.result.new_type as NewType | null | undefined;
      return nt && nt.name === idType && nt.description
        ? null
        : `the rule's id_type ${idType} is not a type the registry knows and no new type with a description is proposed`;
    },
    /** The held identifiers were read against the rule's shapes, and the sentence says what they are. */
    held_read: (verdict: Verdict, ctx) => {
      const conversation = String(ctx.conversation ?? "");
      const overDataset = probesOf(conversation).some((pr) => pr.dataset !== null);
      const held = heldOf(conversation);
      if (held === null)
        return overDataset ? "the dataset's held identifiers were not read; read them with nils_held" : null;
      const r = heldVerdict(conversation);
      const got = verdict.result.held as { reading?: unknown } | null | undefined;
      if (r.held && got?.reading !== r.held.reading)
        return `held.reading is ${r.held.reading}: ${readingWords(r.held.reading)}`;
      if (verdict.result.map_needed !== r.map_needed)
        return `map_needed is ${r.map_needed}: ${r.map_needed ? "a map releases the held files, not a rule change" : "no held identifier is of the rule's kind"}`;
      const s = String(verdict.result.sentence ?? "");
      if (r.map_needed && !/\bmap\b/u.test(s))
        return "identifiers of the rule's kind are held: the sentence says a map is needed, not a rule change";
      if (
        (r.held?.reading === "second_kind" || r.held?.reading === "mixed") &&
        !/second kind|another kind|other kind|unlike/u.test(s)
      )
        return "a held shape is unlike the rule's: the sentence says a second kind of identifier is on this dataset";
      return null;
    },
  };
}

function readingWords(r: HeldReading): string {
  switch (r) {
    case "none":
      return "nothing is held";
    case "same_kind":
      return "every held shape is one the rule answered with, unmapped identifiers of the same kind";
    case "second_kind":
      return "no held shape is one the rule answered with, a second kind of identifier on this dataset";
    case "mixed":
      return "some held shapes are the rule's kind and some are another";
    default:
      return "the rule's shapes could not be read from the probe";
  }
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
      "You are identity-check. You are given a dataset by name. Read what it declares with nils_dataset (its current identity rule is the one to compare against), the identifier types with nils_identifier_types and what it holds with nils_held; probe the current rule and one candidate side by side over the dataset's originals with nils_probe, the current rule first; read the job until it is done; propose the rule the shapes bear out with propose_rule, naming a type the registry knows or a new one, answering the path question when the rule reads a path; then settle with the dataset as location, the probe's job, what you saw per rule (shapes and counts, never a value), the proposed rule, the path answer, the new type when there is one, the held shapes with your reading of them, whether a map is needed, and one sentence that names the source the rule reads and the shape it saw and, when identifiers are held, whether they are of the rule's kind (a map is needed) or a second kind. A re-digest under the rule, a map and a new type are a person's acts, not yours. The proposals list carries one entry {kind: identity_rule, ref: {rule}, sentence}; there is no other kind.",
    tools: identityCheckTools(),
    checks: identityCheckChecks(),
    briefInline: true,
    settle: { phases: ["check", "finish"] },
    complete: async (result, ctx) => {
      const p = proposedOf(ctx.conversation);
      const probed = probesOf(ctx.conversation);
      const h = heldVerdict(ctx.conversation);
      return {
        ...result,
        dataset: result.dataset ?? probed.find((x) => x.dataset !== null)?.dataset ?? null,
        proposed: result.proposed ?? p?.rule ?? null,
        path_is_direct_identifier:
          typeof result.path_is_direct_identifier === "boolean"
            ? result.path_is_direct_identifier
            : (p?.path_is_direct_identifier ?? null),
        new_type: p?.new_type ?? result.new_type ?? null,
        held: h.held ?? result.held ?? null,
        map_needed: h.map_needed ?? result.map_needed ?? null,
        probe_jobs: probed.map((x) => x.job),
      };
    },
  };
  return stationAgent(def);
}
