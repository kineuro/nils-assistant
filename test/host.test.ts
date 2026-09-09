// SPDX-License-Identifier: AGPL-3.0-only
// The host (Wave 4c D2): a conversation survives a process kill and round
// trips through export, on Flue's store; the capabilities document; the
// records file passes the redactor.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { init } from "@flue/runtime";
import { sqlite, start } from "@flue/runtime/node";
import { afterAll, describe, expect, it } from "vitest";
import { config } from "../src/config.ts";
import { capabilities } from "../src/host/capabilities.ts";
import { exportStore, importStore } from "../src/host/records.ts";
import { fakeProvider } from "./child/fake-provider.ts";
import { Slow } from "./child/slow-agent.ts";

const closers: (() => Promise<void> | void)[] = [];
afterAll(async () => {
  for (const c of closers) await c();
});

describe("the host", () => {
  it("names itself, its stations and that telemetry content is off", () => {
    const c = config({ NILS_URL: "http://e", KVASIR_URL: "http://k", KVASIR_KEY: "kvs_x" });
    const doc = capabilities(
      c,
      [
        {
          id: "echo",
          app: "nils-assistant",
          purpose: "assistant.echo",
          content: "catalog",
          ceiling: "reader",
          brief: { path: "", hash: "" },
          budget: {},
          writes: [],
        },
      ],
      { teaching_open: false, conversations: 0 },
    );
    expect(doc).toMatchObject({
      assistant: { name: "nils-assistant" },
      runtime: { flue: "2.0.3", pi_ai: "0.83.0" },
      telemetry: { content: "off" },
    });
    expect((doc.stations as unknown[]).length).toBe(1);
    expect(JSON.stringify(doc)).not.toContain("kvs_x");
  });

  it("a conversation survives a process kill and round-trips through export", async () => {
    const dir = mkdtempSync(join(tmpdir(), "host-"));
    const file = join(dir, "assistant.sqlite");
    const id = "conv-kill";
    // the child dies mid-tool
    // the child is the compiled JavaScript of test/child (npm test builds it first): a plain node process in a plain environment
    const child = spawn(
      process.execPath,
      [join(import.meta.dirname, "..", "dist", "test", "child", "kill.js"), file, id],
      {
        cwd: join(import.meta.dirname, ".."),
        stdio: ["ignore", "pipe", "pipe"],
        env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", SLOW_MS: "60000" },
      },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += String(d);
    });
    child.stderr.on("data", (d) => {
      err += String(d);
    });
    const code = await new Promise<number | null>((r) => child.on("exit", r));
    expect(code, err).toBe(137);
    const { submissionId } = JSON.parse(out.trim().split("\n").pop() ?? "{}") as { submissionId: string };
    expect(submissionId).toBeTruthy();
    // a replacement owner wakes on the same file and settles the interrupted work
    process.env.SLOW_MS = "0";
    const flue = await start({
      agents: [{ agent: Slow, name: "slow" }],
      db: sqlite(file),
      providers: [fakeProvider()],
    });
    closers.push(() => flue.stop());
    const handle = init(Slow, { id });
    const reply = await handle.read(submissionId);
    expect(reply.text).toBe("done");
    // the export as tables, its import into a fresh store the runtime opened once, and the same bytes back
    await flue.stop();
    closers.pop();
    const exported = await exportStore(file);
    expect(Object.keys(exported.tables)).toContain("flue_conversation_stream_batches");
    expect(exported.tables.flue_conversation_stream_batches.length).toBeGreaterThan(0);
    const copy = join(dir, "copy.sqlite");
    const second = await start({
      agents: [{ agent: Slow, name: "slow" }],
      db: sqlite(copy),
      providers: [fakeProvider()],
    });
    await second.stop();
    const r = await importStore(copy, exported);
    expect(r.rows).toBe(
      Object.values(exported.tables).reduce((n, t) => n + t.length, 0) - exported.tables.flue_meta.length,
    );
    const back = await exportStore(copy);
    expect(back.tables).toEqual(exported.tables);
    // a reviewer's copy is redacted and says so, and is refused on import
    const reviewer = await exportStore(file, { redact: true });
    expect(reviewer.redacted).toBe(true);
    await expect(importStore(copy, reviewer)).rejects.toThrow(/reviewer's copy/u);
    // and the recovered conversation reads back from the copy
    const third = await start({
      agents: [{ agent: Slow, name: "slow" }],
      db: sqlite(copy),
      providers: [fakeProvider()],
    });
    closers.push(() => third.stop());
    expect((await init(Slow, { id }).read(submissionId)).text).toBe("done");
    expect(readFileSync(file).includes("kvs_")).toBe(false);
  }, 60_000);
});
