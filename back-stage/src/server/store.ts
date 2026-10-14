import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Durable state lives in data/*.json (plus the append-only audit log).
 * Writes are atomic (temp file + rename) and read-modify-write cycles on the same
 * file are serialised, so two concurrent logins can no longer drop each other's session.
 */
// scripts/start.mjs pins this to the source tree's data/, because the standalone server chdirs into .next/.
export const dataDir = process.env.HYPER_CLOCK_DATA_DIR || path.join(process.cwd(), "data");

export const files = {
  config: "runtime-config.json",
  defaultConfig: "default-config.json",
  users: "runtime-users.json",
  sessions: "runtime-sessions.json",
  favorites: "runtime-favorites.json",
  kiosk: "runtime-kiosk.json",
  haCache: "runtime-ha-cache.json",
  audit: "audit.ndjson",
} as const;

const queues = new Map<string, Promise<unknown>>();

function serial<T>(name: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(name) ?? Promise.resolve();
  const next = previous.then(task, task);
  queues.set(name, next.catch(() => undefined));
  return next;
}

export async function readJson<T>(name: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(path.join(dataDir, name), "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeNow(name: string, value: unknown) {
  await fs.mkdir(dataDir, { recursive: true });
  const file = path.join(dataDir, name);
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2));
  await fs.rename(temp, file);
}

export function writeJson(name: string, value: unknown) {
  return serial(name, () => writeNow(name, value));
}

/** Read, transform and write one file without interleaving with other writers of that file. */
export function updateJson<T>(name: string, fallback: T, change: (current: T) => T | Promise<T>): Promise<T> {
  return serial(name, async () => {
    const next = await change(await readJson(name, fallback));
    await writeNow(name, next);
    return next;
  });
}

export type AuditEvent = { type: string; [key: string]: unknown };

export function audit(event: AuditEvent) {
  return serial(files.audit, async () => {
    await fs.mkdir(dataDir, { recursive: true });
    await fs.appendFile(path.join(dataDir, files.audit), `${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`);
  });
}

export async function readAudit(limit = 100) {
  try {
    const text = await fs.readFile(path.join(dataDir, files.audit), "utf8");
    return text.trim().split("\n").filter(Boolean).slice(-Math.min(Math.max(limit, 1), 500)).reverse().map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}
