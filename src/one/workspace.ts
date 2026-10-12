// SPDX-License-Identifier: AGPL-3.0-only
// The one chat's analysis workspace (2026-10-12): Flue's virtual sandbox, an
// in-memory filesystem with an emulated bash (just-bash), for a person who
// may read the registry's rows. No real process is started and nothing on
// the host is reached: no network (no curl, Python's sockets fail), no host
// file, no environment. It holds Python 3 with the standard library, xan for
// CSV, jq, awk, sort, sqlite3, and the `chart` command, which draws a CSV as
// a plain SVG figure. The workspace starts empty for every message.
//
// The model works in it with three of Flue's own tools, bash, read and write,
// each held to the turn's guards like every other tool. `analysis_table`
// stages a stored question's rows into /data as CSV. What the model writes
// under /out reaches the person: a chart (SVG or PNG) is shown in the thread
// as an image, and a table (CSV, TSV, text, JSON, Markdown) is offered as a
// download, each as a data part the model never sees. Every limit says
// itself when it is hit.

import { createHash } from "node:crypto";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import {
  type BashLike,
  bash,
  createBashTool,
  createReadTool,
  createWriteTool,
  type Sandbox,
  type SandboxFactory,
  type SandboxToolFactory,
} from "@flue/runtime";
import { Bash, InMemoryFs } from "just-bash";
import { chartCommand, plainSvg } from "./chart.ts";
import { type TurnState, turnOf } from "./state.ts";
import type { Writers } from "./tools.ts";

/** The workspace's limits, each said in words when it is hit. */
export const WORKSPACE = {
  /** One command's wall time, Python included. */
  commandSeconds: 20,
  /** What one command may print, stdout and stderr together. */
  printBytes: 1_048_576,
  /** What the model reads back of one command or file. */
  readChars: 6_000,
  /** Everything the workspace may hold at once. */
  workspaceBytes: 64 * 1_048_576,
  /** Python's own ceiling: CPython built for WebAssembly holds at most 512 MB. */
  pythonMegabytes: 512,
  /** The rows a stored question may put into the workspace. */
  rows: 2_000,
  /** What reaches the person per turn. */
  charts: 4,
  files: 4,
  chartBytes: 200_000,
  fileBytes: 256_000,
} as const;

/** A chart the person sees in the thread, as the desk receives it in the `chart` part. */
export interface ChartItem {
  /** The tool call that made it. */
  call: string | null;
  name: string;
  title: string;
  media: "image/svg+xml" | "image/png";
  encoding: "utf8" | "base64";
  data: string;
  bytes: number;
}

/** A file the person may download, as the desk receives it in the `file` part. */
export interface FileItem {
  call: string | null;
  name: string;
  media: "text/csv" | "text/tab-separated-values" | "text/plain" | "application/json" | "text/markdown";
  encoding: "utf8";
  data: string;
  bytes: number;
  /** A CSV's or TSV's data rows, its header left out; null for other files. */
  rows: number | null;
}

/** The folders: tables come in under /data, the model works in /work, what the person gets goes under /out. */
export const DATA = "/data";
export const WORK = "/work";
export const OUT = "/out";

const FILE_TYPES: Record<string, FileItem["media"]> = {
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  txt: "text/plain",
  json: "application/json",
  md: "text/markdown",
};

/** A new just-bash instance for one message: empty folders, Python on, no network, the chart command, the limits. */
export async function newWorkspace(seconds: number = WORKSPACE.commandSeconds): Promise<Bash> {
  const fs = new InMemoryFs();
  for (const dir of [DATA, WORK, OUT]) await fs.mkdir(dir, { recursive: true });
  return new Bash({
    fs,
    cwd: WORK,
    python: true,
    customCommands: [chartCommand],
    env: { HOME: WORK, LANG: "C.UTF-8" },
    executionLimits: {
      maxExecutionTimeMs: seconds * 1000,
      maxOutputSize: WORKSPACE.printBytes,
      maxFileSystemBytes: WORKSPACE.workspaceBytes,
    },
  });
}

// ------------------------------------------------------------------ what reaches the person

/** The outputs a turn has shown so far, by file name, with the hash each was shown at. */
export interface TurnOutputs {
  charts: ChartItem[];
  files: FileItem[];
  seen: Map<string, string>;
}

const kb = (n: number) => (n < 1000 ? `${n} bytes` : `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)} kB`);
const isPng = (b: Uint8Array) =>
  b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

/** A chart's caption: the SVG's own title, else its file name in words. */
function titleOf(name: string, svg: string | null): string {
  const t = svg ? /<title[^>]*>([^<]{1,200})<\/title>/iu.exec(svg)?.[1] : undefined;
  const plain = (t ?? "")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&amp;/gu, "&")
    .trim();
  return plain || name.replace(/\.[a-z]+$/iu, "").replace(/[-_]+/gu, " ");
}

/**
 * Read /out and hand the person what is new or changed since the turn last looked: charts as images, tables as
 * downloads, each whole list written again (the desk keeps one part per name per turn). Returns the words the model
 * reads about it, or null when nothing changed.
 */
export async function showOutputs(
  sandbox: Pick<Sandbox, "readdir" | "readFileBuffer" | "stat">,
  turn: Pick<TurnState, "outputs">,
  write: Pick<Writers, "chart" | "file">,
  call: string | null,
): Promise<string | null> {
  let names: string[];
  try {
    names = (await sandbox.readdir(OUT)).sort();
  } catch {
    return null;
  }
  const shown: string[] = [];
  const offered: string[] = [];
  const kept: string[] = [];
  let charts = false;
  let files = false;
  for (const name of names) {
    const path = `${OUT}/${name}`;
    let stat: Awaited<ReturnType<Sandbox["stat"]>>;
    try {
      stat = await sandbox.stat(path);
    } catch {
      continue;
    }
    if (!stat.isFile) continue;
    const bytes = await sandbox.readFileBuffer(path);
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (turn.outputs.seen.get(name) === hash) continue;
    turn.outputs.seen.set(name, hash);
    const ext = /\.([a-z0-9]+)$/iu.exec(name)?.[1]?.toLowerCase() ?? "";
    if (ext === "svg" || ext === "png") {
      const at = turn.outputs.charts.findIndex((c) => c.name === name);
      if (at < 0 && turn.outputs.charts.length >= WORKSPACE.charts) {
        kept.push(`${name} is not shown: a turn shows at most ${WORKSPACE.charts} charts`);
        continue;
      }
      if (bytes.length > WORKSPACE.chartBytes) {
        kept.push(
          `${name} is not shown: it is ${kb(bytes.length)}, over the ${kb(WORKSPACE.chartBytes)} a chart may be`,
        );
        continue;
      }
      let item: ChartItem;
      if (ext === "svg") {
        const svg = new TextDecoder().decode(bytes);
        if (!plainSvg(svg)) {
          kept.push(
            `${name} is not shown: a chart is plain SVG, with no script, event handler, link out or foreign content`,
          );
          continue;
        }
        item = {
          call,
          name,
          title: titleOf(name, svg),
          media: "image/svg+xml",
          encoding: "utf8",
          data: svg,
          bytes: bytes.length,
        };
      } else {
        if (!isPng(bytes)) {
          kept.push(`${name} is not shown: it is not a PNG image`);
          continue;
        }
        item = {
          call,
          name,
          title: titleOf(name, null),
          media: "image/png",
          encoding: "base64",
          data: Buffer.from(bytes).toString("base64"),
          bytes: bytes.length,
        };
      }
      if (at >= 0) turn.outputs.charts[at] = item;
      else turn.outputs.charts.push(item);
      charts = true;
      shown.push(name);
      continue;
    }
    const media = FILE_TYPES[ext];
    if (!media) {
      kept.push(
        `${name} is not offered: a file the person may download ends in .${Object.keys(FILE_TYPES).join(", .")}`,
      );
      continue;
    }
    const at = turn.outputs.files.findIndex((f) => f.name === name);
    if (at < 0 && turn.outputs.files.length >= WORKSPACE.files) {
      kept.push(`${name} is not offered: a turn offers at most ${WORKSPACE.files} files`);
      continue;
    }
    if (bytes.length > WORKSPACE.fileBytes) {
      kept.push(
        `${name} is not offered: it is ${kb(bytes.length)}, over the ${kb(WORKSPACE.fileBytes)} a file may be`,
      );
      continue;
    }
    const text = new TextDecoder().decode(bytes);
    const lines = text.split(/\r?\n/u).filter((l) => l.trim() !== "").length;
    const rows = ext === "csv" || ext === "tsv" ? Math.max(0, lines - 1) : null;
    const item: FileItem = { call, name, media, encoding: "utf8", data: text, bytes: bytes.length, rows };
    if (at >= 0) turn.outputs.files[at] = item;
    else turn.outputs.files.push(item);
    files = true;
    offered.push(`${name} (${rows === null ? "" : `${rows} rows, `}${kb(bytes.length)})`);
  }
  if (charts) write.chart([...turn.outputs.charts]);
  if (files) write.file([...turn.outputs.files]);
  const said = [
    shown.length ? `Shown to the person beside your answer: ${shown.join(", ")}.` : "",
    offered.length ? `Offered to the person to download: ${offered.join(", ")}.` : "",
    kept.length ? `${kept.join("; ")}.` : "",
  ].filter(Boolean);
  return said.length ? said.join(" ") : null;
}

// ------------------------------------------------------------------ the model's tools in it

/** The line the desk shows while each runs. */
const STEPS: Record<string, string> = {
  bash: "Analysing the rows",
  read: "Reading a result",
  write: "Writing a file",
};

const textOf = (r: AgentToolResult<unknown>) =>
  r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");

/** The text the model reads back, kept to its cap: the head and the tail of a long one, with what was cut said. */
export function capped(text: string, max: number = WORKSPACE.readChars): string {
  if (text.length <= max) return text;
  const head = text.slice(0, Math.floor(max * 0.6));
  const tail = text.slice(text.length - Math.floor(max * 0.3));
  return `${head}\n[... ${(text.length - head.length - tail.length).toLocaleString("en-US")} characters left out; print less, such as a count or a value per group ...]\n${tail}`;
}

/** Why a command stopped, in words, when just-bash stopped it at a limit. */
function limitSaid(text: string): string | null {
  if (/exceeded its execution deadline/iu.test(text))
    return `The command was stopped at the workspace's limit of ${WORKSPACE.commandSeconds} seconds; make it smaller or simpler.`;
  if (/total output size exceeded/iu.test(text))
    return `The command printed more than the workspace's limit of ${kb(WORKSPACE.printBytes)}; print less.`;
  if (/MemoryError/u.test(text))
    return `Python ran out of memory (at most ${WORKSPACE.pythonMegabytes} MB); work on fewer rows or columns at a time.`;
  if (/filesystem.*(exceeded|limit)|maxFileSystemBytes/iu.test(text))
    return `The workspace holds at most ${kb(WORKSPACE.workspaceBytes)}; remove files you do not need.`;
  return null;
}

/**
 * One of Flue's tools held to the turn's guards: refused once the turn is stopped, counted by the repeat detector and
 * the turn's caps, its step shown, what it says kept to its cap, a limit said in words, and what it left under /out
 * handed to the person.
 */
/** One of the tools a sandbox gives the model (Flue's AgentTool). */
type FlueTool = ReturnType<SandboxToolFactory>[number];

export function guarded(
  tool: FlueTool,
  sandbox: Sandbox,
  o: { conversation: string; writers: () => Writers },
): FlueTool {
  return {
    ...tool,
    async execute(toolCallId, params, signal, onUpdate) {
      const turn = turnOf(o.conversation);
      const say = (text: string, terminate = false): AgentToolResult<unknown> => ({
        content: [{ type: "text", text }],
        details: {},
        ...(terminate ? { terminate: true } : {}),
      });
      if (turn.stopped) return say(`Refused: ${turn.stopped}. Answer the person now.`, true);
      const gate = turn.machine.call(tool.name, params as Record<string, unknown>);
      if (!gate.ok) {
        turn.stopped =
          gate.terminal === "loop_stopped" ? "the same call came five times" : "this turn's work is spent";
        return say(
          `Stopped: ${turn.stopped}. Stop calling tools. Answer the person now, in plain words, with what you have.`,
        );
      }
      turn.tools.push(tool.name);
      const w = o.writers();
      w.progress(STEPS[tool.name] ?? "Working", toolCallId);
      const r = await tool.execute(toolCallId, params, signal, onUpdate);
      const text = textOf(r);
      const lines = [capped(text)];
      const limit = limitSaid(text);
      if (limit) lines.push(limit);
      if (tool.name !== "read") {
        const shown = await showOutputs(sandbox, turn, w, toolCallId);
        if (shown) lines.push(shown);
      }
      if (gate.warning) lines.push(`Warning: ${gate.warning}; change the arguments or answer now.`);
      return { ...r, content: [{ type: "text", text: lines.join("\n") }] };
    },
  };
}

/**
 * The workspace as Flue's sandbox for the one agent: a fresh just-bash instance per message, and of Flue's six tools
 * the three the analysis needs (bash, read, write), guarded. `writers` gives the render's data writers at call time.
 */
export function analysisWorkspace(o: { conversation: string; writers: () => Writers }): SandboxFactory {
  const base = bash(async (): Promise<BashLike> => (await newWorkspace()) as unknown as BashLike);
  return {
    createSandbox: (options) => base.createSandbox(options),
    tools: (sandbox) =>
      [createBashTool(sandbox), createReadTool(sandbox), createWriteTool(sandbox)].map((t) =>
        guarded(t, sandbox, o),
      ),
  };
}

/** The Flue tools the workspace mounts, by name. */
export const WORKSPACE_TOOLS = ["bash", "read", "write"] as const;
