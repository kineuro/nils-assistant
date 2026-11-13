// SPDX-License-Identifier: AGPL-3.0-only
// Opening the assistant's own SQLite files (2026-11-13). Each store is one
// file; its folder is made when it is missing, and the host opens every
// store when it starts, so a file that cannot be opened stops the start with
// a line that names its variable and its path. Before then the changes'
// store was opened at its first proposal: an install that named the other
// stores and not this one learned of it in the middle of a chat, as a tool's
// error the model put into its own words.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** A store's SQLite file opened, its folder made first when it is missing. */
export function openSqlite(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  return new DatabaseSync(path);
}

/** A store that could not be opened when the host started: which variable names it, and where. */
export class StoreUnopened extends Error {
  constructor(
    readonly variable: string,
    readonly path: string,
    readonly why: string,
  ) {
    super(
      `nils-assistant: the store at ${path} (${variable}) cannot be opened: ${why}. Set ${variable} to a file in a folder the assistant may write to.`,
    );
    this.name = "StoreUnopened";
  }
}

/**
 * A store opened as the host starts: what `open` answers, or an error that names the variable and the path. The
 * host lets it end the start, so the service is seen failed where it runs and not later by a person in a chat.
 */
export function openAtStart<T>(variable: string, path: string, open: () => T): T {
  try {
    return open();
  } catch (e) {
    throw new StoreUnopened(variable, path, e instanceof Error ? e.message : String(e));
  }
}
