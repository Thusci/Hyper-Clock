import type { HassEntity, HassEntityMap } from "@/types/config";

/**
 * Sunrise / sunset for the home location, independent of HA's `sun.sun`.
 *
 * On the client's HA, `sun.sun` stopped updating (next_rising/next_setting lay days in the
 * past), which made the face think it was always "just before sunrise". The face now uses
 * `sun.sun` only while its next events are in the future, and otherwise computes the times
 * from zone.home's coordinates (NOAA simplified algorithm, accurate to about a minute).
 */
export type SunTimes = { rising: Date; setting: Date; above: boolean; lastChange: Date; source: "ha" | "computed" };

const RAD = Math.PI / 180;

function solarEvent(date: Date, latitude: number, longitude: number, rising: boolean): Date | null {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((date.getTime() - start) / 86_400_000);
  const gamma = (2 * Math.PI / 365) * (dayOfYear - 1);
  const equationOfTime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma) - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  const declination = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma) - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma) - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  const cosHour = Math.cos(90.833 * RAD) / (Math.cos(latitude * RAD) * Math.cos(declination)) - Math.tan(latitude * RAD) * Math.tan(declination);
  if (cosHour < -1 || cosHour > 1) return null; // polar day or night
  const hourAngle = Math.acos(cosHour) / RAD;
  const minutesUtc = 720 - 4 * (longitude + (rising ? hourAngle : -hourAngle)) - equationOfTime;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) + minutesUtc * 60_000);
}

function validDate(value: unknown) {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function homeCoordinates(entities: HassEntityMap) {
  const home = entities["zone.home"]?.attributes;
  const latitude = Number(home?.latitude);
  const longitude = Number(home?.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
}

/** Next rising/setting after `now`, plus the most recent horizon crossing. */
function computed(now: Date, latitude: number, longitude: number): SunTimes | null {
  const events: Array<{ at: Date; rising: boolean }> = [];
  for (const offset of [-1, 0, 1, 2]) {
    const day = new Date(now.getTime() + offset * 86_400_000);
    for (const rising of [true, false]) {
      const at = solarEvent(day, latitude, longitude, rising);
      if (at) events.push({ at, rising });
    }
  }
  events.sort((a, b) => a.at.getTime() - b.at.getTime());
  const past = events.filter((event) => event.at <= now);
  const future = events.filter((event) => event.at > now);
  const last = past.at(-1);
  const rising = future.find((event) => event.rising)?.at;
  const setting = future.find((event) => !event.rising)?.at;
  if (!last || !rising || !setting) return null;
  return { rising, setting, above: last.rising, lastChange: last.at, source: "computed" };
}

export function resolveSun(entities: HassEntityMap, now = new Date()): SunTimes | null {
  const sun: HassEntity | undefined = entities["sun.sun"];
  const rising = validDate(sun?.attributes.next_rising);
  const setting = validDate(sun?.attributes.next_setting);
  const lastChange = validDate(sun?.last_changed);
  const home = homeCoordinates(entities);
  const local = home ? computed(now, home.latitude, home.longitude) : null;
  // Trust HA only while its forecast still lies ahead (a frozen integration leaves these in the past).
  if (sun && rising && setting && lastChange && rising > now && setting > now) {
    const above = sun.state === "above_horizon";
    // last_changed resets when HA restarts, so a 00:26 restart would look like "sunset was 5 minutes ago"
    // and put the face in dusk mode. Use the computed horizon crossing when it agrees with HA's state.
    const crossing = local && local.above === above ? local.lastChange : lastChange;
    return { rising, setting, above, lastChange: crossing, source: "ha" };
  }
  return local;
}
