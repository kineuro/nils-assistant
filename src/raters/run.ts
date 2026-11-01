// SPDX-License-Identifier: AGPL-3.0-only
// The rater of site participation (Wave 7b step 5, the sealed read's model-first path): a raters' campaign read
// blind through the engine's campaign doors, one item at a time, through the assistant's configured model server,
// so a site needs nothing outside its install. The loop is the 7b audit runner's (nils-design
// studies/2026-10-14-blind-audit/tools/audit_raters_7b.py, cmd_read and read_one): claim as a rater, the item's
// why must say blind, the header, one model call with thinking on by default and one retry on an illegal answer,
// the joint JSON answer on every asked axis. The run reads as the person who started it: the assistant holds no
// identity of its own against the engine (the desk hands it the person's token per request), so that person is the
// draw's rater and may not settle. Nothing of an item is kept or logged: counts only.

import { splitReasoning } from "../host/reasoning.ts";
import { type ChatAnswer, type ChatCall, ChatFailed } from "../providers/kvasir.ts";
import type { Answer as DoorAnswer, Seam } from "../seam/client.ts";
import { type Answer, type Constraints, violations } from "./legal.ts";
import { packetFromDoors, Refused } from "./packet.ts";
import { composePrompt, extendSchema, type Question, type Vocabulary } from "./prompt.ts";
import { CONSTRAINTS_TEXT, PROMPT_V34, REGISTERED_SHA256, SCHEMA_TEXT } from "./registered.ts";
import {
  campaignOf,
  campaignValue,
  earlierOf,
  questionValues,
  type ValueCounts,
  valueCounts,
} from "./values.ts";

/** The header certificate's axes, asked where the campaign does not say its own (config-7b.json). */
export const AXES = ["provenance", "technique", "modifier", "construct", "base"];

/** The model call's settings, the runner's: no sampling, the longest answer the catalog allows, half an hour. */
export const CALL = { temperature: 0, maxTokens: 65_536, timeoutMs: 1_800_000 };
const BACKOFF_MS = [15_000, 30_000, 45_000];

export interface RaterDeps {
  /** The seam of the run's conversation: the person's token, the rater station's grant, the ledger. */
  seam: Seam;
  /** One structured model call through Kvasir. */
  chat: (call: ChatCall) => Promise<ChatAnswer>;
  /** The wait between model attempts; a test shortens it. */
  sleep?: (ms: number) => Promise<void>;
  /** Where a count line goes (never an item). */
  say?: (line: string) => void;
}

export interface RaterCounts extends ValueCounts {
  claimed: number;
  answered: number;
  not_blind: number;
  legal_first: number;
  retried: number;
  illegal_final: number;
  length_stops: number;
  refused_packets: number;
  door_refused: number;
  fields_unplaced: number;
  model_errors: number;
  completion_tokens: number;
  seconds: number;
}

export type RaterState = "queued" | "running" | "done" | "refused" | "failed";

export interface RaterRun {
  id: string;
  campaign: string;
  conversation: string;
  principal: string;
  model: string;
  thinking: boolean;
  state: RaterState;
  started_at: string;
  settled_at: string | null;
  /** Why the run refused or failed: a reason, never an item. */
  error: string | null;
  counts: RaterCounts;
  /** What the prompt was composed from, once the campaign was read. */
  vocabulary: Vocabulary | null;
  axes: string[];
}

export class Stop extends Error {}

function freshCounts(): RaterCounts {
  return {
    claimed: 0,
    answered: 0,
    not_blind: 0,
    legal_first: 0,
    retried: 0,
    illegal_final: 0,
    length_stops: 0,
    refused_packets: 0,
    door_refused: 0,
    fields_unplaced: 0,
    model_errors: 0,
    completion_tokens: 0,
    seconds: 0,
    ...valueCounts(),
  };
}

const sum = (t: Record<string, number>) => Object.values(t).reduce((a, b) => a + b, 0);

/** What the status door answers: counts and the run's settings, nothing of the items. */
export function raterRunView(run: RaterRun): Record<string, unknown> {
  const c = run.counts;
  return {
    run: run.id,
    campaign: run.campaign,
    conversation: run.conversation,
    principal: run.principal,
    model: run.model,
    thinking: run.thinking,
    state: run.state,
    done: run.state === "done" || run.state === "refused" || run.state === "failed",
    started_at: run.started_at,
    settled_at: run.settled_at,
    error: run.error,
    claimed: c.claimed,
    answered: c.answered,
    refused: c.refused_packets + c.door_refused + c.not_blind,
    cant_tell: sum(c.cant_tell_cells),
    errors: c.model_errors + (run.state === "failed" ? 1 : 0),
    counts: { ...c, seconds: Math.round(c.seconds * 10) / 10 },
    axes: run.axes,
    prompt: {
      prompt_sha256: REGISTERED_SHA256.PROMPT_V34,
      schema_sha256: REGISTERED_SHA256.SCHEMA_TEXT,
      constraints_sha256: REGISTERED_SHA256.CONSTRAINTS_TEXT,
      vocabulary: run.vocabulary,
    },
  };
}

/** A door's refusal or error as a reason: the status and the engine's sentence, never a body of an item. */
function reasonOf(a: DoorAnswer, what: string): string {
  switch (a.kind) {
    case "blocked":
      return `${what}: blocked, ${a.reason}`;
    case "refused": {
      const e = (a.body as { error?: unknown } | null)?.error;
      return `${what}: ${a.status}${typeof e === "string" ? ` ${e}` : ""}`;
    }
    case "error":
      return `${what}: ${a.reason}`;
    case "ok":
      return what;
  }
}

async function door(
  seam: Seam,
  method: "GET" | "POST",
  path: string,
  body: unknown,
  id: string,
  what: string,
): Promise<Record<string, unknown>> {
  const a = await seam.call({ method, path, body, toolCallId: id, phase: "read" });
  if (a.kind !== "ok") throw new Stop(reasonOf(a, what));
  return (a.body ?? {}) as Record<string, unknown>;
}

interface Read {
  answer: Answer | null;
  text: string | null;
  legalFirst: boolean;
  legalFinal: boolean;
  calls: ChatAnswer[];
  seconds: number;
}

/** The model's answer parsed: reasoning a runtime left inline is not the answer. */
function parse(text: string | null): Answer | null {
  if (text === null) return null;
  try {
    const v = JSON.parse(splitReasoning(text).text.trim()) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Answer) : null;
  } catch {
    return null;
  }
}

/** The reader of one item: the prompt, the packet, the call with its retries, one more call on an illegal answer. */
export class Reader {
  readonly system: string;
  readonly schema: Record<string, unknown>;
  readonly vocabulary: Vocabulary;
  private readonly constraints: Constraints;
  private readonly served: Record<string, Set<string>>;
  constructor(
    question: Question | null,
    served: Record<string, Set<string>>,
    private readonly o: { model: string; thinking: boolean; maxTokens: number },
    private readonly deps: RaterDeps,
    private readonly counts: RaterCounts,
  ) {
    const p = composePrompt(PROMPT_V34, question);
    this.system = p.text;
    this.vocabulary = p.vocabulary;
    this.schema = extendSchema(JSON.parse(SCHEMA_TEXT) as Record<string, unknown>, question);
    this.constraints = JSON.parse(CONSTRAINTS_TEXT) as Constraints;
    this.served = served;
  }

  private async call(messages: ChatCall["messages"]): Promise<ChatAnswer> {
    let last = "no answer";
    for (let attempt = 0; attempt < BACKOFF_MS.length; attempt++) {
      try {
        return await this.deps.chat({
          model: this.o.model,
          messages,
          schema: this.schema,
          thinking: this.o.thinking,
          maxTokens: this.o.maxTokens,
          temperature: CALL.temperature,
          timeoutMs: CALL.timeoutMs,
        });
      } catch (e) {
        this.counts.model_errors += 1;
        const f = e instanceof ChatFailed ? e : new ChatFailed(null, e instanceof Error ? e.name : "fault");
        last = f.message;
        if (f.status !== null && [401, 403, 404].includes(f.status)) break;
        if (attempt + 1 < BACKOFF_MS.length)
          await (this.deps.sleep ?? sleepFor)(BACKOFF_MS[attempt] as number);
      }
    }
    throw new Stop(`the model server gave no answer (${last}); the lease is kept and a new run resumes`);
  }

  async read(packet: unknown): Promise<Read> {
    const t0 = Date.now();
    const messages: ChatCall["messages"] = [
      { role: "system", content: this.system },
      { role: "user", content: `The stack:\n\`\`\`json\n${JSON.stringify(packet, null, 1)}\n\`\`\`` },
    ];
    const calls: ChatAnswer[] = [];
    const once = async () => {
      const r = await this.call(messages);
      calls.push(r);
      const ans = parse(r.content);
      const v = ans ? violations(ans, this.constraints, this.served) : ["not JSON"];
      return { text: r.content, ans, v };
    };
    let { text, ans, v } = await once();
    const first = v.length === 0;
    if (!first) {
      // the runner's one retry on an illegal answer
      messages.push(
        { role: "assistant", content: text ?? "" },
        {
          role: "user",
          content: `That answer breaks the pack's rules: ${v.join("; ")}. Answer again with a legal combination (use cant_tell on an axis you cannot settle).`,
        },
      );
      ({ text, ans, v } = await once());
    }
    return {
      answer: ans,
      text,
      legalFirst: first,
      legalFinal: v.length === 0,
      calls,
      seconds: (Date.now() - t0) / 1000,
    };
  }
}

const sleepFor = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The whole read of one campaign, until the campaign offers nothing more or the run stops. */
export async function readCampaign(run: RaterRun, deps: RaterDeps): Promise<void> {
  const { seam } = deps;
  const c = run.counts;
  const base = `/api/campaigns/${encodeURIComponent(run.campaign)}`;
  run.state = "running";
  const say = deps.say ?? (() => {});
  try {
    const doc = await door(seam, "GET", base, undefined, `rater-${run.id}-campaign`, "the campaign");
    const { axes, legal } = questionValues(doc, AXES);
    run.axes = axes;
    const question = (campaignOf(doc).question ?? null) as Question | null;
    const earlier = earlierOf(doc);
    const reader = new Reader(
      question,
      legal,
      { model: run.model, thinking: run.thinking, maxTokens: CALL.maxTokens },
      deps,
      c,
    );
    run.vocabulary = reader.vocabulary;
    say(
      `nils-assistant: rater run ${run.id} on campaign ${run.campaign}: ${axes.length} axes, vocabulary from the ${reader.vocabulary.source}, model ${run.model}, thinking ${run.thinking ? "on" : "off"}`,
    );
    for (let n = 0; ; n++) {
      const got = await door(
        seam,
        "POST",
        `${base}/claim`,
        { role: "rater" },
        `rater-${run.id}-claim-${n}`,
        "the claim",
      );
      const asg = got.assignment as { id?: unknown } | null;
      const item = got.item as { id?: unknown; stack_id?: unknown } | null;
      if (!asg || !item || asg.id === undefined || item.id === undefined) break;
      c.claimed += 1;
      const items = `${base}/items/${encodeURIComponent(String(item.id))}`;
      const why = await door(
        seam,
        "GET",
        `${items}/why`,
        undefined,
        `rater-${run.id}-why-${n}`,
        "the item's why",
      );
      if (why.blind !== true) {
        c.not_blind += 1;
        // the lease is given back, so the campaign is not held by a run that reads nothing
        await seam.call({
          method: "POST",
          path: `${base}/assignments/${encodeURIComponent(String(asg.id))}/release`,
          toolCallId: `rater-${run.id}-release-${n}`,
          phase: "read",
        });
        run.state = "refused";
        run.error =
          "the item's why does not say blind: true; nothing is read. The rater reads only a campaign made to suggest none (a raters' campaign of an audit draw).";
        break;
      }
      const header = await door(
        seam,
        "GET",
        `${items}/header`,
        undefined,
        `rater-${run.id}-header-${n}`,
        "the item's header",
      );
      let note: string;
      let answer: Answer | null = null;
      try {
        const { packet, unplaced } = packetFromDoors(
          item.stack_id,
          header,
          why as Parameters<typeof packetFromDoors>[2],
        );
        c.fields_unplaced += unplaced;
        const r = await reader.read(packet);
        answer = r.answer;
        c.legal_first += r.legalFirst ? 1 : 0;
        c.retried += r.legalFirst ? 0 : 1;
        c.illegal_final += r.legalFinal ? 0 : 1;
        c.length_stops += r.calls.filter((x) => x.finish_reason === "length").length;
        c.seconds += r.seconds;
        c.completion_tokens += r.calls.reduce((a, x) => a + x.completion_tokens, 0);
        note = `rater (${r.calls.at(-1)?.model ?? run.model}), blind header read`;
      } catch (e) {
        if (!(e instanceof Refused)) throw e;
        // nothing goes to the model: the item is answered can't tell on every axis, so the settle puts it before
        // the person (a can't tell is a difference), and the count says why
        c.refused_packets += 1;
        note = "rater: the packet was refused by the identifier guard, not read";
      }
      const value = campaignValue(answer, axes, legal, c, earlier);
      const answerPath = `${base}/assignments/${encodeURIComponent(String(asg.id))}/answer`;
      const a = await seam.call({
        method: "POST",
        path: answerPath,
        body: { value, why: note },
        toolCallId: `rater-${run.id}-answer-${n}`,
        phase: "read",
      });
      if (a.kind === "refused" && [400, 409, 422].includes(a.status)) {
        // the question refused the joint answer: can't tell on every axis, counted; a person settles it
        c.door_refused += 1;
        const all = JSON.stringify(Object.fromEntries([...axes].sort().map((x) => [x, "cant_tell"])));
        const again = await seam.call({
          method: "POST",
          path: answerPath,
          body: { value: all, why: `${note}; the question refused the model's answer` },
          toolCallId: `rater-${run.id}-answer-again-${n}`,
          phase: "read",
        });
        if (again.kind !== "ok") throw new Stop(reasonOf(again, "the answer"));
      } else if (a.kind !== "ok") throw new Stop(reasonOf(a, "the answer"));
      c.answered += 1;
    }
    if (run.state === "running") run.state = "done";
  } catch (e) {
    run.state = "failed";
    run.error = e instanceof Stop ? e.message : `the run stopped: ${e instanceof Error ? e.name : "fault"}`;
  }
  run.settled_at = new Date().toISOString();
  say(
    `nils-assistant: rater run ${run.id} ${run.state}: claimed ${c.claimed}, answered ${c.answered}, refused ${c.refused_packets + c.door_refused + c.not_blind}, cant_tell cells ${sum(c.cant_tell_cells)}, model errors ${c.model_errors}${run.error ? `; ${run.error}` : ""}`,
  );
}

/** The rater runs of this process: one at a time per campaign, read back by the person who started each. */
export class RaterRuns {
  private readonly runs = new Map<string, RaterRun>();

  /** The run reading a campaign now, if any. */
  running(campaign: string): RaterRun | null {
    for (const r of this.runs.values())
      if (r.campaign === campaign && (r.state === "queued" || r.state === "running")) return r;
    return null;
  }

  start(
    o: { campaign: string; conversation: string; principal: string; model: string; thinking: boolean },
    deps: RaterDeps,
  ): RaterRun {
    const id = `rater-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const run: RaterRun = {
      id,
      ...o,
      state: "queued",
      started_at: new Date().toISOString(),
      settled_at: null,
      error: null,
      counts: freshCounts(),
      vocabulary: null,
      axes: [],
    };
    this.runs.set(id, run);
    void readCampaign(run, deps);
    return run;
  }

  get(id: string): RaterRun | null {
    return this.runs.get(id) ?? null;
  }
}
