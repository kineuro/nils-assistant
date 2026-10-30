// SPDX-License-Identifier: AGPL-3.0-only
// Record 57 P9: an approved analysis plan tells the engine which proposal the run came from.
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decide } from "../src/one/apply.ts";
import { ChangeStore } from "../src/one/changes.ts";
import { Ledger } from "../src/seam/ledger.ts";

function setup() {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? ".", "proposed-by-"));
  const changes = new ChangeStore(join(dir, "changes.sqlite"));
  const ledger = new Ledger(join(dir, "seam.sqlite"));
  const sent: { path: string; body: unknown }[] = [];
  const seam = () =>
    ({
      call: async (r: { path: string; body: unknown }) => {
        sent.push({ path: r.path, body: r.body });
        return { kind: "ok", body: {} };
      },
    }) as never;
  const deps = { changes, ledger, seam, confirmPlan: async () => ({ refused: "no plan" }) };
  const propose = (kind: "analysis_plan" | "identity_merge", payload: Record<string, unknown>) =>
    changes.propose({ conversation: "c", subject: "anna@n", kind, sentence: "s", payload });
  return { deps, sent, propose };
}

describe("proposed_by on an approved plan", () => {
  it("rides the job body", async () => {
    const { deps, sent, propose } = setup();
    const c = propose("analysis_plan", { command: ["run", "synthseg@2", "--select", "selection:x@1"] });
    expect((await decide(deps, c.id, "anna@n", "approved")).ok).toBe(true);
    expect(sent).toEqual([
      {
        path: "/api/jobs",
        body: {
          command: ["run", "synthseg@2", "--select", "selection:x@1"],
          proposed_by: { agent: "assistant.concierge", proposal: c.id },
        },
      },
    ]);
  });

  it("rides the workflow run body beside what the plan carried", async () => {
    const { deps, sent, propose } = setup();
    const c = propose("analysis_plan", {
      workflow: { label: "wf-1", body: { dataset: "d", knobs: { a: 1 } } },
    });
    expect((await decide(deps, c.id, "anna@n", "approved")).ok).toBe(true);
    expect(sent).toEqual([
      {
        path: "/api/workflows/wf-1/run",
        body: {
          dataset: "d",
          knobs: { a: 1 },
          proposed_by: { agent: "assistant.concierge", proposal: c.id },
        },
      },
    ]);
  });

  it("is not sent for a proposal that is no plan", async () => {
    const { deps, sent, propose } = setup();
    const c = propose("identity_merge", { canonical: "A", alias: "B", why: "same" });
    expect((await decide(deps, c.id, "anna@n", "approved")).ok).toBe(true);
    expect(JSON.stringify(sent)).not.toContain("proposed_by");
  });
});
