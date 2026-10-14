"use client";

import { Activity, Cloud, Droplets, Eye, Gauge, Leaf, Navigation, Sun, Thermometer, Umbrella, Wind } from "lucide-react";
import type { SolarState } from "@/hooks/use-solar-theme";
import type { AppConfig, HassEntityMap, WeatherBundle, WeatherForecastItem } from "@/types/config";
import { ConditionIcon, WeatherMotion } from "./weather-motion";
import { MoonGlobe, SunOrbit } from "./celestial";
import { formatWeatherMetric, resolveWeatherSnapshot } from "@/lib/weather-source";
import { PageHeader } from "./page-header";

function formatHour(value: string, timezone: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "--" : new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}
function formatDay(value: string, timezone: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "--" : new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, weekday: "short", month: "numeric", day: "numeric" }).format(date);
}
function ForecastCell({ item, timezone, hourly = false }: { item: WeatherForecastItem; timezone: string; hourly?: boolean }) {
  return <div className="forecast-cell"><span>{hourly ? formatHour(item.datetime, timezone) : formatDay(item.datetime, timezone)}</span><i><ConditionIcon condition={item.condition}/></i><b>{item.temperature == null ? "--" : `${Math.round(item.temperature)}°`}</b>{!hourly && <small>{item.templow == null ? "" : `${Math.round(item.templow)}°`}</small>}{(item.precipitation_probability ?? item.precipitation ?? 0) > 0 && <em><Umbrella size={10}/>{item.precipitation_probability != null ? `${Math.round(item.precipitation_probability)}%` : `${item.precipitation} mm`}</em>}</div>;
}

export function WeatherPage({ config, entities, forecast, solar }: { config: AppConfig; entities: HassEntityMap; forecast: WeatherBundle | null; solar: SolarState }) {
  const weather = resolveWeatherSnapshot(entities, config.weatherEntity, forecast?.entityId);
  const forecastMatches = forecast && [weather.entityId, weather.fallbackEntityId].includes(forecast.entityId);
  const hourly = forecastMatches ? forecast.hourly.slice(0, 12) : [];
  const daily = forecastMatches ? forecast.daily.slice(0, 7) : [];
  const metrics = [
    ["湿度", weather.metrics.humidity, Droplets],
    ["风速", weather.metrics.windSpeed, Wind],
    ["气压", weather.metrics.pressure, Gauge],
    ["能见度", weather.metrics.visibility, Eye],
    ["风向", weather.metrics.windDirection, Navigation],
    ["紫外线", weather.metrics.uv, Sun],
    ["云量", weather.metrics.cloud, Cloud],
    ["露点", weather.metrics.dew, Thermometer],
    ["空气质量", weather.metrics.aqi, Leaf],
    ["PM2.5", weather.metrics.pm25, Activity],
    ["PM10", weather.metrics.pm10, Activity],
    ["臭氧 O₃", weather.metrics.o3, Cloud],
  ] as const;
  const airSummary = [weather.metrics.airCategory.value, weather.metrics.primaryPollutant.value ? `首要污染物 ${weather.metrics.primaryPollutant.value}` : null].filter(Boolean).join(" · ");

  return <section className="weather-layout h-full p-7 xl:p-9" aria-label="天气详情">
    <PageHeader kicker="Weather · 本地预报" title="天气详情" tone="blue" aside={weather.sourceName} />
    <div className="weather-dashboard grid min-h-0 grid-cols-[minmax(17rem,.72fr)_minmax(0,1.28fr)] gap-4">
      <div className="grid min-h-0 grid-rows-[1.18fr_.82fr] gap-4">
        <article className="glass weather-hero relative flex min-h-0 flex-col justify-end overflow-hidden rounded-[var(--r-xl)] p-6"><div className="weather-detail-scene absolute inset-x-0 top-0 h-[66%]"><WeatherMotion condition={weather.condition}/></div><div className="relative z-10 flex items-end justify-between gap-4"><div><strong className="font-display text-[clamp(4.4rem,8vw,7.4rem)] font-medium leading-none tracking-[-.09em]">{formatWeatherMetric(weather.metrics.temperature)}</strong><p className="mb-0 mt-2 text-sm text-[var(--muted)]">体感 {formatWeatherMetric(weather.metrics.apparentTemperature)} · {weather.conditionLabel || "等待 HA 天气"}</p>{airSummary && <p className="mb-0 mt-1 text-xs text-[var(--muted)]">空气 {airSummary}</p>}</div><span className="mb-2 text-xs text-[var(--muted)]">{weather.conditionLabel}</span></div></article>
        <article className="glass weather-celestial-grid min-h-0 rounded-[var(--r-xl)] p-4"><div className="grid h-full grid-cols-[1.45fr_.55fr] gap-3"><SunOrbit progress={solar.progress} above={solar.above} rising={solar.rising} setting={solar.setting} timezone={config.timezone} /><MoonGlobe /></div></article>
      </div>
      <div className="grid min-h-0 grid-rows-[auto_1fr_1fr] gap-4">
        <div className="grid grid-cols-4 gap-2 xl:grid-cols-6">{metrics.map(([label,metric,Icon]) => <article key={label} className="glass weather-metric rounded-[var(--r-lg)] p-4"><Icon size={17}/><span>{label}</span><b>{formatWeatherMetric(metric)}</b></article>)}</div>
        <article className="glass min-h-0 overflow-hidden rounded-[var(--r-xl)] p-5"><div className="mb-3 flex items-center justify-between"><span className="card-kicker">逐小时</span><span className="text-[11px] text-[var(--muted)]">未来 12 小时</span></div>{hourly.length ? <div className="forecast-row" data-no-swipe>{hourly.map((item) => <ForecastCell key={item.datetime} item={item} timezone={config.timezone} hourly/>)}</div> : <div className="weather-empty">当前天气集成未提供逐小时预报</div>}</article>
        <article className="glass min-h-0 overflow-hidden rounded-[var(--r-xl)] p-5"><div className="mb-3 flex items-center justify-between"><span className="card-kicker">未来一周</span><span className="text-[11px] text-[var(--muted)]">每日高低温与降水概率</span></div>{daily.length ? <div className="forecast-row daily" data-no-swipe>{daily.map((item) => <ForecastCell key={item.datetime} item={item} timezone={config.timezone}/>)}</div> : <div className="weather-empty">当前天气集成未提供每日预报</div>}</article>
      </div>
    </div>
  </section>;
}
