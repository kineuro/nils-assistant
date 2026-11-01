// SPDX-License-Identifier: AGPL-3.0-only
// The rater's two doors for the desk (Wave 7b step 5): POST /raters/runs starts the blind read of a raters'
// campaign as the person whose token the desk sent, and GET /raters/runs/{id} answers that person counts.
// The host mounts them with its seam, its model call and its stores; a test mounts them with fakes.

import type { Hono } from "hono";
import { personIn } from "../host/access.ts";
import type { Lineage } from "../host/lineage.ts";
import { bearerOf } from "../host/people.ts";
import type { ChatAnswer, ChatCall } from "../providers/kvasir.ts";
import type { Seam } from "../seam/client.ts";
import type { Tokens } from "../seam/tokens.ts";
import { type RaterRun, RaterRuns, raterRunView } from "./run.ts";

export interface RaterHost {
  /** The seam of a conversation for the rater station. */
  seam: (conversation: string) => Seam;
  chat: (call: ChatCall) => Promise<ChatAnswer>;
  /** The model a run reads with: the one named while the model server lists it, else the stations' own. */
  model: (named: string | undefined) => string;
  tokens: Tokens;
  lineage: () => Lineage;
  sleep?: (ms: number) => Promise<void>;
  say?: (line: string) => void;
}

/** The status with whether the run still holds a token: the desk pushes a fresh one to the run's conversation before it expires, as it does for a turn. */
function view(run: RaterRun, tokens: Tokens): Record<string, unknown> {
  return { ...raterRunView(run), token: tokens.get(run.conversation) ? "held" : "missing" };
}

export function mountRaters(app: Hono, host: RaterHost): RaterRuns {
  const runs = new RaterRuns();

  app.post("/raters/runs", async (ctx) => {
    const who = personIn(ctx.req.raw);
    if (!who) return ctx.json({ error: "no token" }, 401);
    const body = (await ctx.req.json().catch(() => ({}))) as {
      campaign?: unknown;
      model?: unknown;
      thinking?: unknown;
    };
    const campaign =
      typeof body.campaign === "number" || (typeof body.campaign === "string" && body.campaign)
        ? String(body.campaign)
        : null;
    if (!campaign) return ctx.json({ error: "campaign: the id of the raters' campaign to read" }, 400);
    if (body.model !== undefined && typeof body.model !== "string")
      return ctx.json({ error: "model: the name of a model the model server lists" }, 400);
    if (body.thinking !== undefined && typeof body.thinking !== "boolean")
      return ctx.json({ error: "thinking: true or false" }, 400);
    const held = runs.running(campaign);
    if (held)
      return ctx.json(
        {
          error: `campaign ${campaign} is being read by run ${held.id}; one run reads a campaign at a time`,
          run: held.id,
        },
        409,
      );
    const conversation = `rater-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const token = bearerOf(ctx.req.header("authorization"));
    if (token) host.tokens.put(conversation, token);
    // the run's conversation is the person's, so the desk may push a fresh token to it and read its ledger
    host.lineage().open({ id: conversation, station: "rater", subject: who.principal, owner: who.principal });
    const run = runs.start(
      {
        campaign,
        conversation,
        principal: who.principal,
        model: host.model(body.model as string | undefined),
        thinking: body.thinking === undefined ? true : body.thinking,
      },
      {
        seam: host.seam(conversation),
        chat: host.chat,
        ...(host.sleep ? { sleep: host.sleep } : {}),
        ...(host.say ? { say: host.say } : {}),
      },
    );
    return ctx.json(view(run, host.tokens), 202);
  });

  app.get("/raters/runs/:id", (ctx) => {
    const who = personIn(ctx.req.raw);
    const run = runs.get(ctx.req.param("id"));
    // a run is read by the person who started it; another sees no such run
    if (!who || !run || run.principal !== who.principal)
      return ctx.json({ error: `no rater run ${ctx.req.param("id")}` }, 404);
    return ctx.json(view(run, host.tokens));
  });

  return runs;
}
