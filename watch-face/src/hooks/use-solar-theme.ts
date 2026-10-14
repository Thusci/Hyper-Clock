"use client";

import { useEffect, useMemo, useState } from "react";
import { resolveSun } from "@/lib/solar";
import type { HassEntityMap } from "@/types/config";

export type SolarPhase = "dawn" | "day" | "dusk" | "night";
export type SolarState = {
  phase: SolarPhase;
  label: string;
  nextEvent: string;
  progress: number;
  offsetX: number;
  offsetY: number;
  /** Sun above the horizon right now. */
  above: boolean;
  /** Next sunrise / sunset as ISO strings, from HA when fresh or computed locally. */
  rising: string | null;
  setting: string | null;
};

const phaseLabel: Record<SolarPhase, string> = {
  dawn: "晨光模式",
  day: "日光模式",
  dusk: "暮色模式",
  night: "深夜模式",
};

function localMinutes(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: "hour" | "minute") => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return value("hour") * 60 + value("minute");
}

export function useSolarTheme(entities: HassEntityMap, timezone: string, burnInShift: boolean): SolarState {
  const [now, setNow] = useState<Date | null>(null);
  const sunEntity = entities["sun.sun"];
  const homeZone = entities["zone.home"];

  useEffect(() => {
    const update = () => setNow(new Date());
    const firstTick = window.setTimeout(update, 0);
    const timer = window.setInterval(update, 30000);
    return () => {
      window.clearTimeout(firstTick);
      window.clearInterval(timer);
    };
  }, []);

  return useMemo(() => {
    if (!now) return { phase: "night", label: phaseLabel.night, nextEvent: "正在读取太阳位置", progress: 0, offsetX: 0, offsetY: 0, above: false, rising: null, setting: null };

    // HA's sun.sun when fresh, otherwise computed from zone.home (see lib/solar.ts).
    const sun = resolveSun({ "sun.sun": sunEntity, "zone.home": homeZone } as HassEntityMap, now);
    let phase: SolarPhase;
    let progress: number;

    if (sun) {
      const minutesSinceChange = (now.getTime() - sun.lastChange.getTime()) / 60000;
      const minutesToRise = (sun.rising.getTime() - now.getTime()) / 60000;
      const minutesToSet = (sun.setting.getTime() - now.getTime()) / 60000;
      if (sun.above) phase = minutesSinceChange < 75 ? "dawn" : minutesToSet < 75 ? "dusk" : "day";
      else phase = minutesSinceChange < 75 ? "dusk" : minutesToRise < 75 ? "dawn" : "night";
      const next = sun.above ? sun.setting : sun.rising;
      progress = (now.getTime() - sun.lastChange.getTime()) / Math.max(1, next.getTime() - sun.lastChange.getTime());
    } else {
      const minute = localMinutes(now, timezone);
      phase = minute >= 330 && minute < 420 ? "dawn" : minute >= 420 && minute < 1020 ? "day" : minute >= 1020 && minute < 1140 ? "dusk" : "night";
      progress = minute / 1440;
    }

    const event = sun ? (sun.above ? sun.setting : sun.rising) : null;
    const eventName = sun?.above ? "日落" : "日出";
    const nextEvent = event
      ? `${eventName} ${new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(event)}`
      : phase === "night" || phase === "dawn" ? "预计 06:30 日出" : "预计 18:30 日落";

    const minuteSeed = Math.floor(now.getTime() / 60000);
    return {
      phase,
      label: phaseLabel[phase],
      nextEvent,
      progress: Math.min(1, Math.max(0, progress)),
      offsetX: burnInShift ? (minuteSeed * 17) % 7 - 3 : 0,
      offsetY: burnInShift ? (minuteSeed * 11) % 5 - 2 : 0,
      above: sun ? sun.above : phase === "day" || phase === "dawn",
      rising: sun?.rising.toISOString() ?? null,
      setting: sun?.setting.toISOString() ?? null,
    };
  }, [burnInShift, homeZone, now, sunEntity, timezone]);
}
