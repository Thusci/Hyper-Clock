import "server-only";
import { ha } from "../ha";
import { loadBtc } from "../harva";
import type { AgendaMap, AppConfig, BtcFeed, HaCatalog, HassEntityMap, HistoryMap, WeatherBundle } from "@/types";

/**
 * Feeds are the extension point for kiosk data beyond raw entity states.
 *
 * A feed has a name, a refresh interval and a `load` function. The hub runs every
 * registered feed after (re)connecting, on its interval and whenever the config changes,
 * then pushes `{ name, value }` to the watch face as an SSE `feed` event. A failed load
 * keeps the previous value. To add one: write a Feed and append it to `feeds` below;
 * the watch face reads it as `feeds[name]` with no transport changes.
 *
 * A feed with `needsHa: false` talks to another service and keeps running while HA is down.
 */
export type FeedContext<T = unknown> = { config: AppConfig; entities: HassEntityMap; catalog: HaCatalog; previous: T | undefined };

export type Feed<T = unknown> = {
  name: string;
  intervalMs: number;
  needsHa?: boolean;
  load: (context: FeedContext<T>) => Promise<T>;
};

const DAY = 86_400_000;

const agenda: Feed<AgendaMap> = {
  name: "agenda",
  intervalMs: 5 * 60_000,
  async load({ config, catalog }) {
    const configured = [...config.entities.calendars, ...config.entities.courses];
    const ids = configured.length ? configured : catalog.entities.filter((item) => item.domain === "calendar" && !item.disabled).map((item) => item.entityId);
    return ids.length ? ha.calendarEvents(ids, new Date(), new Date(Date.now() + 7 * DAY)) : {};
  },
};

/** QWeather (和风) is preferred when present, then the configured entity, then any weather entity. */
const weather: Feed<WeatherBundle | null> = {
  name: "weather",
  intervalMs: 15 * 60_000,
  async load({ config, entities, catalog }) {
    const qWeather = Object.values(entities).find((entity) => {
      if (!entity.entity_id.startsWith("weather.")) return false;
      const id = entity.entity_id.toLowerCase();
      const name = String(entity.attributes.friendly_name ?? "").toLowerCase();
      return id.includes("he_feng_tian_qi") || id.includes("heweather") || id.includes("qweather") || name.includes("和风") || name.includes("qweather");
    })?.entity_id;
    const anyWeather = catalog.entities.find((item) => item.domain === "weather" && !item.disabled)?.entityId;
    const candidates = [...new Set([qWeather, config.weatherEntity, anyWeather].filter((id): id is string => Boolean(id)))];
    let first: WeatherBundle | null = null;
    for (const entityId of candidates) {
      const bundle = await ha.weatherForecast(entityId);
      first ??= bundle;
      if (bundle.hourly.length || bundle.daily.length) return bundle;
    }
    return first;
  },
};

const history: Feed<HistoryMap> = {
  name: "history",
  intervalMs: 15 * 60_000,
  load: ({ config }) => config.entities.stocks.length ? ha.history(config.entities.stocks) : Promise.resolve({}),
};

/** BTC-HARVA on the LAN (server/harva.ts); null when HARVA_URL / HARVA_API_KEYS are not set. */
const btc: Feed<BtcFeed | null> = {
  name: "btc",
  intervalMs: 15_000,
  needsHa: false,
  load: ({ previous }) => loadBtc(previous),
};

export const feeds = [agenda, weather, history, btc] as Feed[];
