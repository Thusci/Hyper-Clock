"use client";

import { BookOpen, Clock3, MapPin } from "lucide-react";
import { parseCourse } from "@/lib/course";
import type { AgendaMap, AppConfig } from "@/types/config";
import { PageHeader } from "./page-header";

function collect(ids: string[], agenda: AgendaMap) {
  return ids.flatMap((id) => agenda[id] ?? []).map((event) => ({
    event,
    start: new Date(event.start.dateTime ?? event.start.date ?? ""),
    end: new Date(event.end.dateTime ?? event.end.date ?? event.start.dateTime ?? event.start.date ?? ""),
  })).filter((item) => !Number.isNaN(item.start.getTime())).sort((a, b) => a.start.getTime() - b.start.getTime());
}

function dayKey(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function time(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

export function SchedulePage({ config, agenda }: { config: AppConfig; agenda: AgendaMap }) {
  const now = new Date();
  const events = collect(config.entities.courses, agenda);
  const today = events.filter((item) => dayKey(item.start, config.timezone) === dayKey(now, config.timezone));
  const remaining = today.filter((item) => item.end.getTime() >= now.getTime());
  const upcoming = events.filter((item) => item.end.getTime() >= now.getTime()).slice(0, 8);
  const date = new Intl.DateTimeFormat("zh-CN", { timeZone: config.timezone, month: "numeric", day: "numeric", weekday: "long" }).format(now);

  return <section className="schedule-page h-full p-7 xl:p-9" aria-label="课程表">
    <PageHeader kicker="Classes · 今日课程" title={remaining.length ? `今日还有 ${remaining.length} 门课` : today.length ? "今日课程已结束" : "今日没有课程"} tone="red" aside={<span className="page-meta-stack"><b>{date}</b><span>数据来自 HA 日历</span></span>} />
    <div className="schedule-dashboard grid min-h-0 grid-cols-[1.25fr_.75fr] gap-4">
      <article className="glass schedule-board min-h-0 rounded-[var(--r-xl)] p-6">
        {today.length ? <div className="schedule-course-grid grid h-full grid-cols-2 gap-3 overflow-y-auto" data-no-swipe>{today.slice(0, 6).map((item, index) => { const course = parseCourse(item.event); const done = item.end.getTime() < now.getTime(); return <div className={`course-block tone-${index % 4} ${done ? "done" : ""}`} key={`${item.event.summary}-${item.start.toISOString()}`}><div className="flex min-w-0 items-start justify-between gap-3"><b>{course.title}</b><span>{course.period || String(index + 1).padStart(2, "0")}</span></div><p><Clock3 size={13}/>{time(item.start, config.timezone)} – {time(item.end, config.timezone)}</p><small><MapPin size={12}/>{course.room || "地点未提供"}{course.teacher ? ` · ${course.teacher}` : ""}</small></div>; })}</div> : <div className="grid h-full place-items-center text-center"><div><BookOpen className="mx-auto text-[var(--red)]" size={38}/><b className="mt-4 block text-xl">今天没有排课</b><span className="mt-2 block text-sm text-[var(--muted)]">绑定课程日历后自动同步，不使用示例数据</span></div></div>}
      </article>
      <aside className="glass min-h-0 overflow-hidden rounded-[var(--r-xl)] p-5"><div className="mb-4 flex items-center justify-between"><span className="card-kicker">接下来</span><span className="text-[11px] text-[var(--muted)]">未来日程</span></div><div className="schedule-list h-[calc(100%-2rem)] overflow-y-auto pr-1" data-no-swipe>{upcoming.length ? upcoming.map((item, index) => <div className="schedule-row" key={`${item.event.summary}-${item.start.toISOString()}`}><i className={`tone-${index % 4}`}/><div><b>{item.event.summary}</b><span>{new Intl.DateTimeFormat("zh-CN", { timeZone: config.timezone, weekday: "short", month: "numeric", day: "numeric" }).format(item.start)} · {time(item.start, config.timezone)}</span></div><small>{parseCourse(item.event).room}</small></div>) : <div className="weather-empty">当前课程日历没有未来事件</div>}</div></aside>
    </div>
  </section>;
}
