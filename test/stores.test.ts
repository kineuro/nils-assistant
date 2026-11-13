// SPDX-License-Identifier: AGPL-3.0-only
// Where the assistant's own files live (2026-11-13). Each store defaulted to
// `./data` by itself, so an install that named its state folder for six of
// the seven files left the changes' store in a folder that was not there:
// its first proposal met "unable to open database file" in the middle of a
// chat. A file its variable does not name is beside the store, its folder is
// made when missing, the host opens every store as it starts and says which
// one it could not open, and a plan whose change cannot be kept is taken
// back.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { config, stateDir } from "../src/config.ts";
import { LadderStore } from "../src/host/ladder-store.ts";
import { openAtStart, StoreUnopened } from "../src/host/stores.ts";
import { ChangeStore } from "../src/one/changes.ts";
import { Ledger } from "../src/seam/ledger.ts";

const dir = mkdtempSync(join(tmpdir(), "stores-"));

describe("where the assistant's own files live", () => {
  it("puts every store an install does not name beside the store it does name", () => {
    const none = () => false;
    const c = config({ ASSISTANT_STORE: "/srv/state/assistant.sqlite", KVASIR_KEY: "k" }, none);
    expect(c.changes).toBe("/srv/state/changes.sqlite");
    expect(c.ledger).toBe("/srv/state/seam.sqlite");
    expect(c.notes).toBe("/srv/state/notes.sqlite");
    expect(c.lineage).toBe("/srv/state/lineage.sqlite");
    expect(c.ladder).toBe("/srv/state/ladder.sqlite");
    expect(c.teaching).toBe("/srv/state/teaching.sqlite");
    expect(c.teachingDir).toBe("/srv/state/teaching");
  });

  it("keeps a file its own variable names, and ./data where no store or a Postgres store is named", () => {
    const none = () => false;
    const named = config(
      {
        ASSISTANT_STORE: "/srv/state/assistant.sqlite",
        ASSISTANT_CHANGES: "/elsewhere/changes.sqlite",
        KVASIR_KEY: "k",
      },
      none,
    );
    expect(named.changes).toBe("/elsewhere/changes.sqlite");
    expect(named.ladder).toBe("/srv/state/ladder.sqlite");
    const bare = config({ KVASIR_KEY: "k" }, none);
    expect(bare.store).toBe("./data/assistant.sqlite");
    expect(bare.changes).toBe("./data/changes.sqlite");
    expect(stateDir({ ASSISTANT_STORE: "postgres://nils@db/assistant" })).toBe("./data");
    expect(config({ ASSISTANT_STORE: "postgresql://db/a", KVASIR_KEY: "k" }, none).changes).toBe(
      "./data/changes.sqlite",
    );
    // a variable set to nothing names no file: the default stands, never SQLite's unnamed temporary file
    expect(config({ ASSISTANT_STORE: "/srv/state/a.sqlite", ASSISTANT_CHANGES: "" }, none).changes).toBe(
      "/srv/state/changes.sqlite",
    );
  });

  it("goes on with a file an install already keeps under ./data, until there is one beside the store", () => {
    const env = { ASSISTANT_STORE: "/srv/state/assistant.sqlite", KVASIR_KEY: "k" };
    const before = (path: string) => path === "./data/changes.sqlite";
    expect(config(env, before).changes).toBe("./data/changes.sqlite");
    expect(config(env, before).ladder).toBe("/srv/state/ladder.sqlite");
    const both = (path: string) => path.endsWith("/changes.sqlite");
    expect(config(env, both).changes).toBe("/srv/state/changes.sqlite");
  });

  it("makes a store's folder when it is missing: the changes and the seam's ledger as the others", () => {
    const state = join(dir, "state", "not", "made", "yet");
    const changes = new ChangeStore(join(state, "changes.sqlite"));
    expect(changes.of("none")).toEqual([]);
    changes.close();
    const ledger = new Ledger(join(state, "deeper", "seam.sqlite"));
    expect(ledger.rows("none")).toEqual([]);
  });

  it("ends the start with the variable and the path of a store that cannot be opened", () => {
    // a folder cannot be made under a file: the store's path is one no process can open
    const file = join(dir, "a-file");
    writeFileSync(file, "x");
    const path = join(file, "changes.sqlite");
    let thrown: unknown = null;
    try {
      openAtStart("ASSISTANT_CHANGES", path, () => new ChangeStore(path));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(StoreUnopened);
    const line = (thrown as Error).message;
    expect(line).toMatch(/^nils-assistant: the store at /u);
    expect(line).toContain(path);
    expect(line).toContain("ASSISTANT_CHANGES");
    // and a store that opens is handed on
    const ok = join(dir, "opens", "changes.sqlite");
    expect(openAtStart("ASSISTANT_CHANGES", ok, () => new ChangeStore(ok))).toBeInstanceOf(ChangeStore);
  });
});

describe("a plan taken back", () => {
  const ladder = new LadderStore(join(dir, "ladder.sqlite"));

  it("drops only a plan still proposed, with its steps", () => {
    const planned = {
      steps: [
        {
          n: 1,
          rung: 2 as const,
          verb: "run",
          door: "POST /api/ask/jobs",
          args: { document: 31 },
          when: "now" as const,
          words: "run question 31",
        },
      ],
      proposals: [],
      refused: [],
    };
    const row = { conversation: "c", subject: "anna@lab", instruction: "run it", planned };
    ladder.plan({ id: "plan-dropped", ...row });
    expect(ladder.drop("plan-dropped")).toBe(true);
    expect(ladder.planById("plan-dropped")).toBeNull();
    expect(ladder.steps("plan-dropped")).toEqual([]);
    ladder.plan({ id: "plan-confirmed", ...row });
    ladder.confirm("plan-confirmed", "anna@lab");
    expect(ladder.drop("plan-confirmed")).toBe(false);
    expect(ladder.steps("plan-confirmed")).toHaveLength(1);
    expect(ladder.drop("plan-never-made")).toBe(false);
  });
});
