"use client";

import { useEffect, useMemo, useState } from "react";

export function useLocalClock(locale: string, timezone: string) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const update = () => setNow(new Date());
    const firstTick = window.setTimeout(update, 0);
    const timer = window.setInterval(update, 1000);
    return () => {
      window.clearTimeout(firstTick);
      window.clearInterval(timer);
    };
  }, []);

  return useMemo(() => {
    if (!now) return { hours: "--", minutes: "--", seconds: "--", date: "", now: null };
    const parts = new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
    return {
      hours: get("hour"), minutes: get("minute"), seconds: get("second"),
      date: new Intl.DateTimeFormat(locale, {
        timeZone: timezone, month: "long", day: "numeric", weekday: "long",
      }).format(now),
      now,
    };
  }, [locale, now, timezone]);
}
