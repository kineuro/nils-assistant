// SPDX-License-Identifier: AGPL-3.0-only
// The stub model of the offline bench (bench/offline.ts): a pi provider with
// no network that plays a station's model by a fixed policy, reading only what
// the model would read (the person's message and the tools' answers in the
// context) and calling the station's own tools. It stands in for the model so
// that the engine's doors, the station's tools and checks, and a question
// set's expectations are tried together without one; what it measures is the
// plumbing, never a model. The number a station earns is the live measure's
// (bench/measure.ts).
//
// The policy of identity-check follows its brief: read the dataset, the
// identifier types and the held shapes; probe the current rule beside the
// candidate the person named (a path segment by default); read the job;
// propose the path's rule when the tag is a placeholder, else the current
// rule; propose the merge of the first pair the probe found alike; settle.

import type { AssistantMessageEvent, Context } from "@earendil-works/pi-ai";
import { createProvider, type Model, type Provider } from "@earendil-works/pi-ai";
import {
  type HeldShape,
  heldReading,
  type ProbeCandidate,
  shapeCounts,
} from "../src/stations/identity-check.ts";

type Api = "openai-completions";

/** One response of the stub: tool calls, run side by side, or the final text; `wait` first, in milliseconds. */
export type Step =
  | { calls: { tool: string; args: Record<string, unknown> }[]; wait?: number }
  | { text: string };

function msg(content: unknown[], stop: "toolUse" | "stop") {
  return {
    role: "assistant" as const,
    content,
    api: "openai-completions" as const,
    provider: "stub",
    model: "stub",
    usage: {
      input: 100,
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 110,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: stop,
    timestamp: Date.now(),
  };
}

/** A provider under a station's own id whose model `stub` answers by `policy`. */
export function stubProvider(id: string, policy: (context: Context) => Step): Provider<Api> {
  const model: Model<Api> = {
    id: "stub",
    name: "stub",
    api: "openai-completions",
    provider: id as never,
    baseUrl: "http://stub.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 131072,
    maxTokens: 4096,
  };
  let n = 0;
  const stream = (_m: Model<Api>, context: Context) => {
    const next = policy(context);
    return (async function* (): AsyncGenerator<AssistantMessageEvent> {
      if ("calls" in next) {
        if (next.wait) await new Promise((r) => setTimeout(r, next.wait));
        const calls = next.calls.map((c) => {
          n += 1;
          return { type: "toolCall" as const, id: `stub_${n}`, name: c.tool, arguments: c.args };
        });
        const partial = msg(calls, "toolUse");
        yield { type: "start", partial } as never;
        for (const [i, call] of calls.entries()) {
          yield { type: "toolcall_start", contentIndex: i, partial } as never;
          yield { type: "toolcall_end", contentIndex: i, toolCall: call, partial } as never;
        }
        yield { type: "done", reason: "toolUse", message: partial } as never;
      } else {
        const partial = msg([{ type: "text", text: next.text }], "stop");
        yield { type: "start", partial } as never;
        yield { type: "text_start", contentIndex: 0, partial } as never;
        yield { type: "text_delta", contentIndex: 0, delta: next.text, partial } as never;
        yield { type: "text_end", contentIndex: 0, content: next.text, partial } as never;
        yield { type: "done", reason: "stop", message: partial } as never;
      }
    })();
  };
  return createProvider<Api>({
    id,
    name: id,
    auth: { apiKey: { name: "none", resolve: async () => ({ auth: { apiKey: "stub" } }) } },
    models: [model],
    api: { stream: stream as never, streamSimple: stream as never },
  });
}

/** The person's words: every user message's text, joined. */
function said(context: Context): string {
  return context.messages
    .filter((m) => m.role === "user")
    .map((m) =>
      typeof m.content === "string"
        ? m.content
        : m.content.map((c) => (c.type === "text" ? c.text : "")).join("\n"),
    )
    .join("\n");
}

/** What a tool answered, by name, oldest first, as parsed JSON (the text when it is not JSON). */
function answers(context: Context): Map<string, unknown[]> {
  const out = new Map<string, unknown[]>();
  for (const m of context.messages) {
    if (m.role !== "toolResult") continue;
    const text = m.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    let doc: unknown = text;
    try {
      doc = JSON.parse(text);
    } catch {
      // kept as text
    }
    const list = out.get(m.toolName) ?? [];
    list.push(doc);
    out.set(m.toolName, list);
  }
  return out;
}

/** The phase the run is in, by the last advance the station took. */
function phaseOf(seen: Map<string, unknown[]>): string {
  const advanced = (seen.get("advance") ?? []) as { phase?: string }[];
  return [...advanced].reverse().find((a) => typeof a?.phase === "string")?.phase ?? "read";
}

const DEFAULT_RULE = { id_type: "patient-id", from: [{ field: "PatientID" }] };
const PATH_RULE = {
  id_type: "subject-code",
  code: "verbatim",
  from: [{ path: { segment: 1 }, pattern: "^(?<id>.+)$" }],
};

/** The source a rule's first source names, as a sentence names it. */
function sourceWords(rule: { from?: { field?: string; path?: { segment?: number } }[] }): string {
  const first = rule.from?.[0];
  return first?.field ?? `path segment ${first?.path?.segment ?? 1}`;
}

/** The shape a candidate answered on the most files. */
function topShape(c: ProbeCandidate | undefined): { shape: string; files: number } | null {
  const counts = Object.entries(shapeCounts(c)).sort((a, b) => b[1] - a[1]);
  return counts[0] ? { shape: counts[0][0], files: counts[0][1] } : null;
}

/** identity-check's policy. */
export function identityCheckPolicy(context: Context): Step {
  const text = said(context);
  const dataset = /dataset:\s*(\S+)/u.exec(text)?.[1] ?? null;
  const location = /location:\s*(\S+)/u.exec(text)?.[1] ?? null;
  const candidate = /candidate:\s*(.+)/u.exec(text)?.[1]?.trim() ?? null;
  const seen = answers(context);
  const phase = phaseOf(seen);
  const last = (tool: string) => {
    const l = seen.get(tool);
    return (l ? l[l.length - 1] : undefined) as Record<string, unknown> | undefined;
  };

  // read
  if (!seen.has("nils_dataset") && !seen.has("nils_capabilities")) {
    if (location) return { calls: [{ tool: "nils_capabilities", args: {} }] };
    if (!dataset) return { calls: [{ tool: "nils_dataset", args: {} }] };
    return {
      calls: [
        { tool: "nils_dataset", args: { dataset } },
        { tool: "nils_identifier_types", args: {} },
        { tool: "nils_held", args: { dataset } },
      ],
    };
  }
  const ds = last("nils_dataset");
  if (!location && ds?.refused) {
    // a path for a dataset, or a name the registry does not know: list the datasets once, then say so
    if (!seen.has("nils_dataset") || (seen.get("nils_dataset") ?? []).length < 2)
      if (String(ds.why ?? "").includes("one name")) return { calls: [{ tool: "nils_dataset", args: {} }] };
    return { text: `I cannot check that: ${String(ds.why ?? "no such dataset")}. Name one of the datasets.` };
  }
  if (!location && !dataset) {
    const names = (ds?.datasets as string[] | undefined) ?? [];
    return { text: `Which dataset? The datasets are ${names.join(", ") || "none"}.` };
  }
  if (!location && Array.isArray(ds?.datasets))
    return {
      text: `I cannot check that: a dataset is one name. The datasets are ${ds.datasets.join(", ")}.`,
    };

  // diagnose
  const current = (ds?.identity as Record<string, unknown> | null | undefined) ?? DEFAULT_RULE;
  const field = candidate && /^[A-Z][A-Za-z]+$/u.test(candidate) ? candidate : null;
  const other = field ? { id_type: String(current.id_type ?? "patient-id"), from: [{ field }] } : PATH_RULE;
  const rules = [current, other];
  if (phase === "read") return { calls: [{ tool: "advance", args: { to: "diagnose" } }] };
  const probe = last("nils_probe");
  if (!probe) {
    const where = location ? { location } : { dataset };
    return { calls: [{ tool: "nils_probe", args: { ...where, rules } }] };
  }
  if (probe.refused) return { text: `The probe was refused: ${String(probe.why ?? "")}` };
  const job = last("nils_job") as { state?: string; result?: { candidates?: ProbeCandidate[] } } | undefined;
  if (job?.state !== "done") {
    if (job?.state === "failed") return { text: "The probe failed." };
    return { calls: [{ tool: "nils_job", args: { job: probe.job } }], wait: job ? 1500 : 800 };
  }
  const cands = job.result?.candidates ?? [];
  const constant = Boolean(
    (cands[0] as { identity_constant?: { constant?: boolean } })?.identity_constant?.constant,
  );
  const choice = constant ? 1 : 0;
  const rule = rules[choice] as Record<string, unknown>;
  const usesPath = rule === PATH_RULE;
  const types = ((last("nils_identifier_types")?.types as { name: string }[] | undefined) ?? []).map(
    (t) => t.name,
  );
  const idType = String(rule.id_type);
  const newType =
    types.length > 0 && !types.includes(idType)
      ? { name: idType, description: "a subject's code, read from the folder each subject's files are in" }
      : null;
  const pairs = (cands[0]?.alike?.pairs ?? []) as { subjects: [string, string] }[];

  // propose
  if (phase === "diagnose") return { calls: [{ tool: "advance", args: { to: "propose" } }] };
  if (phase === "propose") {
    if (!seen.has("propose_rule")) {
      const calls: { tool: string; args: Record<string, unknown> }[] = [
        {
          tool: "propose_rule",
          args: {
            rule,
            why: constant
              ? "the tag holds one value across the sample, a placeholder; the folder answers one code per subject"
              : "the rule's source answers one identifier per subject",
            ...(usesPath ? { path_is_direct_identifier: false } : {}),
            ...(newType ? { new_type: newType } : {}),
          },
        },
      ];
      if (pairs.length > 0)
        calls.push({
          tool: "propose_merge",
          args: {
            subjects: pairs[0].subjects,
            why: "the same birth date and sex, and visits on the same days",
          },
        });
      return { calls };
    }
    return { calls: [{ tool: "advance", args: { to: "check" } }] };
  }

  // check, then settle
  const top = topShape(cands[choice]);
  const held = ((last("nils_held")?.held as HeldShape[] | undefined) ?? null) as HeldShape[] | null;
  const reading = held ? heldReading(held, shapeCounts(cands[choice])) : null;
  const words = [
    `${sourceWords(rule as never)} answered ${top?.shape ?? "nothing"} on ${top?.files ?? 0} files`,
  ];
  if (reading?.reading === "same_kind" || reading?.reading === "mixed")
    words.push("the held files carry identifiers of the rule's kind, so a map is needed, not a rule change");
  if (reading?.reading === "second_kind" || reading?.reading === "mixed")
    words.push("a held shape is unlike the rule's: a second kind of identifier is on this dataset");
  if (pairs.length > 0)
    words.push(
      "two subjects share birth date, sex and visits, and their merge is proposed for a person to make",
    );
  const sentence = `${words.join("; ")}.`;
  const saw = cands.map((c, i) => {
    const t = topShape(c);
    return {
      rule: `rules[${i}]`,
      source: sourceWords(rules[i] as never),
      shape: t?.shape ?? null,
      answered: t?.files ?? 0,
    };
  });
  return {
    calls: [
      {
        tool: "settle",
        args: {
          result: {
            location: location ?? dataset,
            dataset: location ? null : dataset,
            saw,
            proposed: rule,
            path_is_direct_identifier: usesPath ? false : null,
            new_type: newType,
            sentence,
          },
          proposals: [{ kind: "identity_rule", ref: { rule }, sentence }],
          sentence,
        },
      },
    ],
  };
}
