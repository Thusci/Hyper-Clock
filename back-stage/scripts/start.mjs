import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");
// outputFileTracingRoot is the repository root, so Next nests the server under the package name.
const targetRoot = [path.join(standalone, "back-stage"), standalone].find((dir) => existsSync(path.join(dir, "server.js")));
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

// server.js chdirs into the build output, which "npm run build" wipes; keep runtime data in the source tree.
const dataDir = path.join(root, "data");
mkdirSync(dataDir, { recursive: true });
// Earlier releases wrote runtime data inside the build output. Carry over anything newer so accounts survive.
const strandedDir = path.join(targetRoot, "data");
if (strandedDir !== dataDir && existsSync(strandedDir)) {
  for (const name of readdirSync(strandedDir)) {
    if (!name.startsWith("runtime-") && name !== "audit.ndjson") continue;
    const from = path.join(strandedDir, name);
    const to = path.join(dataDir, name);
    if (!existsSync(to) || statSync(from).mtimeMs > statSync(to).mtimeMs) {
      cpSync(from, to, { preserveTimestamps: true });
      console.log(`Recovered ${name} from the build output into ${dataDir}`);
    }
  }
}
process.env.HYPER_CLOCK_DATA_DIR ??= dataDir;

process.env.PORT ??= "3001";
process.env.HOSTNAME ??= process.env.TRUST_PROXY_HEADERS === "true" ? "0.0.0.0" : "127.0.0.1";
await import(pathToFileURL(path.join(targetRoot, "server.js")).href);
