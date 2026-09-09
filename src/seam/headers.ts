// SPDX-License-Identifier: AGPL-3.0-only
// The two headers of §5.5 and the idempotency key of §6.3, as
// contracts/suite/v1/headers.schema.json fixes them.

import { createHash } from "node:crypto";

export type Ceiling = "reader" | "reviewer" | "operator" | "admin";

export interface Actor {
  kind: "agent";
  name: string;
  model: string;
  version: string;
  conversation: string;
}

export function actorHeader(a: Actor): string {
  return JSON.stringify({
    kind: a.kind,
    name: a.name,
    model: a.model,
    version: a.version,
    conversation: a.conversation,
  });
}

/** The idempotency key of a call: the tool call id, digested with the operation so a retry of the same call repeats and a different call never collides. */
export function idempotencyKey(toolCallId: string, operation: string): string {
  return createHash("sha256").update(`${operation}\n${toolCallId}`).digest("hex").slice(0, 48);
}

/** The doors that take a key (§6.3). */
export const IDEMPOTENT = new Set(["run", "jobs", "apply", "handles/{id}/promote"]);

/** A digest of the arguments for the ledger: never the arguments. */
export function argumentDigest(body: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(body ?? null))
    .digest("hex")
    .slice(0, 16);
}
