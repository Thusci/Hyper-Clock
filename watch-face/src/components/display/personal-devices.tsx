import type { CSSProperties } from "react";
import { BatteryCharging, House, MapPinOff, PlugZap, Smartphone, Tablet, Wifi, WifiOff } from "lucide-react";
import type { HaCatalog, HassEntity, HassEntityMap } from "@/types/config";

/**
 * Personal devices come exclusively from the Home Assistant Companion App (`mobile_app`).
 *
 * Other integrations that report the same phone or iPad (iCloud3, iCloud, BLE trackers)
 * are ignored on purpose: they lag behind or disagree with the app. Any device registered
 * through the Companion App appears automatically, so a new phone needs no code change.
 *
 * Per device (Companion App entity naming, Android and iOS):
 *   battery   sensor.<device>_battery_level, else the app's device_tracker `battery_level` attribute
 *   charging  sensor.<device>_battery_state ∈ {charging, full} or binary_sensor.<device>_is_charging = on
 *   charger   sensor.<device>_charger_type (Android: ac · usb · wireless · none)
 *   presence  the app's own device_tracker
 */
type PersonalDeviceKind = "phone" | "tablet";

export type PersonalDevice = {
  id: string;
  name: string;
  kind: PersonalDeviceKind;
  battery: number;
  charging: boolean;
  chargeLabel: string;
  /** True when the app is not reporting and the battery comes from its last location update. */
  stale: boolean;
  presence: "home" | "away" | "online" | "offline";
  presenceLabel: string;
};

const COMPANION = "mobile_app";
const CHARGING_STATES = new Set(["charging", "full"]);
const CHARGER_NAMES: Record<string, string> = { ac: "交流", usb: "USB", wireless: "无线" };

function usable(entity: HassEntity | undefined): entity is HassEntity {
  return Boolean(entity && !["unknown", "unavailable", "none", ""].includes(entity.state.toLowerCase()));
}

function percent(value: unknown) {
  const number = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(number) && number >= 0 && number <= 100 ? Math.round(number) : null;
}

/** "Not Charging", "not_charging", "NotCharging" → "notcharging"; exact match avoids "discharging" ⊃ "charging". */
const normalize = (state: string) => state.toLowerCase().replace(/[\s_-]+/g, "");

export function resolvePersonalDevices(entities: HassEntityMap, catalog: HaCatalog): PersonalDevice[] {
  const companionEntities = catalog.entities.filter((item) => item.platform === COMPANION && item.deviceId && !item.disabled);
  const deviceIds = [...new Set(companionEntities.map((item) => item.deviceId!))];

  return deviceIds.flatMap((deviceId): PersonalDevice[] => {
    const device = catalog.devices.find((item) => item.deviceId === deviceId);
    const own = companionEntities.filter((item) => item.deviceId === deviceId).map((item) => item.entityId);
    const pick = (test: (id: string) => boolean) => own.filter(test).map((id) => entities[id]).find(usable);

    const tracker = own.filter((id) => id.startsWith("device_tracker.")).map((id) => entities[id]).find(Boolean);
    const levelEntity = pick((id) => id.startsWith("sensor.") && /_battery_level$/.test(id));
    const fromSensor = levelEntity ? percent(levelEntity.state) : null;
    const fromTracker = percent(tracker?.attributes.battery_level);
    const battery = fromSensor ?? fromTracker;
    if (battery == null) return [];
    const stale = fromSensor == null;

    const stateEntity = pick((id) => id.startsWith("sensor.") && /_battery_state$/.test(id));
    const chargingFlag = pick((id) => id.startsWith("binary_sensor.") && /_is_charging$/.test(id));
    const chargerEntity = pick((id) => id.startsWith("sensor.") && /_charger_type$/.test(id));
    const charger = chargerEntity ? normalize(chargerEntity.state) : "";
    const charging = !stale && ((stateEntity ? CHARGING_STATES.has(normalize(stateEntity.state)) : false) || chargingFlag?.state === "on" || (charger !== "" && charger !== "none" && charger in CHARGER_NAMES));

    const where = tracker?.state ?? "unknown";
    const presence: PersonalDevice["presence"] = where === "home" ? "home" : where === "not_home" ? "away" : !["unknown", "unavailable"].includes(where) ? "away" : stale ? "offline" : "online";
    const presenceLabel = presence === "home" ? "在家" : where === "not_home" ? "离家" : presence === "away" ? where : presence === "offline" ? "App 离线" : "已同步";
    const chargeLabel = stale ? "最近一次上报" : charging ? (CHARGER_NAMES[charger] ? `${CHARGER_NAMES[charger]}充电` : "正在充电") : battery <= 20 ? "电量偏低" : "使用电池";
    const model = `${device?.model ?? ""} ${device?.name ?? ""}`;

    return [{
      id: deviceId,
      name: device?.name ?? own[0],
      kind: /ipad|tablet|pad\b/i.test(model) ? "tablet" : "phone",
      battery, charging, chargeLabel, stale, presence, presenceLabel,
    }];
  }).sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "phone" ? -1 : 1));
}

function DeviceGlyph({ kind, size = 22 }: { kind: PersonalDeviceKind; size?: number }) {
  const Icon = kind === "phone" ? Smartphone : Tablet;
  return <Icon size={size} strokeWidth={1.7} />;
}

function PresenceGlyph({ state, size = 13 }: { state: PersonalDevice["presence"]; size?: number }) {
  const Icon = state === "home" ? House : state === "away" ? MapPinOff : state === "offline" ? WifiOff : Wifi;
  return <Icon size={size} strokeWidth={1.9} />;
}

function BatteryRing({ device, compact = false }: { device: PersonalDevice; compact?: boolean }) {
  const tone = device.battery <= 15 ? "critical" : device.battery <= 35 ? "low" : "healthy";
  return (
    <div className={`personal-battery-ring ${compact ? "compact" : ""} ${tone} ${device.stale ? "stale" : ""}`} style={{ "--battery-offset": 100 - device.battery } as CSSProperties} aria-label={`${device.name} 电量 ${device.battery}%`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="personal-battery-track" cx="50" cy="50" r="43" pathLength="100" />
        <circle className="personal-battery-level" cx="50" cy="50" r="43" pathLength="100" />
      </svg>
      <span className="personal-device-glyph"><DeviceGlyph kind={device.kind} size={compact ? 14 : 22} /></span>
      <strong>{device.battery}<small>%</small></strong>
      {device.charging && <i className="personal-charge-badge"><BatteryCharging size={compact ? 9 : 12} /></i>}
    </div>
  );
}

export function PersonalDevicesPanel({ devices }: { devices: PersonalDevice[] }) {
  if (!devices.length) return null;
  return (
    <section className="personal-device-panel" aria-label="个人设备状态">
      <div className="personal-device-panel-heading"><span>我的设备</span><small>Companion App 实时电量与位置</small></div>
      <div className="personal-device-cards">
        {devices.map((device) => (
          <article key={device.id} className={`glass personal-device-card ${device.stale ? "stale" : ""}`}>
            <BatteryRing device={device} />
            <div className="personal-device-copy">
              <b>{device.name}</b>
              <span>{device.chargeLabel}</span>
              <div className="personal-device-badges">
                <small><PresenceGlyph state={device.presence} />{device.presenceLabel}</small>
                <small>{device.charging ? <BatteryCharging size={13} /> : <PlugZap size={13} />}{device.charging ? "外接电源" : "电池供电"}</small>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function PersonalDevicesHome({ devices }: { devices: PersonalDevice[] }) {
  if (!devices.length) return null;
  return (
    <div className="home-personal-devices">
      {devices.slice(0, 2).map((device) => (
        <div key={device.id} className="home-personal-device">
          <BatteryRing device={device} compact />
          <div><b>{device.name}</b><span><PresenceGlyph state={device.presence} size={10} />{device.presenceLabel}{device.charging ? " · 充电" : ""}</span></div>
        </div>
      ))}
    </div>
  );
}
