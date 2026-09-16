// SPDX-License-Identifier: AGPL-3.0-only
// A stub engine for tool-level tests: one handler answers every door by
// method and path, and every call is kept with its body, so a test reads
// what a station dialled and with what.

import { mkdtempSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Seam, type Station } from "../../src/seam/client.ts";
import { Ledger } from "../../src/seam/ledger.ts";
import type { RunState } from "../../src/stations/machine.ts";

export interface Dialled {
  method: string;
  path: string;
  body: unknown;
}

function text(req: IncomingMessage): Promise<string> {
  return new Promise((r) => {
    let t = "";
    req.on("data", (d) => {
      t += String(d);
    });
    req.on("end", () => r(t));
  });
}

export async function stubEngine(
  answer: (call: Dialled) => { status?: number; body: unknown } | null,
): Promise<{ url: string; seen: Dialled[]; close: () => void }> {
  const seen: Dialled[] = [];
  const server: Server = createServer(async (req, res) => {
    const raw = await text(req);
    const call: Dialled = {
      method: req.method ?? "",
      path: req.url ?? "",
      body: raw ? JSON.parse(raw) : null,
    };
    seen.push(call);
    const a = answer(call) ?? { status: 404, body: { error: "no door" } };
    res.writeHead(a.status ?? 200, { "content-type": "application/json" });
    res.end(JSON.stringify(a.body));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, seen, close: () => server.close() };
}

/** A seam for one station against the stub, with a fresh ledger, the engine's authentication off. */
export function seamOf(
  engine: string,
  station: Omit<Station, "version" | "model">,
  conversation: string,
): Seam {
  const dir = mkdtempSync(join(tmpdir(), "stub-seam-"));
  return new Seam({
    engine,
    station: { ...station, version: "t", model: "none" },
    conversation,
    token: () => null,
    authOff: () => true,
    ledger: new Ledger(join(dir, "seam.sqlite")),
  });
}

/** The context a station tool runs with, at one phase; the machine is not read by the tools under test. */
export function toolContext(seam: Seam, conversation: string, phase: string, n = 0) {
  return {
    seam,
    conversation,
    toolCallId: `call-${n}`,
    state: { phase } as RunState,
    machine: null as never,
  };
}
