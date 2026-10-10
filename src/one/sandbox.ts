// SPDX-License-Identifier: AGPL-3.0-only
// The analysis sandbox (2026-10-10, a trial for the one chat, record 55's
// decisions of that day): Python run offline in Pyodide, in a child Node
// process started for one run alone (bin/python-sandbox.mjs). The child runs
// under Node's permission model, reading only Pyodide's own folder and its
// own file, writing nothing, starting no process, worker or addon, with code
// generation from strings turned off and no environment; before any Python
// runs it takes away the network globals, the process object and Python's
// bridge to JavaScript, and the files it works on live in Pyodide's memory.
// This side holds the caps: the time, the memory the process may use (read
// from /proc while it runs), and the size of its answer. One run at a time.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

export interface SandboxLimits {
  /** How long one run may take, start included. */
  timeoutMs: number;
  /** How much memory the run's process may hold. */
  memoryMb: number;
  /** How long the run's answer may be, its files included. */
  answerBytes: number;
}

export const LIMITS: SandboxLimits = { timeoutMs: 20_000, memoryMb: 768, answerBytes: 600_000 };

export interface SandboxJob {
  code: string;
  /** Files to put in the sandbox's memory, under /data only. */
  files: Record<string, string>;
}

export interface SandboxRun {
  ok: boolean;
  error: string | null;
  /** What the code printed, at most 16,000 characters. */
  printed: string;
  printedCut: boolean;
  /** The code's `result`, as JSON. */
  result?: unknown;
  /** The files the code wrote under /out, each at most 200,000 characters. */
  files?: Record<string, string>;
  /** Why the run was stopped from outside, where it was. */
  stopped?: "time" | "memory" | "output" | "crash";
  ms: number;
}

const STOPPED: Record<NonNullable<SandboxRun["stopped"]>, string> = {
  time: "the analysis ran past its time and was stopped",
  memory: "the analysis took more memory than it may and was stopped",
  output: "the analysis answered more than it may and was stopped",
  crash: "the analysis sandbox did not answer",
};

let paths: { pyodide: string; child: string } | null = null;

/** Where Pyodide's files and the child are: the child sits in bin/ beside the package's node_modules. */
export function sandboxPaths(): { pyodide: string; child: string } {
  if (!paths) {
    const pyodide = dirname(createRequire(import.meta.url).resolve("pyodide/package.json"));
    paths = { pyodide, child: resolve(pyodide, "..", "..", "bin", "python-sandbox.mjs") };
  }
  return paths;
}

/** The arguments the child is started with: what it may read, and nothing else it may do. */
export function childArgs(p: { pyodide: string; child: string } = sandboxPaths()): string[] {
  return [
    "--permission",
    `--allow-fs-read=${p.pyodide}`,
    `--allow-fs-read=${p.child}`,
    "--disallow-code-generation-from-strings",
    "--max-old-space-size=256",
    p.child,
  ];
}

function residentMb(pid: number): number | null {
  try {
    const m = /VmRSS:\s+(\d+)\s+kB/u.exec(readFileSync(`/proc/${pid}/status`, "utf8"));
    return m ? Number(m[1]) / 1024 : null;
  } catch {
    return null;
  }
}

let lane: Promise<unknown> = Promise.resolve();

/** Run one piece of Python over its files, after any run before it has ended. */
export function runPython(job: SandboxJob, limits: SandboxLimits = LIMITS): Promise<SandboxRun> {
  const run = lane.then(() => runOnce(job, limits));
  lane = run.catch(() => undefined);
  return run;
}

function runOnce(job: SandboxJob, limits: SandboxLimits): Promise<SandboxRun> {
  const started = Date.now();
  return new Promise((done) => {
    const child = spawn(process.execPath, childArgs(), { stdio: ["pipe", "pipe", "ignore"], env: {} });
    let out = "";
    let stopped: SandboxRun["stopped"];
    const stop = (why: NonNullable<SandboxRun["stopped"]>) => {
      if (stopped) return;
      stopped = why;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(() => stop("time"), limits.timeoutMs);
    const watch = setInterval(() => {
      const mb = child.pid ? residentMb(child.pid) : null;
      if (mb !== null && mb > limits.memoryMb) stop("memory");
    }, 100);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => {
      out += d;
      if (out.length > limits.answerBytes) stop("output");
    });
    child.stdin.on("error", () => undefined);
    child.on("error", () => stop("crash"));
    child.on("close", () => {
      clearTimeout(timer);
      clearInterval(watch);
      const ms = Date.now() - started;
      if (stopped) {
        done({ ok: false, error: STOPPED[stopped], printed: "", printedCut: false, stopped, ms });
        return;
      }
      try {
        const a = JSON.parse(out.trim().split("\n").pop() ?? "") as Record<string, unknown>;
        done({
          ok: a.ok === true,
          error: typeof a.error === "string" ? a.error : null,
          printed: typeof a.printed === "string" ? a.printed : "",
          printedCut: a.printed_cut === true,
          ...(a.result !== undefined ? { result: a.result } : {}),
          ...(a.files && typeof a.files === "object" ? { files: a.files as Record<string, string> } : {}),
          ms,
        });
      } catch {
        done({ ok: false, error: STOPPED.crash, printed: "", printedCut: false, stopped: "crash", ms });
      }
    });
    child.stdin.end(JSON.stringify(job));
  });
}
