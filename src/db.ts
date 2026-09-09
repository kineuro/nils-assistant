// SPDX-License-Identifier: AGPL-3.0-only
// The store (Wave 4c §9.2): Flue's own persistence contract on both
// backends. A Postgres URL in ASSISTANT_STORE chooses @flue/postgres over a
// driver of ours; anything else is a SQLite file through Node's own binding.
// The format is reset-only with no migration (§9.1), which is why the
// record export and import exist beside it (host/records.ts).

import { postgres } from "@flue/postgres";
import type { PersistenceAdapter } from "@flue/runtime/adapter";
import { sqlite } from "@flue/runtime/node";
import sql from "postgres";

export function adapterFor(store: string): PersistenceAdapter {
  if (/^postgres(ql)?:\/\//u.test(store)) {
    const db = sql(store);
    return postgres({
      query: (text: string, params?: unknown[]) => db.unsafe(text, params as never),
      transaction: <T>(
        fn: (tx: { query: (text: string, params?: unknown[]) => Promise<unknown[]> }) => Promise<T>,
      ) =>
        db.begin((tx) =>
          fn({ query: (text: string, params?: unknown[]) => tx.unsafe(text, params as never) }),
        ) as Promise<T>,
      close: () => db.end(),
    } as never);
  }
  return sqlite(store);
}

export default adapterFor(process.env.ASSISTANT_STORE ?? "./data/assistant.sqlite");
