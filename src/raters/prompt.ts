// SPDX-License-Identifier: AGPL-3.0-only
// The rater's prompt and answer schema, composed from the registered texts and the campaign's served question
// (audit_raters_7b.py: served_vocabulary, compose_prompt, extend_schema). The question's `values` and each
// value's `meaning` replace the prompt's per-axis value lists where the question serves them; the fixed text is
// untouched, and an axis the question does not serve keeps the prompt's list.

import { createHash } from "node:crypto";

export interface Question {
  axes?: unknown;
  values?: Record<string, unknown[]>;
  vocabulary?: Record<string, Record<string, { meaning?: unknown }>>;
  earlier_names?: Record<string, Record<string, string | null>>;
}

const VOCAB_HEAD = "## The vocabulary";
const VOCAB_BULLET = /^- `/u;

const sha = (lines: string[]) => createHash("sha256").update(lines.join("\n")).digest("hex");

/** The value id a served value names: a string, or an object with `value`. */
export function valueId(v: unknown): string | null {
  if (typeof v === "string") return v;
  const id = (v as { value?: unknown } | null)?.value;
  return typeof id === "string" ? id : null;
}

/**
 * {axis: [[value, meaning], ...]} from the served question (`values` in its order, `vocabulary[axis][value]
 * .meaning`). An axis where any value lacks a meaning is left out, so it keeps the prompt's fixed list.
 */
export function servedVocabulary(question: Question | null | undefined): Record<string, [string, string][]> {
  const out: Record<string, [string, string][]> = {};
  for (const [axis, vals] of Object.entries(question?.values ?? {})) {
    const voc = question?.vocabulary?.[axis] ?? {};
    const items: [string, string][] = [];
    let whole = true;
    for (const v of vals) {
      const id = valueId(v);
      const meaning = id ? voc[id]?.meaning : null;
      if (!id || typeof meaning !== "string" || !meaning.trim()) {
        whole = false;
        break;
      }
      items.push([id, meaning.split(/\s+/u).join(" ")]);
    }
    if (whole && items.length > 0) out[axis] = items;
  }
  return out;
}

export interface Vocabulary {
  source: "question" | "prompt";
  axes_served: string[];
  fixed_sha256: string;
  vocabulary_sha256: string;
}

/**
 * The prompt with the per-axis value lists of its vocabulary section replaced, for every axis the served
 * question gives values and meanings for, by the question's own (`- value: meaning`). Returns the text and the
 * sha256 of the fixed lines alone and of the generated lines alone.
 */
export function composePrompt(
  text: string,
  question: Question | null | undefined,
): { text: string; vocabulary: Vocabulary } {
  const served = servedVocabulary(question);
  const out: string[] = [];
  const fixed: string[] = [];
  const gen: string[] = [];
  const done: string[] = [];
  let inVocab = false;
  let axis: string | null = null;
  let wrote = false;
  for (const ln of text.split("\n")) {
    if (ln.startsWith("## ")) {
      inVocab = ln.startsWith(VOCAB_HEAD);
      axis = null;
    } else if (inVocab && ln.startsWith("### ")) {
      axis = ln.slice(4).trim();
      wrote = false;
    }
    if (inVocab && axis !== null && axis in served && VOCAB_BULLET.test(ln)) {
      if (!wrote) {
        for (const [id, meaning] of served[axis] as [string, string][]) {
          const g = `- \`${id}\`: ${meaning}`;
          out.push(g);
          gen.push(g);
        }
        wrote = true;
        done.push(axis);
      }
      continue;
    }
    out.push(ln);
    fixed.push(ln);
  }
  return {
    text: out.join("\n"),
    vocabulary: {
      source: done.length > 0 ? "question" : "prompt",
      axes_served: done,
      fixed_sha256: sha(fixed),
      vocabulary_sha256: sha(gen),
    },
  };
}

type Node = Record<string, unknown>;

/**
 * The registered schema's value enums, widened by the values the question serves and the schema lacks (a value
 * the schema cannot emit could never be answered). Never narrowed; a schema of another shape is left.
 */
export function extendSchema(schema: Node, question: Question | null | undefined): Node {
  const served = servedVocabulary(question);
  const sch = JSON.parse(JSON.stringify(schema)) as Node;
  for (const [axis, items] of Object.entries(served)) {
    const props = (sch.properties as Record<string, Node> | undefined)?.[axis]?.properties as
      | Record<string, Node>
      | undefined;
    const node = props?.value;
    if (!node || typeof node !== "object") continue;
    const ids = items.map(([v]) => v);
    // a single-valued axis: the node's enum; a list axis: the array branch's items (not the cant_tell branch)
    const branches: Node[] =
      "enum" in node
        ? [node]
        : ((node.anyOf as Node[] | undefined) ?? []).filter(
            (b) =>
              b.type === "array" && b.items && typeof b.items === "object" && "enum" in (b.items as Node),
          );
    for (const b of branches) {
      const tgt = (b.type === "array" ? b.items : b) as Node;
      const had = tgt.enum as string[];
      tgt.enum = [...had, ...ids.filter((v) => !had.includes(v))];
    }
  }
  return sch;
}
