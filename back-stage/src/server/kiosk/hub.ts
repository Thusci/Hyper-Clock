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
 *   start()   once per process, on the first subscriber: load config + disk cache, then
 *             greet at once (the face paints the cache immediately) and connect HA in the background
 *   resync()  after every (re)connect, one at a time: catalog + full states + all feeds → `ready`;
 *             subscribes to state_changed again whenever ha.ts had to build a new connection
 *   offline   HA drops → wait OFFLINE_GRACE_MS before announcing `offline`, so a short blip or an
 *             HA restart does not flip the face to "cache" and back; a retry timer covers failed resyncs
 *
 * Fan-out
 *   Entity changes are batched for 250 ms into one `entities` event, so a chatty HA
 *   does not re-render the face once per sensor tick. Feeds push `feed {name,value}`.
 *   Config edits are detected every 5 s and pushed as `config`; feeds then reload.
 *   Wake triggers fire only on a real state transition, not on attribute-only updates.
 *
 * Persistence
 *   The snapshot is written to runtime-ha-cache.json right after every successful resync and
 *   otherwise at most every 30 s, so a restart (or HA outage) still paints the last known state,
 *   clearly flagged as cache. Feeds that fail keep their previous value.
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
const OFFLINE_GRACE_MS = 20_000;

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

/** `fresh` decides which entities exist; an entity in `held` wins only when HA stamped it later. */
function keepNewer(fresh: HassEntityMap, held: HassEntityMap): HassEntityMap {
  const merged = { ...fresh };
  for (const [id, entity] of Object.entries(held)) {
    const incoming = fresh[id];
    if (incoming && Date.parse(entity.last_updated ?? "") > Date.parse(incoming.last_updated ?? "")) merged[id] = entity;
  }
  return merged;
}

class KioskHub {
  private clients = new Set<Send>();
  private config!: AppConfig;
  private configHash = "";
  private snapshot: Snapshot = { entities: {}, catalog: emptyCatalog, feeds: {}, updatedAt: "" };
  /** What clients were told: stays true through a short HA blip. */
  private live = false;
  /** Whether HA is actually reachable right now. */
  private haUp = false;
  private subscribedGeneration = 0;
  private resyncing: Promise<void> | null = null;
  private resyncAgain = false;
  private offlineTimer: NodeJS.Timeout | undefined;
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
      ha.onStatus((status) => status === "offline" ? this.haDown() : void this.resync());
      // Do not wait for HA: an unreachable host must not keep the face from painting its cache.
      void this.resync();
      for (const feed of feeds) if (feed.needsHa === false) void this.refreshFeed(feed);
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

  /** One resync at a time; a request that arrives meanwhile runs once more afterwards. */
  private resync(): Promise<void> {
    if (this.resyncing) {
      this.resyncAgain = true;
      return this.resyncing;
    }
    this.resyncing = this.doResync().finally(() => {
      this.resyncing = null;
      if (this.resyncAgain) {
        this.resyncAgain = false;
        void this.resync();
      }
    });
    return this.resyncing;
  }

  private async doResync() {
    clearTimeout(this.retryTimer);
    try {
      const [catalog, entities] = await Promise.all([ha.catalog(), ha.states()]);
      if (this.subscribedGeneration !== ha.generation) {
        await ha.subscribeStates((next, previous) => this.onState(next, previous));
        this.subscribedGeneration = ha.generation;
      }
      // A change that arrived while the full state was in flight is newer than that state.
      this.snapshot = { ...this.snapshot, catalog, entities: keepNewer(entities, this.snapshot.entities) };
      this.haUp = true;
      this.live = true;
      clearTimeout(this.offlineTimer);
      this.offlineTimer = undefined;
      this.touch();
      this.broadcast("catalog", catalog);
      this.broadcast("entities", this.snapshot.entities);
      await Promise.allSettled(feeds.map((feed) => this.refreshFeed(feed)));
      this.broadcast("ready", {});
      await this.persist();
    } catch {
      this.haDown();
      this.retryTimer = setTimeout(() => void this.resync(), RETRY_MS);
    }
  }

  /**
   * HA is unreachable. Clients keep showing the last picture as live for OFFLINE_GRACE_MS;
   * only a longer outage is announced as `offline` (and only once — new clients learn it from greet()).
   */
  private haDown() {
    this.haUp = false;
    if (!this.live || this.offlineTimer) return;
    this.offlineTimer = setTimeout(() => {
      this.offlineTimer = undefined;
      if (this.haUp || !this.live) return;
      this.live = false;
      this.broadcast("offline", { cachedAt: this.snapshot.updatedAt || null });
      void this.persist();
    }, OFFLINE_GRACE_MS);
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
    if (feed.needsHa !== false && !this.haUp) return;
    try {
      const previous = this.snapshot.feeds[feed.name];
      const value = await feed.load({ config: this.config, entities: this.snapshot.entities, catalog: this.snapshot.catalog, previous });
      // An unchanged value is not re-sent: every push re-renders the face.
      if (JSON.stringify(value) === JSON.stringify(previous)) return;
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
