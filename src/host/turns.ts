// SPDX-License-Identifier: AGPL-3.0-only
// A user turn from the desk (Wave 5 sections 7.4 and 9.2): beside the words
// it may carry the page's typed context, the document the rail is on and
// the lineage that document belongs to. The host keeps those three and
// hands the runtime the turn it expects, the words and nothing else, so a
// station never sees a field the allowlist did not admit.

import type { Hono } from "hono";
import type { PageContext } from "../seam/context.ts";
import type { Lineage } from "./lineage.ts";

export interface Turn {
  /** What the runtime receives. */
  forward: Record<string, unknown>;
  context: unknown | undefined;
  lineage: number | null;
  document: number | null;
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Split a turn's body into what the host keeps and what the runtime gets. A body that is not a user message passes untouched. */
export function splitTurn(raw: unknown): Turn {
  const o = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const { context, lineage, document, ...forward } = o;
  return {
    forward,
    context,
    lineage: num(lineage) ? lineage : null,
    document: num(document) ? document : null,
  };
}

/**
 * The handler for POST /agents/:station/:id: read the turn, keep the
 * context and the lineage, forward the words to the station's own router.
 */
export function interceptTurn(o: {
  routers: Map<string, Hono>;
  lineage: () => Lineage;
  subject: (conversation: string) => string;
  onContext?: (conversation: string, c: PageContext) => void;
}) {
  return async (ctx: {
    req: { param: (k: string) => string; json: () => Promise<unknown>; raw: Request };
    json: (body: unknown, status?: number) => Response;
    env?: unknown;
  }): Promise<Response> => {
    const station = ctx.req.param("station");
    const id = decodeURIComponent(ctx.req.param("id"));
    const router = o.routers.get(station);
    if (!router) return ctx.json({ error: `no station ${station}` }, 404);
    const raw = await ctx.req.json().catch(() => null);
    if (raw === null) return ctx.json({ error: "the turn is not JSON" }, 400);
    const t = splitTurn(raw);
    if (t.forward.kind === "user") {
      const store = o.lineage();
      store.open({ id, station, subject: o.subject(id), lineage: t.lineage, document: t.document });
      if (t.context !== undefined) {
        const admitted = store.contextPut(id, t.context);
        o.onContext?.(id, admitted);
      }
    }
    const headers = new Headers(ctx.req.raw.headers);
    headers.set("content-type", "application/json");
    headers.delete("content-length");
    return router.request(
      `/${encodeURIComponent(id)}`,
      { method: "POST", headers, body: JSON.stringify(t.forward) },
      ctx.env as never,
    );
  };
}
