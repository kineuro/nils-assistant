// SPDX-License-Identifier: AGPL-3.0-only
// Who may use a conversation (the chat, slice 1). Every door that names a
// conversation asks first: the person the bearer names, read from the engine,
// must own it. A conversation the host has not seen is opened by the turn or
// the token push that names it, for the person who sent it. Anything else
// answers as if the conversation did not exist, so an id tells a stranger
// nothing, and a stranger's token is never kept for a conversation not theirs.

import type { MiddlewareHandler } from "hono";
import type { Lineage } from "./lineage.ts";
import { bearerOf, type Person } from "./people.ts";

export type Door =
  | { kind: "open" }
  | { kind: "person" }
  | { kind: "conversation"; id: string; opens: boolean; tokenInBody?: true };

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** What a request needs, by its method and path: nothing, a person, or a conversation that person owns. */
export function doorOf(method: string, path: string): Door {
  const agent = /^\/agents\/[^/]+\/([^/]+)(\/.*)?$/u.exec(path);
  if (agent) return { kind: "conversation", id: decode(agent[1]), opens: method === "POST" && !agent[2] };
  const part = /^\/conversations\/([^/]+)\/(token|feedback|delegations)$/u.exec(path);
  // the desk pushes a person's fresh token in the body, with no header: that token names the person
  if (part && part[2] === "token" && method === "POST")
    return { kind: "conversation", id: decode(part[1]), opens: true, tokenInBody: true };
  if (part) return { kind: "conversation", id: decode(part[1]), opens: false };
  // a person's own notes: the conversation in the path only says where the desk asked from
  if (/^\/conversations\/[^/]+\/notes$/u.test(path)) return { kind: "person" };
  const one = /^\/conversations\/([^/]+)$/u.exec(path);
  if (one) return { kind: "conversation", id: decode(one[1]), opens: false };
  const ledger = /^\/ledger\/([^/]+)$/u.exec(path);
  if (ledger) return { kind: "conversation", id: decode(ledger[1]), opens: false };
  if (
    path === "/conversations" ||
    /^\/stations\/[^/]+\/runs$/u.test(path) ||
    /^\/runs\/[^/]+(\/verdict)?$/u.test(path) ||
    (path === "/notes/institutional" && method !== "GET")
  )
    return { kind: "person" };
  return { kind: "open" };
}

const seen = new WeakMap<Request, Person>();

/** The person a guarded request came from; null for a door that needs none. */
export function personIn(req: Request): Person | null {
  return seen.get(req) ?? null;
}

export function guard(o: {
  people: { of(token: string | null): Promise<Person | null> };
  lineage: () => Lineage;
  authOff: () => boolean;
  /** Called with the person before the door runs: where rows written under older keys are adopted. */
  onPerson?: (p: Person) => void;
}): MiddlewareHandler {
  return async (ctx, next) => {
    const door = doorOf(ctx.req.method, ctx.req.path);
    if (door.kind === "open") return next();
    const token =
      door.kind === "conversation" && door.tokenInBody
        ? await ctx.req.json().then(
            (b: { token?: unknown }) => (typeof b?.token === "string" ? b.token : null),
            () => null,
          )
        : bearerOf(ctx.req.header("authorization"));
    const person = await o.people.of(token);
    if (!person)
      return ctx.json({ error: "no person: the desk sends the person's token with every call" }, 401);
    seen.set(ctx.req.raw, person);
    o.onPerson?.(person);
    if (door.kind === "person") return next();
    const access = o.lineage().access(door.id, person.principal, { authOff: o.authOff() });
    if (access === "owner" || (access === "unknown" && door.opens)) return next();
    return ctx.json({ error: `no conversation ${door.id}` }, 404);
  };
}
