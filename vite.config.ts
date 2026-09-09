// SPDX-License-Identifier: AGPL-3.0-only
import { flue } from "@flue/vite";
import { defineConfig } from "vite";

// The Node target. No built-in provider registers: the only model provider
// is Kvasir, registered per station in app.ts (Wave 4c section 9.1).
export default defineConfig({
  plugins: [flue({ providers: [] })],
  // the compiled bench and the durability child live under dist/ too; the app keeps its own directory
  build: { outDir: "dist/app", emptyOutDir: true },
});
