"use client";

import { CalendarDays, MapPin } from "lucide-react";
import type { AgendaMap, AppConfig, CalendarEvent } from "@/types/config";
import { isWorkdayCalendar } from "@/lib/calendar";
import { PageHeader } from "./page-header";

type EventItem = { event: CalendarEvent; date: Date };
const KNOWN_DAYS = 7; // the agenda feed fetches one week ahead

function key(date: Date, timezone: string) { return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date); }

export function CalendarPage({ config, agenda }: { config: AppConfig; agenda: AgendaMap }) {
  const now = new Date();
  const current = new Intl.DateTimeFormat("en-US", { timeZone: config.timezone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(now);
  const year = Number(current.find((part) => part.type === "year")?.value);
  const month = Number(current.find((part) => part.type === "month")?.value) - 1;
  const today = Number(current.find((part) => part.type === "day")?.value);
  const firstDay = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const eventCalendars = config.entities.calendars.filter((id) => !isWorkdayCalendar(id));
  const workdayCalendars = config.entities.calendars.filter(isWorkdayCalendar);
  const workdays = new Set(workdayCalendars.flatMap((id) => agenda[id] ?? []).map((event) => event.start.date ?? key(new Date(event.start.dateTime ?? ""), config.timezone)));
  const knownDays = new Set(Array.from({ length: KNOWN_DAYS }, (_, offset) => key(new Date(now.getTime() + offset * 86_400_000), config.timezone)));
  const classesByDay = new Map<string, number>();
  for (const event of config.entities.courses.flatMap((id) => agenda[id] ?? [])) {
    const start = new Date(event.start.dateTime ?? event.start.date ?? "");
    if (!Number.isNaN(start.getTime())) classesByDay.set(key(start, config.timezone), (classesByDay.get(key(start, config.timezone)) ?? 0) + 1);
  }
  const events: EventItem[] = eventCalendars.flatMap((id) => agenda[id] ?? []).map((event) => ({ event, date: new Date(event.start.dateTime ?? event.start.date ?? "") })).filter((item) => !Number.isNaN(item.date.getTime())).sort((a, b) => a.date.getTime() - b.date.getTime());
  const byDay = new Map<string, EventItem[]>();
  for (const item of events) { const dateKey = key(item.date, config.timezone); byDay.set(dateKey, [...(byDay.get(dateKey) ?? []), item]); }
  const upcoming = events.filter((item) => item.date.getTime() >= now.getTime() - 3_600_000).slice(0, 7);
  const cells = Array.from({ length: 42 }, (_, index) => { const day = index - firstDay + 1; return day >= 1 && day <= count ? day : null; });

  return <section className="calendar-page h-full p-7 xl:p-9" aria-label="完整日历"><PageHeader kicker="Calendar · 本月" title={`${year} 年 ${month + 1} 月`} tone="blue" aside={`HA 日历 · ${upcoming.length} 项近期安排`} /><div className="calendar-dashboard grid min-h-0 grid-cols-[1fr_21rem] gap-4"><article className="glass rounded-[var(--r-xl)] p-5"><div className="calendar-weekdays">{["日","一","二","三","四","五","六"].map((day) => <span key={day}>周{day}</span>)}</div><div className="calendar-grid">{cells.map((day, index) => { const dateKey = day ? key(new Date(Date.UTC(year, month, day, 12)), config.timezone) : ""; const items = byDay.get(dateKey) ?? []; const rest = Boolean(day && workdayCalendars.length && knownDays.has(dateKey) && !workdays.has(dateKey)); const classes = classesByDay.get(dateKey) ?? 0; return <div key={index} className={`calendar-cell ${day === today ? "today" : ""} ${day ? "" : "empty"} ${rest ? "rest" : ""}`}><b>{day}</b>{rest && <em className="calendar-rest">休</em>}{items.slice(0, 2).map((item) => <span key={`${item.event.summary}-${item.date.toISOString()}`}>{item.event.summary}</span>)}{items.length > 2 && <small>+{items.length - 2}</small>}{classes > 0 && <i className="calendar-classes">{classes} 节课</i>}</div>; })}</div></article><aside className="glass min-h-0 rounded-[var(--r-xl)] p-5"><div className="mb-5 flex items-center gap-2"><CalendarDays size={17} className="text-[var(--blue)]"/><span className="card-kicker">近期安排</span></div><div className="calendar-agenda">{upcoming.length ? upcoming.map((item) => <div key={`${item.event.summary}-${item.date.toISOString()}`}><time>{new Intl.DateTimeFormat("zh-CN", { timeZone: config.timezone, month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(item.date)}</time><b>{item.event.summary}</b>{item.event.location && <small><MapPin size={11}/>{item.event.location}</small>}</div>) : <div className="weather-empty">当前没有近期日程</div>}</div></aside></div></section>;
}
