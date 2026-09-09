// SPDX-License-Identifier: AGPL-3.0-only
// The record export and import (Wave 4c §9.1): the persisted format is
// reset-only with no migration, so the store's own tables are written out as
// one JSON file, row by row, and read back into another store of the same
// format version, byte for byte. Flue's own append door refuses records
// whose submission it did not admit, so an import speaks to the tables the
// adapter made, on either backend, and never to the runtime. An export for
// a reviewer passes every row through the redactor and says so; a redacted
// file is not imported.

import { readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import sql from "postgres";
import { redactValue } from "../seam/redactor.ts";

export interface Runner {
  tables(): Promise<string[]>;
  rows(table: string): Promise<Record<string, unknown>[]>;
  insert(table: string, row: Record<string, unknown>): Promise<void>;
  close(): Promise<void>;
}

/** The store as tables: a SQLite file through Node's binding, or Postgres through its driver. */
export function runnerFor(store: string): Runner {
  if (/^postgres(ql)?:\/\//u.test(store)) {
    const db = sql(store);
    return {
      tables: async () =>
        (await db`SELECT tablename FROM pg_tables WHERE tablename LIKE 'flue_%' ORDER BY tablename`).map(
          (r) => String(r.tablename),
        ),
      rows: async (t) => (await db.unsafe(`SELECT * FROM "${t}"`)) as Record<string, unknown>[],
      insert: async (t, row) => {
        await db.unsafe(
          `INSERT INTO "${t}" (${Object.keys(row)
            .map((k) => `"${k}"`)
            .join(", ")}) VALUES (${Object.keys(row)
            .map((_, i) => `$${i + 1}`)
            .join(", ")})`,
          Object.values(row) as never,
        );
      },
      close: () => db.end(),
    };
  }
  const db = new DatabaseSync(store);
  return {
    tables: async () =>
      (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'flue_%' ORDER BY name")
          .all() as { name: string }[]
      ).map((r) => r.name),
    rows: async (t) => db.prepare(`SELECT * FROM "${t}"`).all() as Record<string, unknown>[],
    insert: async (t, row) => {
      db.prepare(
        `INSERT INTO "${t}" (${Object.keys(row)
          .map((k) => `"${k}"`)
          .join(", ")}) VALUES (${Object.keys(row)
          .map(() => "?")
          .join(", ")})`,
      ).run(...(Object.values(row) as never[]));
    },
    close: async () => db.close(),
  };
}

export interface Export {
  format: "nils-assistant-records";
  version: 1;
  /** Flue's own format version, from its meta table; an import needs the same. */
  flue_format: unknown;
  redacted: boolean;
  exported_at: string;
  tables: Record<string, Record<string, unknown>[]>;
}

export async function exportStore(
  store: string,
  opts: { redact?: boolean; filter?: (table: string, row: Record<string, unknown>) => boolean } = {},
): Promise<Export> {
  const r = runnerFor(store);
  try {
    const tables: Record<string, Record<string, unknown>[]> = {};
    for (const t of await r.tables()) {
      const rows = await r.rows(t);
      tables[t] = opts.filter ? rows.filter((row) => opts.filter?.(t, row)) : rows;
    }
    const meta = tables.flue_meta ?? [];
    const out: Export = {
      format: "nils-assistant-records",
      version: 1,
      flue_format: meta,
      redacted: Boolean(opts.redact),
      exported_at: new Date().toISOString(),
      tables,
    };
    return opts.redact ? { ...redactValue(out), redacted: true } : out;
  } finally {
    await r.close();
  }
}

export async function importStore(store: string, file: Export): Promise<{ rows: number }> {
  if (file.format !== "nils-assistant-records") throw new Error("not a records file");
  if (file.redacted) throw new Error("a redacted export is a reviewer's copy and is not imported");
  const r = runnerFor(store);
  try {
    const have = await r.tables();
    const mine = (await r.rows("flue_meta").catch(() => [])) as Record<string, unknown>[];
    if (mine.length > 0 && JSON.stringify(mine) !== JSON.stringify(file.flue_format)) {
      throw new Error(
        `the store's format is ${JSON.stringify(mine)}, the file's ${JSON.stringify(file.flue_format)}; the format is reset-only`,
      );
    }
    let n = 0;
    for (const [t, rows] of Object.entries(file.tables)) {
      if (t === "flue_meta" && mine.length > 0) continue;
      if (!have.includes(t))
        throw new Error(`the store has no table ${t}; open it once with the runtime first`);
      for (const row of rows) {
        await r.insert(t, row);
        n += 1;
      }
    }
    return { rows: n };
  } finally {
    await r.close();
  }
}

// the command line: records export <store> <file> [--redact] | records import <store> <file>
if (process.argv[1]?.endsWith("records.js")) {
  const [verb, store, file] = process.argv.slice(2);
  if (verb === "export" && store && file) {
    const out = await exportStore(store, { redact: process.argv.includes("--redact") });
    writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
    console.log(
      `${Object.values(out.tables).reduce((n, t) => n + t.length, 0)} rows of ${store} written to ${file}${out.redacted ? " (redacted)" : ""}`,
    );
  } else if (verb === "import" && store && file) {
    const r = await importStore(store, JSON.parse(readFileSync(file, "utf8")) as Export);
    console.log(`${r.rows} rows read into ${store}`);
  } else {
    console.error("records export <store> <file> [--redact] | records import <store> <file>");
    process.exit(2);
  }
}
