import type { CalendarEvent } from "@/types/config";

/**
 * Course events on the client's 课表 calendar look like:
 *   summary      大学物理II-2
 *   location     中3-3321 刘梦婷，蔡寅        (room, then teachers)
 *   description  第1 - 2节 中3-3321 刘梦婷，蔡寅 (period first)
 * Splitting them lets the face show "第1–2节 · 中3-3321" and the teachers on their own line.
 */
export type Course = { title: string; period: string; room: string; teacher: string };

export function parseCourse(event: CalendarEvent): Course {
  const location = (event.location ?? "").trim();
  const [room = "", ...rest] = location.split(/\s+/);
  const period = (event.description ?? "").match(/第\s*(\d+)\s*(?:[-–~至]\s*(\d+))?\s*节/);
  return {
    title: event.summary,
    period: period ? (period[2] ? `第${period[1]}–${period[2]}节` : `第${period[1]}节`) : "",
    room,
    teacher: rest.join(" ").replace(/，/g, "、"),
  };
}
