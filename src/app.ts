// SPDX-License-Identifier: AGPL-3.0-only
// The host (Wave 4c §9.2): one Node process, one Flue application, an HTTP
// surface for the desk only. It holds no credential of its own: the desk
// hands it the person's token per turn on every request and pushes a fresh
// one before expiry; Kvasir is reached with the app's minted key, one
// provider per station carrying its purpose, and the person's token beside
// the key where a person streams (record 23).

import { existsSync, readFileSync } from "node:fs";
import { instrument, observe, setProvider } from "@flue/runtime";
import { createAgentRouter } from "@flue/runtime/routing";
import { Hono } from "hono";
import { config } from "./config.ts";
import { guard, personIn } from "./host/access.ts";
import { capabilities } from "./host/capabilities.ts";
import { type Observe, watchContext } from "./host/context.ts";
import { markdownOf } from "./host/export.ts";
import {
  ForkRefused,
  firstUserMessage,
  forkStream,
  type Sql,
  settledExtent,
  sqlFor,
  streamPath,
} from "./host/fork.ts";
import { ladderOf, opens, type PolicyRow, rungOf } from "./host/ladder.ts";
import { LadderStore } from "./host/ladder-store.ts";
import type { ConversationRow, ShareRow } from "./host/lineage.ts";
import { chosenModel, modelList, setModels } from "./host/models.ts";
import { type Instructions, MemoryRefused, type Note } from "./host/notes.ts";
import { bareOf, People, type Person } from "./host/people.ts";
import { Runs } from "./host/runs.ts";
import { inboxOf, Scheduler } from "./host/scheduler.ts";
import {
  asRole,
  guards,
  maxRole,
  mayRead,
  minRole,
  principalFor,
  type Role,
  snapshotOf,
  topRole,
} from "./host/shares.ts";
import { SUMMARIZE_KEEP, SUMMARIZE_SIGNAL, summarizable, summarizeCompaction } from "./host/summarize.ts";
import {
  corrections as correctionsOf,
  KvasirRefused,
  kvasirLifecycle,
  parseRecipe,
  type ReviewItem,
  recordedBench,
  scriptRunner,
  Teaching,
  TeachingStore,
} from "./host/teaching.ts";
import { kvasirTitles, nameConversation, openingWords } from "./host/titles.ts";
import { interceptTurn } from "./host/turns.ts";
import {
  type Catalog,
  kvasirProvider,
  readCatalog,
  servedCatalog,
  watchCatalog,
} from "./providers/kvasir.ts";
import { personInstrumentation, streamingConversation } from "./providers/person.ts";
import { agentIds, delegationsOf, delegationView, registerAgent } from "./seam/delegations.ts";
import {
  engineAuthOff,
  feedbackOf,
  forgetSeam,
  probeEngineAuth,
  recordFeedback,
  registerStation,
  seamFor,
  stationList,
  subjectOfConversation,
  theLedger,
  theLineage,
  theNotes,
  tokens,
  verdicts,
} from "./seam/for.ts";
import { AskHelp } from "./stations/ask-help-agent.ts";
import { Concierge } from "./stations/concierge-agent.ts";
import { Echo } from "./stations/echo.ts";
import { IdentityCheck } from "./stations/identity-check-agent.ts";
import { KeywordTune } from "./stations/keyword-tune-agent.ts";
import { loadManifests } from "./stations/manifest.ts";
import { useLadderStore } from "./stations/operator.ts";
import { Operator } from "./stations/operator-agent.ts";
import { warmPrelude } from "./stations/prelude.ts";

const c = config();
const runs = new Runs();

// the manifests the configuration lists (section 4.4): each is validated at start, its brief's hash checked;
// a station's code registers against its manifest's id (D4 onwards). D2's echo station has none.
const manifests = loadManifests(c.stationDirs);
const model = process.env.ASSISTANT_MODEL ?? "qwen38-27b-fast";
for (const m of manifests.values())
  registerStation({
    id: m.id,
    version: c.version,
    grant: m.grant,
    ceiling: m.ceiling,
    content: m.content,
    model,
  });
// the station code, by manifest id, each a 'use agent' module the build scanned; a manifest without code is listed and refused at run time
const agents = new Map<string, Parameters<typeof createAgentRouter>[0]>();
if (manifests.has("ask-help")) agents.set("ask-help", AskHelp);
if (manifests.has("concierge")) agents.set("concierge", Concierge);
if (manifests.has("keyword-tune")) agents.set("keyword-tune", KeywordTune);
if (manifests.has("identity-check")) agents.set("identity-check", IdentityCheck);
if (manifests.has("operator")) agents.set("operator", Operator);
agents.set("echo", Echo);
// the stations a concierge may delegate to, by id (section 9.12)
for (const [id, a] of agents) registerAgent(id, a);
registerStation({
  id: "echo",
  version: c.version,
  grant: { describe: { calls: 4 }, capabilities: {} },
  ceiling: "reader",
  content: "catalog",
  model,
});

// each model call marked with the conversation it streams for, so it carries that person's token (record 23)
instrument(personInstrumentation());
/** The token of the person a model call streams for, where the desk handed one for that conversation. */
function personStreaming(): string | null {
  const conversation = streamingConversation();
  return conversation ? tokens.get(conversation) : null;
}
// Kvasir, one provider per station, the app's minted key; registered before any agent runs
const catalog: Catalog = await readCatalog(c.kvasir, c.kvasirKey).catch((e: Error) => {
  console.error(`nils-assistant: Kvasir did not answer at start: ${e.message}`);
  return { baseUrl: `${c.kvasir}/v1`, models: [] };
});
// a conversation named by the model once its first answer settles, through the title purpose (the chat, slice 10)
let titles: ReturnType<typeof kvasirTitles> = null;
/**
 * A catalog put to use: each model's window and largest answer, for compaction and the desk's meter (the chat,
 * slice 3), each station's provider, and the model a conversation is named by.
 */
function takeCatalog(next: Catalog): void {
  // where Kvasir lists no model, as where a subscription serves the purposes, the stations still name one (record 23)
  const served = servedCatalog(next, model);
  setModels(served.models);
  for (const s of stationList())
    setProvider(
      kvasirProvider({
        station: s.id,
        purpose: `assistant.${s.id}`,
        catalog: served,
        key: c.kvasirKey,
        person: personStreaming,
      }),
    );
  titles = kvasirTitles({ catalog: served, model: chosenModel(model), key: c.kvasirKey });
}
takeCatalog(catalog);
// a model an admin adds to Kvasir or removes reaches the stations without a restart (record 23)
if (process.env.NODE_ENV !== "test")
  watchCatalog({
    read: () => readCatalog(c.kvasir, c.kvasirKey),
    apply: (next) => {
      takeCatalog(next);
      console.error(`nils-assistant: Kvasir's catalog changed, and it lists ${next.models.length} models`);
    },
    had: catalog,
    every: Number(process.env.ASSISTANT_CATALOG_MS ?? 30_000),
    say: (line) => console.error(`nils-assistant: ${line}`),
  });
// how full each conversation's context is, from the runtime's own events
watchContext({ observe: observe as unknown as Observe, lineage: theLineage });

// an engine serving with its authentication off takes a turn without a token (section 5.5); anything else refuses it
if (await probeEngineAuth(c.engine))
  console.error(
    "nils-assistant: the engine serves with its authentication off; turns without a token are allowed",
  );

// the ladder (Wave 5 sections 9.1 to 9.4): standing grants, plans and the scheduler that runs them under the person's own token
const ladder = new LadderStore(c.ladder);
ladder.sweep(c.retentionDays);
useLadderStore(() => ladder);
registerStation({
  id: "scheduler",
  version: c.version,
  grant: { jobs: {}, "sessions/rebuild": {}, batches: {}, "jobs/{id}": {}, capabilities: {} },
  ceiling: "operator",
  content: "catalog",
  model: "none",
  standing: true,
});
const scheduler = new Scheduler({
  store: ladder,
  seamFor: (conversation) =>
    tokens.get(conversation) || engineAuthOffNow() ? seamFor("scheduler", conversation) : null,
  mayRun: c.requireAssistRun ? (subject) => assistRun.get(subject) === true : undefined,
});
if (process.env.NODE_ENV !== "test") scheduler.start(Number(process.env.ASSISTANT_SCHEDULER_MS ?? 15_000));
/** C49: the persons the deployment's entitlements open rung two to, read from the engine's capabilities with their token. */
const assistRun = new Map<string, boolean>();
function engineAuthOffNow(): boolean {
  return engineAuthOff;
}

// teaching (Wave 5 section 9.5): the corrections, the sets, the fine-tune job, the two gates, promotion gated;
// its seam reads the decided review items with the person's own token and nothing else
registerStation({
  id: "teaching",
  version: c.version,
  grant: { review: {}, capabilities: {} },
  ceiling: "reviewer",
  content: "catalog",
  model: "none",
  standing: true,
});
const teachingStore = new TeachingStore(c.teaching, c.teachingDir);
const teaching = new Teaching({
  store: teachingStore,
  runner: scriptRunner(new URL("../bench/finetune.py", import.meta.url).pathname),
  bench: recordedBench(new URL("../bench/gate", import.meta.url).pathname, (p) =>
    existsSync(p) ? readFileSync(p, "utf8") : null,
  ),
  backend: c.teachingBackend,
  threshold: (of) => Math.ceil(of * c.benchThreshold),
});

// who a person is and every role they hold, read from the engine's capabilities: this seam's ceiling is the highest, so an admin is named an admin (the chat, slice 6)
registerStation({
  id: "people",
  version: c.version,
  grant: { capabilities: {} },
  ceiling: "admin",
  content: "catalog",
  model: "none",
  standing: true,
});

const app = new Hono();

/** The person a request comes from, read from the engine with the token the desk sent (the chat, slice 1). */
const people = new People(async (token) => {
  if (!token && !engineAuthOff) return null;
  const conversation = `person-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  if (token) tokens.put(conversation, token);
  try {
    const a = await seamFor("people", conversation).call({
      method: "GET",
      path: "/api/capabilities",
      toolCallId: "person",
      phase: "grant",
    });
    return a.kind === "ok" ? (a.body as Record<string, unknown>) : null;
  } finally {
    tokens.forget(conversation);
    forgetSeam("people", conversation);
  }
});

/** Rows written under a person's older key become their principal's, once per process: notes, plans, conversations. */
const adopted = new Set<string>();
function adopt(p: Person): void {
  if (adopted.has(p.principal)) return;
  adopted.add(p.principal);
  const bare = bareOf(p.principal);
  theNotes().adopt(p.principal, { bare, authOff: engineAuthOff });
  ladder.adopt(p.principal, { bare, authOff: engineAuthOff });
  theLineage().adopt(p.principal, { authOff: engineAuthOff });
}

// every door that names a conversation asks who the person is and whether it is theirs, before anything else runs
app.use("*", guard({ people, lineage: theLineage, authOff: () => engineAuthOff, onPerson: adopt }));

/** The person's token, from the desk on every request; kept per conversation for the turn. */
app.use("*", async (ctx, next) => {
  const auth = ctx.req.header("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const m = /^\/agents\/[^/]+\/([^/]+)/u.exec(ctx.req.path);
  if (token && m && ctx.req.method === "POST") tokens.put(decodeURIComponent(m[1]), token);
  await next();
});

app.get("/capabilities", (ctx) =>
  ctx.json(
    capabilities(
      c,
      stationList().map((s) => {
        const m = manifests.get(s.id);
        return {
          id: s.id,
          app: m?.app ?? "nils-assistant",
          purpose: m?.purpose ?? `assistant.${s.id}`,
          content: s.content,
          ceiling: s.ceiling,
          brief: m?.brief ?? { path: "", hash: "" },
          budget: m ? { ...m.budget } : {},
          writes: m?.writes ?? [],
        };
      }),
      { teaching_open: true, conversations: 0, models: modelList() },
    ),
  ),
);

/** The desk pushes a fresh token before expiry (§5.5, 19 Q8). */
app.post("/conversations/:id/token", async (ctx) => {
  const body = (await ctx.req.json().catch(() => ({}))) as { token?: string };
  if (!body.token) return ctx.json({ error: "token" }, 400);
  const id = ctx.req.param("id");
  const h = tokens.put(id, body.token);
  // the registry's context for this person, fetched now so the first render finds it in the instructions
  void warmPrelude(seamFor("ask-help", id), personIn(ctx.req.raw)?.principal ?? subjectOfConversation(id));
  return ctx.json({ conversation: ctx.req.param("id"), expires_at: h.expiresAt });
});

/** A headless station run (§9.2). */
app.post("/stations/:id/runs", async (ctx) => {
  const station = ctx.req.param("id");
  const agent = agents.get(station);
  if (!agent) return ctx.json({ error: `no station ${station}` }, 404);
  const body = (await ctx.req.json().catch(() => ({}))) as { message?: string; conversation?: string };
  if (!body.message) return ctx.json({ error: "message" }, 400);
  const who = personIn(ctx.req.raw);
  const store = theLineage();
  // a run in a conversation is its owner's to start (the chat, slice 1)
  if (
    body.conversation &&
    (!who || store.access(body.conversation, who.principal, { authOff: engineAuthOff }) === "none")
  )
    return ctx.json({ error: `no conversation ${body.conversation}` }, 404);
  const conversation =
    body.conversation ?? `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const auth = ctx.req.header("authorization") ?? "";
  if (auth.startsWith("Bearer ")) tokens.put(conversation, auth.slice(7));
  const subject = who?.principal ?? subjectOfConversation(conversation);
  store.open({ id: conversation, station, subject, owner: who?.principal ?? null });
  // the registry's context for this person, fetched before the first render so it sits in the instructions
  await warmPrelude(seamFor(station, conversation), subject);
  const run = runs.start(station, agent, body.message, conversation);
  return ctx.json({ run: run.id, conversation, state: run.state }, 202);
});

/** A run is read by the person whose conversation it ran in (the chat, slice 1). */
function runOf(id: string, req: Request) {
  const run = runs.get(id);
  const who = personIn(req);
  return run &&
    who &&
    theLineage().access(run.conversation, who.principal, { authOff: engineAuthOff }) === "owner"
    ? run
    : null;
}

app.get("/runs/:id/verdict", (ctx) => {
  const run = runOf(ctx.req.param("id"), ctx.req.raw);
  if (!run) return ctx.json({ error: `no run ${ctx.req.param("id")}` }, 404);
  const v = verdicts.get(run.conversation);
  return v ? ctx.json(v) : ctx.json({ error: "the run has not settled" }, 404);
});

app.get("/runs/:id", (ctx) => {
  const run = runOf(ctx.req.param("id"), ctx.req.raw);
  return run ? ctx.json(run) : ctx.json({ error: `no run ${ctx.req.param("id")}` }, 404);
});

/** Accepted and rejected proposals come back as feedback (§7.7): the next turn's prompt names them, and the ledger counts them. A proposal whose base is no longer where the desk is reads as stale and is refused (Wave 5 D1). */
app.post("/conversations/:id/feedback", async (ctx) => {
  const body = (await ctx.req.json().catch(() => ({}))) as { accepted?: unknown[]; rejected?: unknown[] };
  const conversation = ctx.req.param("id");
  const store = theLineage();
  const rows = (list: unknown[] | undefined) =>
    (list ?? []).flatMap((r) => {
      const o = r as { document?: unknown; sentence?: unknown; why?: unknown; current?: unknown };
      return typeof o?.document === "number"
        ? [
            {
              document: o.document,
              sentence: typeof o.sentence === "string" ? o.sentence : undefined,
              why: typeof o.why === "string" ? o.why : undefined,
              current: typeof o.current === "number" ? o.current : undefined,
            },
          ]
        : [];
    });
  for (const d of rows(body.accepted)) {
    const v = store.stale(conversation, d);
    if (!v.ok)
      return ctx.json(
        {
          error: `document ${d.document} was proposed on ${v.base}, and the question moved on to ${v.moved_to}`,
          ...v,
        },
        409,
      );
  }
  for (const d of rows(body.accepted)) store.decide(conversation, "accepted", d);
  for (const d of rows(body.rejected)) store.decide(conversation, "rejected", d);
  recordFeedback(conversation, body);
  theLedger().record({
    at: Date.now(),
    conversation: ctx.req.param("id"),
    station: "desk",
    phase: "feedback",
    operation: "feedback",
    argument_digest: `${(body.accepted ?? []).length}/${(body.rejected ?? []).length}`,
    granted: true,
    reason: null,
    outcome: "ok",
    status: 200,
    handle: null,
    ms: 0,
    ceiling: "reader",
    idempotency_key: null,
  });
  return ctx.json({ recorded: true, ...feedbackOf(ctx.req.param("id")) });
});

app.get("/conversations/:id/feedback", (ctx) => ctx.json(feedbackOf(ctx.req.param("id"))));

/** The owner's verdict on one answer, up or down with a reason (the chat, slice 4): kept with the conversation, counted in the ledger, and taken back by a verdict of null. */
app.post("/conversations/:id/ratings", async (ctx) => {
  const body = (await ctx.req.json().catch(() => ({}))) as {
    message?: unknown;
    verdict?: unknown;
    reason?: unknown;
  };
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (message === "" || message.length > 200)
    return ctx.json({ error: "message: the id of the answer rated" }, 400);
  if (body.verdict !== "up" && body.verdict !== "down" && body.verdict !== null)
    return ctx.json({ error: "verdict: up, down, or null to take it back" }, 400);
  const conversation = ctx.req.param("id");
  const row = theLineage().rate(
    conversation,
    message,
    body.verdict,
    typeof body.reason === "string" ? body.reason : null,
  );
  theLedger().record({
    at: Date.now(),
    conversation,
    station: "desk",
    phase: "rating",
    operation: "rating",
    argument_digest: String(body.verdict),
    granted: true,
    reason: null,
    outcome: "ok",
    status: 200,
    handle: null,
    ms: 0,
    ceiling: "reader",
    idempotency_key: null,
  });
  return ctx.json({ message, verdict: row?.verdict ?? null, reason: row?.reason ?? null });
});

/** The conversations of one document lineage, newest first (Wave 5 section 7.4): what was proposed, accepted and rejected and why, and the handles each conversation produced, from the ledger. */
/** A conversation as the desk lists it. */
function conversationView(r: ConversationRow): Record<string, unknown> {
  const iso = (n: number | null) => (n === null ? null : new Date(n).toISOString());
  return {
    id: r.id,
    station: r.station,
    title: r.title,
    title_by: r.title_by,
    lineage: r.lineage,
    document: r.document,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at ?? r.created_at),
    pinned: r.pinned_at !== null,
    archived: r.archived_at !== null,
    forked_from: r.forked_from,
    fork_slot: r.fork_slot,
    context: {
      tokens: r.context_tokens,
      window: r.context_window,
      compactions: r.compactions ?? 0,
      compacted_at: iso(r.compacted_at),
    },
  };
}

app.get("/conversations", (ctx) => {
  const who = personIn(ctx.req.raw);
  if (!who) return ctx.json({ error: "no person" }, 401);
  const store = theLineage();
  if (ctx.req.query("lineage") === undefined) {
    // a person's own conversations, the pinned first (the chat, slice 1)
    const before = Date.parse(ctx.req.query("before") ?? "");
    const limit = Math.min(Math.max(Number(ctx.req.query("limit")) || 50, 1), 200);
    const rows = store.mine(who.principal, {
      q: ctx.req.query("q"),
      archived: ctx.req.query("archived") === "1",
      before: Number.isFinite(before) ? before : undefined,
      limit,
    });
    const last = rows.at(-1);
    return ctx.json({
      conversations: ((shared) => rows.map((r) => ({ ...conversationView(r), shared: shared.has(r.id) })))(
        store.sharedIds(who.principal),
      ),
      next: rows.length === limit && last ? new Date(last.updated_at ?? last.created_at).toISOString() : null,
    });
  }
  const lineage = Number(ctx.req.query("lineage"));
  if (!Number.isFinite(lineage)) return ctx.json({ error: "lineage" }, 400);
  const ledger = theLedger();
  const conversations = store
    .list(lineage, { principal: who.principal, authOff: engineAuthOff })
    .map((c) => ({
      id: c.id,
      station: c.station,
      document: c.document,
      created_at: new Date(c.created_at).toISOString(),
      proposals: c.proposals.map((p) => ({
        document: p.document,
        parent: p.parent,
        base_document: p.base_document,
        base_hash: p.base_hash,
        sentence: p.sentence,
        at: new Date(p.at).toISOString(),
        decided: p.decided,
        why: p.why,
        decided_at: p.decided_at === null ? null : new Date(p.decided_at).toISOString(),
        stale: p.decided === null && !store.stale(c.id, { document: p.document }).ok,
      })),
      handles: ledger
        .rows(c.id, 500)
        .filter((r) => r.handle !== null)
        .map((r) => ({ handle: r.handle, operation: r.operation, at: new Date(r.at).toISOString() })),
    }));
  return ctx.json({ lineage, head: store.headOf(lineage), conversations });
});

/** A new conversation, named by the host and owned by the person who asks (the chat, slice 1). */
app.post("/conversations", async (ctx) => {
  const who = personIn(ctx.req.raw);
  if (!who) return ctx.json({ error: "no person" }, 401);
  const body = (await ctx.req.json().catch(() => ({}))) as {
    station?: unknown;
    title?: unknown;
    title_by?: unknown;
    lineage?: unknown;
    document?: unknown;
  };
  const station = typeof body.station === "string" ? body.station : "";
  if (!agents.has(station)) return ctx.json({ error: `no station ${station || "(none)"}` }, 404);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const row = theLineage().create({
    station,
    owner: who.principal,
    title: typeof body.title === "string" ? body.title : null,
    ...(body.title_by === "words" ? { titleBy: "words" as const } : {}),
    lineage: num(body.lineage),
    document: num(body.document),
  });
  return ctx.json(conversationView(row), 201);
});

/** One conversation: what the list says, with its proposals and their decisions, so a reload shows what was accepted. */
app.get("/conversations/:id", async (ctx) => {
  const store = theLineage();
  const row = store.conversation(ctx.req.param("id"));
  if (!row) return ctx.json({ error: `no conversation ${ctx.req.param("id")}` }, 404);
  await nameVersions(row.id);
  return ctx.json({
    ...conversationView(row),
    shared: store.shareOf(row.id) !== null,
    versions: store.versions(row.id),
    proposals: store.proposals(row.id).map((p) => ({
      document: p.document,
      parent: p.parent,
      sentence: p.sentence,
      at: new Date(p.at).toISOString(),
      decided: p.decided,
      why: p.why,
      decided_at: p.decided_at === null ? null : new Date(p.decided_at).toISOString(),
      stale: p.decided === null && !store.stale(row.id, { document: p.document }).ok,
    })),
    ratings: store.ratings(row.id).map((r) => ({
      message: r.message,
      verdict: r.verdict,
      reason: r.reason,
      at: new Date(r.at).toISOString(),
    })),
  });
});

/**
 * A conversation named by the model once its first answer has settled (the chat, slice 10): only while its
 * name is still the first words of its first message, from that message alone, through the shape guard. A
 * name the person gave, or one the model gave before, stays; either way the conversation comes back as the
 * list shows it.
 */
app.post("/conversations/:id/title", async (ctx) => {
  const store = theLineage();
  const row = store.conversation(ctx.req.param("id"));
  if (!row) return ctx.json({ error: `no conversation ${ctx.req.param("id")}` }, 404);
  const complete = titles;
  if (row.title_by !== "words" || !complete) return ctx.json(conversationView(row));
  // the words of the family's first message: a version's stream begins with the conversation it was copied from
  const root = store.conversation(row.fork_root ?? row.id) ?? row;
  const first = openingWords(await historyOf(root.station, root.id));
  let title: string | null = null;
  if (first) {
    try {
      // asked for the person whose conversation it is, so a subscription of theirs applies (record 23)
      title = await nameConversation(first, (instructions, message) =>
        complete(instructions, message, tokens.get(row.id)),
      );
      if (!title)
        console.error(
          "nils-assistant: the model gave no name a conversation could take, so it keeps its first words",
        );
    } catch (e) {
      console.error(
        `nils-assistant: a conversation could not be named: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return ctx.json(conversationView((title ? store.setModelTitle(row.id, title) : null) ?? row));
});

/**
 * The owner summarizes a conversation's earlier turns now (the chat, slice 11). When there is enough of it to
 * summarize and its turns have settled, the station is sent the summarize signal and the runtime's door answers,
 * with the offset its stream continues from: the station answers in one line, and the runtime summarizes all but
 * the latest turn. A conversation too short to summarize is refused before any model is asked.
 */
app.post("/conversations/:id/summarize", async (ctx) => {
  const store = theLineage();
  const row = store.conversation(ctx.req.param("id"));
  if (!row) return ctx.json({ error: `no conversation ${ctx.req.param("id")}` }, 404);
  const router = routers.get(row.station);
  if (!router) return ctx.json({ error: `no station ${row.station}` }, 404);
  const keep = row.context_window ? summarizeCompaction(row.context_window).keepRecentTokens : SUMMARIZE_KEEP;
  const held = summarizable(await historyOf(row.station, row.id), keep);
  if (!held.enough)
    return ctx.json(
      {
        error:
          held.since === "summary"
            ? "too little has been said since the conversation was last summarized"
            : "the conversation is still too short to summarize",
      },
      409,
    );
  const sql = sqlFor(c.store);
  try {
    await settledExtent(sql, row.station, row.id);
  } catch (e) {
    if (e instanceof ForkRefused)
      return ctx.json(
        { error: "a turn is still running; summarize the conversation once it has settled" },
        409,
      );
    throw e;
  } finally {
    await sql.close();
  }
  return router.request(`/${encodeURIComponent(row.id)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(SUMMARIZE_SIGNAL),
  });
});

/** The first message of each version in a conversation's family that has been sent since it was made, read once from its stream (the chat, slice 4). */
async function nameVersions(id: string, open?: Sql): Promise<void> {
  const store = theLineage();
  const unsent = store.unsent(id);
  if (unsent.length === 0) return;
  const sql = open ?? sqlFor(c.store);
  try {
    for (const b of unsent) {
      const first = await firstUserMessage(sql, streamPath(b.station, b.id), b.fork_offset ?? 0);
      if (first) store.setBranchMessage(b.id, first);
    }
  } finally {
    if (!open) await sql.close();
  }
}

/**
 * The owner continues a conversation from one of its messages, or copies it whole (the chat, slice 4): a
 * new conversation of theirs whose model reads what the old one read up to there. Made before a message,
 * it is another version of that message, and the desk sends the edited words, or the same words again,
 * into it next; made at no message, it is a conversation of its own. The old one stays as it was.
 */
app.post("/conversations/:id/fork", async (ctx) => {
  const who = personIn(ctx.req.raw);
  if (!who) return ctx.json({ error: "no person" }, 401);
  const body = (await ctx.req.json().catch(() => ({}))) as { before?: unknown };
  const before = typeof body.before === "string" && body.before !== "" ? body.before : undefined;
  const store = theLineage();
  const source = store.conversation(ctx.req.param("id"));
  if (!source) return ctx.json({ error: `no conversation ${ctx.req.param("id")}` }, 404);
  const sql = sqlFor(c.store);
  try {
    await nameVersions(source.id, sql);
    const id = store.newId();
    const plan = await forkStream(sql, {
      from: { agentName: source.station, instanceId: source.id },
      to: { agentName: source.station, instanceId: id },
      before,
    });
    let slot: string | null = null;
    let origin: string | null = null;
    if (before !== undefined) {
      const placed = store.slotOf(before);
      slot = placed.slot;
      origin = placed.origin ?? store.originOf(source, plan.cutSeq ?? 0);
    }
    const row = store.branch({ id, source, slot, origin, offset: plan.offset });
    store.copyState(source.id, id, { cutAt: plan.cutAt, messages: plan.messages });
    return ctx.json(
      { ...conversationView(row), fork: { from: source.id, before: before ?? null, slot } },
      201,
    );
  } catch (e) {
    if (e instanceof ForkRefused) return ctx.json({ error: e.message }, e.status);
    throw e;
  } finally {
    await sql.close();
  }
});

/** The owner's conversation as a markdown file (the chat, slice 7): what was said, the steps and the versions proposed, never a tool's input or output. */
app.get("/conversations/:id/export", async (ctx) => {
  const store = theLineage();
  const row = store.conversation(ctx.req.param("id"));
  if (!row) return ctx.json({ error: `no conversation ${ctx.req.param("id")}` }, 404);
  const snapshot = snapshotOf(await historyOf(row.station, row.id), store.proposals(row.id));
  const markdown = markdownOf({
    title: row.title,
    station: row.station,
    at: new Date().toISOString(),
    snapshot,
  });
  return ctx.body(markdown, 200, { "content-type": "text/markdown; charset=utf-8" });
});

/** The owner renames, pins, unpins, archives or restores a conversation. */
app.patch("/conversations/:id", async (ctx) => {
  const body = (await ctx.req.json().catch(() => ({}))) as {
    title?: unknown;
    pinned?: unknown;
    archived?: unknown;
    current?: unknown;
  };
  const row = theLineage().patch(ctx.req.param("id"), {
    ...(typeof body.title === "string" || body.title === null ? { title: body.title as string | null } : {}),
    ...(typeof body.pinned === "boolean" ? { pinned: body.pinned } : {}),
    ...(typeof body.archived === "boolean" ? { archived: body.archived } : {}),
    ...(body.current === true ? { current: true } : {}),
  });
  return row
    ? ctx.json(conversationView(row))
    : ctx.json({ error: `no conversation ${ctx.req.param("id")}` }, 404);
});

/** The owner deletes a conversation: gone from every list and door at once. */
app.delete("/conversations/:id", (ctx) => {
  const id = ctx.req.param("id");
  theLineage().remove(id);
  tokens.forget(id);
  return ctx.json({ deleted: id });
});

/** The most a conversation could read, after each turn a person sends: the lower of their highest role and the station's ceiling (the chat, slice 5). */
function noteTurn(conversation: string, station: string, req: Request): void {
  const who = personIn(req);
  theLineage().noteReach(conversation, who ? topRole(who.roles) : null, ceilingOf(station));
}

/** A station's ceiling; a station the host does not list counts as the highest a seam reaches. */
function ceilingOf(station: string): Role {
  return asRole(stationList().find((s) => s.id === station)?.ceiling) ?? "operator";
}

/** The highest ceiling of any station, which a conversation from before the most it could read was kept may have reached through a delegate. */
function highestCeiling(): Role {
  return stationList().reduce<Role>((most, s) => maxRole(most, asRole(s.ceiling) ?? "reader"), "reader");
}

/** A conversation's history as the runtime keeps it, read in the host. */
async function historyOf(station: string, id: string): Promise<{ messages?: never[] }> {
  const r = await routers.get(station)?.request(`/${encodeURIComponent(id)}?view=history`);
  return r?.ok ? ((await r.json()) as { messages?: never[] }) : { messages: [] };
}

/** A share as its owner and its viewers read it; the reads only for the owner. */
function shareView(s: ShareRow, withReads: boolean): Record<string, unknown> {
  const iso = (n: number | null) => (n === null ? null : new Date(n).toISOString());
  const people = (() => {
    try {
      return JSON.parse(s.people) as { principal: string; display: string | null }[];
    } catch {
      return [];
    }
  })();
  return {
    id: s.id,
    conversation: s.conversation,
    title: s.title,
    owner: s.owner_display ?? bareOf(s.owner),
    // the desk names people by subject, from its own directory
    owner_subject: bareOf(s.owner),
    audience: s.audience,
    people: people.map((p) => ({ subject: bareOf(p.principal), display: p.display })),
    guards: guards(asRole(s.reach) ?? "operator"),
    created_at: iso(s.created_at),
    updated_at: iso(s.updated_at),
    ...(withReads
      ? {
          reads: theLineage()
            .reads(s.id)
            .map((r) => ({
              subject: bareOf(r.reader),
              display: r.display,
              first_at: iso(r.first_at),
              last_at: iso(r.last_at),
              count: r.count,
            })),
        }
      : {}),
  };
}

/** The owner's share of a conversation, with who opened it (the chat, slice 5). */
app.get("/conversations/:id/share", (ctx) => {
  const s = theLineage().shareOf(ctx.req.param("id"));
  return ctx.json({ share: s ? shareView(s, true) : null });
});

/**
 * The owner shares a conversation, or brings its share up to the latest turn: with people named on the desk, or
 * with everyone on it. The share holds a snapshot of the words and the cards' references, never a tool's input
 * or output, and the most the conversation could have read, which a viewer's roles must reach.
 */
app.put("/conversations/:id/share", async (ctx) => {
  const who = personIn(ctx.req.raw);
  if (!who) return ctx.json({ error: "no person" }, 401);
  const body = (await ctx.req.json().catch(() => ({}))) as { audience?: unknown; people?: unknown };
  if (body.audience !== "desk" && body.audience !== "people")
    return ctx.json({ error: "audience: desk, or people with the people named" }, 400);
  const named = new Map<string, { principal: string; display: string | null }>();
  if (body.audience === "people" && Array.isArray(body.people))
    for (const p of body.people) {
      const o = p as { subject?: unknown; display?: unknown };
      const subject = typeof o?.subject === "string" ? o.subject.trim() : "";
      const principal = subject ? principalFor(subject, who.principal) : "";
      if (principal && principal !== who.principal)
        named.set(principal, { principal, display: typeof o.display === "string" ? o.display : null });
    }
  if (body.audience === "people" && named.size === 0)
    return ctx.json({ error: "people: name at least one person other than yourself" }, 400);
  const store = theLineage();
  const row = store.conversation(ctx.req.param("id"));
  if (!row) return ctx.json({ error: `no conversation ${ctx.req.param("id")}` }, 404);
  const sql = sqlFor(c.store);
  let extent: number;
  try {
    extent = await settledExtent(sql, row.station, row.id);
  } catch (e) {
    if (e instanceof ForkRefused) return ctx.json({ error: e.message }, e.status);
    throw e;
  } finally {
    await sql.close();
  }
  const snapshot = snapshotOf(await historyOf(row.station, row.id), store.proposals(row.id));
  if (snapshot.messages.length === 0)
    return ctx.json({ error: "there is nothing to share yet; ask something first" }, 409);
  // a conversation from before the most it could read was kept counts as reaching as far as its owner and any station could
  const known = asRole(row.reach) ?? "reader";
  const reach = row.reach_complete
    ? known
    : maxRole(known, minRole(topRole(who.roles) ?? "operator", highestCeiling()));
  const s = store.putShare({
    conversation: row.id,
    owner: who.principal,
    ownerDisplay: who.display ?? null,
    audience: body.audience,
    people: [...named.values()],
    reach,
    extent,
    title: row.title,
    snapshot,
  });
  return ctx.json({ share: shareView(s, true) });
});

/** The owner stops sharing a conversation: the snapshot is gone at once. */
app.delete("/conversations/:id/share", (ctx) =>
  ctx.json({ revoked: theLineage().revokeShare(ctx.req.param("id")) }),
);

/** The person's own shares, the latest first, each with who opened it. */
app.get("/shares", (ctx) => {
  const who = personIn(ctx.req.raw);
  if (!who) return ctx.json({ error: "no person" }, 401);
  return ctx.json({
    shares: theLineage()
      .sharesBy(who.principal)
      .map((s) => shareView(s, true)),
  });
});

/** What others share with the person, the latest first; one whose class their roles do not reach says so. */
app.get("/shared", (ctx) => {
  const who = personIn(ctx.req.raw);
  if (!who) return ctx.json({ error: "no person" }, 401);
  return ctx.json({
    shared: theLineage()
      .sharedWith(who.principal)
      .map((s) => ({ ...shareView(s, false), readable: mayRead(who.roles, asRole(s.reach) ?? "operator") })),
  });
});

/** Why a person may not read a share: outside its audience as if it did not exist, and with the class when their roles do not reach it. */
function refusal(
  s: ShareRow | null,
  who: Person,
): { status: 403 | 404; body: Record<string, unknown> } | null {
  if (!s || s.revoked_at !== null) return { status: 404, body: { error: "no share" } };
  if (s.owner === who.principal) return null;
  if (!theLineage().inAudience(s, who.principal)) return { status: 404, body: { error: "no share" } };
  const reach = asRole(s.reach) ?? "operator";
  if (mayRead(who.roles, reach)) return null;
  const g = guards(reach);
  return {
    status: 403,
    body: {
      error: g
        ? `This conversation may have read ${g.words}, which your roles do not reach.`
        : "Your roles do not reach what this conversation read.",
      class: g?.class ?? null,
    },
  };
}

/** A share as its audience reads it: the snapshot, whose cards open under the reader's own roles. A viewer's read is recorded. */
app.get("/shares/:share", (ctx) => {
  const who = personIn(ctx.req.raw);
  if (!who) return ctx.json({ error: "no person" }, 401);
  const store = theLineage();
  const s = store.share(ctx.req.param("share"));
  const refused = refusal(s, who);
  if (refused || !s) return ctx.json(refused?.body ?? { error: "no share" }, refused?.status ?? 404);
  const mine = s.owner === who.principal;
  if (!mine) store.noteRead(s.id, who.principal, who.display ?? null);
  const snapshot = (() => {
    try {
      return JSON.parse(s.snapshot ?? "") as unknown;
    } catch {
      return { v: 1, messages: [] };
    }
  })();
  return ctx.json({ ...shareView(s, mine), mine, snapshot });
});

/** A viewer continues a share as a conversation of their own: its model reads what the shared one read up to the snapshot, and its tools run as the viewer from there. */
app.post("/shares/:share/continue", async (ctx) => {
  const who = personIn(ctx.req.raw);
  if (!who) return ctx.json({ error: "no person" }, 401);
  const store = theLineage();
  const s = store.share(ctx.req.param("share"));
  const refused = refusal(s, who);
  if (refused || !s) return ctx.json(refused?.body ?? { error: "no share" }, refused?.status ?? 404);
  const source = store.conversation(s.conversation);
  if (!source || source.deleted_at !== null)
    return ctx.json({ error: "the conversation shared is gone" }, 404);
  if (s.owner === who.principal) return ctx.json({ ...conversationView(source), continued: false });
  const sql = sqlFor(c.store);
  try {
    const id = store.newId();
    await forkStream(sql, {
      from: { agentName: source.station, instanceId: source.id },
      to: { agentName: source.station, instanceId: id },
      upTo: s.extent,
    });
    const copy = store.branch({
      id,
      source,
      slot: null,
      origin: null,
      offset: s.extent,
      owner: who.principal,
      title: s.title,
    });
    store.copyState(source.id, id, { cutAt: s.updated_at, messages: [] });
    return ctx.json({ ...conversationView(copy), continued: true }, 201);
  } catch (e) {
    if (e instanceof ForkRefused) return ctx.json({ error: e.message }, e.status);
    throw e;
  } finally {
    await sql.close();
  }
});

/** The delegations of a conversation, from the store (section 9.12): the desk renders a delegate's verdict from here, never from the concierge's words. */
app.get("/conversations/:id/delegations", (ctx) =>
  ctx.json({ stations: agentIds(), tasks: delegationsOf(ctx.req.param("id")).map(delegationView) }),
);

/** Memory (section 9.9): a person's own notes, read and deleted by the person the token names. */
app.get("/conversations/:id/notes", (ctx) => {
  const who = personIn(ctx.req.raw);
  if (!who) return ctx.json({ error: "no person" }, 401);
  return ctx.json({ subject: who.principal, notes: theNotes().list(who.principal) });
});
app.delete("/conversations/:id/notes", (ctx) => {
  const who = personIn(ctx.req.raw);
  if (!who) return ctx.json({ error: "no person" }, 401);
  return ctx.json({ subject: who.principal, deleted: theNotes().deleteSubject(who.principal) });
});
/** A memory as the desk reads it (the chat, slice 6). */
function memoryView(n: Note): Record<string, unknown> {
  const iso = (t: number | null | undefined) =>
    t === null || t === undefined ? null : new Date(t).toISOString();
  return {
    id: n.id,
    kind: n.kind,
    text: n.text,
    source: n.source ?? (n.kind === "person" ? null : "work"),
    station: n.station,
    at: iso(n.at),
    edited_at: iso(n.edited_at),
    used_at: iso(n.used_at),
  };
}

function instructionView(i: Instructions | null): Record<string, unknown> | null {
  return i
    ? { version: i.version, text: i.text, author: bareOf(i.author), at: new Date(i.at).toISOString() }
    : null;
}

/** A refused memory as a door answers it. */
function refusedMemory(ctx: { json: (b: unknown, s: number) => Response }, e: unknown): Response {
  if (e instanceof MemoryRefused) return ctx.json({ error: e.message }, e.status);
  throw e;
}

/** What the assistant keeps for the person: what they asked it to keep, the notes their work left, whether memory is paused, and the install's instructions. */
app.get("/memory", (ctx) => {
  const who = personIn(ctx.req.raw);
  if (!who) return ctx.json({ error: "no person" }, 401);
  const notes = theNotes();
  return ctx.json({
    paused: notes.paused(who.principal),
    items: notes.list(who.principal).map(memoryView),
    instructions: instructionView(notes.instructions()),
  });
});

/** The person keeps something: typed on the Memory page, said in a conversation, or a memory the assistant offered and they accepted. */
app.post("/memory", async (ctx) => {
  const who = personIn(ctx.req.raw);
  if (!who) return ctx.json({ error: "no person" }, 401);
  const body = (await ctx.req.json().catch(() => ({}))) as { text?: unknown; source?: unknown };
  const source = body.source === "said" || body.source === "accepted" ? body.source : "page";
  try {
    return ctx.json(
      memoryView(theNotes().remember(who.principal, typeof body.text === "string" ? body.text : "", source)),
      201,
    );
  } catch (e) {
    return refusedMemory(ctx, e);
  }
});

app.patch("/memory/:id", async (ctx) => {
  const who = personIn(ctx.req.raw);
  if (!who) return ctx.json({ error: "no person" }, 401);
  const body = (await ctx.req.json().catch(() => ({}))) as { text?: unknown };
  try {
    return ctx.json(
      memoryView(
        theNotes().edit(
          who.principal,
          Number(ctx.req.param("id")),
          typeof body.text === "string" ? body.text : "",
        ),
      ),
    );
  } catch (e) {
    return refusedMemory(ctx, e);
  }
});

app.delete("/memory/:id", (ctx) => {
  const who = personIn(ctx.req.raw);
  if (!who) return ctx.json({ error: "no person" }, 401);
  const deleted = theNotes().removeOwn(who.principal, Number(ctx.req.param("id")));
  return deleted
    ? ctx.json({ deleted })
    : ctx.json({ error: `no memory ${ctx.req.param("id")} of yours` }, 404);
});

/** The person pauses memory, or resumes it: while paused a new conversation reads none of it and nothing is kept. */
app.put("/memory/pause", async (ctx) => {
  const who = personIn(ctx.req.raw);
  if (!who) return ctx.json({ error: "no person" }, 401);
  const body = (await ctx.req.json().catch(() => ({}))) as { paused?: unknown };
  if (typeof body.paused !== "boolean") return ctx.json({ error: "paused: true or false" }, 400);
  return ctx.json({ paused: theNotes().pause(who.principal, body.paused) });
});

/** The person deletes everything the assistant keeps about them. */
app.delete("/memory", (ctx) => {
  const who = personIn(ctx.req.raw);
  if (!who) return ctx.json({ error: "no person" }, 401);
  return ctx.json({ deleted: theNotes().deleteSubject(who.principal) });
});

/** The install's instructions and their versions: every person reads them, and an admin writes the next version. */
app.get("/instructions", (ctx) => {
  const who = personIn(ctx.req.raw);
  if (!who) return ctx.json({ error: "no person" }, 401);
  const notes = theNotes();
  return ctx.json({
    current: instructionView(notes.instructions()),
    history: notes.instructionHistory().map((h) => ({
      version: h.version,
      author: bareOf(h.author),
      at: new Date(h.at).toISOString(),
      chars: h.chars,
    })),
  });
});

app.put("/instructions", async (ctx) => {
  const who = personIn(ctx.req.raw);
  if (!who) return ctx.json({ error: "no person" }, 401);
  if (!who.roles.includes("admin"))
    return ctx.json({ error: "the install's instructions are written by an admin" }, 403);
  const body = (await ctx.req.json().catch(() => ({}))) as { text?: unknown };
  try {
    return ctx.json({
      current: instructionView(
        theNotes().writeInstructions(typeof body.text === "string" ? body.text : "", who.principal),
      ),
    });
  } catch (e) {
    return refusedMemory(ctx, e);
  }
});

/** Institutional corrections: structural only, accepted by a named person; the row has no field a value fits. */
app.get("/notes/institutional", (ctx) =>
  ctx.json({ corrections: theNotes().institutional(ctx.req.query("station") || undefined) }),
);
app.post("/notes/institutional", async (ctx) => {
  // accepted by a named person: the one the token names, holding the reviewer role (the chat, slice 1)
  const who = personIn(ctx.req.raw);
  if (!who) return ctx.json({ error: "no person" }, 401);
  if (!who.roles.some((r) => r === "reviewer" || r === "operator" || r === "admin"))
    return ctx.json({ error: "an institutional correction is accepted by a reviewer" }, 403);
  const body = (await ctx.req.json().catch(() => ({}))) as {
    station?: string;
    axis?: string;
    check?: string;
  };
  try {
    return ctx.json(
      theNotes().accept({
        station: String(body.station ?? ""),
        axis: String(body.axis ?? ""),
        check: String(body.check ?? ""),
        accepted_by: who.principal,
      }),
      201,
    );
  } catch (e) {
    return ctx.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

app.get("/ledger/:id", (ctx) => ctx.json({ rows: theLedger().rows(ctx.req.param("id")) }));

// the ladder (Wave 5 section 9.1): a person's standing grants, per verb, revocable, never beyond the person

/** The person a request comes from, by the token the desk sent with it; and their roles, read from the engine with that token. */
async function personOf(ctx: {
  req: { header: (k: string) => string | undefined };
}): Promise<{ subject: string; roles: string[]; entitlements: string[]; policy: PolicyRow[] } | null> {
  const p = await people.of(bearerOf(ctx));
  if (!p) return null;
  adopt(p);
  assistRun.set(p.principal, p.entitlements.includes("assist-run"));
  return { subject: p.principal, roles: p.roles, entitlements: p.entitlements, policy: p.policy };
}

app.get("/grants", async (ctx) => {
  const who = await personOf(ctx);
  if (!who) return ctx.json({ error: "no token" }, 401);
  const all = who.roles.includes("admin") && ctx.req.query("all") === "1";
  return ctx.json({
    subject: who.subject,
    grants: ladder.grants(all ? null : who.subject).map((g) => ({
      id: g.id,
      subject: g.subject,
      door: g.door,
      created_at: new Date(g.created_at).toISOString(),
      revoked_at: g.revoked_at === null ? null : new Date(g.revoked_at).toISOString(),
    })),
    ladder: ladderOf(who.policy),
  });
});

app.post("/grants", async (ctx) => {
  const who = await personOf(ctx);
  if (!who) return ctx.json({ error: "no token" }, 401);
  const body = (await ctx.req.json().catch(() => ({}))) as { door?: unknown };
  const door = typeof body.door === "string" ? body.door : "";
  const row = who.policy.find((r) => r.door === door);
  if (!row) return ctx.json({ error: `${door || "(none)"} is not a door the engine serves` }, 404);
  if (rungOf(row) !== 2)
    return ctx.json({ error: `${door} is rung ${rungOf(row)}; a standing grant is for rung two only` }, 409);
  if (!opens(who.roles, row.role))
    return ctx.json(
      {
        error: `${door} asks for the ${row.role} role, which you do not hold; a grant never exceeds the person`,
      },
      403,
    );
  if (c.requireAssistRun && !who.entitlements.includes("assist-run"))
    return ctx.json({ error: "rung two is closed here without the assist-run entitlement (C49)" }, 403);
  const g = ladder.grant(who.subject, door);
  return ctx.json(
    { id: g.id, subject: g.subject, door: g.door, created_at: new Date(g.created_at).toISOString() },
    201,
  );
});

app.delete("/grants/:id", async (ctx) => {
  const who = await personOf(ctx);
  if (!who) return ctx.json({ error: "no token" }, 401);
  const g = ladder.revoke(Number(ctx.req.param("id")), who.roles.includes("admin") ? null : who.subject);
  return g
    ? ctx.json({
        id: g.id,
        door: g.door,
        revoked_at: g.revoked_at === null ? null : new Date(g.revoked_at).toISOString(),
      })
    : ctx.json({ error: "no such grant of yours" }, 404);
});

// the plan (section 9.3): the person sees it restated and confirms it once; the scheduler does the rest
app.get("/plans/:id", async (ctx) => {
  const who = await personOf(ctx);
  if (!who) return ctx.json({ error: "no token" }, 401);
  const p = ladder.planById(ctx.req.param("id"));
  if (!p || (p.subject !== who.subject && !who.roles.includes("admin")))
    return ctx.json({ error: "no such plan of yours" }, 404);
  return ctx.json({ ...p, steps: ladder.steps(p.id) });
});

app.post("/plans/:id/confirm", async (ctx) => {
  const who = await personOf(ctx);
  if (!who) return ctx.json({ error: "no token" }, 401);
  const r = ladder.confirm(ctx.req.param("id"), who.subject);
  if ("refused" in r) return ctx.json({ error: r.refused }, 409);
  // fire what is due at once, so a plan of "now" steps does not wait a tick
  const fired = await scheduler.tick();
  return ctx.json({
    ...r,
    steps: ladder.steps(r.id),
    fired: fired.filter((f) => ladder.step(f.step)?.plan === r.id),
  });
});

/** A person decided on a rung-three proposal on the desk, through its own closure panel; the assistant records it and does nothing else. */
app.post("/plans/:id/proposals/:n/decide", async (ctx) => {
  const who = await personOf(ctx);
  if (!who) return ctx.json({ error: "no token" }, 401);
  const body = (await ctx.req.json().catch(() => ({}))) as { verdict?: unknown };
  const verdict = body.verdict === "accepted" ? "accepted" : body.verdict === "rejected" ? "rejected" : null;
  if (!verdict) return ctx.json({ error: "verdict is accepted or rejected" }, 400);
  const step = ladder
    .steps(ctx.req.param("id"))
    .find((s) => s.n === Number(ctx.req.param("n")) && s.rung === 3);
  if (!step) return ctx.json({ error: "no such proposal" }, 404);
  const r = ladder.decide(step.id, verdict, who.subject);
  return "refused" in r ? ctx.json({ error: r.refused }, 409) : ctx.json(r);
});

/** The inbox (section 9.4): what the assistant and the engine did for this person, the teaching jobs among them. */
app.get("/inbox", async (ctx) => {
  const who = await personOf(ctx);
  if (!who) return ctx.json({ error: "no token" }, 401);
  return ctx.json({
    ...inboxOf(ladder, who.subject),
    teaching: teachingStore.jobs(who.subject).map(jobView),
  });
});

// teaching (Wave 5 section 9.5)

function jobView(j: ReturnType<TeachingStore["jobs"]>[number]): Record<string, unknown> {
  return {
    ...j,
    started_at: new Date(j.started_at).toISOString(),
    finished_at: j.finished_at === null ? null : new Date(j.finished_at).toISOString(),
  };
}

function bearerOf(ctx: { req: { header: (k: string) => string | undefined } }): string | null {
  const auth = ctx.req.header("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

/** The decided review items, read with the person's token; the ledger says which a station had decided before. */
async function reviewFor(token: string | null): Promise<{ items: ReviewItem[]; byStation: Set<number> }> {
  const conversation = `teaching-${Date.now().toString(36)}`;
  if (token) tokens.put(conversation, token);
  const seam = seamFor("teaching", conversation);
  const a = await seam.call({
    method: "GET",
    path: "/api/review?status=decided&limit=500",
    toolCallId: "corrections",
    phase: "grant",
  });
  tokens.forget(conversation);
  const items = a.kind === "ok" ? (((a.body as { items?: ReviewItem[] }).items ?? []) as ReviewItem[]) : [];
  const byStation = new Set<number>();
  for (const r of theLedger().rows(undefined, 5000)) {
    const m = /review\/(\d+)\/apply/u.exec(r.operation);
    if (m && r.outcome === "ok" && r.station !== "desk" && r.station !== "scheduler")
      byStation.add(Number(m[1]));
  }
  return { items, byStation };
}

app.get("/teaching/corrections", async (ctx) => {
  const who = await personOf(ctx);
  if (!who) return ctx.json({ error: "no token" }, 401);
  const { items, byStation } = await reviewFor(bearerOf(ctx));
  const list = correctionsOf(theLineage(), items, byStation);
  return ctx.json({ count: list.length, corrections: list });
});

app.get("/teaching/sets", async (ctx) => {
  const who = await personOf(ctx);
  if (!who) return ctx.json({ error: "no token" }, 401);
  return ctx.json({
    sets: teachingStore.sets().map((s) => ({ ...s, created_at: new Date(s.created_at).toISOString() })),
  });
});

app.post("/teaching/sets", async (ctx) => {
  const who = await personOf(ctx);
  if (!who) return ctx.json({ error: "no token" }, 401);
  if (!opens(who.roles, "reviewer"))
    return ctx.json({ error: "curating a set asks for the reviewer role" }, 403);
  const body = (await ctx.req.json().catch(() => ({}))) as { name?: unknown; corrections?: unknown };
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "";
  const ids = Array.isArray(body.corrections)
    ? body.corrections.filter((x): x is string => typeof x === "string")
    : [];
  if (!name || ids.length === 0)
    return ctx.json({ error: "a set has a name and at least one correction" }, 400);
  const { items, byStation } = await reviewFor(bearerOf(ctx));
  const all = correctionsOf(theLineage(), items, byStation);
  const chosen = all.filter((x) => ids.includes(x.id));
  if (chosen.length === 0) return ctx.json({ error: "none of the corrections named exists" }, 404);
  const s = teachingStore.curate(name, who.subject, chosen);
  return ctx.json({ ...s, created_at: new Date(s.created_at).toISOString() }, 201);
});

app.post("/teaching/sets/:id/fine-tune", async (ctx) => {
  const who = await personOf(ctx);
  if (!who) return ctx.json({ error: "no token" }, 401);
  if (!opens(who.roles, "operator"))
    return ctx.json({ error: "a fine-tune asks for the operator role" }, 403);
  const set = teachingStore.set(Number(ctx.req.param("id")));
  if (!set) return ctx.json({ error: "no such set" }, 404);
  const body = (await ctx.req.json().catch(() => ({}))) as { recipe?: unknown };
  const recipe = parseRecipe(body.recipe);
  if ("refused" in recipe) return ctx.json({ error: recipe.refused }, 400);
  const { job } = teaching.fineTune(set, who.subject, recipe, kvasirLifecycle(c.kvasir, bearerOf(ctx)));
  return ctx.json(jobView(job), 202);
});

app.get("/teaching/candidates", async (ctx) => {
  const who = await personOf(ctx);
  if (!who) return ctx.json({ error: "no token" }, 401);
  try {
    return ctx.json(await teaching.candidates(kvasirLifecycle(c.kvasir, bearerOf(ctx))));
  } catch (e) {
    return kvasirError(ctx, e);
  }
});

app.post("/teaching/candidates/:id/:verb", async (ctx) => {
  const who = await personOf(ctx);
  if (!who) return ctx.json({ error: "no token" }, 401);
  if (!opens(who.roles, "operator")) return ctx.json({ error: "the gates ask for the operator role" }, 403);
  const kv = kvasirLifecycle(c.kvasir, bearerOf(ctx));
  const id = Number(ctx.req.param("id"));
  const verb = ctx.req.param("verb");
  try {
    if (verb === "admit") return ctx.json(await kv.admit(id));
    const cand = (await kv.list()).candidates.find((x) => x.id === id);
    if (!cand) return ctx.json({ error: `no candidate ${id}` }, 404);
    if (verb === "bench") {
      const b = await teaching.bench(cand, who.subject);
      return ctx.json({ ...b, at: new Date(b.at).toISOString() });
    }
    if (verb === "promote") {
      const body = (await ctx.req.json().catch(() => ({}))) as { proposal?: { id?: unknown } };
      const pid =
        typeof body.proposal?.id === "number" || typeof body.proposal?.id === "string"
          ? body.proposal.id
          : `desk-${Date.now().toString(36)}`;
      const r = await teaching.promote(cand, { id: pid, principal: who.subject }, kv);
      return r.ok
        ? ctx.json({ promoted: id, result: r.result })
        : ctx.json({ error: r.refused, refused: true }, 409);
    }
    return ctx.json({ error: `${verb} is not a teaching verb` }, 404);
  } catch (e) {
    return kvasirError(ctx, e);
  }
});

function kvasirError(ctx: { json: (b: unknown, s: number) => Response }, e: unknown): Response {
  if (e instanceof KvasirRefused) return ctx.json({ error: e.message }, e.status as 400);
  return ctx.json({ error: e instanceof Error ? e.message : String(e) }, 502);
}

// a user turn may carry the rail's typed context, the document and its lineage (Wave 5 D1): the host keeps them and hands the runtime the words
const routers = new Map<string, Hono>();
for (const [id, agent] of agents) routers.set(id, createAgentRouter(agent) as unknown as Hono);
app.post(
  "/agents/:station/:id",
  interceptTurn({
    routers,
    lineage: theLineage,
    subject: subjectOfConversation,
    owner: (req) => personIn(req)?.principal ?? null,
    onTurn: noteTurn,
  }) as never,
);
for (const [id, router] of routers) app.route(`/agents/${id}`, router);

export default app;
