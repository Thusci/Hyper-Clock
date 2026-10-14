"use client";

import { useId } from "react";
import { Cloud, CloudDrizzle, CloudFog, CloudHail, CloudLightning, CloudRain, CloudRainWind, CloudSnow, CloudSun, Moon, Sun, TriangleAlert, Wind, type LucideIcon } from "lucide-react";
import type { HassEntity } from "@/types/config";

export const conditionNames: Record<string, string> = {
  "clear-night": "晴朗夜间", cloudy: "多云", exceptional: "异常天气", fog: "有雾", hail: "冰雹",
  lightning: "雷电", "lightning-rainy": "雷雨", partlycloudy: "局部多云", pouring: "暴雨",
  rainy: "有雨", snowy: "有雪", "snowy-rainy": "雨夹雪", sunny: "晴", windy: "有风", "windy-variant": "多云有风",
};

export function weatherNumber(entity: HassEntity | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = entity?.attributes[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return undefined;
}

export function solarTime(raw: unknown, timezone: string) {
  if (typeof raw !== "string") return "--";
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? "--" : new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

const conditionGlyphs: Record<string, [LucideIcon, "sun" | "moon" | "cloud" | "rain" | "snow" | "storm"]> = {
  sunny: [Sun, "sun"], "clear-night": [Moon, "moon"], partlycloudy: [CloudSun, "sun"], cloudy: [Cloud, "cloud"],
  fog: [CloudFog, "cloud"], rainy: [CloudDrizzle, "rain"], pouring: [CloudRainWind, "rain"], snowy: [CloudSnow, "snow"],
  "snowy-rainy": [CloudRain, "snow"], hail: [CloudHail, "snow"], lightning: [CloudLightning, "storm"],
  "lightning-rainy": [CloudLightning, "storm"], windy: [Wind, "cloud"], "windy-variant": [Wind, "cloud"], exceptional: [TriangleAlert, "storm"],
};

// Static symbol for dense lists; WeatherMotion stays reserved for the hero scenes.
export function ConditionIcon({ condition = "", size = 22 }: { condition?: string; size?: number }) {
  const [Icon, tone] = conditionGlyphs[condition] ?? [Cloud, "cloud"];
  return <span className="condition-icon" data-tone={tone} aria-label={conditionNames[condition] ?? condition}><Icon size={size} strokeWidth={1.8} /></span>;
}

export function WeatherMotion({ condition = "", compact = false }: { condition?: string; compact?: boolean }) {
  const id = useId().replaceAll(":", "");
  const sunGradient = `weather-sun-${id}`;
  const cloudGradient = `weather-cloud-${id}`;
  const glowFilter = `weather-glow-${id}`;
  const moonMask = `weather-moon-${id}`;
  const rain = condition.includes("rain") || condition === "pouring";
  const snow = condition.includes("snow") || condition === "hail";
  const lightning = condition.includes("lightning");
  const fog = condition === "fog";
  const cloudy = condition === "cloudy" || condition === "partlycloudy" || condition.includes("wind") || rain || snow || lightning || fog;
  const night = condition === "clear-night";
  const sunny = condition === "sunny" || condition === "" || condition === "exceptional";
  return (
    <div className={`weather-motion ${compact ? "compact" : ""}`} data-weather={condition || "unknown"} aria-label={conditionNames[condition] ?? condition ?? "天气动画"}>
      <svg viewBox="0 0 240 170" role="img">
        <defs>
          <linearGradient id={sunGradient} x1="0" y1="0" x2="1" y2="1"><stop stopColor="var(--weather-sun-a)"/><stop offset="1" stopColor="var(--weather-sun-b)"/></linearGradient>
          <linearGradient id={cloudGradient} x1="0" y1="0" x2="0" y2="1"><stop stopColor="var(--weather-cloud-a)"/><stop offset="1" stopColor="var(--weather-cloud-b)"/></linearGradient>
          <filter id={glowFilter} x="-70%" y="-70%" width="240%" height="240%"><feGaussianBlur stdDeviation="7"/></filter>
          <mask id={moonMask}><rect width="240" height="170" fill="white"/><circle cx="101" cy="55" r="30" fill="black"/></mask>
        </defs>
        {(sunny || cloudy) && !night && <g className="weather-sun"><circle className="weather-glow" cx="82" cy="61" r="37" fill="var(--weather-sun-a)" filter={`url(#${glowFilter})`}/><circle className="weather-orb-contrast" cx="82" cy="61" r="30"/><circle cx="82" cy="61" r="27" fill={`url(#${sunGradient})`}/><circle className="weather-orb-highlight" cx="74" cy="52" r="7"/></g>}
        {night && <g className="weather-moon"><circle className="weather-glow" cx="78" cy="57" r="37" fill="var(--weather-moon)" filter={`url(#${glowFilter})`}/><circle className="weather-orb-contrast" cx="78" cy="57" r="31"/><circle cx="78" cy="57" r="28" fill="var(--weather-moon)" mask={`url(#${moonMask})`}/><circle className="weather-orb-highlight" cx="68" cy="47" r="6"/><circle cx="134" cy="32" r="2" fill="var(--weather-star)"/><circle cx="154" cy="59" r="1.5" fill="var(--weather-star)"/><circle cx="119" cy="17" r="1.2" fill="var(--weather-star)"/></g>}
        {cloudy && <g className="weather-cloud"><path className="weather-cloud-shell" d="M55 119c-19 0-31-10-31-25 0-14 11-25 27-26 6-24 25-39 49-39 27 0 48 18 52 44 18 1 31 12 31 29 0 17-14 29-34 29H55z" fill={`url(#${cloudGradient})`}/><path d="M64 112c-14 0-23-7-23-18 0-10 8-18 20-19 5-17 18-27 35-27 19 0 34 13 37 31 13 1 22 9 22 20 0 12-10 20-24 20H64z" fill="rgba(255,255,255,.16)"/></g>}
        {rain && <g className="weather-rain" stroke="var(--weather-rain)" strokeWidth="4" strokeLinecap="round"><path d="M61 135l-7 13"/><path d="M94 135l-7 13"/><path d="M127 135l-7 13"/><path d="M160 135l-7 13"/></g>}
        {snow && <g className="weather-snow" fill="var(--weather-snow)"><circle cx="59" cy="143" r="3"/><circle cx="91" cy="137" r="3"/><circle cx="123" cy="146" r="3"/><circle cx="155" cy="138" r="3"/></g>}
        {lightning && <path className="weather-lightning" d="M112 121h23l-18 22h14l-31 27 10-23H95z" fill="var(--weather-lightning)"/>}
        {fog && <g className="weather-fog" stroke="var(--weather-fog)" strokeWidth="5" strokeLinecap="round"><path d="M39 135h132"/><path d="M57 149h126"/><path d="M32 163h114"/></g>}
        {condition.includes("wind") && <g className="weather-wind" fill="none" stroke="var(--weather-wind)" strokeWidth="4" strokeLinecap="round"><path d="M28 124h102c22 0 22-21 7-21"/><path d="M48 143h118c25 0 25 22 7 22"/></g>}
      </svg>
    </div>
  );
}
