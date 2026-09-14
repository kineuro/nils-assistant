// SPDX-License-Identifier: AGPL-3.0-only
// Who a request comes from (the chat, slice 1). The engine names a person by
// their principal, `sub@node`, and says their roles; the host asks it once
// per token and keeps the answer for five minutes, or until the token
// expires. Every store keys a person by that principal, so the notes, the
// conversations and the plans a person makes in the chat are the same
// person's as their grants and their inbox.

import { createHash } from "node:crypto";
import type { PolicyRow } from "./ladder.ts";

export interface Person {
  principal: string;
  roles: string[];
  entitlements: string[];
  policy: PolicyRow[];
  /** The name the engine gives the person, when it gives one (the chat, slice 5). */
  display?: string | null;
}

/** The engine's capabilities read with a token, or with none when the engine serves with its authentication off; null when it refuses. */
export type ReadCapabilities = (token: string | null) => Promise<Record<string, unknown> | null>;

const KEEP_MS = 5 * 60_000;

function expiresAt(token: string | null): number | null {
  const parts = token?.split(".") ?? [];
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export class People {
  private readonly known = new Map<string, { person: Person; until: number }>();

  constructor(
    private readonly read: ReadCapabilities,
    private readonly now: () => number = Date.now,
  ) {}

  /** The person a token names, or null when the engine does not know it. */
  async of(token: string | null): Promise<Person | null> {
    const key = token ? createHash("sha256").update(token).digest("hex") : "";
    const at = this.now();
    const hit = this.known.get(key);
    if (hit && hit.until > at) return hit.person;
    this.known.delete(key);
    const doc = await this.read(token);
    if (!doc || typeof doc.principal !== "string" || !doc.principal) return null;
    const roles = Array.isArray(doc.roles) ? doc.roles.map(String) : [];
    const person: Person = {
      principal: doc.principal,
      roles,
      entitlements: Array.isArray(doc.entitlements) ? doc.entitlements.map(String) : roles,
      policy: Array.isArray(doc.policy) ? (doc.policy as PolicyRow[]) : [],
      display: typeof doc.display === "string" && doc.display ? doc.display : null,
    };
    this.known.set(key, {
      person,
      until: Math.min(at + KEEP_MS, expiresAt(token) ?? Number.POSITIVE_INFINITY),
    });
    return person;
  }
}

/** The part of a principal a token's `sub` gave, which rows written before the principal was kept are keyed by. */
export function bareOf(principal: string): string {
  const at = principal.lastIndexOf("@");
  return at > 0 ? principal.slice(0, at) : principal;
}

/** The bearer of an Authorization header. */
export function bearerOf(header: string | undefined): string | null {
  const h = header ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}
