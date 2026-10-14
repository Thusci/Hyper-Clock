"use client";

import { AirVent, BookOpen, Plug, Thermometer } from "lucide-react";
import type { Climate, Complication, Power } from "@/lib/glance";
import { parseCourse } from "@/lib/course";
import type { CalendarEvent } from "@/types/config";

/**
 * Home-face building blocks. Each one renders only what the HA actually provides and
 * shares the Maison vocabulary: tracked micro-labels, light numerals, hairlines.
 */

/** IWC-style sub-dials under the main clock: label above, light numeral, small unit. */
export function Complications({ items }: { items: Complication[] }) {
  if (!items.length) return null;
  return (
    <div className="home-complications" style={{ "--count": items.length } as React.CSSProperties}>
      {items.map((item) => (
        <div key={item.key} className="home-complication">
          <span>{item.label}</span>
          <b>{item.value}<small>{item.unit}</small></b>
        </div>
      ))}
    </div>
  );
}

type Slot = { event: CalendarEvent; start: number; end: number };

const clock = (time: number, timezone: string) => new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(time);
const minutesText = (ms: number) => { const minutes = Math.max(1, Math.round(ms / 60_000)); return minutes >= 60 ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟` : `${minutes} 分钟`; };

/**
 * Today's classes as one timeline: segments for every class, a marker for now, and a
 * headline that answers the only question that matters at a glance — "what now, and how long?".
 */
export function CourseTimeline({ events, now, timezone, bound }: { events: CalendarEvent[]; now: Date | null; timezone: string; bound: boolean }) {
  const slots: Slot[] = events
    .map((event) => ({ event, start: new Date(event.start.dateTime ?? event.start.date ?? "").getTime(), end: new Date(event.end.dateTime ?? event.end.date ?? "").getTime() }))
    .filter((slot) => Number.isFinite(slot.start) && Number.isFinite(slot.end) && slot.end > slot.start)
    .sort((a, b) => a.start - b.start);
  const at = now?.getTime() ?? 0;
  const current = slots.find((slot) => slot.start <= at && at < slot.end);
  const next = slots.find((slot) => slot.start > at);
  const done = slots.filter((slot) => slot.end <= at).length;
  const focus = current ?? next;
  const course = focus ? parseCourse(focus.event) : null;

  const headline = !slots.length ? (bound ? "今日无课" : "未绑定课程日历")
    : current ? `上课中 · 还剩 ${minutesText(current.end - at)}`
      : next ? `下一节 · ${minutesText(next.start - at)}后`
        : "今日课程已结束";

  const first = slots[0]?.start ?? 0;
  const last = slots.at(-1)?.end ?? 1;
  const span = Math.max(1, last - first);
  const position = (time: number) => `${Math.min(100, Math.max(0, ((time - first) / span) * 100))}%`;

  return (
    <article className="glass ambient-card home-timeline-card col-span-2 rounded-[var(--r-xl)] px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <span className="ambient-label"><BookOpen size={13} />今日课程</span>
        <span className="home-timeline-count">{slots.length ? `${done} / ${slots.length}` : ""}</span>
      </div>
      <strong className="home-timeline-headline">{headline}</strong>
      {slots.length > 0 && (
        <div className="home-timeline" aria-hidden="true">
          {slots.map((slot, index) => (
            <i key={`${slot.start}-${index}`} className={slot.end <= at ? "done" : slot === current ? "now" : ""} style={{ left: position(slot.start), width: `calc(${position(slot.end)} - ${position(slot.start)})` }} />
          ))}
          {at >= first && at <= last && <em style={{ left: position(at) }} />}
        </div>
      )}
      {slots.length > 0 && (
        <div className="home-timeline-scale"><span>{clock(first, timezone)}</span><span>{clock(last, timezone)}</span></div>
      )}
      {course && focus && (
        <p className="home-timeline-detail">
          <b>{course.title}</b>
          <span>{[course.period, `${clock(focus.start, timezone)}–${clock(focus.end, timezone)}`, course.room, course.teacher].filter(Boolean).join(" · ")}</span>
        </p>
      )}
    </article>
  );
}

/** The room itself: air conditioner and the plug's live power, in place of an idle media card. */
export function EnvironmentCard({ climate, power, indoor }: { climate: Climate | null; power: Power | null; indoor: { temperature: number | null; humidity: number | null } }) {
  return (
    <article className="glass ambient-card home-status-card home-environment-card rounded-[var(--r-lg)] p-4">
      <span className="ambient-label"><Thermometer size={14} />室内</span>
      <strong className="home-status-value">{indoor.temperature == null ? "--" : indoor.temperature.toFixed(1)}<small>°{indoor.humidity != null ? ` · ${Math.round(indoor.humidity)}%` : ""}</small></strong>
      <div className="home-environment-rows">
        {climate && <span className={climate.active ? "active" : ""}><AirVent size={12} />{climate.name} · {climate.mode}{climate.active && climate.target != null ? ` ${climate.target}°` : ""}</span>}
        {power && <span className={power.watts > 1 ? "active" : ""}><Plug size={12} />{power.name} {Math.round(power.watts)} W{power.energy != null ? ` · 累计 ${power.energy.toFixed(2)} kWh` : ""}</span>}
        {!climate && !power && <span>等待室内设备数据</span>}
      </div>
    </article>
  );
}
