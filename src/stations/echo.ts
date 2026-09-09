"use agent";
// SPDX-License-Identifier: AGPL-3.0-only
// The smallest station (Wave 4c D2's live checks): one tool through the
// seam, one model through Kvasir, the phase in durable state. The station
// framework of D3 replaces it with manifests; the shape it proves stays.

import { useModel, usePersistentState, useTool } from "@flue/runtime";
import * as v from "valibot";
import { toolResult } from "../seam/client.ts";
import { seamFor } from "../seam/for.ts";

export function Echo({ id }: { id: string }) {
  useModel(`kvasir-echo/${process.env.ASSISTANT_MODEL ?? "qwen38-27b-fast"}`);
  const [phase, setPhase] = usePersistentState("phase", "start");
  useTool({
    name: "nils_describe",
    description: "One sentence per set of a stored document, and the conventions in force.",
    input: v.object({ document_id: v.number() }),
    async run({ data, toolCallId }) {
      const seam = seamFor("echo", id);
      const a = await seam.door(
        "/api/ask/describe",
        "POST",
        { document_id: data.document_id },
        { toolCallId, phase },
      );
      return toolResult(a);
    },
  });
  useTool({
    name: "settle",
    description: "Settle the run with one sentence.",
    input: v.object({ sentence: v.string() }),
    async run({ data }) {
      setPhase("settled");
      return { output: { settled: true, sentence: data.sentence } };
    },
  });
  return "You describe a stored document by its id with nils_describe, then call settle with one sentence. Nothing else.";
}
