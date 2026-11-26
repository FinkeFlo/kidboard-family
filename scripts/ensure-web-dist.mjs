// The worker serves `apps/web/dist` (wrangler `assets.directory`); `wrangler dev` fails when
// the directory is missing. Build the web app once on a fresh clone before `pnpm dev`.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const indexHtml = fileURLToPath(
  new URL("../apps/web/dist/index.html", import.meta.url),
);

if (existsSync(indexHtml)) {
  process.exit(0);
}

console.log(
  "apps/web/dist is missing: building the web app once for the worker...",
);
const result = spawnSync("pnpm", ["--filter", "@kidboard/web", "build"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
