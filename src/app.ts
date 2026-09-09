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
import { kvasirProvider, readCatalog } from "./providers/kvasir.ts";
import {
  feedbackOf,
  recordFeedback,
  registerStation,
  stationList,
  theLedger,
  tokens,
  verdicts,
} from "./seam/for.ts";
import { AskHelp } from "./stations/ask-help-agent.ts";
import { Echo } from "./stations/echo.ts";
import { loadManifests } from "./stations/manifest.ts";

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
agents.set("echo", Echo);
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

/** Accepted and rejected proposals come back as feedback (§7.7): the next turn's prompt names them, and the ledger counts them. */
app.post("/conversations/:id/feedback", async (ctx) => {
  const body = (await ctx.req.json().catch(() => ({}))) as { accepted?: unknown[]; rejected?: unknown[] };
  recordFeedback(ctx.req.param("id"), body);
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

app.get("/ledger/:id", (ctx) => ctx.json({ rows: theLedger().rows(ctx.req.param("id")) }));

for (const [id, agent] of agents) app.route(`/agents/${id}`, createAgentRouter(agent));

export default app;
