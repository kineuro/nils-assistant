// SPDX-License-Identifier: AGPL-3.0-only
// The baseline, one shot (Wave 4c §9.10): the model reads the engine's guide
// and one question, writes an ask document, the engine runs it, and the
// content hash is compared to the gold. Through Kvasir's pi-messages door
// when KVASIR_URL is set, and every answer is recorded into gate/fixtures/
// as pi's event stream; without it, the recording is replayed, so the number
// is reproducible from the repository alone. Both splits are reported.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AssistantMessageEvent } from "@earendil-works/pi-ai";
import { parse } from "yaml";
import { type Fixture, last, recorded, textOf } from "./gate/replay.ts";
import { report } from "./manifest/split.ts";

const nils = (process.env.NILS_URL ?? "http://127.0.0.1:8437").replace(/\/+$/u, "");
const nilsToken = process.env.NILS_TOKEN;
const kvasir = process.env.KVASIR_URL?.replace(/\/+$/u, "");
const kvasirToken = process.env.KVASIR_TOKEN;
const model = process.env.MODEL ?? "recorded";
const purpose = process.env.KVASIR_PURPOSE;
const root = process.cwd();
const fixturesDir = join(root, "bench", "gate", "fixtures");
const tag = model.replace(/[^a-z0-9.-]+/giu, "-");

interface Shape {
  id: string;
  question: string;
  rebased: { status: string; gold?: string };
}
const shapes = (
  parse(readFileSync(join(root, "bench", "corpus", "shapes.yml"), "utf8")) as { shapes: Shape[] }
).shapes.filter((s) => s.rebased.gold);
const expect = JSON.parse(readFileSync(join(root, "bench", "gold", "expect.json"), "utf8")) as Record<
  string,
  { content_hash: string | null; row_count: number }
>;

async function engine(path: string, body: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(`${nils}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(nilsToken ? { authorization: `Bearer ${nilsToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return (await r.json()) as Record<string, unknown>;
}

const guide = (await (
  await fetch(`${nils}/api/ask/guide`, { headers: nilsToken ? { authorization: `Bearer ${nilsToken}` } : {} })
).json()) as Record<string, unknown>;
const catalog = (await (
  await fetch(`${nils}/api/ask/catalog`, {
    headers: nilsToken ? { authorization: `Bearer ${nilsToken}` } : {},
  })
).json()) as Record<string, unknown>;
const grounding = JSON.stringify({
  grounding: guide.grounding,
  examples: guide.examples,
  cohorts: catalog.cohorts,
  kinds: catalog.kinds,
  axes: catalog.axes,
  derived: catalog.derived,
  functions: catalog.functions,
  levels: catalog.levels,
});

const SYSTEM = `You write ask documents for a research registry. Answer with one JSON object, the document, and nothing else: no prose, no code fence. The grammar, the worked examples and the catalog follow.\n${grounding}`;

/** One shot through Kvasir's door, the events kept for the recording. */
async function live(question: string): Promise<AssistantMessageEvent[]> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (kvasirToken) headers.authorization = `Bearer ${kvasirToken}`;
  if (purpose) headers["x-kvasir-purpose"] = purpose;
  const r = await fetch(`${kvasir}/v1/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      context: {
        systemPrompt: SYSTEM,
        messages: [{ role: "user", content: question, timestamp: Date.now() }],
      },
      options: { temperature: 0, maxTokens: 4096 },
    }),
  });
  if (!r.ok || !r.body) throw new Error(`Kvasir answered ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const events: AssistantMessageEvent[] = [];
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let at = buffer.indexOf("\n\n");
    while (at >= 0) {
      const frame = buffer.slice(0, at);
      buffer = buffer.slice(at + 2);
      const data = frame
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("");
      if (data) events.push(JSON.parse(data));
      at = buffer.indexOf("\n\n");
    }
  }
  return events;
}

function documentOf(text: string): unknown {
  const t = text
    .trim()
    .replace(/^```(?:json)?/u, "")
    .replace(/```$/u, "")
    .trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end < 0) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

const results: { id: string; passed: boolean; why: string }[] = [];
for (const s of shapes) {
  const file = join(fixturesDir, `baseline-${tag}-${s.id}.json`);
  let events: AssistantMessageEvent[];
  if (kvasir) {
    events = await live(s.question);
    const fixture: Fixture = {
      id: `baseline-${tag}-${s.id}`,
      question: s.question,
      model,
      recorded_at: new Date().toISOString().slice(0, 10),
      attempts: [{ events }],
    };
    mkdirSync(fixturesDir, { recursive: true });
    writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`);
  } else if (existsSync(file)) {
    const fixture = JSON.parse(readFileSync(file, "utf8")) as Fixture;
    events = fixture.attempts[0].events;
  } else {
    results.push({ id: s.id, passed: false, why: "no recording; set KVASIR_URL to make one" });
    continue;
  }
  const message = await last(
    recorded({ id: s.id, question: s.question, model, recorded_at: "", attempts: [{ events }] }).stream(),
  );
  const document = documentOf(textOf(message));
  let passed = false;
  let why = "";
  if (!document) why = "no JSON document in the answer";
  else {
    // unnamed: a named handle is unique in the registry and the baseline runs again and again
    const ran = await engine("/api/ask/run", { document });
    const want = expect[s.rebased.gold!];
    if (ran.error) why = `the engine refused: ${String(ran.error).slice(0, 120)}`;
    else if (ran.truncated) why = "truncated";
    else if (want?.content_hash && ran.content_hash === want.content_hash) passed = true;
    else why = `${ran.row_count} rows, hash differs from the gold's ${want?.row_count} rows`;
  }
  results.push({ id: s.id, passed, why });
  console.log(`${s.id}: ${passed ? "pass" : `FAIL (${why})`}`);
}
const two = report((id) => results.find((r) => r.id === id)?.passed ?? false, results);
const all = results.filter((r) => r.passed).length;
console.log(
  `${model}: ${all} of ${results.length} (${((100 * all) / Math.max(1, results.length)).toFixed(1)} percent); loop ${two.loop.passed}/${two.loop.of}, held out ${two.held_out.passed}/${two.held_out.of}`,
);
writeFileSync(
  join(root, "bench", "gate", `baseline-${tag}.json`),
  `${JSON.stringify({ model, at: new Date().toISOString().slice(0, 10), results, loop: two.loop, held_out: two.held_out }, null, 2)}\n`,
);
