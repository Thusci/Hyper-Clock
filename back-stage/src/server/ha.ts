import "server-only";
import { createConnection, createLongLivedTokenAuth, createSocket, getServices, getStates, type Connection, type StateChangedEvent } from "home-assistant-js-websocket";
import WebSocket from "ws";
import { env, haConfigured } from "./env";
import type { AgendaMap, CalendarEvent, HaCatalog, HassEntity, HassEntityMap, HistoryMap, WeatherBundle, WeatherForecastItem } from "@/types";

/**
 * The one Home Assistant connection for the whole process.
 *
 * - home-assistant-js-websocket reconnects by itself and re-establishes subscriptions,
 *   so we keep the same Connection object while it can recover.
 * - It cannot notice a half-open socket (Wi-Fi drop, HA host suspended), so a watchdog pings
 *   every 30 s and forces a reconnect when HA stops answering.
 * - When reconnecting is impossible (token revoked), the connection is dropped and `generation`
 *   goes up; the next caller builds a new one and must subscribe again.
 * - Every request has a deadline, so a stalled HA can never hang a resync or a feed.
 * - `onStatus` tells listeners when HA drops and when it is back (and they should resync).
 */
if (!(globalThis as { WebSocket?: unknown }).WebSocket) (globalThis as { WebSocket?: unknown }).WebSocket = WebSocket;

export type StateListener = (next: HassEntity, previous: HassEntity | null) => void;
export type StatusListener = (status: "online" | "offline") => void;

type RegistryEntity = { entity_id: string; name?: string | null; original_name?: string | null; device_id?: string | null; area_id?: string | null; disabled_by?: string | null; config_entry_id?: string | null; platform?: string | null; entity_category?: string | null };
type RegistryDevice = { id: string; name?: string | null; name_by_user?: string | null; area_id?: string | null; manufacturer?: string | null; model?: string | null; config_entries?: string[]; entry_type?: string | null };
type RegistryArea = { area_id: string; name: string };
type ConfigEntry = { entry_id: string; domain: string; title?: string; state?: string; source?: string };

const CONNECT_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 15_000;
const PING_EVERY_MS = 30_000;
const PING_TIMEOUT_MS = 10_000;

/** Rejects when `promise` has not settled after `ms`; the late result is ignored. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms); });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

export const emptyCatalog: HaCatalog = { connected: false, areas: [], integrations: [], devices: [], entities: [] };

class HomeAssistant {
  private connection: Connection | null = null;
  private connecting: Promise<Connection> | null = null;
  private statusListeners = new Set<StatusListener>();
  private watchdog: NodeJS.Timeout | undefined;
  /** Goes up whenever a new Connection replaces a dead one; subscriptions belong to one generation. */
  generation = 0;

  connect(): Promise<Connection> {
    if (this.connection) return Promise.resolve(this.connection);
    if (this.connecting) return this.connecting;
    const { HA_URL, HA_TOKEN } = env();
    if (!HA_URL || !HA_TOKEN) return Promise.reject(new Error("Home Assistant is not configured"));
    const pending = createConnection({ auth: createLongLivedTokenAuth(HA_URL, HA_TOKEN), createSocket });
    // An unreachable host can leave the TCP handshake hanging for minutes; give up sooner and close a late arrival.
    let abandoned = false;
    pending.then((late) => { if (abandoned) late.close(); }, () => {});
    this.connecting = withTimeout(pending, CONNECT_TIMEOUT_MS, "Home Assistant connect")
      .then((connection) => {
        this.connection = connection;
        this.generation += 1;
        connection.addEventListener("disconnected", () => this.emit("offline"));
        connection.addEventListener("ready", () => this.emit("online"));
        connection.addEventListener("reconnect-error", () => this.drop(connection));
        this.startWatchdog();
        return connection;
      }, (error: unknown) => {
        abandoned = true;
        throw error;
      })
      .finally(() => { this.connecting = null; });
    return this.connecting;
  }

  /** Forget a connection that will never come back; the next connect() starts fresh. */
  private drop(connection: Connection) {
    if (this.connection !== connection) return;
    this.connection = null;
    try { connection.close(); } catch { /* already closed */ }
    this.emit("offline");
  }

  private startWatchdog() {
    this.watchdog ??= setInterval(() => {
      const connection = this.connection;
      if (!connection?.connected) return;
      withTimeout(connection.ping(), PING_TIMEOUT_MS, "Home Assistant ping").catch(() => {
        // The library then reports "disconnected", backs off and reconnects on its own.
        if (this.connection === connection) connection.reconnect(true);
      });
    }, PING_EVERY_MS);
  }

  private request<T>(connection: Connection, message: { type: string } & Record<string, unknown>) {
    return withTimeout(connection.sendMessagePromise<T>(message), REQUEST_TIMEOUT_MS, `Home Assistant ${message.type}`);
  }

  isConnected() {
    return Boolean(this.connection?.connected);
  }

  onStatus(listener: StatusListener) {
    this.statusListeners.add(listener);
    return () => { this.statusListeners.delete(listener); };
  }

  private emit(status: "online" | "offline") {
    for (const listener of this.statusListeners) listener(status);
  }

  private async rest<T>(path: string): Promise<T | null> {
    const { HA_URL, HA_TOKEN } = env();
    if (!haConfigured()) return null;
    try {
      const response = await fetch(`${HA_URL}${path}`, { headers: { authorization: `Bearer ${HA_TOKEN}` }, cache: "no-store", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      return response.ok ? await response.json() as T : null;
    } catch {
      return null;
    }
  }

  async states(): Promise<HassEntityMap> {
    const states = await withTimeout(getStates(await this.connect()), REQUEST_TIMEOUT_MS, "Home Assistant get_states");
    return Object.fromEntries(states.map((entity) => [entity.entity_id, entity as HassEntity]));
  }

  /** Every state change in HA, with the previous state so callers can tell real transitions from attribute updates. */
  async subscribeStates(listener: StateListener) {
    const connection = await this.connect();
    const pending = connection.subscribeEvents<StateChangedEvent>((event) => {
      const next = event.data.new_state as HassEntity | null;
      if (next?.entity_id) listener(next, (event.data.old_state as HassEntity | null) ?? null);
    }, "state_changed");
    // A subscription that arrives after we gave up would deliver every change twice once we retry.
    let abandoned = false;
    pending.then((unsubscribe) => { if (abandoned) void unsubscribe().catch(() => {}); }, () => {});
    return withTimeout(pending, REQUEST_TIMEOUT_MS, "Home Assistant subscribe").catch((error: unknown) => {
      abandoned = true;
      throw error;
    });
  }

  /** Current state of selected entities, then live updates for exactly those (used by the HA console). */
  async watchSelected(ids: string[], listener: (entities: HassEntityMap) => void) {
    const connection = await this.connect();
    const unique = [...new Set(ids)].slice(0, 100);
    const pairs = await Promise.all(unique.map(async (id) => {
      const entity = await this.rest<HassEntity>(`/api/states/${encodeURIComponent(id)}`);
      return entity ? [id, entity] as const : null;
    }));
    listener(Object.fromEntries(pairs.filter((pair): pair is readonly [string, HassEntity] => pair !== null)));
    if (!unique.length) return async () => {};
    return connection.subscribeMessage<{ variables?: { trigger?: { to_state?: HassEntity } } }>((message) => {
      const entity = message.variables?.trigger?.to_state;
      if (entity?.entity_id) listener({ [entity.entity_id]: entity });
    }, { type: "subscribe_trigger", trigger: { platform: "state", entity_id: unique } });
  }

  async call(domain: string, service: string, entityId: string, data: Record<string, unknown> = {}) {
    const connection = await this.connect();
    return this.request(connection, { type: "call_service", domain, service, target: { entity_id: entityId }, service_data: data, return_response: false });
  }

  async calendarEvents(ids: string[], start: Date, end: Date): Promise<AgendaMap> {
    const unique = [...new Set(ids.filter((id) => id.startsWith("calendar.")))].slice(0, 20);
    const query = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() });
    const entries = await Promise.all(unique.map(async (id) => [id, await this.rest<CalendarEvent[]>(`/api/calendars/${encodeURIComponent(id)}?${query}`) ?? []] as const));
    return Object.fromEntries(entries);
  }

  async weatherForecast(entityId: string): Promise<WeatherBundle> {
    const empty: WeatherBundle = { entityId, daily: [], hourly: [], updatedAt: new Date().toISOString() };
    if (!entityId.startsWith("weather.")) return empty;
    const connection = await this.connect();
    const request = async (type: "daily" | "hourly") => {
      try {
        const result = await this.request<Record<string, unknown>>(connection, {
          type: "call_service", domain: "weather", service: "get_forecasts",
          target: { entity_id: entityId }, service_data: { type }, return_response: true,
        });
        const root = (result.response ?? result.service_response ?? result) as Record<string, { forecast?: WeatherForecastItem[] } | undefined>;
        return Array.isArray(root[entityId]?.forecast) ? root[entityId]!.forecast! : [];
      } catch {
        return [];
      }
    };
    const [daily, hourly] = await Promise.all([request("daily"), request("hourly")]);
    if (daily.length || hourly.length) return { ...empty, daily, hourly };
    // Older integrations still expose the forecast as a state attribute.
    const legacy = (await this.states())[entityId]?.attributes.forecast;
    return { ...empty, daily: Array.isArray(legacy) ? legacy as WeatherForecastItem[] : [] };
  }

  async history(ids: string[], hours = 24): Promise<HistoryMap> {
    const unique = [...new Set(ids.filter(Boolean))].slice(0, 30);
    if (!unique.length) return {};
    const start = new Date(Date.now() - hours * 3_600_000).toISOString();
    const query = new URLSearchParams({ filter_entity_id: unique.join(","), end_time: new Date().toISOString(), no_attributes: "" });
    const rows = await this.rest<Array<Array<{ entity_id?: string; state: string; last_changed: string }>>>(`/api/history/period/${encodeURIComponent(start)}?${query}`);
    if (!rows) return {};
    return Object.fromEntries(rows.map((series, index) => {
      const id = series.find((point) => point.entity_id)?.entity_id ?? unique[index];
      return [id, series.filter((point) => Number.isFinite(Number(point.state))).map((point) => ({ state: point.state, last_changed: point.last_changed }))];
    }).filter(([id]) => Boolean(id)));
  }

  /** Areas, devices, entities and integrations merged from HA's registries into one tree. */
  async catalog(): Promise<HaCatalog> {
    const connection = await this.connect();
    const [entities, devices, areas, configEntries, services] = await Promise.all([
      this.request<RegistryEntity[]>(connection, { type: "config/entity_registry/list" }),
      this.request<RegistryDevice[]>(connection, { type: "config/device_registry/list" }),
      this.request<RegistryArea[]>(connection, { type: "config/area_registry/list" }),
      this.request<ConfigEntry[]>(connection, { type: "config_entries/get" }),
      withTimeout(getServices(connection), REQUEST_TIMEOUT_MS, "Home Assistant get_services"),
    ]);
    const areaName = new Map(areas.map((area) => [area.area_id, area.name]));
    const deviceById = new Map(devices.map((device) => [device.id, device]));
    const entryDomain = new Map(configEntries.map((entry) => [entry.entry_id, entry.domain]));

    type Group = { domain: string; title: string; state: string; source?: string; entries: Set<string>; devices: Set<string>; entities: Set<string>; serviceCount: number };
    const groups = new Map<string, Group>();
    const group = (domain: string, title = domain) => {
      let found = groups.get(domain);
      if (!found) groups.set(domain, found = { domain, title, state: "loaded", entries: new Set(), devices: new Set(), entities: new Set(), serviceCount: 0 });
      return found;
    };
    for (const entry of configEntries) {
      const item = group(entry.domain, entry.title || entry.domain);
      item.entries.add(entry.entry_id);
      if (entry.title && (item.title === item.domain || item.entries.size === 1)) item.title = entry.title;
      if (entry.state && entry.state !== "loaded") item.state = entry.state;
      item.source ||= entry.source;
    }
    for (const entity of entities) {
      const domain = (entity.config_entry_id && entryDomain.get(entity.config_entry_id)) || entity.platform;
      if (!domain) continue;
      const item = group(domain);
      item.entities.add(entity.entity_id);
      if (entity.device_id) item.devices.add(entity.device_id);
    }
    for (const device of devices) {
      for (const entryId of device.config_entries ?? []) {
        const domain = entryDomain.get(entryId);
        if (domain) group(domain).devices.add(device.id);
      }
    }
    for (const [domain, actions] of Object.entries(services)) {
      const item = groups.get(domain);
      if (item) item.serviceCount = Object.keys(actions).length;
    }

    return {
      connected: true,
      areas: areas.map((area) => ({ areaId: area.area_id, name: area.name })),
      integrations: [...groups.values()].map((item) => ({
        domain: item.domain, title: item.title, state: item.state, source: item.source,
        entryCount: item.entries.size, deviceCount: item.devices.size, entityCount: item.entities.size, serviceCount: item.serviceCount,
      })).sort((a, b) => a.domain.localeCompare(b.domain)),
      devices: devices.map((device) => ({
        deviceId: device.id,
        name: device.name_by_user || device.name || device.id,
        areaId: device.area_id || null,
        areaName: device.area_id ? areaName.get(device.area_id) : undefined,
        manufacturer: device.manufacturer || undefined,
        model: device.model || undefined,
        service: device.entry_type === "service",
        integrations: [...new Set((device.config_entries ?? []).map((entryId) => entryDomain.get(entryId)).filter((domain): domain is string => Boolean(domain)))],
      })),
      entities: entities.map((entity) => {
        const device = entity.device_id ? deviceById.get(entity.device_id) : undefined;
        const areaId = entity.area_id || device?.area_id || null;
        return {
          entityId: entity.entity_id,
          name: entity.name || entity.original_name || device?.name_by_user || device?.name || entity.entity_id,
          domain: entity.entity_id.split(".")[0],
          deviceId: entity.device_id,
          areaId,
          areaName: areaId ? areaName.get(areaId) : undefined,
          disabled: Boolean(entity.disabled_by),
          platform: entity.platform || undefined,
          category: entity.entity_category || undefined,
        };
      }),
    };
  }
}

// One instance per process, surviving Next.js dev hot reloads.
const holder = globalThis as unknown as { hcHomeAssistant?: HomeAssistant };
export const ha = holder.hcHomeAssistant ??= new HomeAssistant();
