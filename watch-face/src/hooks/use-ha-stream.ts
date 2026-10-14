"use client";

import { useEffect, useRef, useState } from "react";
import type { AppConfig, DisplayMode, FeedMap, HaCatalog, HassEntityMap } from "@/types/config";

/**
 * Subscribes to back-stage's KioskHub over SSE (/api/public/stream).
 *
 * Events: config · cache · catalog · entities · feed {name,value} · wake · ready · offline · heartbeat
 * Feeds are stored generically by name, so a new back-end feed is available as `feeds[name]`
 * without touching this hook. The last picture is mirrored to localStorage (throttled) so a
 * reload while the control plane is down still paints real data, flagged as cache.
 */
const CACHE_KEY = "hyper-clock:watch-cache:v3";
const CACHE_WRITE_MS = 15_000;
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
    let disposed = false;

    const saveSoon = () => {
      if (saveTimer) return;
      saveTimer = window.setTimeout(() => {
        saveTimer = 0;
        try { window.localStorage.setItem(CACHE_KEY, JSON.stringify(state.current)); } catch { /* Cache is best effort. */ }
      }, CACHE_WRITE_MS);
    };
    const apply = (next: Partial<WatchCache>, savedAt = new Date().toISOString()) => {
      state.current = { ...state.current, ...next, savedAt };
      if (next.entities) setEntities(state.current.entities);
      if (next.catalog) setCatalog(state.current.catalog);
      if (next.feeds) setFeeds(state.current.feeds);
      setCachedAt(savedAt);
      saveSoon();
    };
    const acceptConfig = (raw: AppConfig) => {
      const config = normalizeConfig(raw);
      state.current.config = config;
      onConfig(config);
    };
    const markOffline = () => {
      setStatus("offline");
      setUsingCache(Object.keys(state.current.entities).length > 0);
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

    const connect = () => {
      if (disposed) return;
      setStatus("connecting");
      source = new EventSource(`${controlUrl}/api/public/stream`);
      const on = <T,>(event: string, handle: (data: T) => void) => source!.addEventListener(event, (message) => handle(JSON.parse((message as MessageEvent).data) as T));

      on<AppConfig>("config", acceptConfig);
      on<Partial<WatchCache> & { updatedAt?: string }>("cache", (cached) => {
        apply({
          entities: { ...state.current.entities, ...(cached.entities ?? {}) },
          catalog: cached.catalog ? normalizeCatalog(cached.catalog) : state.current.catalog,
          feeds: { ...state.current.feeds, ...(cached.feeds ?? {}) },
        }, cached.updatedAt ?? new Date().toISOString());
        setUsingCache(true);
      });
      on<HaCatalog>("catalog", (next) => apply({ catalog: normalizeCatalog(next) }));
      on<HassEntityMap>("entities", (batch) => {
        retries = 0;
        setStatus("connected");
        setUsingCache(false);
        apply({ entities: { ...state.current.entities, ...batch } });
      });
      on<{ name: string; value: unknown }>("feed", ({ name, value }) => apply({ feeds: { ...state.current.feeds, [name]: value } }));
      on<{ mode: Exclude<DisplayMode, "off"> }>("wake", ({ mode }) => onWake(mode));
      on("ready", () => { setStatus("connected"); setUsingCache(false); });
      on("offline", markOffline);
      source.onerror = () => {
        source?.close();
        markOffline();
        retryTimer = window.setTimeout(connect, Math.min(30_000, 1000 * 2 ** retries++));
      };
    };

    const boot = window.setTimeout(() => { hydrate(); connect(); }, 0);
    return () => {
      disposed = true;
      source?.close();
      window.clearTimeout(boot);
      window.clearTimeout(retryTimer);
      window.clearTimeout(saveTimer);
    };
  }, [controlUrl, onConfig, onWake]);

  return { entities, catalog, feeds, status, usingCache, cachedAt };
}
