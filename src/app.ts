// SPDX-License-Identifier: AGPL-3.0-only
// The host (Wave 4c §9.2): one Node process, one Flue application, an HTTP
// surface for the desk only. It holds no credential of its own: the desk
// hands it the person's token per turn on every request and pushes a fresh
// one before expiry; Kvasir is reached with the app's minted key, one
// provider per station carrying its purpose.

import { setProvider } from "@flue/runtime";
import { createAgentRouter } from "@flue/runtime/routing";
import { Hono } from "hono";
import { config } from "./config.ts";
import { capabilities } from "./host/capabilities.ts";
import { Runs } from "./host/runs.ts";
import { interceptTurn } from "./host/turns.ts";
import { kvasirProvider, readCatalog } from "./providers/kvasir.ts";
import { agentIds, delegationsOf, delegationView, registerAgent } from "./seam/delegations.ts";
import {
  feedbackOf,
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

// Kvasir, one provider per station, the app's minted key; registered before any agent runs
const catalog = await readCatalog(c.kvasir, c.kvasirKey).catch((e: Error) => {
  console.error(`nils-assistant: Kvasir did not answer at start: ${e.message}`);
  return { baseUrl: `${c.kvasir}/v1`, models: [] };
});
for (const s of stationList())
  setProvider(kvasirProvider({ station: s.id, purpose: `assistant.${s.id}`, catalog, key: c.kvasirKey }));

// an engine serving with its authentication off takes a turn without a token (section 5.5); anything else refuses it
if (await probeEngineAuth(c.engine))
  console.error(
    "nils-assistant: the engine serves with its authentication off; turns without a token are allowed",
  );

const app = new Hono();

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
      { teaching_open: false, conversations: 0 },
    ),
  ),
);

/** The desk pushes a fresh token before expiry (§5.5, 19 Q8). */
app.post("/conversations/:id/token", async (ctx) => {
  const body = (await ctx.req.json().catch(() => ({}))) as { token?: string };
  if (!body.token) return ctx.json({ error: "token" }, 400);
  const h = tokens.put(ctx.req.param("id"), body.token);
  // the registry's context for this person, fetched now so the first render finds it in the instructions
  void warmPrelude(seamFor("ask-help", ctx.req.param("id")), subjectOfConversation(ctx.req.param("id")));
  return ctx.json({ conversation: ctx.req.param("id"), expires_at: h.expiresAt });
});

/** A headless station run (§9.2). */
app.post("/stations/:id/runs", async (ctx) => {
  const station = ctx.req.param("id");
  const agent = agents.get(station);
  if (!agent) return ctx.json({ error: `no station ${station}` }, 404);
  const body = (await ctx.req.json().catch(() => ({}))) as { message?: string; conversation?: string };
  if (!body.message) return ctx.json({ error: "message" }, 400);
  const conversation = body.conversation ?? `run-${Date.now().toString(36)}`;
  const auth = ctx.req.header("authorization") ?? "";
  if (auth.startsWith("Bearer ")) tokens.put(conversation, auth.slice(7));
  // the registry's context for this person, fetched before the first render so it sits in the instructions
  await warmPrelude(seamFor(station, conversation), subjectOfConversation(conversation));
  const run = runs.start(station, agent, body.message, conversation);
  return ctx.json({ run: run.id, conversation, state: run.state }, 202);
});

app.get("/runs/:id/verdict", (ctx) => {
  const run = runs.get(ctx.req.param("id"));
  if (!run) return ctx.json({ error: `no run ${ctx.req.param("id")}` }, 404);
  const v = verdicts.get(run.conversation);
  return v ? ctx.json(v) : ctx.json({ error: "the run has not settled" }, 404);
});

app.get("/runs/:id", (ctx) => {
  const run = runs.get(ctx.req.param("id"));
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

/** The conversations of one document lineage, newest first (Wave 5 section 7.4): what was proposed, accepted and rejected and why, and the handles each conversation produced, from the ledger. */
app.get("/conversations", (ctx) => {
  const lineage = Number(ctx.req.query("lineage"));
  if (!Number.isFinite(lineage)) return ctx.json({ error: "lineage" }, 400);
  const store = theLineage();
  const ledger = theLedger();
  const conversations = store.list(lineage).map((c) => ({
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

/** The delegations of a conversation, from the store (section 9.12): the desk renders a delegate's verdict from here, never from the concierge's words. */
app.get("/conversations/:id/delegations", (ctx) =>
  ctx.json({ stations: agentIds(), tasks: delegationsOf(ctx.req.param("id")).map(delegationView) }),
);

/** Memory (section 9.9): a person's own notes, read and deleted by the subject the desk's token names for the conversation. */
app.get("/conversations/:id/notes", (ctx) => {
  const subject = subjectOfConversation(ctx.req.param("id"));
  return ctx.json({ subject, notes: theNotes().list(subject) });
});
app.delete("/conversations/:id/notes", (ctx) => {
  const subject = subjectOfConversation(ctx.req.param("id"));
  return ctx.json({ subject, deleted: theNotes().deleteSubject(subject) });
});
/** Institutional corrections: structural only, accepted by a named person; the row has no field a value fits. */
app.get("/notes/institutional", (ctx) =>
  ctx.json({ corrections: theNotes().institutional(ctx.req.query("station") || undefined) }),
);
app.post("/notes/institutional", async (ctx) => {
  const body = (await ctx.req.json().catch(() => ({}))) as {
    station?: string;
    axis?: string;
    check?: string;
    accepted_by?: string;
  };
  try {
    return ctx.json(
      theNotes().accept({
        station: String(body.station ?? ""),
        axis: String(body.axis ?? ""),
        check: String(body.check ?? ""),
        accepted_by: String(body.accepted_by ?? ""),
      }),
      201,
    );
  } catch (e) {
    return ctx.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

app.get("/ledger/:id", (ctx) => ctx.json({ rows: theLedger().rows(ctx.req.param("id")) }));

// a user turn may carry the rail's typed context, the document and its lineage (Wave 5 D1): the host keeps them and hands the runtime the words
const routers = new Map<string, Hono>();
for (const [id, agent] of agents) routers.set(id, createAgentRouter(agent) as unknown as Hono);
app.post(
  "/agents/:station/:id",
  interceptTurn({ routers, lineage: theLineage, subject: subjectOfConversation }) as never,
);
for (const [id, router] of routers) app.route(`/agents/${id}`, router);

export default app;
