export type DisplayMode = "full" | "minimal" | "off";
export type UserRole = "admin" | "viewer";

export type DashboardPage = {
  id: string;
  title: string;
  enabled: boolean;
  /** Resolved through src/registry/pages.tsx; unknown kinds render a placeholder instead of crashing. */
  kind: string;
  cards: string[];
};

export type AppConfig = {
  deviceName: string;
  locale: string;
  timezone: string;
  idle: {
    minimalAfterMs: number;
    screenOffAfterMs: number;
    winLongPressMs: number;
    voiceLongPressMs: number;
    minimalLongPressMs: number;
  };
  voice: { enabled: boolean; wakeWord: boolean; winKey: boolean; endpoint: string };
  theme: { accent: string; cardOpacity: number; clockScale: number; burnInShift: boolean };
  weatherEntity: string;
  pages: DashboardPage[];
  entities: {
    lights: string[];
    sensors: string[];
    calendars: string[];
    courses: string[];
    mediaPlayers: string[];
    briefings: string[];
    memos: string[];
    stocks: string[];
    systemMetrics: {
      cpu: string;
      memory: string;
      disk: string;
      power: string;
      temperature: string;
      uptime: string;
    };
  };
  wakeTriggers: Array<{
    id: string;
    entityId: string;
    toState?: string;
    mode: Exclude<DisplayMode, "off">;
    enabled: boolean;
  }>;
};

export type HassEntity = {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown> & {
    friendly_name?: string;
    unit_of_measurement?: string;
    device_class?: string;
    icon?: string;
  };
  last_changed?: string;
};

export type HassEntityMap = Record<string, HassEntity>;

export type CalendarEvent = {
  summary: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  description?: string;
  location?: string;
};

export type AgendaMap = Record<string, CalendarEvent[]>;

export type HaCatalog = {
  connected: boolean;
  areas: Array<{ areaId: string; name: string }>;
  integrations: Array<{
    domain: string;
    title: string;
    state: string;
    source?: string;
    entryCount: number;
    deviceCount: number;
    entityCount: number;
    serviceCount: number;
  }>;
  devices: Array<{
    deviceId: string;
    name: string;
    areaId: string | null;
    areaName?: string;
    manufacturer?: string;
    model?: string;
    /** HA integrations (config-entry domains) the device belongs to, e.g. ["mobile_app"]. Absent in old caches. */
    integrations?: string[];
    /** HA device registry entry_type "service": an integration's virtual device (Sun, Backup, HACS…), not hardware. */
    service?: boolean;
  }>;
  entities: Array<{
    entityId: string;
    name: string;
    domain: string;
    deviceId?: string | null;
    areaId: string | null;
    areaName?: string;
    disabled: boolean;
    /** Integration that created the entity (mobile_app, icloud3, ibeacon, …). Absent in old caches. */
    platform?: string;
    /** HA entity_category: "config" / "diagnostic" entities are settings, not the device itself. */
    category?: string;
  }>;
};

export type WeatherForecastItem = {
  datetime: string;
  condition?: string;
  temperature?: number;
  templow?: number;
  precipitation?: number;
  precipitation_probability?: number;
  humidity?: number;
  pressure?: number;
  wind_speed?: number;
  wind_bearing?: number | string;
};

export type WeatherBundle = {
  entityId: string;
  daily: WeatherForecastItem[];
  hourly: WeatherForecastItem[];
  updatedAt: string;
};

export type HistoryPoint = { state: string; last_changed: string };
export type HistoryMap = Record<string, HistoryPoint[]>;

/** Named data pushed by back-stage feeds (server/kiosk/feeds.ts). Known feeds are typed; new ones arrive as unknown. */
export type FeedMap = {
  agenda?: AgendaMap;
  weather?: WeatherBundle | null;
  history?: HistoryMap;
} & Record<string, unknown>;
