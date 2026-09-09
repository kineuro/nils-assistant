// SPDX-License-Identifier: AGPL-3.0-only
// The child of the durability test: starts a runtime on a SQLite file,
// dispatches one message whose tool never returns, and dies without
// warning while the tool runs. Nothing here settles anything.

import { dispatch } from "@flue/runtime";
import { sqlite, start } from "@flue/runtime/node";
import { fakeProvider } from "./fake-provider.ts";
import { Slow } from "./slow-agent.ts";

const file = process.argv[2];
const id = process.argv[3];
process.env.SLOW_MS = "60000";
await start({ agents: [{ agent: Slow, name: "slow" }], db: sqlite(file), providers: [fakeProvider()] });
const receipt = await dispatch(Slow, { id, message: "go" });
process.stdout.write(`${JSON.stringify({ submissionId: receipt.submissionId })}\n`);
// die mid-tool, the way a crash does
setTimeout(() => process.exit(137), 1500);
