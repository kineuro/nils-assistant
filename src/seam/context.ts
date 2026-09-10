// SPDX-License-Identifier: AGPL-3.0-only
// The rail's context, typed (Wave 5 section 9.2). The desk sends beside a
// user turn what the page under the rail contributes; this is the same
// allowlist the desk applies before sending (nils-desk web/src/ui/context.ts),
// applied again here because the host trusts no caller with the prompt:
// identifiers, names, counts and codes cross; a row never does. What the
// station reads is one short line per item, so the local model reads where
// the person is without paging for it.

export interface PageContext {
  page: { kind: string; id: string | null };
  document_id?: number;
  content_hash?: string;
  chain?: number[];
  epoch?: number;
  sets?: { name: string; grain: string }[];
  funnel?: { set: string; rows: number }[];
  pack?: { name: string; version: string };
  handle_id?: number;
  declaration?: Record<string, string | number | boolean | null>;
  error_codes?: string[];
  job_ids?: number[];
}

const MAX_TEXT = 200;
const MAX_LIST = 64;
const NAME = /^[A-Za-z0-9_.:@+ -]{1,200}$/u;

function scalar(v: unknown): v is string | number | boolean | null {
  return (
    v === null ||
    typeof v === "number" ||
    typeof v === "boolean" ||
    (typeof v === "string" && v.length <= MAX_TEXT)
  );
}
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const name = (v: unknown): v is string => typeof v === "string" && NAME.test(v);

/** The context a turn may carry: the allowlisted keys, each in its shape, nothing else. */
export function admit(input: unknown): PageContext {
  const src = (input && typeof input === "object" && !Array.isArray(input) ? input : {}) as Record<
    string,
    unknown
  >;
  const page = src.page as { kind?: unknown; id?: unknown } | undefined;
  const out: PageContext = {
    page: {
      kind: name(page?.kind) ? page.kind : "unknown",
      id: name(page?.id) ? page.id : null,
    },
  };
  if (num(src.document_id)) out.document_id = src.document_id;
  if (num(src.handle_id)) out.handle_id = src.handle_id;
  if (num(src.epoch)) out.epoch = src.epoch;
  if (typeof src.content_hash === "string" && /^[0-9a-f]{8,64}$/u.test(src.content_hash))
    out.content_hash = src.content_hash;
  if (Array.isArray(src.chain)) out.chain = src.chain.filter(num).slice(0, MAX_LIST);
  if (Array.isArray(src.job_ids)) out.job_ids = src.job_ids.filter(num).slice(0, MAX_LIST);
  if (Array.isArray(src.error_codes)) out.error_codes = src.error_codes.filter(name).slice(0, MAX_LIST);
  if (Array.isArray(src.sets))
    out.sets = src.sets
      .flatMap((x) => {
        const s = x as { name?: unknown; grain?: unknown } | null;
        return name(s?.name) && name(s?.grain) ? [{ name: s.name, grain: s.grain }] : [];
      })
      .slice(0, MAX_LIST);
  if (Array.isArray(src.funnel))
    out.funnel = src.funnel
      .flatMap((x) => {
        const f = x as { set?: unknown; rows?: unknown } | null;
        return name(f?.set) && num(f?.rows) ? [{ set: f.set, rows: f.rows }] : [];
      })
      .slice(0, MAX_LIST);
  const pack = src.pack as { name?: unknown; version?: unknown } | undefined;
  if (name(pack?.name) && name(pack?.version)) out.pack = { name: pack.name, version: pack.version };
  if (src.declaration && typeof src.declaration === "object" && !Array.isArray(src.declaration)) {
    const d: Record<string, string | number | boolean | null> = {};
    for (const [k, v] of Object.entries(src.declaration as Record<string, unknown>).slice(0, MAX_LIST))
      if (name(k) && scalar(v)) d[k] = v;
    out.declaration = d;
  }
  return out;
}

/** Where the person is, as lines a small model reads once; empty when the context says nothing beyond the page. */
export function renderContext(c: PageContext | null): string {
  if (!c) return "";
  const lines: string[] = [];
  lines.push(`- page: ${c.page.kind}${c.page.id ? ` ${c.page.id}` : ""}`);
  if (c.document_id !== undefined)
    lines.push(
      `- the open document: ${c.document_id}${c.content_hash ? ` (hash ${c.content_hash.slice(0, 12)})` : ""}${c.chain?.length ? `; its versions, newest first: ${c.chain.join(", ")}` : ""}`,
    );
  if (c.epoch !== undefined) lines.push(`- epoch: ${c.epoch}`);
  if (c.sets?.length) lines.push(`- its sets: ${c.sets.map((s) => `${s.name} (${s.grain})`).join(", ")}`);
  if (c.funnel?.length)
    lines.push(`- rows kept per set: ${c.funnel.map((f) => `${f.set} ${f.rows}`).join(", ")}`);
  if (c.pack) lines.push(`- pack: ${c.pack.name} ${c.pack.version}`);
  if (c.handle_id !== undefined) lines.push(`- the open result: handle ${c.handle_id}`);
  if (c.declaration && Object.keys(c.declaration).length)
    lines.push(
      `- the declaration: ${Object.entries(c.declaration)
        .map(([k, v]) => `${k} ${String(v)}`)
        .join(", ")}`,
    );
  if (c.error_codes?.length) lines.push(`- errors on the page: ${c.error_codes.join(", ")}`);
  if (c.job_ids?.length) lines.push(`- jobs on the page: ${c.job_ids.join(", ")}`);
  return `Where the person is (from the desk, identifiers only):\n${lines.join("\n")}`;
}
