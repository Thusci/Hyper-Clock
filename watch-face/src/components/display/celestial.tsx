"use client";

import { useEffect, useId, useState, type CSSProperties } from "react";
import { litPath, moonPhase } from "@/lib/moon";

/**
 * Sun and moon, drawn as small 3D instruments rather than flat icons.
 *
 * Performance (Q775): everything is static SVG; motion comes only from CSS transforms and
 * transitions on composited groups (the sun glides between 30 s updates, the moon librates),
 * so nothing is re-rasterised per frame and paused pages cost nothing.
 */
function useMinuteClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 30_000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, []);
  return now;
}

const clock = (iso: string | null, timezone: string) => {
  if (!iso) return "--:--";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "--:--" : new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
};
const span = (ms: number) => { const minutes = Math.max(0, Math.round(ms / 60_000)); return `${Math.floor(minutes / 60)} 小时 ${String(minutes % 60).padStart(2, "0")} 分`; };
const mix = (a: [number, number, number], b: [number, number, number], t: number) => `rgb(${a.map((value, index) => Math.round(value + (b[index] - value) * t)).join(" ")})`;

// Orbit geometry (viewBox 240 × 160): the day arc stands over a foreshortened ground plane,
// the night arc passes "under" it, flattened, so the path reads as one tilted orbit.
const CX = 120, HORIZON = 112, RX = 96, RY_DAY = 74, RY_NIGHT = 16;

export function SunOrbit({ progress, above, rising, setting, timezone, compact = false }: { progress: number; above: boolean; rising: string | null; setting: string | null; timezone: string; compact?: boolean }) {
  const id = useId().replaceAll(":", "");
  const now = useMinuteClock();
  const p = Math.min(1, Math.max(0, progress));
  const theta = Math.PI * p;
  const x = above ? CX - RX * Math.cos(theta) : CX + RX * Math.cos(theta);
  const y = above ? HORIZON - RY_DAY * Math.sin(theta) : HORIZON + RY_NIGHT * Math.sin(theta);
  const altitude = above ? Math.sin(theta) : 0;
  // Low sun is amber, high sun near-white: the same light the sky shader uses.
  const core = mix([255, 176, 112], [255, 246, 222], altitude);
  const corona = mix([255, 140, 80], [255, 226, 160], altitude);
  const nearHorizon = above ? Math.max(0, 1 - altitude / .22) : 0;

  const riseAt = rising ? new Date(rising).getTime() : NaN;
  const setAt = setting ? new Date(setting).getTime() : NaN;
  const dayLength = Number.isFinite(riseAt) && Number.isFinite(setAt) ? (((setAt - riseAt) % 86_400_000) + 86_400_000) % 86_400_000 : NaN;
  const remaining = now ? (above ? setAt : riseAt) - now.getTime() : NaN;

  return (
    <div className={`sun-orbit ${compact ? "compact" : ""} ${above ? "day" : "night"}`} aria-label={above ? "太阳在地平线以上" : "太阳在地平线以下"}>
      {!compact && (
        <div className="sun-orbit-head">
          <span>{above ? "白昼" : "夜晚"}</span>
          <b>{Number.isFinite(remaining) ? `距${above ? "日落" : "日出"} ${span(remaining)}` : "--"}</b>
        </div>
      )}
      <svg viewBox="0 0 240 160" role="img">
        <defs>
          <linearGradient id={`${id}-trail`} x1="0" x2="1"><stop offset="0" stopColor="var(--brand)" stopOpacity=".15" /><stop offset="1" stopColor="var(--brand)" stopOpacity=".9" /></linearGradient>
          <linearGradient id={`${id}-ground`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--solar-land-a)" stopOpacity=".55" /><stop offset="1" stopColor="var(--solar-land-b)" stopOpacity="0" /></linearGradient>
          <radialGradient id={`${id}-core`} cx="38%" cy="34%" r="70%"><stop offset="0" stopColor="#fffdf6" /><stop offset=".55" stopColor={core} /><stop offset="1" stopColor={corona} /></radialGradient>
          <radialGradient id={`${id}-corona`}><stop offset="0" stopColor={corona} stopOpacity=".5" /><stop offset=".45" stopColor={corona} stopOpacity=".16" /><stop offset="1" stopColor={corona} stopOpacity="0" /></radialGradient>
          <radialGradient id={`${id}-dawn`} cx="50%" cy="100%" r="60%"><stop offset="0" stopColor={corona} stopOpacity=".42" /><stop offset="1" stopColor={corona} stopOpacity="0" /></radialGradient>
        </defs>

        {/* Night half of the orbit, under the plane. */}
        <path d={`M ${CX + RX} ${HORIZON} A ${RX} ${RY_NIGHT} 0 0 1 ${CX - RX} ${HORIZON}`} className="sun-orbit-night" />
        {/* Ground plane in perspective, then the horizon hairline. */}
        <ellipse cx={CX} cy={HORIZON} rx="114" ry="22" fill={`url(#${id}-ground)`} />
        <line x1="6" y1={HORIZON} x2="234" y2={HORIZON} className="sun-orbit-horizon" />
        {/* Day arc and the part of it already travelled today. */}
        <path d={`M ${CX - RX} ${HORIZON} A ${RX} ${RY_DAY} 0 0 1 ${CX + RX} ${HORIZON}`} className="sun-orbit-day" />
        <path d={`M ${CX - RX} ${HORIZON} A ${RX} ${RY_DAY} 0 0 1 ${CX + RX} ${HORIZON}`} pathLength={100} className="sun-orbit-trail" stroke={`url(#${id}-trail)`} style={{ strokeDashoffset: above ? 100 - p * 100 : 0 }} />
        <circle cx={CX - RX} cy={HORIZON} r="2.2" className="sun-orbit-node" />
        <circle cx={CX + RX} cy={HORIZON} r="2.2" className="sun-orbit-node" />
        {/* Horizon glow while the sun is low. */}
        <ellipse cx={x} cy={HORIZON} rx="58" ry="20" fill={`url(#${id}-dawn)`} style={{ opacity: nearHorizon, transition: "opacity 2s ease" }} />

        <g className="sun-orbit-sun" style={{ transform: `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)` }}>
          <circle r={above ? 30 : 16} fill={`url(#${id}-corona)`} className="sun-orbit-corona" />
          {above && (
            <g className="sun-orbit-rays">
              {Array.from({ length: 12 }, (_, index) => {
                const angle = (index * Math.PI) / 6;
                return <line key={index} x1={Math.cos(angle) * 13.5} y1={Math.sin(angle) * 13.5} x2={Math.cos(angle) * (index % 2 ? 17 : 19.5)} y2={Math.sin(angle) * (index % 2 ? 17 : 19.5)} stroke={corona} />;
              })}
            </g>
          )}
          <circle r={above ? 10 : 6.5} fill={`url(#${id}-core)`} className="sun-orbit-core" />
        </g>
      </svg>
      {!compact && (
        <div className="sun-orbit-foot">
          <span>日出 <b>{clock(rising, timezone)}</b></span>
          <span className="sun-orbit-length">{Number.isFinite(dayLength) ? `昼长 ${span(dayLength)}` : ""}</span>
          <span>日落 <b>{clock(setting, timezone)}</b></span>
        </div>
      )}
    </div>
  );
}

export function MoonGlobe({ compact = false }: { compact?: boolean }) {
  const id = useId().replaceAll(":", "");
  const now = useMinuteClock();
  const phase = moonPhase(now ?? new Date(0));
  const lit = litPath(phase.fraction, 50, 50, 44);
  // Light comes from the sunward side; the glow scales with how much of the disc is lit.
  const lightX = phase.waxing ? "70%" : "30%";

  return (
    <div className={`moon-globe ${compact ? "compact" : ""}`} style={{ "--moon-glow": (.12 + phase.illumination * .4).toFixed(2) } as CSSProperties}>
      <div className="moon-globe-body" aria-label={`${phase.name}，照亮 ${Math.round(phase.illumination * 100)}%`}>
        <svg viewBox="0 0 100 100" role="img">
          <defs>
            <radialGradient id={`${id}-lit`} cx={lightX} cy="38%" r="78%"><stop offset="0" stopColor="#fbf7ef" /><stop offset=".55" stopColor="#ddd6ca" /><stop offset="1" stopColor="#9f998f" /></radialGradient>
            <radialGradient id={`${id}-limb`}><stop offset=".62" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity=".38" /></radialGradient>
            <radialGradient id={`${id}-earthshine`} cx={phase.waxing ? "30%" : "70%"} cy="40%" r="75%"><stop offset="0" stopColor="#3a4150" /><stop offset="1" stopColor="#15171c" /></radialGradient>
            <filter id={`${id}-soft`} x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation=".9" /></filter>
            <mask id={`${id}-mask`}><path d={lit} fill="#fff" filter={`url(#${id}-soft)`} /></mask>
            <clipPath id={`${id}-disc`}><circle cx="50" cy="50" r="44" /></clipPath>
          </defs>
          {/* Dark limb lit faintly by earthshine. */}
          <circle cx="50" cy="50" r="44" fill={`url(#${id}-earthshine)`} />
          <g clipPath={`url(#${id}-disc)`}>
            <g mask={`url(#${id}-mask)`}>
              <circle cx="50" cy="50" r="44" fill={`url(#${id}-lit)`} />
              {/* Maria (approximate near-side layout) and a few craters. */}
              <g className="moon-maria">
                <ellipse cx="38" cy="34" rx="11" ry="8" /><ellipse cx="55" cy="30" rx="8" ry="6" /><ellipse cx="63" cy="44" rx="9" ry="7" />
                <ellipse cx="44" cy="52" rx="13" ry="9" /><ellipse cx="32" cy="60" rx="7" ry="9" /><ellipse cx="58" cy="62" rx="6" ry="5" />
              </g>
              <g className="moon-craters">
                <circle cx="52" cy="78" r="3.4" /><circle cx="70" cy="66" r="2.2" /><circle cx="27" cy="44" r="2" /><circle cx="66" cy="26" r="1.6" />
              </g>
            </g>
          </g>
          <circle cx="50" cy="50" r="44" fill={`url(#${id}-limb)`} />
          <circle cx="50" cy="50" r="44" className="moon-rim" />
        </svg>
      </div>
      {!compact && (
        <div className="moon-globe-copy">
          <b>{phase.name}</b>
          <span>照亮 {Math.round(phase.illumination * 100)}% · 月龄 {phase.ageDays.toFixed(1)} 天</span>
          <span>{phase.waxing ? `距满月 ${Math.round(phase.daysToFull)} 天` : `距新月 ${Math.round(phase.daysToNew)} 天`}</span>
        </div>
      )}
    </div>
  );
}
