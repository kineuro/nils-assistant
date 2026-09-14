// SPDX-License-Identifier: AGPL-3.0-only
// A conversation exported as markdown (the chat, slice 7): what was said, the
// steps by what they did, and the query versions proposed with the decisions
// on them, from the same snapshot a share holds, so never a tool's input or
// output. It is the owner's own conversation, written out for them to keep.

import { plainMentions } from "./mentions.ts";
import type { Snapshot } from "./shares.ts";

const WORDS: Record<string, string> = {
  nils_draft: "drafted the query",
  nils_values: "looked up the values of a field",
  nils_document: "read the query",
  nils_diagnose: "checked where the counts drop",
  nils_preview: "previewed the first rows",
  nils_describe: "read what the query says",
  nils_handle: "read a result",
  nils_rows: "read rows of a result",
  nils_batches: "read the batches",
  nils_documents: "read the saved queries",
  nils_jobs: "read the jobs",
  nils_capabilities: "read what the registry offers",
  delegate: "handed the question to another station",
  delegation_status: "checked on the handover",
  plan: "planned the work",
  remember: "noted something to keep",
  forget: "forgot something kept",
  search_conversations: "searched earlier conversations",
};

/** A step as a person reads it: known tools by what they do, others by name. */
export function stepWords(name: string): string {
  return WORDS[name] ?? `used ${name.replace(/^nils_/u, "").replace(/_/gu, " ")}`;
}

/** The markdown of a conversation: its title, when it was exported and from which station, then each turn. */
export function markdownOf(o: {
  title: string | null;
  station: string;
  at: string;
  snapshot: Snapshot;
}): string {
  const lines: string[] = [
    `# ${o.title?.trim() || "A conversation"}`,
    "",
    `Exported ${o.at.slice(0, 10)}, from the ${o.station} station.`,
    "",
  ];
  for (const m of o.snapshot.messages) {
    if (m.role === "user") {
      // a card, a cohort or a result named in the words reads plainly, with what it names (the chat, slice 12)
      lines.push("## You", "", plainMentions(m.text, { kinds: true }), "");
      continue;
    }
    lines.push("## The assistant", "");
    const steps = m.steps
      .filter((s) => s.name !== "settle" && s.name !== "advance")
      .map((s) => `${stepWords(s.name)}${s.failed ? " (it failed)" : ""}`);
    if (steps.length > 0) lines.push(`*Steps: ${steps.join("; ")}.*`, "");
    if (m.text) lines.push(m.text, "");
    for (const p of m.proposals)
      lines.push(
        `- A new version of the query, document ${p.document}${p.parent === null ? "" : `, from document ${p.parent}`}: ${p.sentence}${p.decided === "accepted" ? " (accepted)" : p.decided === "rejected" ? " (disregarded)" : ""}`,
      );
    if (m.proposals.length > 0) lines.push("");
  }
  return `${lines
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trimEnd()}\n`;
}
