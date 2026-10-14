import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");
// outputFileTracingRoot is the repository root, so Next nests the server under the package name.
const targetRoot = [path.join(standalone, "watch-face"), standalone].find((dir) => existsSync(path.join(dir, "server.js")));
if (!targetRoot) {
  console.error(`No standalone build in ${standalone}; run "npm run build" first.`);
  process.exit(1);
}

const staticTarget = path.join(targetRoot, ".next", "static");
if (existsSync(path.join(root, ".next", "static"))) {
  mkdirSync(path.dirname(staticTarget), { recursive: true });
  cpSync(path.join(root, ".next", "static"), staticTarget, { recursive: true });
}
if (existsSync(path.join(root, "public"))) cpSync(path.join(root, "public"), path.join(targetRoot, "public"), { recursive: true });
process.env.PORT ??= "3000";
process.env.HOSTNAME ??= "127.0.0.1";
await import(pathToFileURL(path.join(targetRoot, "server.js")).href);
