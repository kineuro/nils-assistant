// SPDX-License-Identifier: AGPL-3.0-only
// The attribution order, once (Wave 4c §9.10 part 4): where a failure is
// attributed, in the order a diagnosis walks. One table generates both the
// code path (the components, in order, each with the test that clears it)
// and the prompt text a diagnoser reads, so the two can never disagree.

export interface Component {
  id:
    | "domain_knowledge"
    | "tool_description"
    | "prompt"
    | "control_flow"
    | "tool_behaviour"
    | "configuration"
    | "delegation";
  /** What a failure here looks like. */
  looks_like: string;
  /** What clears this component, so the walk moves on. */
  cleared_by: string;
  /** What kind of edit repairs it; the change manifest names one. */
  repaired_by: string;
}

export const ORDER: readonly Component[] = [
  {
    id: "domain_knowledge",
    looks_like:
      "a wrong reading of a term of the registry: a grain, a scheme, an axis, a level, a default exclusion",
    cleared_by: "the guide door's grounding names the term the way the answer needed it",
    repaired_by: "a pack release: the grounding, an example, a keyword",
  },
  {
    id: "tool_description",
    looks_like: "the right tool with the wrong arguments, or the wrong tool of two near ones",
    cleared_by: "the tool's description and schema state the argument the call missed",
    repaired_by: "the tool description or its schema",
  },
  {
    id: "prompt",
    looks_like:
      "the right tools and arguments but no plan, a plan in the wrong order, or a silent decision taken",
    cleared_by: "the brief states the phase order and the six decisions to declare",
    repaired_by: "the brief",
  },
  {
    id: "control_flow",
    looks_like: "a phase left too early or too late, a check not run, a loop",
    cleared_by: "the phase machine's transitions and checks allow only the order the brief states",
    repaired_by: "the station's phases, checks or budget",
  },
  {
    id: "tool_behaviour",
    looks_like: "a correct call answered wrongly or not at all: a door's bug, a cap, a refusal",
    cleared_by: "the same call replayed against the engine answers as the fixture expects",
    repaired_by: "the engine, in its own repository",
  },
  {
    id: "configuration",
    looks_like: "a grant, a cap, a purpose or a backend that removed the option the answer needed",
    cleared_by: "the manifest and the deployment document allow the operation at the cap the answer needed",
    repaired_by: "the manifest or the deployment",
  },
  {
    id: "delegation",
    looks_like: "the concierge chose the wrong station, or a delegate's verdict was misread",
    cleared_by: "the delegation's task and its verdict match the question and the answer",
    repaired_by: "the concierge's roster or its prompt",
  },
] as const;

export type ComponentId = Component["id"];

/** The code path: the components in order, for a diagnosis to walk. */
export function path(): readonly ComponentId[] {
  return ORDER.map((c) => c.id);
}

/** The prompt text a diagnoser reads, generated from the same table. */
export function prompt(): string {
  const lines = [
    "Attribute the failure to the first component in this order that is not cleared. Do not skip ahead.",
    "",
  ];
  ORDER.forEach((c, i) => {
    lines.push(
      `${i + 1}. ${c.id.replace("_", " ")}: it looks like ${c.looks_like}. It is cleared when ${c.cleared_by}. It is repaired by ${c.repaired_by}.`,
    );
  });
  lines.push(
    "",
    "Name the component, the evidence that the earlier ones are cleared, and the one edit that repairs it.",
  );
  return lines.join("\n");
}
