"use client";

import { useEffect, useMemo, useState } from "react";
import { Sparkles, CalendarDays, Cloud, Clock3, Droplets, Eye, Gauge, HousePlug, Music2, Navigation, Newspaper, NotebookPen, Sunrise, Sunset, Sun, Thermometer, TrendingDown, TrendingUp, Wind } from "lucide-react";
import { ClockMark } from "./clock-mark";
import { StatusPill } from "./status-pill";
import { useLocalClock } from "@/hooks/use-local-clock";
import type { SolarState } from "@/hooks/use-solar-theme";
import type { AgendaMap, AppConfig, BtcFeed, CalendarEvent, HaCatalog, HassEntity, HassEntityMap, WeatherBundle } from "@/types/config";
import { resolveStockIds, stockChange, stockCurrency, stockDirection, stockPercent, stockSymbol } from "@/lib/stocks";
import { solarTime, WeatherMotion } from "./weather-motion";
import { SunOrbit } from "./celestial";
import { PersonalDevicesHome, resolvePersonalDevices } from "./personal-devices";
import { formatWeatherMetric, resolveWeatherSnapshot } from "@/lib/weather-source";
import { parseCourse } from "@/lib/course";
import { isWorkdayCalendar } from "@/lib/calendar";
import { isDeviceTile } from "@/lib/catalog";
import { resolveAlmanac, resolveClimate, resolveComplications, resolveIndoor, resolvePower } from "@/lib/glance";
import { Complications, CourseTimeline, EnvironmentCard } from "./home-cards";
import { buildDeviceTree } from "./devices-page";
import { BtcAccountsCard, BtcTrendCard } from "./btc-cards";
import { SafeBoundary } from "./safe-boundary";

type DynamicItem = { id: string; kind: "简报" | "备忘" | "股票" | "缓存" | "概览"; title: string; content: string; positive?: boolean };

function usable(entity: HassEntity | undefined) {
  return entity && !["unknown", "unavailable", "none", ""].includes(entity.state);
}

function entityText(entity: HassEntity | undefined) {
  if (!entity) return "";
  const attributes = entity.attributes;
  const value = attributes.message ?? attributes.text ?? attributes.description ?? attributes.title;
  return typeof value === "string" && value.trim() ? value : usable(entity) ? entity.state : "";
}

function firstEntity(ids: string[], entities: HassEntityMap) {
  return ids.map((id) => entities[id]).find(Boolean);
}

function nextAgenda(ids: string[], agenda: AgendaMap) {
  const now = Date.now();
  return ids.flatMap((id) => agenda[id] ?? []).map((event) => ({ event, time: new Date(event.start.dateTime ?? event.start.date ?? "").getTime() })).filter((item) => Number.isFinite(item.time) && item.time >= now - 3_600_000).sort((a, b) => a.time - b.time)[0];
}

function calendarDayKey(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function eventDate(event: CalendarEvent) {
  const value = event.start.dateTime ?? event.start.date ?? "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function weekDates(now: Date | null, timezone: string) {
  if (!now) return [];
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value) - 1;
  const day = Number(parts.find((part) => part.type === "day")?.value);
  const anchor = new Date(Date.UTC(year, month, day, 12));
  const mondayOffset = (anchor.getUTCDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, index) => new Date(anchor.getTime() + (index - mondayOffset) * 86_400_000));
}

export function HomePage({ config, entities, catalog, agenda, forecast, btc, status, solar, usingCache, cachedAt }: {
  config: AppConfig;
  btc: BtcFeed | null;
  entities: HassEntityMap;
  catalog: HaCatalog;
  agenda: AgendaMap;
  forecast: WeatherBundle | null;
  status: "connecting" | "connected" | "offline";
  solar: SolarState;
  usingCache: boolean;
  cachedAt: string | null;
}) {
  const clock = useLocalClock(config.locale, config.timezone);
  const weather = resolveWeatherSnapshot(entities, config.weatherEntity, forecast?.entityId);
  // Event calendars only: workday calendars carry no events worth showing ("Workday Sensor CN" every weekday).
  const calendarIds = useMemo(() => (config.entities.calendars.length ? config.entities.calendars : catalog.entities.filter((item) => item.domain === "calendar" && !item.disabled && !config.entities.courses.includes(item.entityId)).map((item) => item.entityId)).filter((id) => !isWorkdayCalendar(id)), [catalog.entities, config.entities.calendars, config.entities.courses]);
  const calendar = firstEntity(calendarIds, entities);
  const workday = Object.values(entities).find((entity) => entity.entity_id.startsWith("binary_sensor.workday"));
  const workdayText = workday?.state === "on" ? "今天是工作日" : workday?.state === "off" ? "今天休息" : "未绑定日历";
  const calendarEvent = nextAgenda(calendarIds, agenda)?.event;
  const todayKey = clock.now ? calendarDayKey(clock.now, config.timezone) : "";
  const calendarEvents = useMemo(() => calendarIds.flatMap((id) => agenda[id] ?? []), [agenda, calendarIds]);
  const courseEvents = useMemo(() => config.entities.courses.flatMap((id) => agenda[id] ?? []).filter((event) => eventDate(event)), [agenda, config.entities.courses]);
  const todayCourses = courseEvents.filter((event) => {
    const date = eventDate(event);
    return date && calendarDayKey(date, config.timezone) === todayKey;
  }).sort((a, b) => eventDate(a)!.getTime() - eventDate(b)!.getTime());
  const remainingCourses = todayCourses.filter((event) => new Date(event.end.dateTime ?? event.end.date ?? "").getTime() >= (clock.now?.getTime() ?? 0));
  const calendarWeek = weekDates(clock.now, config.timezone);
  const calendarEventDays = new Set(calendarEvents.map(eventDate).filter((date): date is Date => Boolean(date)).map((date) => calendarDayKey(date, config.timezone)));
  const media = firstEntity(config.entities.mediaPlayers, entities) ?? entities[Object.keys(entities).find((id) => id.startsWith("media_player.")) ?? ""];
  const tiles = catalog.devices.filter(isDeviceTile);
  const tileIds = new Set(tiles.map((device) => device.deviceId));
  const deviceEntityIds = catalog.entities.filter((item) => item.deviceId && tileIds.has(item.deviceId) && !item.disabled && !item.category).map((item) => item.entityId);
  const online = deviceEntityIds.filter((id) => entities[id] && entities[id].state !== "unavailable").length;
  // Same tile model as the Devices page: a device is "on" by its primary entity, not by a config switch or indicator light.
  const activeDevices = useMemo(() => buildDeviceTree(catalog, entities).filter((device) => ["on", "playing", "open", "heat", "cool", "dry", "fan_only", "auto", "heat_cool"].includes(device.state?.state ?? "")).length, [catalog, entities]);
  const personalDevices = useMemo(() => resolvePersonalDevices(entities, catalog), [entities, catalog]);
  const complications = useMemo(() => resolveComplications(entities), [entities]);
  const almanac = useMemo(() => resolveAlmanac(entities), [entities]);
  const climate = useMemo(() => resolveClimate(entities), [entities]);
  const power = useMemo(() => resolvePower(entities), [entities]);
  const indoor = useMemo(() => resolveIndoor(entities), [entities]);
  const hostUptime = Object.values(entities).find((entity) => /^sensor\.q775_.*_system_uptime$/.test(entity.entity_id));
  const temperature = weather.metrics.temperature;
  const SolarIcon = solar.phase === "dawn" || solar.phase === "day" ? Sunrise : Sunset;
  const mediaTitle = typeof media?.attributes.media_title === "string" ? media.attributes.media_title : "";
  const mediaArtist = typeof media?.attributes.media_artist === "string" ? media.attributes.media_artist : "";
  const weatherMetrics = [
    ["湿度", weather.metrics.humidity, Droplets],
    ["风速", weather.metrics.windSpeed, Wind],
    ["气压", weather.metrics.pressure, Gauge],
    ["能见度", weather.metrics.visibility, Eye],
    ["风向", weather.metrics.windDirection, Navigation],
    ["紫外线", weather.metrics.uv, Sun],
    ["云量", weather.metrics.cloud, Cloud],
    ["空气", weather.metrics.aqi, Thermometer],
  ] as const;
  const stockIds = useMemo(() => resolveStockIds(config.entities.stocks, entities), [config.entities.stocks, entities]);
  const dynamicItems = useMemo<DynamicItem[]>(() => {
    const items: DynamicItem[] = [];
    for (const id of config.entities.briefings) {
      const entity = entities[id];
      const content = entityText(entity);
      if (content) items.push({ id, kind: "简报", title: String(entity?.attributes.friendly_name ?? "今日简报"), content });
    }
    for (const id of config.entities.memos) {
      const entity = entities[id];
      const content = entityText(entity);
      if (content) items.push({ id, kind: "备忘", title: String(entity?.attributes.friendly_name ?? "备忘录"), content });
    }
    for (const id of stockIds) {
      const entity = entities[id];
      if (!usable(entity)) continue;
      const change = stockChange(entity);
      const percent = stockPercent(entity);
      const symbol = stockSymbol(entity, id);
      const currency = stockCurrency(entity);
      const movement = change == null ? "" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}${percent == null ? "" : ` · ${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%`}`;
      items.push({ id: `stock-${id}`, kind: "股票", title: symbol, content: `${entity.state}${currency ? ` ${currency}` : ""}${movement ? ` · ${movement}` : ""}`, positive: stockDirection(entity) >= 0 });
    }
    // Nothing bound? Rotate real facts instead of an empty card.
    if (!items.length) {
      const done = todayCourses.filter((event) => new Date(event.end.dateTime ?? event.end.date ?? "").getTime() <= (clock.now?.getTime() ?? 0)).length;
      if (todayCourses.length) items.push({ id: "auto-courses", kind: "概览", title: "今日课程", content: `共 ${todayCourses.length} 节课，已完成 ${done} 节${remainingCourses[0] ? `，下一节 ${parseCourse(remainingCourses[0]).title}` : ""}` });
      if (solar.rising && solar.setting) items.push({ id: "auto-sun", kind: "概览", title: "日照", content: `日出 ${solarTime(solar.rising, config.timezone)} · 日落 ${solarTime(solar.setting, config.timezone)}` });
      const sky = [almanac.season, almanac.moon && `月相 ${almanac.moon}`, almanac.workday].filter(Boolean).join(" · ");
      if (sky) items.push({ id: "auto-almanac", kind: "概览", title: "今日", content: sky });
      const seconds = Number(hostUptime?.state);
      if (Number.isFinite(seconds)) items.push({ id: "auto-host", kind: "概览", title: config.deviceName, content: `已连续运行 ${Math.floor(seconds / 86400)} 天 ${Math.floor((seconds % 86400) / 3600)} 小时` });
    }
    if (usingCache) {
      const time = cachedAt ? new Intl.DateTimeFormat("zh-CN", { timeZone: config.timezone, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(cachedAt)) : "未知时间";
      items.push({ id: "cache-state", kind: "缓存", title: "当前显示历史状态", content: `缓存更新时间 ${time}` });
    }
    return items;
  }, [almanac, cachedAt, clock.now, config.deviceName, config.entities.briefings, config.entities.memos, config.timezone, entities, hostUptime?.state, remainingCourses, solar.rising, solar.setting, stockIds, todayCourses, usingCache]);
  const [activeDynamic, setActiveDynamic] = useState(0);
  const [weatherScene, setWeatherScene] = useState<"weather" | "solar">("weather");

  useEffect(() => {
    if (dynamicItems.length < 2) return;
    const timer = window.setInterval(() => setActiveDynamic((current) => (current + 1) % dynamicItems.length), 7000);
    return () => window.clearInterval(timer);
  }, [dynamicItems.length]);

  useEffect(() => {
    const timer = window.setInterval(() => setWeatherScene((current) => current === "weather" ? "solar" : "weather"), 9000);
    return () => window.clearInterval(timer);
  }, []);

  const dynamic = dynamicItems[activeDynamic % Math.max(dynamicItems.length, 1)];
  const DynamicIcon = dynamic?.kind === "简报" ? Newspaper : dynamic?.kind === "备忘" ? NotebookPen : dynamic?.kind === "股票" ? (dynamic.positive ? TrendingUp : TrendingDown) : dynamic?.kind === "概览" ? Sparkles : Clock3;

  return (
    <section className="home-layout grid h-full grid-cols-[minmax(0,1.42fr)_minmax(34rem,.92fr)] gap-5 p-7 xl:p-9" aria-label="主表盘">
      <div className="home-clock-column min-w-0 px-2 py-4">
        <div className="home-clock-status flex items-center gap-3">
          <StatusPill status={status} usingCache={usingCache} />
          <span className="solar-chip inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium"><SolarIcon size={14} /> {solar.label}</span>
        </div>
        <div className="home-clock-primary">
          <ClockMark locale={config.locale} timezone={config.timezone} clockScale={config.theme.clockScale} />
          <Complications items={complications} />
          <div className="solar-horizon max-w-3xl" aria-label={solar.nextEvent}>
            <div className="solar-horizon-line"><i style={{ left: `${solar.progress * 100}%` }} /></div>
            <div className="mt-2 flex justify-between text-[11px] font-medium tracking-[.08em] text-[var(--muted)]"><span>{solar.label}</span><span>{solar.nextEvent}</span></div>
          </div>
        </div>
        <div className="briefing-line home-clock-footer flex max-w-3xl items-center justify-between gap-4 text-sm text-[var(--muted)]">
          <span>{config.deviceName}</span>
          <span className="home-almanac">{[almanac.workday, almanac.season, almanac.moon].filter(Boolean).map((item) => <i key={item}>{item}</i>)}<i>{status === "connected" ? "实时同步" : usingCache ? "离线缓存" : "等待数据"}</i></span>
        </div>
      </div>

      <aside className={`ambient-deck grid min-h-0 grid-cols-2 gap-3 ${btc ? "has-btc" : ""}`} aria-label="常驻状态卡片">
        <article className="glass home-weather-card ambient-card relative col-span-2 min-h-0 overflow-hidden rounded-[var(--r-xl)] p-3">
          <div className="home-weather-stage relative h-full min-h-0 overflow-hidden rounded-[calc(var(--r-xl)_-_.75rem)] bg-[rgb(var(--surface-rgb)/.12)]">
            <div className={`weather-scene-layer ${weatherScene === "weather" ? "active" : ""}`} aria-hidden={weatherScene !== "weather"}>
              <WeatherMotion condition={weather.condition} compact />
            </div>
            <div className={`weather-scene-layer ${weatherScene === "solar" ? "active" : ""}`} aria-hidden={weatherScene !== "solar"}>
              <SunOrbit progress={solar.progress} above={solar.above} rising={solar.rising} setting={solar.setting} timezone={config.timezone} compact />
            </div>
            <div className="weather-hud-title absolute left-3 top-3"><span>现在 · {weather.conditionLabel || "等待天气"}</span><strong>{formatWeatherMetric(temperature)}</strong></div>
            <div className="weather-hud-left absolute left-3 flex flex-col justify-end gap-1.5">
              {weatherMetrics.slice(0, 4).map(([label,metric,Icon]) => <div key={label} className="weather-hud-chip"><Icon size={11}/><span>{label}</span><b>{formatWeatherMetric(metric)}</b></div>)}
            </div>
            <div className="weather-hud-bottom absolute bottom-2 left-3 right-3 flex items-center gap-1.5">
              {weatherMetrics.slice(4).map(([label,metric,Icon]) => <div key={label} className="weather-hud-chip"><Icon size={11}/><span>{label}</span><b>{formatWeatherMetric(metric)}</b></div>)}
              <div className="weather-hud-sun"><span>日出 {solarTime(solar.rising, config.timezone)}</span><span>日落 {solarTime(solar.setting, config.timezone)}</span></div>
            </div>
            <div className="weather-scene-dots absolute right-3 top-3 flex gap-1"><i className={`size-1 rounded-full ${weatherScene === "weather" ? "bg-[var(--ink)]/70" : "bg-[var(--ink)]/20"}`} /><i className={`size-1 rounded-full ${weatherScene === "solar" ? "bg-[var(--ink)]/70" : "bg-[var(--ink)]/20"}`} /></div>
          </div>
        </article>

        <CourseTimeline events={todayCourses} now={clock.now} timezone={config.timezone} bound={config.entities.courses.length > 0} />

        <article className="glass ambient-card home-calendar-card rounded-[var(--r-lg)] p-3.5">
          <div className="flex items-center justify-between gap-2"><span className="ambient-label"><CalendarDays size={13} />日历</span><strong className="home-calendar-date">{clock.date || "--"}</strong></div>
          <div className="home-week-strip mt-2.5">{calendarWeek.map((date) => { const key = date.toISOString().slice(0, 10); const current = key === todayKey; return <div key={key} className={current ? "today" : ""}><span>{["日","一","二","三","四","五","六"][date.getUTCDay()]}</span><b>{date.getUTCDate()}</b>{calendarEventDays.has(key) && <i />}</div>; })}</div>
          <p className="ambient-detail home-calendar-next"><span>下一项</span>{calendarEvent?.summary || entityText(calendar) || (calendarIds.length ? "近期没有日程" : workdayText)}</p>
        </article>


        <article className="glass ambient-card home-status-card rounded-[var(--r-lg)] p-4">
          <span className="ambient-label"><HousePlug size={14} />设备</span>
          {personalDevices.length ? <PersonalDevicesHome devices={personalDevices} /> : <>
            <strong className="home-status-value">{activeDevices}<small>开启</small></strong>
            <p className="ambient-detail">{tiles.length ? `${online} 个实体在线 · ${tiles.length} 台设备` : "等待 HA 设备树"}</p>
          </>}
        </article>

        {btc && (
          <div className="home-btc-row col-span-2">
            <SafeBoundary name="btc trend" fallback={<article className="glass ambient-card rounded-[var(--r-lg)]" />}><BtcTrendCard btc={btc} timezone={config.timezone} /></SafeBoundary>
            <SafeBoundary name="btc accounts" fallback={<article className="glass ambient-card rounded-[var(--r-lg)]" />}><BtcAccountsCard btc={btc} timezone={config.timezone} /></SafeBoundary>
          </div>
        )}

        {media ? (
          <article className="glass ambient-card home-status-card rounded-[var(--r-lg)] p-4">
            <span className="ambient-label"><Music2 size={14} />媒体</span>
            <strong className="home-media-title">{mediaTitle || (usable(media) ? media.state : "暂无播放")}</strong>
            <p className="ambient-detail line-clamp-1">{mediaArtist || "播放器空闲"}</p>
          </article>
        ) : <EnvironmentCard climate={climate} power={power} indoor={indoor} />}

        <article className="glass dynamic-strip relative overflow-hidden rounded-[var(--r-lg)] px-4 py-3.5" aria-live="polite">
          {dynamic ? (
            <div key={dynamic.id} className="dynamic-card-content flex h-full items-center gap-4">
              <span className="dynamic-icon"><DynamicIcon size={16} /></span>
              <div className="min-w-0"><span className="dynamic-kicker">{dynamic.kind} · {dynamic.title}</span><p className="mb-0 mt-1 line-clamp-2 text-sm font-medium leading-5">{dynamic.content}</p></div>
            </div>
          ) : (
            <div className="flex h-full items-center gap-4 text-[var(--muted)]"><NotebookPen size={20} /><div><b className="block text-sm text-[var(--ink)]">暂无动态内容</b><span className="mt-1 block text-xs">在后台绑定简报、备忘或股票实体</span></div></div>
          )}
          {dynamicItems.length > 1 && <div key={`progress-${activeDynamic}`} className="card-progress absolute inset-x-0 bottom-0 h-[2px]" />}
        </article>
      </aside>
    </section>
  );
}
