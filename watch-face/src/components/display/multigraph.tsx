"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { resolveWeatherSnapshot, type WeatherMetric } from "@/lib/weather-source";
import type { HassEntityMap } from "@/types/config";

/**
 * Multi-function dial for the minimal face, after the Ferrari Luce "Multigraph":
 * three slim aluminium hands over black glass that re-purpose themselves per mode.
 *
 *   time      hour · minute · sweeping seconds
 *   compass   hour + minute stack into a needle on the wind bearing, seconds is its tail
 *   daylight  24 h scale: hour → sunrise, minute → sunset, seconds → now
 *
 * Modes without data are skipped. Every mode change moves each hand along the shortest
 * arc with a smootherstep ease (zero velocity and acceleration at both ends), staggered
 * per hand, so the dial re-forms like a mechanical movement rather than jumping.
 */
type Mode = "time" | "compass" | "daylight";

const HOLD_MS: Record<Mode, number> = { time: 22_000, compass: 9000, daylight: 9000 };
const TRANSITION_MS = 1900;
const STAGGER_MS = [0, 110, 220];
const C = 200;

const compassPoints: Record<string, number> = {
  北: 0, 东北: 45, 东: 90, 东南: 135, 南: 180, 西南: 225, 西: 270, 西北: 315,
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
};
const compassNames = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];

function windBearing(metric: WeatherMetric | undefined) {
  const value = metric?.value;
  if (typeof value === "number" && Number.isFinite(value)) return ((value % 360) + 360) % 360;
  if (typeof value !== "string") return null;
  const numeric = Number(value);
  if (value.trim() && Number.isFinite(numeric)) return ((numeric % 360) + 360) % 360;
  const key = value.replace(/风$/, "").trim().toUpperCase();
  return compassPoints[key] ?? compassPoints[value.replace(/风$/, "").trim()] ?? null;
}

function minutesOfDay(raw: unknown, timezone: string) {
  if (typeof raw !== "string") return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

const pad = (value: number) => String(Math.floor(value)).padStart(2, "0");
const clock = (minutes: number) => `${pad(minutes / 60)}:${pad(minutes % 60)}`;
const norm = (angle: number) => ((angle + 540) % 360) - 180;
const wrap = (angle: number) => ((angle % 360) + 360) % 360;
const smootherstep = (x: number) => x * x * x * (x * (x * 6 - 15) + 10);
const polar = (angle: number, radius: number) => [C + radius * Math.sin(angle * Math.PI / 180), C - radius * Math.cos(angle * Math.PI / 180)] as const;

function arc(fromDeg: number, toDeg: number, radius: number) {
  const sweep = wrap(toDeg - fromDeg);
  const [x1, y1] = polar(fromDeg, radius);
  const [x2, y2] = polar(fromDeg + sweep, radius);
  return `M ${x1} ${y1} A ${radius} ${radius} 0 ${sweep > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}

export function Multigraph({ locale, timezone, entities, weatherEntity, rising, setting }: { locale: string; timezone: string; entities: HassEntityMap; weatherEntity: string; rising: string | null; setting: string | null }) {
  const id = useId().replaceAll(":", "");
  const hands = useRef<Array<SVGGElement | null>>([]);
  const shadows = useRef<Array<SVGGElement | null>>([]);

  const weather = resolveWeatherSnapshot(entities, weatherEntity);
  const bearing = windBearing(weather.metrics.windDirection);
  const windSpeed = weather.metrics.windSpeed;
  const sunrise = minutesOfDay(rising, timezone);
  const sunset = minutesOfDay(setting, timezone);

  const sequence = useMemo<Mode[]>(() => {
    const modes: Mode[] = ["time"];
    if (bearing != null) modes.push("compass");
    if (sunrise != null && sunset != null) modes.push(...(modes.length > 1 ? ["time", "daylight"] as Mode[] : ["daylight"] as Mode[]));
    return modes;
  }, [bearing, sunrise, sunset]);
  const [step, setStep] = useState(0);
  const mode = sequence[step % sequence.length];

  useEffect(() => {
    if (sequence.length < 2) return;
    const timer = window.setTimeout(() => setStep((current) => current + 1), HOLD_MS[mode]);
    return () => window.clearTimeout(timer);
  }, [mode, sequence.length, step]);

  // The animation loop reads the latest inputs from a ref so it never restarts.
  const live = useRef({ mode, bearing, sunrise, sunset, timezone });
  useEffect(() => { live.current = { mode, bearing, sunrise, sunset, timezone }; }, [bearing, mode, sunrise, sunset, timezone]);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const shown = [0, 0, 0];
    let from = [0, 0, 0];
    let started = performance.now();
    let lastMode: Mode | null = live.current.mode;
    let lastDraw = 0;
    let frame = 0;
    let cachedSecond = -1;
    let wall = { h: 0, m: 0, s: 0 };

    const wallClock = (now: Date) => {
      const second = Math.floor(now.getTime() / 1000);
      if (second !== cachedSecond) {
        cachedSecond = second;
        const parts = new Intl.DateTimeFormat("en-US", { timeZone: live.current.timezone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now);
        const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
        wall = { h: get("hour"), m: get("minute"), s: get("second") };
      }
      return { ...wall, ms: reduced.matches ? 0 : now.getMilliseconds() };
    };

    const targets = (now: Date): number[] => {
      const { mode: current, bearing: wind, sunrise: rise, sunset: set } = live.current;
      const t = wallClock(now);
      if (current === "compass" && wind != null) return [wind, wind, wind + 180];
      if (current === "daylight" && rise != null && set != null) return [rise / 4, set / 4, (t.h * 60 + t.m + t.s / 60) / 4];
      const seconds = t.s + t.ms / 1000;
      return [((t.h % 12) + t.m / 60 + seconds / 3600) * 30, (t.m + seconds / 60) * 6, seconds * 6];
    };

    const draw = (time: number) => {
      frame = window.requestAnimationFrame(draw);
      if (live.current.mode !== lastMode) {
        lastMode = live.current.mode;
        from = [...shown];
        started = time;
      }
      const moving = time - started < TRANSITION_MS + STAGGER_MS[2];
      const fps = moving ? 60 : live.current.mode === "time" && !reduced.matches ? 30 : 4;
      if (time - lastDraw < 1000 / fps - 2) return;
      lastDraw = time;
      const goal = targets(new Date());
      for (let index = 0; index < 3; index++) {
        const progress = reduced.matches ? 1 : Math.min(1, Math.max(0, (time - started - STAGGER_MS[index]) / TRANSITION_MS));
        shown[index] = wrap(from[index] + norm(goal[index] - from[index]) * smootherstep(progress));
        hands.current[index]?.setAttribute("transform", `rotate(${shown[index].toFixed(2)} ${C} ${C})`);
        shadows.current[index]?.setAttribute("transform", `translate(1.6 2.6) rotate(${shown[index].toFixed(2)} ${C} ${C})`);
      }
    };
    frame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const now = new Date();
  const weekday = new Intl.DateTimeFormat(locale, { timeZone: timezone, weekday: "short" }).format(now);
  const date = new Intl.DateTimeFormat(locale, { timeZone: timezone, month: "numeric", day: "numeric" }).format(now);
  const readout: Record<Mode, [string, string]> = {
    time: ["TIME", `${weekday} · ${date}`],
    compass: ["WIND", bearing == null ? "--" : `${compassNames[Math.round(bearing / 45) % 8]}风 ${Math.round(bearing)}°${windSpeed?.value != null ? ` · ${windSpeed.value}${windSpeed.unit}` : ""}`],
    daylight: ["DAYLIGHT", sunrise != null && sunset != null ? `↑ ${clock(sunrise)}   ↓ ${clock(sunset)}` : "--"],
  };

  const handShapes = [
    "M 196.2 214 L 197.6 112 Q 200 104 202.4 112 L 203.8 214 Z",
    "M 197.2 220 L 198.4 58 Q 200 50 201.6 58 L 202.8 220 Z",
  ];

  return (
    <div className="multigraph" data-mode={mode}>
      <svg viewBox="0 0 400 400" role="img" aria-label={readout[mode].join(" ")}>
        <defs>
          <radialGradient id={`${id}-glass`} cx="50%" cy="38%" r="70%"><stop offset="0" stopColor="#1a1a1b" /><stop offset=".7" stopColor="#080808" /><stop offset="1" stopColor="#020202" /></radialGradient>
          <linearGradient id={`${id}-bezel`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#b9b6b0" /><stop offset=".45" stopColor="#4a4946" /><stop offset=".55" stopColor="#34332f" /><stop offset="1" stopColor="#9d9a94" /></linearGradient>
          <linearGradient id={`${id}-alu`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#f1efea" /><stop offset=".5" stopColor="#c9c6bf" /><stop offset=".52" stopColor="#8e8b85" /><stop offset="1" stopColor="#b3b0a9" /></linearGradient>
          <radialGradient id={`${id}-glare`} cx="32%" cy="18%" r="60%"><stop offset="0" stopColor="#fff" stopOpacity=".07" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
        </defs>

        <circle cx={C} cy={C} r="197" fill={`url(#${id}-bezel)`} />
        <circle cx={C} cy={C} r="193" fill={`url(#${id}-glass)`} />

        <g className="mg-track">
          {Array.from({ length: 120 }, (_, index) => {
            const major = index % 10 === 0;
            const mid = index % 2 === 0;
            const [x1, y1] = polar(index * 3, major ? 168 : mid ? 175 : 178);
            const [x2, y2] = polar(index * 3, 183);
            return <line key={index} x1={x1} y1={y1} x2={x2} y2={y2} className={major ? "major" : mid ? "mid" : "minor"} />;
          })}
        </g>

        <g className="mg-layer" data-active={mode === "time"}>
          {Array.from({ length: 12 }, (_, index) => {
            const [x, y] = polar(index * 30, 145);
            return <text key={index} x={x} y={y} className="mg-numeral">{index === 0 ? 12 : index}</text>;
          })}
        </g>
        <g className="mg-layer" data-active={mode === "compass"}>
          {(["N", "E", "S", "W"] as const).map((label, index) => {
            const [x, y] = polar(index * 90, 145);
            return <text key={label} x={x} y={y} className={`mg-numeral ${label === "N" ? "mg-north" : ""}`}>{label}</text>;
          })}
          {[45, 135, 225, 315].map((angle) => { const [x, y] = polar(angle, 145); return <circle key={angle} cx={x} cy={y} r="2.2" className="mg-pip" />; })}
        </g>
        <g className="mg-layer" data-active={mode === "daylight"}>
          {sunrise != null && sunset != null && <path d={arc(sunrise / 4, sunset / 4, 160)} className="mg-daylight" />}
          {[0, 6, 12, 18].map((hour) => { const [x, y] = polar(hour * 15, 140); return <text key={hour} x={x} y={y} className="mg-numeral">{pad(hour)}</text>; })}
          {[3, 9, 15, 21].map((hour) => { const [x, y] = polar(hour * 15, 140); return <text key={hour} x={x} y={y} className="mg-numeral mg-minor">{hour}</text>; })}
        </g>

        <text x={C} y="128" className="mg-mode">{readout[mode][0]}</text>
        <g className="mg-window">
          <rect x="122" y="252" width="156" height="40" rx="9" />
          <text key={`${mode}-${readout[mode][1]}`} x={C} y="273" className="mg-readout">{readout[mode][1]}</text>
        </g>

        <g className="mg-shadows" aria-hidden="true">
          {handShapes.map((shape, index) => <g key={index} ref={(node) => { shadows.current[index] = node; }}><path d={shape} /></g>)}
          <g ref={(node) => { shadows.current[2] = node; }}><path d="M 199.3 236 L 199.3 30 L 200.7 30 L 200.7 236 Z" /></g>
        </g>
        {handShapes.map((shape, index) => (
          <g key={index} ref={(node) => { hands.current[index] = node; }} className="mg-hand">
            <path d={shape} fill={`url(#${id}-alu)`} />
            <path d={index === 0 ? "M 200 200 L 200 122" : "M 200 200 L 200 70"} className="mg-lume" />
          </g>
        ))}
        <g ref={(node) => { hands.current[2] = node; }} className="mg-seconds">
          <line x1={C} y1="238" x2={C} y2="32" />
          <circle cx={C} cy="226" r="4.5" />
        </g>
        <circle cx={C} cy={C} r="6.5" fill={`url(#${id}-alu)`} />
        <circle cx={C} cy={C} r="2.4" className="mg-cap" />
        <circle cx={C} cy={C} r="193" fill={`url(#${id}-glare)`} pointerEvents="none" />
      </svg>
    </div>
  );
}
