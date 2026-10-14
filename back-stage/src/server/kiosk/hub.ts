import "server-only";
import { readConfig } from "../config";
import { emptyCatalog, ha } from "../ha";
import { files, readJson, writeJson } from "../store";
import { feeds, type Feed } from "./feeds";
import type { AppConfig, HaCatalog, HassEntity, HassEntityMap } from "@/types";

/**
 * KioskHub — the single source of truth the watch face streams from.
 *
 * Lifecycle
 *   start()   once per process, on the first subscriber:
 *             load config + disk cache → connect HA → subscribe to state_changed once
 *   resync()  after every (re)connect: catalog + full states + all feeds → `ready`
 *   offline   HA drops → `offline`; the library reconnects, a retry timer covers a first connect that never succeeded
 *
 * Fan-out
 *   Entity changes are batched for 250 ms into one `entities` event, so a chatty HA
 *   does not re-render the face once per sensor tick. Feeds push `feed {name,value}`.
 *   Config edits are detected every 5 s and pushed as `config`; feeds then reload.
 *   Wake triggers fire only on a real state transition, not on attribute-only updates.
 *
 * Persistence
 *   The snapshot is written to runtime-ha-cache.json at most every 30 s, so a restart
 *   (or HA outage) still paints the last known state, clearly flagged as cache.
 *
 * SSE events: config · cache · catalog · entities · feed · wake · ready · offline · heartbeat
 */
export type Send = (event: string, data: unknown) => void;

export type Snapshot = {
  entities: HassEntityMap;
  catalog: HaCatalog;
  feeds: Record<string, unknown>;
  updatedAt: string;
};

type LegacyCache = Partial<Snapshot> & { agenda?: unknown; weather?: unknown; history?: unknown };

const BATCH_MS = 250;
const CONFIG_POLL_MS = 5000;
const PERSIST_MS = 30_000;
const HEARTBEAT_MS = 15_000;
const RETRY_MS = 15_000;

async function loadCache(): Promise<Snapshot> {
  const raw = await readJson<LegacyCache>(files.haCache, {});
  // Caches written before feeds existed stored agenda/weather/history at the top level.
  const legacyFeeds = Object.fromEntries((["agenda", "weather", "history"] as const).filter((key) => raw[key] !== undefined).map((key) => [key, raw[key]]));
  return {
    entities: raw.entities ?? {},
    catalog: raw.catalog ? { ...emptyCatalog, ...raw.catalog, integrations: raw.catalog.integrations ?? [] } : emptyCatalog,
    feeds: { ...legacyFeeds, ...raw.feeds },
    updatedAt: raw.updatedAt ?? "",
  };
}

class KioskHub {
  private clients = new Set<Send>();
  private config!: AppConfig;
  private configHash = "";
  private snapshot: Snapshot = { entities: {}, catalog: emptyCatalog, feeds: {}, updatedAt: "" };
  private live = false;
  private subscribed = false;
  private dirty = false;
  private pending: HassEntityMap = {};
  private batchTimer: NodeJS.Timeout | undefined;
  private retryTimer: NodeJS.Timeout | undefined;
  private starting: Promise<void> | null = null;

  /** Register an SSE client; it immediately receives the current picture. Returns the unsubscribe function. */
  subscribe(send: Send) {
    let closed = false;
    void this.start().then(() => {
      if (closed) return;
      this.greet(send);
      this.clients.add(send);
    });
    return () => {
      closed = true;
      this.clients.delete(send);
    };
  }

  status() {
    return { live: this.live, clients: this.clients.size, updatedAt: this.snapshot.updatedAt };
  }

  private start() {
    this.starting ??= (async () => {
      this.config = await readConfig();
      this.configHash = JSON.stringify(this.config);
      this.snapshot = await loadCache();
      setInterval(() => void this.watchConfig(), CONFIG_POLL_MS);
      setInterval(() => void this.persist(), PERSIST_MS);
      setInterval(() => this.broadcast("heartbeat", {}), HEARTBEAT_MS);
      for (const feed of feeds) setInterval(() => void this.refreshFeed(feed), feed.intervalMs);
      ha.onStatus((status) => status === "offline" ? this.goOffline() : void this.resync());
      await this.resync();
    })();
    return this.starting;
  }

  private greet(send: Send) {
    send("config", this.config);
    if (this.live) {
      send("catalog", this.snapshot.catalog);
      send("entities", this.snapshot.entities);
      for (const [name, value] of Object.entries(this.snapshot.feeds)) send("feed", { name, value });
      send("ready", {});
      return;
    }
    if (this.snapshot.updatedAt || Object.keys(this.snapshot.entities).length) send("cache", this.snapshot);
    send("offline", { cachedAt: this.snapshot.updatedAt || null });
  }

  private broadcast(event: string, data: unknown) {
    for (const send of this.clients) send(event, data);
  }

  private async resync() {
    clearTimeout(this.retryTimer);
    try {
      const [catalog, entities] = await Promise.all([ha.catalog(), ha.states()]);
      this.snapshot = { ...this.snapshot, catalog, entities };
      if (!this.subscribed) {
        await ha.subscribeStates((next, previous) => this.onState(next, previous));
        this.subscribed = true;
      }
      this.live = true;
      this.touch();
      this.broadcast("catalog", catalog);
      this.broadcast("entities", entities);
      await Promise.allSettled(feeds.map((feed) => this.refreshFeed(feed)));
      this.broadcast("ready", {});
      await this.persist();
    } catch {
      this.goOffline();
      this.retryTimer = setTimeout(() => void this.resync(), RETRY_MS);
    }
  }

  /** Announce only the live → offline transition; new clients learn the state from greet(). */
  private goOffline() {
    if (!this.live) return;
    this.live = false;
    this.broadcast("offline", { cachedAt: this.snapshot.updatedAt || null });
  }

  private onState(next: HassEntity, previous: HassEntity | null) {
    this.snapshot.entities[next.entity_id] = next;
    this.pending[next.entity_id] = next;
    this.touch();
    this.batchTimer ??= setTimeout(() => {
      this.batchTimer = undefined;
      const batch = this.pending;
      this.pending = {};
      this.broadcast("entities", batch);
    }, BATCH_MS);
    if (previous?.state === next.state) return;
    for (const trigger of this.config.wakeTriggers) {
      if (trigger.enabled && trigger.entityId === next.entity_id && (!trigger.toState || trigger.toState === next.state)) {
        this.broadcast("wake", { mode: trigger.mode, triggerId: trigger.id });
      }
    }
  }

  private async refreshFeed(feed: Feed) {
    if (!this.live) return;
    try {
      const value = await feed.load({ config: this.config, entities: this.snapshot.entities, catalog: this.snapshot.catalog });
      this.snapshot.feeds[feed.name] = value;
      this.touch();
      this.broadcast("feed", { name: feed.name, value });
    } catch {
      // Keep the previous value; feeds are best effort.
    }
  }

  private async watchConfig() {
    try {
      const next = await readConfig();
      const hash = JSON.stringify(next);
      if (hash === this.configHash) return;
      this.config = next;
      this.configHash = hash;
      this.broadcast("config", next);
      await Promise.allSettled(feeds.map((feed) => this.refreshFeed(feed)));
    } catch {
      // An invalid file on disk keeps the last valid config.
    }
  }

  private touch() {
    this.dirty = true;
    this.snapshot.updatedAt = new Date().toISOString();
  }

  private async persist() {
    if (!this.dirty) return;
    this.dirty = false;
    await writeJson(files.haCache, this.snapshot).catch(() => { this.dirty = true; });
  }
}

const holder = globalThis as unknown as { hcKioskHub?: KioskHub };
export const kioskHub = holder.hcKioskHub ??= new KioskHub();
