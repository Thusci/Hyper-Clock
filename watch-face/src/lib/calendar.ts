/** Workday-integration calendars only mark working days; the face shows them as 休 badges, never as events. */
export const isWorkdayCalendar = (id: string) => /workday/i.test(id);
