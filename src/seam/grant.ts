// SPDX-License-Identifier: AGPL-3.0-only
// The grant (Wave 4c §9.3, §9.4): the door operations a station may call and
// the caps per operation, applied before the seam dials. An operation is
// named the way the manifest names it: the door path after /api/ask/ with
// {id} for a path parameter, so `catalog`, `catalog/{level}`, `options`,
// `handles/{id}/rows`. A blocked call returns a reason the model reads, not
// a crash. A decision-apply verb is never in any grant, which a test proves
// by reading every manifest.

export interface Cap {
  /** Calls allowed per run; absent means unbounded by count. */
  calls?: number;
  /** Rows the operation may ask for at once. */
  rows?: number;
}

export type Grant = Record<string, Cap>;

/** The verbs no station may hold: writes the engine governs by a person (§9.6). */
export const FORBIDDEN = [
  "review/{id}/apply",
  "review/{id}/accept",
  "decisions/{id}/commit",
  "decisions/{id}/withdraw",
  "overlays/{id}/adopt",
  "handles/{id}/promote",
  "releases",
  "handovers",
  "sessions/rebuild",
  "values",
] as const;

/** The operation an engine path names, in the grant's vocabulary. */
export function operationOf(method: string, path: string): string {
  const p = path.replace(/^\/+/u, "").replace(/\?.*$/u, "");
  const under = p.startsWith("api/ask/")
    ? p.slice("api/ask/".length)
    : p.startsWith("api/")
      ? p.slice("api/".length)
      : p;
  const named = under
    .split("/")
    .map((seg) => (/^\d+$/u.test(seg) ? "{id}" : seg))
    .join("/");
  // the catalog's level and the sampler's field are path parameters too
  const m = /^catalog\/([^/]+)(\/([^/]+)\/values)?$/u.exec(named);
  if (m) return m[2] ? "catalog/{level}/{field}/values" : "catalog/{level}";
  return method.toUpperCase() === "GET" && named === "capabilities" ? "capabilities" : named;
}

export interface Decision {
  allowed: boolean;
  operation: string;
  reason: string | null;
}

export class GrantKeeper {
  private readonly used = new Map<string, number>();
  constructor(readonly grant: Grant) {
    for (const f of FORBIDDEN) {
      if (f in grant)
        throw new Error(`a grant may not hold ${f}: a decision apply is a person's (Wave 4c section 9.6)`);
    }
  }

  /** Whether a call may dial, and why not when it may not. The count is taken when allowed. */
  decide(method: string, path: string, rows?: number): Decision {
    const operation = operationOf(method, path);
    const cap = this.grant[operation];
    if (!cap)
      return {
        allowed: false,
        operation,
        reason: `${operation} is not in this station's grant; the grant holds ${Object.keys(this.grant).join(", ") || "nothing"}`,
      };
    const n = this.used.get(operation) ?? 0;
    if (cap.calls !== undefined && n >= cap.calls)
      return {
        allowed: false,
        operation,
        reason: `${operation} was called ${n} times; the cap is ${cap.calls}`,
      };
    if (cap.rows !== undefined && rows !== undefined && rows > cap.rows)
      return {
        allowed: false,
        operation,
        reason: `${operation} asked for ${rows} rows; the cap is ${cap.rows}`,
      };
    this.used.set(operation, n + 1);
    return { allowed: true, operation, reason: null };
  }

  counts(): Record<string, number> {
    return Object.fromEntries(this.used);
  }
}
