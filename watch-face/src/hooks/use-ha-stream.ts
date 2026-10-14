"use client";

import { useEffect, useRef, useState } from "react";
import type { AppConfig, DisplayMode, FeedMap, HaCatalog, HassEntityMap } from "@/types/config";

/**
 * Subscribes to back-stage's KioskHub over SSE (/api/public/stream).
 *
 * Events: config · cache · catalog · entities · feed {name,value} · wake · ready · offline · heartbeat
 * Feeds are stored generically by name, so a new back-end feed is available as `feeds[name]`
 * without touching this hook. The last picture is mirrored to localStorage so a reload while
 * the control plane is down still paints real data, flagged as cache.
 *
 * Stability rules (the face runs for weeks; numbers must never jump backwards or blank out):
 *   - nothing is ever cleared; incoming data is merged into what is on screen;
 *   - an entity is replaced only by a state HA stamped at the same time or later, so an older
 *     cache (back-stage restart, browser cache) can never overwrite newer live values;
 *   - a dropped stream is reconnected quietly; "offline" is shown only after OFFLINE_GRACE_MS;
 *   - a stream that goes silent (no heartbeat for STALE_MS) is treated as dropped;
 *   - the browser cache is written right away whenever a (re)connect completes.
 */
const CACHE_KEY = "hyper-clock:watch-cache:v3";
const CACHE_WRITE_MS = 15_000;
const OFFLINE_GRACE_MS = 20_000;
const STALE_MS = 45_000;
const emptyCatalog: HaCatalog = { connected: false, areas: [], integrations: [], devices: [], entities: [] };

const normalizeCatalog = (catalog: Partial<HaCatalog> | undefined): HaCatalog => ({
  ...emptyCatalog,
  ...catalog,
  areas: catalog?.areas ?? [],
  integrations: catalog?.integrations ?? [],
  devices: catalog?.devices ?? [],
  entities: catalog?.entities ?? [],
});

const emptyMetrics: AppConfig["entities"]["systemMetrics"] = { cpu: "", memory: "", disk: "", power: "", temperature: "", uptime: "" };

const normalizeConfig = (config: AppConfig): AppConfig => ({
  ...config,
  entities: {
    ...config.entities,
    stocks: config.entities?.stocks ?? [],
    systemMetrics: { ...emptyMetrics, ...(config.entities?.systemMetrics ?? {}) },
  },
});

const stamp = (value: string | undefined) => {
  const time = Date.parse(value ?? "");
  return Number.isFinite(time) ? time : null;
};

/** Merge `incoming` into `current`, keeping whichever copy of each entity HA stamped later. */
function mergeEntities(current: HassEntityMap, incoming: HassEntityMap) {
  let changed = false;
  const next = { ...current };
  for (const [id, entity] of Object.entries(incoming)) {
    if (!entity?.entity_id) continue;
    const held = current[id];
    const heldAt = stamp(held?.last_updated);
    const incomingAt = stamp(entity.last_updated);
    if (held && heldAt !== null && incomingAt !== null && incomingAt < heldAt) continue;
    next[id] = entity;
    changed = true;
  }
  return changed ? next : current;
}

type WatchCache = { entities: HassEntityMap; catalog: HaCatalog; feeds: FeedMap; config?: AppConfig; savedAt: string };
type Status = "connecting" | "connected" | "offline";

export function useHaStream(controlUrl: string, onConfig: (config: AppConfig) => void, onWake: (mode: Exclude<DisplayMode, "off">) => void) {
  const [entities, setEntities] = useState<HassEntityMap>({});
  const [catalog, setCatalog] = useState<HaCatalog>(emptyCatalog);
  const [feeds, setFeeds] = useState<FeedMap>({});
  const [status, setStatus] = useState<Status>("connecting");
  const [usingCache, setUsingCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const state = useRef<WatchCache>({ entities: {}, catalog: emptyCatalog, feeds: {}, savedAt: "" });

  useEffect(() => {
    let source: EventSource | null = null;
    let retries = 0;
    let retryTimer = 0;
    let saveTimer = 0;
    let offlineTimer = 0;
    let lastMessage = Date.now();
    let live = false;
    let configJson = "";
    let disposed = false;

    const hasData = () => Object.keys(state.current.entities).length > 0;
    const saveNow = () => {
      window.clearTimeout(saveTimer);
      saveTimer = 0;
      try { window.localStorage.setItem(CACHE_KEY, JSON.stringify(state.current)); } catch { /* Cache is best effort (quota, private mode). */ }
    };
    const saveSoon = () => {
      if (!saveTimer) saveTimer = window.setTimeout(saveNow, CACHE_WRITE_MS);
    };
    const apply = (next: Partial<WatchCache>, savedAt = new Date().toISOString()) => {
      const previous = state.current;
      state.current = { ...previous, ...next, savedAt };
      if (next.entities && next.entities !== previous.entities) setEntities(state.current.entities);
      if (next.catalog) setCatalog(state.current.catalog);
      if (next.feeds) setFeeds(state.current.feeds);
      setCachedAt(savedAt);
      saveSoon();
    };
    const acceptConfig = (raw: AppConfig) => {
      const config = normalizeConfig(raw);
      state.current.config = config;
      // Every reconnect re-sends the config; an identical one must not re-render the face.
      const json = JSON.stringify(config);
      if (json === configJson) return;
      configJson = json;
      onConfig(config);
    };
    const markLive = () => {
      live = true;
      retries = 0;
      window.clearTimeout(offlineTimer);
      offlineTimer = 0;
      setStatus("connected");
      setUsingCache(false);
    };
    const markOffline = () => {
      live = false;
      window.clearTimeout(offlineTimer);
      offlineTimer = 0;
      setStatus("offline");
      setUsingCache(hasData());
    };
    /** The stream dropped. Keep showing the picture as it is unless the outage outlasts the grace period. */
    const markInterrupted = () => {
      if (!live) {
        if (!hasData()) setStatus("connecting");
        return;
      }
      if (!offlineTimer) offlineTimer = window.setTimeout(markOffline, OFFLINE_GRACE_MS);
    };

    const hydrate = () => {
      try {
        const raw = window.localStorage.getItem(CACHE_KEY);
        if (!raw) return;
        const cached = JSON.parse(raw) as Partial<WatchCache>;
        apply({ entities: cached.entities ?? {}, catalog: normalizeCatalog(cached.catalog), feeds: cached.feeds ?? {} }, cached.savedAt ?? "");
        if (cached.config) acceptConfig(cached.config);
        setUsingCache(Object.keys(cached.entities ?? {}).length > 0);
      } catch { /* Ignore a corrupt browser cache. */ }
    };

    const reconnect = () => {
      source?.close();
      source = null;
      markInterrupted();
      window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(connect, Math.min(30_000, 1000 * 2 ** retries++));
    };

    const connect = () => {
      if (disposed) return;
      lastMessage = Date.now();
      const stream = new EventSource(`${controlUrl}/api/public/stream`);
      source = stream;
      const on = <T,>(event: string, handle: (data: T) => void) => stream.addEventListener(event, (message) => {
        lastMessage = Date.now();
        retries = 0;
        let data: T;
        try { data = JSON.parse((message as MessageEvent).data) as T; } catch { return; }
        try { handle(data); } catch (error) { console.error(`[hyper-clock] ${event} event`, error); }
      });

      on<AppConfig>("config", acceptConfig);
      // The hub's disk cache: fills gaps, but never replaces anything newer that is already on screen.
      on<Partial<WatchCache> & { updatedAt?: string }>("cache", (cached) => {
        const current = state.current;
        const feedsFromCache = Object.fromEntries(Object.entries(cached.feeds ?? {}).filter(([name]) => current.feeds[name] === undefined));
        apply({
          entities: mergeEntities(current.entities, cached.entities ?? {}),
          catalog: current.catalog.entities.length || !cached.catalog ? current.catalog : normalizeCatalog(cached.catalog),
          feeds: Object.keys(feedsFromCache).length ? { ...current.feeds, ...feedsFromCache } : current.feeds,
        }, current.savedAt && current.savedAt > (cached.updatedAt ?? "") ? current.savedAt : cached.updatedAt ?? current.savedAt);
        if (!live) setUsingCache(hasData());
      });
      on<HaCatalog>("catalog", (next) => apply({ catalog: normalizeCatalog(next) }));
      on<HassEntityMap>("entities", (batch) => {
        markLive();
        apply({ entities: mergeEntities(state.current.entities, batch) });
      });
      on<{ name: string; value: unknown }>("feed", ({ name, value }) => apply({ feeds: { ...state.current.feeds, [name]: value } }));
      on<{ mode: Exclude<DisplayMode, "off"> }>("wake", ({ mode }) => onWake(mode));
      on("ready", () => { markLive(); saveNow(); });
      on("offline", markOffline);
      on("heartbeat", () => {});
      stream.onerror = () => {
        if (source === stream) reconnect();
      };
    };

    // A half-open connection (Wi-Fi drop, suspended proxy) never fires onerror; the 15 s heartbeat tells.
    const watchdog = window.setInterval(() => {
      if (source && Date.now() - lastMessage > STALE_MS) reconnect();
    }, 10_000);
    const boot = window.setTimeout(() => { hydrate(); connect(); }, 0);
    return () => {
      disposed = true;
      source?.close();
      window.clearTimeout(boot);
      window.clearTimeout(retryTimer);
      window.clearTimeout(offlineTimer);
      window.clearInterval(watchdog);
      if (saveTimer) saveNow();
    };
  }, [controlUrl, onConfig, onWake]);

  return { entities, catalog, feeds, status, usingCache, cachedAt };
}
