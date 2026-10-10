// SPDX-License-Identifier: AGPL-3.0-only
// The analysis sandbox (2026-10-10, a trial): Python in Pyodide, in a child
// Node process under the permission model, with its time, memory and output
// capped from outside. It computes over the table it is given, and nothing
// it runs reaches the network, the host's files or JavaScript's process.

import { describe, expect, it } from "vitest";
import { childArgs, LIMITS, runPython } from "../src/one/sandbox.ts";

const TABLE =
  "base,n_slices,series\nT1w,176,t1 sag\nT2w,30,t2 ax\nT1w,160,t1 ax\nFLAIR,40,flair\nT1w,,t1 empty\n";
const run = (code: string, files: Record<string, string> = { "/data/table.csv": TABLE }, limits = LIMITS) =>
  runPython({ code, files }, limits);
const SLOW = 60_000;

describe("the analysis sandbox", () => {
  it("is started reading only Pyodide and itself, with code generation from strings off", () => {
    const args = childArgs({ pyodide: "/p/pyodide", child: "/p/bin/python-sandbox.mjs" });
    expect(args).toEqual([
      "--permission",
      "--allow-fs-read=/p/pyodide",
      "--allow-fs-read=/p/bin/python-sandbox.mjs",
      "--disallow-code-generation-from-strings",
      "--max-old-space-size=256",
      "/p/bin/python-sandbox.mjs",
    ]);
    expect(args.some((a) => /allow-fs-write|allow-child|allow-worker|allow-addons/u.test(a))).toBe(false);
  });

  it(
    "counts and averages a table by group",
    async () => {
      const r = await run(`
import csv, statistics
from collections import Counter, defaultdict
rows = list(csv.DictReader(open("/data/table.csv")))
by = defaultdict(list)
for x in rows:
    if x["n_slices"]:
        by[x["base"]].append(int(x["n_slices"]))
result = {"count": dict(sorted(Counter(x["base"] for x in rows).items())), "mean": {k: statistics.mean(v) for k, v in sorted(by.items())}}
print("rows", len(rows))
`);
      expect(r.error).toBeNull();
      expect(r.ok).toBe(true);
      expect(r.result).toEqual({
        count: { FLAIR: 1, T1w: 3, T2w: 1 },
        mean: { FLAIR: 40, T1w: 168, T2w: 30 },
      });
      expect(r.printed).toBe("rows 5\n");
    },
    SLOW,
  );

  it(
    "hands back a chart written under /out",
    async () => {
      const r = await run(`
open("/out/chart.svg", "w").write('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="5" height="5"/></svg>')
result = 1
`);
      expect(r.ok).toBe(true);
      expect(r.files?.["chart.svg"]).toMatch(/^<svg /u);
    },
    SLOW,
  );

  it(
    "reaches no network, no host file, no JavaScript bridge and no code made from strings",
    async () => {
      const r = await run(`
import pyodide
out = {}
def t(name, f):
    try:
        f()
        out[name] = "reached"
    except BaseException as e:
        out[name] = type(e).__name__
t("js", lambda: __import__("js"))
t("pyodide_js", lambda: __import__("pyodide_js"))
t("socket", lambda: __import__("socket"))
t("urllib", lambda: __import__("urllib.request").request.urlopen("http://127.0.0.1:1/"))
t("http", lambda: __import__("pyodide.http"))
t("micropip", lambda: __import__("micropip"))
t("host file", lambda: open("/etc/passwd").read())
t("function from a string", lambda: pyodide.ffi.to_js({"a": 1}).constructor.constructor("return globalThis")())
result = out
`);
      expect(r.ok).toBe(true);
      const out = r.result as Record<string, string>;
      for (const name of ["js", "pyodide_js", "socket", "urllib", "http", "micropip"])
        expect(out[name], name).toBe("ImportError");
      expect(out["host file"]).toBe("FileNotFoundError");
      expect(out["function from a string"]).toBe("JsException");
    },
    SLOW,
  );

  it(
    "puts files under /data alone",
    async () => {
      const r = await run(
        `import os
result = {"data": sorted(os.listdir("/data")), "etc": os.path.exists("/etc/escape")}`,
        { "/data/table.csv": TABLE, "/etc/escape": "x", "/data/../escape": "y" },
      );
      expect(r.result).toEqual({ data: ["table.csv"], etc: false });
    },
    SLOW,
  );

  it(
    "stops a run that takes too long",
    async () => {
      const r = await run("while True:\n    pass\n", undefined, { ...LIMITS, timeoutMs: 6_000 });
      expect(r.ok).toBe(false);
      expect(r.stopped).toBe("time");
      expect(r.error).toMatch(/time/u);
    },
    SLOW,
  );

  it(
    "stops a run that takes too much memory",
    async () => {
      const r = await run("x = bytearray(700 * 1024 * 1024)\nwhile True:\n    x[0] = 1\n", undefined, {
        ...LIMITS,
        memoryMb: 400,
        timeoutMs: 30_000,
      });
      expect(r.ok).toBe(false);
      expect(r.stopped).toBe("memory");
    },
    SLOW,
  );

  it(
    "keeps what is printed to its cap",
    async () => {
      const r = await run('for i in range(5000):\n    print("x" * 20)\nresult = "done"\n');
      expect(r.ok).toBe(true);
      expect(r.printed.length).toBeLessThanOrEqual(16_000);
      expect(r.printedCut).toBe(true);
      expect(r.result).toBe("done");
    },
    SLOW,
  );

  it(
    "says what went wrong in the code",
    async () => {
      const r = await run(
        'import csv\nrows = list(csv.DictReader(open("/data/table.csv")))\nresult = rows[0]["age"]\n',
      );
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/KeyError: 'age'/u);
    },
    SLOW,
  );
});
