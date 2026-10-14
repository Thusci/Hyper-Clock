import "server-only";
import { ha } from "../ha";
import type { AgendaMap, AppConfig, HaCatalog, HassEntityMap, HistoryMap, WeatherBundle } from "@/types";

/**
 * Feeds are the extension point for kiosk data beyond raw entity states.
 *
 * A feed has a name, a refresh interval and a `load` function. The hub runs every
 * registered feed after (re)connecting, on its interval and whenever the config changes,
 * then pushes `{ name, value }` to the watch face as an SSE `feed` event. A failed load
 * keeps the previous value. To add one: write a Feed and append it to `feeds` below;
 * the watch face reads it as `feeds[name]` with no transport changes.
 */
export type FeedContext = { config: AppConfig; entities: HassEntityMap; catalog: HaCatalog };

export type Feed<T = unknown> = {
  name: string;
  intervalMs: number;
  load: (context: FeedContext) => Promise<T>;
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

export const feeds: Feed[] = [agenda, weather, history];
