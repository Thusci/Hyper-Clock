import type { HassEntity, HassEntityMap } from "@/types/config";

/**
 * "At a glance" facts for the home face, resolved by device class / unit / integration
 * rather than fixed entity ids, so the same face adapts to whatever the HA exposes.
 *
 * On the client's HA this yields: room temperature from the AC (the SHT40 when it is back),
 * the Xiaomi plug's power and energy, the TP-Link router's throughput and the Q775's load.
 */
const usable = (entity?: HassEntity): entity is HassEntity => Boolean(entity && !["unknown", "unavailable", "none", ""].includes(entity.state));
const numeric = (entity?: HassEntity) => { const value = Number(entity?.state); return usable(entity) && Number.isFinite(value) ? value : null; };
const unit = (entity: HassEntity) => String(entity.attributes.unit_of_measurement ?? "");
/** Entities that describe the face's own host, a phone, or the weather — not the room. */
const notRoom = /^sensor\.(q775_|he_feng|realme_|thusci|.*_ipad_)/;

export type Climate = { name: string; mode: string; current: number | null; target: number | null; active: boolean };
/** `energy` is the meter reading of the same device (cumulative kWh, as Xiaomi plugs report it). */
export type Power = { name: string; watts: number; energy: number | null };
export type Complication = { key: string; label: string; value: string; unit: string };

const climateModes: Record<string, string> = { off: "关闭", cool: "制冷", heat: "制热", dry: "除湿", fan_only: "送风", auto: "自动", heat_cool: "自动" };

export function resolveIndoor(entities: HassEntityMap) {
  const all = Object.values(entities);
  const temperature = all.find((entity) => entity.entity_id.startsWith("sensor.") && !notRoom.test(entity.entity_id) && entity.attributes.device_class === "temperature" && numeric(entity) != null);
  const humidity = all.find((entity) => entity.entity_id.startsWith("sensor.") && !notRoom.test(entity.entity_id) && entity.attributes.device_class === "humidity" && numeric(entity) != null);
  const climate = resolveClimate(entities);
  return {
    temperature: numeric(temperature) ?? climate?.current ?? null,
    humidity: numeric(humidity),
    source: temperature ? String(temperature.attributes.friendly_name ?? "") : climate ? climate.name : "",
  };
}

export function resolveClimate(entities: HassEntityMap): Climate | null {
  const entity = Object.values(entities).find((item) => item.entity_id.startsWith("climate.") && usable(item));
  if (!entity) return null;
  const name = String(entity.attributes.friendly_name ?? "空调").replace(/\s+空调$/, "").trim() || "空调";
  const current = typeof entity.attributes.current_temperature === "number" ? entity.attributes.current_temperature : null;
  const target = typeof entity.attributes.temperature === "number" ? entity.attributes.temperature : null;
  return { name, mode: climateModes[entity.state] ?? entity.state, current, target, active: entity.state !== "off" };
}

/** The household power reading: a W sensor that is not the Q775 or a phone (e.g. the Xiaomi plug). */
export function resolvePower(entities: HassEntityMap): Power | null {
  const all = Object.values(entities);
  const power = all.find((entity) => entity.entity_id.startsWith("sensor.") && !notRoom.test(entity.entity_id) && /^k?W$/.test(unit(entity)) && numeric(entity) != null);
  if (!power) return null;
  const prefix = power.entity_id.replace(/^sensor\./, "").split("_").slice(0, 4).join("_");
  const energy = all.find((entity) => entity.entity_id.startsWith(`sensor.${prefix}`) && /^k?Wh$/.test(unit(entity)) && numeric(entity) != null);
  const watts = numeric(power)! * (unit(power) === "kW" ? 1000 : 1);
  const full = String(power.attributes.friendly_name ?? "");
  const name = /插座/.test(full) ? "插座" : full.split(/\s+/)[0].slice(0, 4) || "功率";
  return { name, watts, energy: energy ? numeric(energy)! * (unit(energy) === "Wh" ? .001 : 1) : null };
}

function throughput(entities: HassEntityMap, direction: "download" | "upload") {
  const entity = Object.values(entities).find((item) => new RegExp(`_${direction}_speed$`).test(item.entity_id) && numeric(item) != null);
  if (!entity) return null;
  const value = numeric(entity)!;
  const kib = unit(entity).startsWith("MiB") || unit(entity).startsWith("MB") ? value * 1024 : value;
  return kib >= 1024 ? { value: (kib / 1024).toFixed(1), unit: "MB/s" } : { value: Math.round(kib).toString(), unit: "KB/s" };
}

export function resolveComplications(entities: HassEntityMap): Complication[] {
  const indoor = resolveIndoor(entities);
  const power = resolvePower(entities);
  const down = throughput(entities, "download");
  const cpu = numeric(Object.values(entities).find((entity) => /^sensor\.q775_.*_cpu_percent$/.test(entity.entity_id)));
  const items: Complication[] = [];
  if (indoor.temperature != null) items.push({ key: "indoor", label: "室内", value: indoor.temperature.toFixed(1), unit: "°" });
  if (power) items.push({ key: "power", label: power.name, value: Math.round(power.watts).toString(), unit: "W" });
  if (down) items.push({ key: "network", label: "网络 ↓", value: down.value, unit: down.unit });
  if (cpu != null) items.push({ key: "host", label: "Q775", value: Math.round(cpu).toString(), unit: "%" });
  return items.slice(0, 4);
}

const moonNames: Record<string, string> = { new_moon: "新月", waxing_crescent: "蛾眉月", first_quarter: "上弦月", waxing_gibbous: "盈凸月", full_moon: "满月", waning_gibbous: "亏凸月", last_quarter: "下弦月", waning_crescent: "残月" };
const seasonNames: Record<string, string> = { spring: "春", summer: "夏", autumn: "秋", winter: "冬" };

/** Calendar-ish context for the clock footer: workday, season, moon. */
export function resolveAlmanac(entities: HassEntityMap) {
  const all = Object.values(entities);
  const workday = all.find((entity) => entity.entity_id.startsWith("binary_sensor.workday") && usable(entity));
  const season = all.find((entity) => entity.entity_id.startsWith("sensor.") && entity.state in seasonNames);
  const moon = all.find((entity) => entity.entity_id.startsWith("sensor.") && entity.state in moonNames);
  return {
    workday: workday ? (workday.state === "on" ? "工作日" : "休息日") : "",
    season: season ? `${seasonNames[season.state]}季` : "",
    moon: moon ? moonNames[moon.state] : "",
  };
}
