// SPDX-License-Identifier: AGPL-3.0-only
// The analysis sandbox's child (2026-10-10, a trial for the one chat): one
// Python run in Pyodide, in a Node process the parent starts for that run
// alone and kills at its time and memory caps. It reads one job as JSON on
// stdin, {code, files}, and writes one answer as JSON on stdout. The parent
// starts it under Node's permission model, reading only Pyodide's own folder
// and this file, writing nothing, with no child process, worker or addon,
// and with code generation from strings turned off. Before any Python runs,
// this file takes away what could reach outside: the network globals, the
// process object with its builtin modules, and Python's bridge to
// JavaScript. The files live in Pyodide's memory, never on the host's disk.
import { constants as fsConstants } from "node:fs";
import { constants as osConstants } from "node:os";
import { loadPyodide } from "pyodide";

// Emscripten's NODEFS asks process.binding("constants") for the file flags
// as Pyodide starts; the permission model refuses process.binding, so the
// flags come from the fs module instead. Nothing else of process.binding is
// served, and NODEFS itself is never mounted here.
process.binding = (name) => {
  if (name === "constants") return { fs: fsConstants, os: osConstants };
  throw new Error(`process.binding(${name}) is not available in the analysis sandbox`);
};

const OUT_CHARS = 16_000;
const FILE_CHARS = 200_000;

/** The process's own write and exit, kept before the process object goes. */
const write = process.stdout.write.bind(process.stdout);
const exit = process.exit.bind(process);
const readStdin = async () => {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
};
const answer = (o) => {
  write(`${JSON.stringify(o)}\n`, () => exit(0));
};

/** Whatever a print says, kept to its cap. */
let printed = "";
let cut = false;
const keep = (s) => {
  if (printed.length >= OUT_CHARS) {
    cut = true;
    return;
  }
  printed += `${s}\n`;
  if (printed.length > OUT_CHARS) {
    printed = printed.slice(0, OUT_CHARS);
    cut = true;
  }
};

// Python's modules that reach JavaScript or the network, refused by name
// and taken out of sys.modules before the person's code runs.
const CLOSE = `
import sys
_CLOSED = ("js", "pyodide_js", "pyodide.http", "pyodide.ffi", "pyodide.code", "pyodide.webloop", "micropip", "_pyodide", "_pyodide_core", "pyodide_http", "ssl", "socket", "urllib.request", "http.client")
class _Closed:
    def find_spec(self, name, path=None, target=None):
        if name in _CLOSED or any(name.startswith(c + ".") for c in _CLOSED):
            raise ImportError(f"{name} is not available in the analysis sandbox")
        return None
sys.meta_path.insert(0, _Closed())
for _m in list(sys.modules):
    if _m in _CLOSED or any(_m.startswith(c + ".") for c in _CLOSED):
        del sys.modules[_m]
del _m, _Closed
import os
os.makedirs("/data", exist_ok=True)
os.makedirs("/out", exist_ok=True)
os.chdir("/data")
`;

const COLLECT = `
import json, os
_out = {}
if "result" in globals():
    try:
        _out["result"] = json.loads(json.dumps(result, default=str))
    except Exception as _e:
        _out["result"] = str(result)
for _name in sorted(os.listdir("/out")):
    _p = os.path.join("/out", _name)
    if os.path.isfile(_p):
        with open(_p, "r", errors="replace") as _f:
            _out.setdefault("files", {})[_name] = _f.read(${FILE_CHARS + 1})
json.dumps(_out)
`;

try {
  const job = JSON.parse(await readStdin());
  const py = await loadPyodide({ stdout: keep, stderr: keep });
  // nothing below may reach the network, the disk or a builtin module
  for (const name of [
    "fetch",
    "WebSocket",
    "EventSource",
    "XMLHttpRequest",
    "Request",
    "Response",
    "Headers",
    "navigator",
    "Worker",
  ]) {
    try {
      delete globalThis[name];
    } catch {
      globalThis[name] = undefined;
    }
  }
  // fetch's dispatcher lives on globalThis under a symbol once made
  for (const sym of Object.getOwnPropertySymbols(globalThis)) {
    if (/undici|dispatcher|fetch/iu.test(String(sym.description ?? ""))) delete globalThis[sym];
  }
  try {
    delete globalThis.process;
  } catch {
    globalThis.process = undefined;
  }
  py.runPython(CLOSE);
  for (const [path, text] of Object.entries(job.files ?? {})) {
    if (typeof path !== "string" || !path.startsWith("/data/") || path.includes("..")) continue;
    py.FS.writeFile(path, String(text));
  }
  let error = null;
  try {
    py.runPython(String(job.code ?? ""), { globals: py.globals });
  } catch (e) {
    const text = String(e?.message ?? e);
    error = text.slice(-2000);
  }
  const collected = JSON.parse(py.runPython(COLLECT, { globals: py.globals }));
  answer({ ok: error === null, error, printed, printed_cut: cut, ...collected });
} catch (e) {
  answer({ ok: false, error: String(e?.message ?? e).slice(0, 2000), printed, printed_cut: cut });
}
