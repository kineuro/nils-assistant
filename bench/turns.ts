// SPDX-License-Identifier: AGPL-3.0-only
// What a turn of a conversation left, read the same way by bench/chains.ts
// (the stations) and bench/one-chat.ts (the one agent), and the comparison
// of its document with a gold.
//
// The final verdict, not the first (the concierge bench defect of
// 2026-10-08): a station that hands its work to another settles at once
// with a sentence and no document, and the document arrives later, in the
// delegate's verdict and in the parent's woken turn. A turn is read when
// its run has settled, every delegation it started has settled, and the
// parent's verdict has moved on from the one its run first left (or a
// bound has passed). Of what the turn left, in order, the last verdict that
// names a document is the turn's; with none, the last verdict.

export interface VerdictLike {
  result?: { document?: unknown; [k: string]: unknown } | null;
  [k: string]: unknown;
}

/** The turn's verdict among those it left, in order: the last that names a document, else the last. */
export function finalOf<V extends VerdictLike>(verdicts: (V | null | undefined)[]): V | null {
  const seen = verdicts.filter((v): v is V => v !== null && v !== undefined);
  for (let i = seen.length - 1; i >= 0; i--) if (typeof seen[i].result?.document === "number") return seen[i];
  return seen.at(-1) ?? null;
}

/** The document a verdict names, or null. */
export const documentOf = (v: VerdictLike | null): number | null =>
  typeof v?.result?.document === "number" ? (v.result.document as number) : null;

interface DelegationView {
  task: string;
  state: string;
  result?: { document?: unknown } | null;
  verdict?: VerdictLike | null;
}

/** How a station turn is read back; `get` answers a host path as JSON (or null), `sleep` waits. */
export interface SettleDeps {
  get: (path: string) => Promise<Record<string, unknown> | null>;
  sleep: (ms: number) => Promise<void>;
  /** How long to wait for delegations and the woken parent, in polls of `every` ms. */
  polls?: number;
  every?: number;
}

/**
 * Every verdict a station turn left, in order, once its run has settled: the run's first, each delegation's
 * started in the turn (by task order), and the conversation's latest once the woken parent has settled.
 */
export async function verdictsOfTurn(
  d: SettleDeps,
  o: { run: string; conversation: string; delegationsBefore: number },
): Promise<VerdictLike[]> {
  const polls = d.polls ?? 60;
  const every = d.every ?? 2000;
  const verdict = async () => {
    const v = await d.get(`/runs/${o.run}/verdict`);
    return v && !("error" in v) ? (v as VerdictLike) : null;
  };
  const first = await verdict();
  const out: VerdictLike[] = first ? [first] : [];
  const tasks = async (): Promise<DelegationView[]> => {
    const body = (await d.get(`/conversations/${o.conversation}/delegations`)) as {
      tasks?: DelegationView[];
    } | null;
    return (body?.tasks ?? []).slice(o.delegationsBefore);
  };
  let mine = await tasks();
  if (mine.length === 0) return out;
  for (let i = 0; i < polls && mine.some((t) => t.state === "queued" || t.state === "running"); i++) {
    await d.sleep(every);
    mine = await tasks();
  }
  for (const t of mine) {
    if (t.verdict) out.push(t.verdict);
    else if (t.result) out.push({ result: t.result as VerdictLike["result"] });
  }
  // the parent is woken by each settled delegation; its verdict replaces the first when it settles
  const before = JSON.stringify(first);
  let last = first;
  for (let i = 0; i < polls; i++) {
    last = await verdict();
    if (JSON.stringify(last) !== before) break;
    await d.sleep(every);
  }
  if (last && JSON.stringify(last) !== before) out.push(last);
  return out;
}

/** The engine's answer to a document: its content hash, row count and scheme digest. */
export interface Ran {
  content_hash: string | null;
  row_count: number;
  digest: string | null;
  error: string | null;
}

/** The engine doors a gold comparison needs, with the person's token on each. */
export function engine(nils: string, token: string) {
  const post = async (path: string, body: unknown): Promise<Record<string, unknown>> => {
    const r = await fetch(`${nils}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    return (await r.json()) as Record<string, unknown>;
  };
  const run = async (document: number): Promise<Ran> => {
    const ran = await post("/api/ask/run", { document_id: document });
    const decl = ran.declaration as { session_scheme?: { digest?: string } } | undefined;
    return {
      content_hash: typeof ran.content_hash === "string" ? ran.content_hash : null,
      row_count: typeof ran.row_count === "number" ? ran.row_count : -1,
      digest: decl?.session_scheme?.digest ?? null,
      error: ran.error ? String(ran.error).slice(0, 120) : null,
    };
  };
  /** A gold's text drafted now: its document, so the answers compare. */
  const draft = async (text: string): Promise<number | null> => {
    const stored = await post("/api/ask/draft", { text });
    return typeof stored.document === "number" ? stored.document : null;
  };
  /** The same answer as the gold: the set of subject codes when both carry one, else the one row of a count. */
  const same = async (document: number, goldDocument: number): Promise<boolean> => {
    const codes = async (id: number): Promise<{ codes: string[] | null; first: string; n: number }> => {
      const r = await post("/api/ask/run", { document_id: id });
      const cols = ((r.columns as (string | { name: string })[] | undefined) ?? []).map((c) =>
        typeof c === "string" ? c : c.name,
      );
      const k = cols.findIndex((c) => c === "code" || c.endsWith(".code"));
      const rows = (r.rows as unknown[][] | undefined) ?? [];
      // the values of the first row without the technical columns, sorted: a count answered as rows and subjects, or as two named aggregates, is the same answer
      const keep = cols.map((c) => !c.startsWith("_"));
      const first = (rows[0] ?? [])
        .filter((_, i) => keep[i])
        .map((v) => JSON.stringify(v))
        .sort();
      return {
        codes: k < 0 ? null : [...new Set(rows.map((row) => String(row[k])))].sort(),
        first: JSON.stringify(first),
        n: typeof r.row_count === "number" ? r.row_count : -1,
      };
    };
    const [a, b] = await Promise.all([codes(document), codes(goldDocument)]);
    if (a.codes && b.codes)
      return a.codes.length === b.codes.length && a.codes.every((v, i) => v === b.codes?.[i]);
    return a.n === b.n && (a.n !== 1 || a.first === b.first);
  };
  /** The document reached the gold: the same content hash, else the same answer as the gold's own document. */
  const reached = async (
    document: number | null,
    want: { content_hash: string | null } | undefined,
    goldDocument: number | null,
  ): Promise<boolean> => {
    if (document === null) return false;
    const r = await run(document);
    if (want?.content_hash && r.content_hash === want.content_hash) return true;
    if (goldDocument === null) return false;
    return same(document, goldDocument).catch(() => false);
  };
  /** The question a document holds, as the engine stores it, as JSON text; null when it cannot be read. */
  const ask = async (document: number | null): Promise<string | null> => {
    if (document === null) return null;
    const r = await fetch(`${nils}/api/ask/documents/${document}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const body = (await r.json().catch(() => null)) as { ask?: unknown } | null;
    return body?.ask === undefined ? null : JSON.stringify(body.ask);
  };
  return { run, draft, same, reached, ask };
}
