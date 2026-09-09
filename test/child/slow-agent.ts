// SPDX-License-Identifier: AGPL-3.0-only
// The agent of the host tests: one slow tool, the phase in durable state.

import { useModel, usePersistentState, useTool } from "@flue/runtime";

export function Slow() {
  useModel("fake/m");
  const [phase, setPhase] = usePersistentState("phase", "start");
  useTool({
    name: "slow",
    description: "Takes a while.",
    async run() {
      setPhase("slow");
      const ms = Number(process.env.SLOW_MS ?? 0);
      if (ms > 0) await new Promise((r) => setTimeout(r, ms));
      return { output: { phase } };
    },
  });
  return "Call slow once, then say done.";
}
