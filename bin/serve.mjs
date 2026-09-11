// SPDX-License-Identifier: AGPL-3.0-only
// Starts the built assistant. Flue's own entry (dist/app/server.mjs) listens
// on every interface and exits 143 when it is stopped, which systemd records
// as a failure. Only the desk ever talks to the assistant, so this listens
// on loopback unless HOST names another address, and a clean stop exits 0.
import { startFlueNodeServer } from "../dist/app/app.mjs";

const port = Number.parseInt(process.env.PORT || "3000", 10);
const hostname = process.env.HOST || "127.0.0.1";

const server = await startFlueNodeServer({
  port,
  hostname,
  quiet: true,
  onReady: () => console.log(`assistant listening on http://${hostname}:${port}`),
});

let stopping = false;
async function stop(code) {
  if (stopping) return;
  stopping = true;
  setTimeout(() => {
    console.error("assistant: the stop timed out, exiting");
    process.exit(1);
  }, 60_000).unref();
  await server.stop();
  process.exit(code);
}
process.on("SIGTERM", () => stop(0));
process.on("SIGINT", () => stop(0));
process.on("disconnect", () => stop(0));
