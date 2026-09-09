// SPDX-License-Identifier: AGPL-3.0-only
// The person's token for the turn (§5.5): handed by the desk per turn and
// pushed fresh before expiry for every conversation with an open
// submission. Held in memory, keyed by conversation, never written to the
// store and never logged.

export interface Held {
  token: string;
  /** Unix seconds, from the token's exp claim when it has one. */
  expiresAt: number | null;
}

function expOf(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

export class Tokens {
  private readonly held = new Map<string, Held>();

  put(conversation: string, token: string): Held {
    const h = { token, expiresAt: expOf(token) };
    this.held.set(conversation, h);
    return h;
  }

  /** The token for a conversation, or null when none or expired: the run then ends with `token_unavailable`. */
  get(conversation: string, now = Math.floor(Date.now() / 1000)): string | null {
    const h = this.held.get(conversation);
    if (!h) return null;
    if (h.expiresAt !== null && h.expiresAt <= now) return null;
    return h.token;
  }

  forget(conversation: string): void {
    this.held.delete(conversation);
  }

  /** Conversations whose token expires within `seconds`: what the desk should push for. */
  expiring(seconds: number, now = Math.floor(Date.now() / 1000)): string[] {
    return [...this.held.entries()]
      .filter(([, h]) => h.expiresAt !== null && h.expiresAt - now <= seconds)
      .map(([c]) => c);
  }
}
