"use client";

import { useMemo, useState } from "react";
import { AirVent, ArchiveRestore, Blinds, Bluetooth, Box, BriefcaseBusiness, CalendarClock, Cloud, CloudSun, Fan, GitBranch, Home, Languages, Leaf, Lightbulb, ListChecks, LockKeyhole, Music2, Power, Radio, RadioTower, Router, ShieldCheck, Sun, Thermometer, TimerReset, Tv, WifiOff } from "lucide-react";
import type { HaCatalog, HassEntity, HassEntityMap } from "@/types/config";
import { PersonalDevicesPanel, resolvePersonalDevices } from "./personal-devices";
import { isDeviceTile } from "@/lib/catalog";
import { PageHeader } from "./page-header";

const controllable = new Set(["light", "switch", "fan", "input_boolean", "automation"]);
const activeStates = new Set(["on", "playing", "open", "opening", "heat", "cool", "dry", "fan_only", "auto", "heat_cool", "home", "locked"]);
const climateModes: Record<string, string> = { off: "关闭", cool: "制冷", heat: "制热", dry: "除湿", fan_only: "送风", auto: "自动", heat_cool: "自动" };
const domainPriority = ["climate", "light", "fan", "cover", "switch", "lock", "media_player", "vacuum", "sensor", "binary_sensor"];
/** Settings-type domains: shown in HA's device page, but never the face of a device tile. */
const settingDomains = new Set(["number", "select", "text", "button", "event", "update", "notify", "time", "date"]);
const rank = (domain: string) => { const index = domainPriority.indexOf(domain); return index < 0 ? domainPriority.length : index; };
/** Xiaomi MIoT entities end in _p_<service>_<property>; the main power is the `on` property of the lowest service. */
const miotMainSwitch = (entityId: string) => { const match = entityId.match(/_on_p_(\d+)_\d+$/); return match ? Number(match[1]) : Number.POSITIVE_INFINITY; };
/** Chips lead with measurements (W, kWh, °C, %), which say more than a bare on/off. */
const isMeasurement = (entity?: HassEntity) => typeof entity?.attributes.unit_of_measurement === "string" && /^(W|kW|kWh|Wh|°C|°F|%|lx|ppm|µg\/m³)$/.test(entity.attributes.unit_of_measurement);
const integrationNames: Record<string, string> = {
  version: "版本", workday: "工作日", season: "季节", sun: "日出日落", time_date: "时间和日期",
  uptime: "正常运行时间", icloud: "Apple iCloud", backup: "备份", bluetooth: "Bluetooth",
  google_translate: "Google Translate 文字转语音", ibeacon: "iBeacon Tracker", met: "Met.no 天气",
  radio_browser: "Radio Browser", shopping_list: "购物清单", todo: "购物与待办", upnp: "UPnP / IGD",
};

function DeviceIcon({ domain, size = 21 }: { domain?: string; size?: number }) {
  const Icon = domain === "light" ? Lightbulb : domain === "fan" ? Fan : domain === "climate" ? AirVent : domain === "cover" ? Blinds : domain === "lock" ? LockKeyhole : domain === "media_player" ? Music2 : domain === "remote" ? Tv : domain === "sensor" || domain === "binary_sensor" ? Thermometer : domain === "switch" ? Power : domain === "device_tracker" ? Radio : domain === "router" ? Router : Box;
  return <Icon size={size} strokeWidth={1.75} />;
}

function IntegrationIcon({ domain }: { domain: string }) {
  const Icon = domain === "version" ? GitBranch : domain === "workday" ? BriefcaseBusiness : domain === "season" ? Leaf : domain === "sun" ? Sun : domain === "time_date" ? CalendarClock : domain === "uptime" ? TimerReset : domain === "icloud" ? Cloud : domain === "backup" ? ArchiveRestore : domain === "bluetooth" ? Bluetooth : domain === "google_translate" ? Languages : domain === "ibeacon" ? RadioTower : domain === "met" ? CloudSun : domain === "radio_browser" ? Radio : domain === "shopping_list" || domain === "todo" ? ListChecks : domain === "upnp" ? Router : Box;
  return <Icon size={21} strokeWidth={1.7} />;
}

function integrationState(state: string) {
  if (state === "loaded") return "已加载";
  if (state === "setup_retry") return "正在重试";
  if (state === "setup_error") return "加载失败";
  if (state === "not_loaded") return "未加载";
  return state || "已发现";
}

function stateLabel(entity: HassEntity | undefined) {
  if (!entity) return "无实时状态";
  if (entity.state === "unavailable") return "离线";
  if (entity.state === "unknown") return "状态未知";
  if (entity.attributes.device_class === "timestamp" || /^\d{4}-\d{2}-\d{2}T/.test(entity.state)) {
    const date = new Date(entity.state);
    if (!Number.isNaN(date.getTime())) return date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  }
  if (entity.entity_id.startsWith("climate.")) {
    const current = entity.attributes.current_temperature;
    const target = entity.attributes.temperature;
    const mode = climateModes[entity.state] ?? entity.state;
    return [mode, typeof current === "number" ? `室内 ${current}°` : "", entity.state !== "off" && typeof target === "number" ? `设定 ${target}°` : ""].filter(Boolean).join(" · ");
  }
  if (entity.state === "on") return "开启";
  if (entity.state === "off") return "关闭";
  const unit = entity.attributes.unit_of_measurement;
  return `${entity.state}${typeof unit === "string" ? ` ${unit}` : ""}`;
}

/** Pure: one tile per device, with its primary entity and the most informative chips. */
export function buildDeviceTree(catalog: HaCatalog, entities: HassEntityMap) {
    const registryByDevice = new Map<string, typeof catalog.entities>();
    for (const item of catalog.entities) {
      if (item.disabled || !item.deviceId || !entities[item.entityId]) continue;
      const values = registryByDevice.get(item.deviceId) ?? [];
      values.push(item);
      registryByDevice.set(item.deviceId, values);
    }
    return catalog.devices.filter(isDeviceTile).map((device) => {
      const all = registryByDevice.get(device.deviceId) ?? [];
      const core = all.filter((item) => !item.category && !settingDomains.has(item.domain));
      const registry = (core.length ? core : all).sort((a, b) => rank(a.domain) - rank(b.domain) || miotMainSwitch(a.entityId) - miotMainSwitch(b.entityId));
      // Climate first (the AC itself), then the device's main controllable entity, never a config switch.
      const primary = registry.find((item) => item.domain === "climate") ?? registry.find((item) => controllable.has(item.domain)) ?? registry[0];
      const chips = [...registry].sort((a, b) => Number(isMeasurement(entities[b.entityId])) - Number(isMeasurement(entities[a.entityId]))).filter((item) => item.entityId !== primary?.entityId || item.domain === "climate");
      const resolvedArea = device.areaId || primary?.areaId || "unassigned";
      return { ...device, resolvedArea, registry, chips, primary, state: primary ? entities[primary.entityId] : undefined };
    }).filter((device) => device.registry.length > 0);
}

export function DevicesPage({ entities, catalog }: { entities: HassEntityMap; catalog: HaCatalog }) {
  const [view, setView] = useState<"devices" | "integrations">("devices");
  const [area, setArea] = useState("all");
  const tree = useMemo(() => buildDeviceTree(catalog, entities), [catalog, entities]);
  const visible = area === "all" ? tree : tree.filter((device) => device.resolvedArea === area);
  const online = tree.filter((device) => device.registry.some((item) => entities[item.entityId]?.state !== "unavailable")).length;
  const integrations = catalog.integrations.filter((item) => item.entryCount || item.deviceCount || item.entityCount || item.serviceCount);
  const personalDevices = useMemo(() => resolvePersonalDevices(entities, catalog), [entities, catalog]);

  async function toggle(entityId: string, domain: string) {
    if (!controllable.has(domain)) return;
    await fetch("/api/control", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "ha", domain, service: "toggle", entityId }),
    });
  }

  return (
    <section className="device-center h-full p-7 xl:p-9" aria-label="设备中心">
      <PageHeader kicker="Home · 原生目录" title="设备与集成" tone="green" aside={<><span className="inline-flex items-center gap-2"><ShieldCheck size={15} className="text-[var(--green)]" />{view === "devices" ? `${online}/${tree.length} 设备在线` : `${integrations.length} 个原生集成`}</span><span>{catalog.areas.length} 个空间</span></>} />
      <div className="mb-4 flex items-center gap-3">
        <div className="device-view-switch" aria-label="设备中心视图">
          <button className={view === "devices" ? "active" : ""} onClick={() => setView("devices")}>设备</button>
          <button className={view === "integrations" ? "active" : ""} onClick={() => setView("integrations")}>HA 原生集成</button>
        </div>
        {view === "devices" && <div className="area-switcher flex min-w-0 gap-2 overflow-x-auto pb-1" aria-label="按区域筛选" data-no-swipe>
          <button className={area === "all" ? "active" : ""} onClick={() => setArea("all")}><Home size={14} />全屋</button>
          {catalog.areas.map((item) => <button key={item.areaId} className={area === item.areaId ? "active" : ""} onClick={() => setArea(item.areaId)}>{item.name}</button>)}
          {tree.some((device) => device.resolvedArea === "unassigned") && <button className={area === "unassigned" ? "active" : ""} onClick={() => setArea("unassigned")}>未分区</button>}
        </div>}
      </div>
      {view === "devices" ? <div className="device-content min-h-0" data-no-swipe>
        <PersonalDevicesPanel devices={personalDevices} />
        <div className="device-grid grid min-h-0 grid-cols-2 gap-3 overflow-y-auto pr-1 lg:grid-cols-3 xl:grid-cols-4">
        {!visible.length && <div className="glass col-span-full grid min-h-64 place-items-center rounded-[var(--r-xl)] text-center"><div><WifiOff className="mx-auto text-[var(--muted)]" size={28} /><b className="mt-4 block">没有可显示的设备</b><span className="mt-2 block text-sm text-[var(--muted)]">连接 HA 后会自动读取区域、设备和实体树</span></div></div>}
        {visible.map((device) => {
          const primary = device.primary;
          const state = device.state;
          const isActive = Boolean(state && activeStates.has(state.state));
          const isOffline = device.registry.every((item) => entities[item.entityId]?.state === "unavailable");
          return (
            <article key={device.deviceId} className={`glass device-tile flex min-h-44 flex-col justify-between rounded-[var(--r-xl)] p-5 ${isActive ? "device-active" : ""} ${isOffline ? "device-offline" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <span className={`device-icon ${isActive ? "active" : ""}`}><DeviceIcon domain={primary?.domain} /></span>
                {primary && controllable.has(primary.domain) && <button className="device-power focus-ring" onClick={() => void toggle(primary.entityId, primary.domain)} aria-label={`切换${device.name}`}><Power size={15} /></button>}
              </div>
              <div className="min-w-0">
                <div className="mb-2 flex items-center gap-2"><b className="truncate text-base">{device.name}</b><i className={`status-dot ${isOffline ? "offline" : isActive ? "active" : ""}`} /></div>
                <p className="m-0 truncate text-xs text-[var(--muted)]">{device.areaName || primary?.areaName || "未分区"} · {device.manufacturer || device.model || `${device.registry.length} 个实体`}</p>
                <div className="mt-3 flex gap-2 overflow-hidden">
                  {device.chips.slice(0, 2).map((item) => <span key={item.entityId} className="device-state-chip"><DeviceIcon domain={item.domain} size={12} />{stateLabel(entities[item.entityId])}</span>)}
                </div>
              </div>
            </article>
          );
        })}
        </div>
      </div> : <div className="integration-grid grid min-h-0 grid-cols-2 gap-3 overflow-y-auto pr-1 lg:grid-cols-3 xl:grid-cols-4" data-no-swipe>
        {!integrations.length && <div className="glass col-span-full grid min-h-64 place-items-center rounded-[var(--r-xl)] text-center"><div><WifiOff className="mx-auto text-[var(--muted)]" size={28} /><b className="mt-4 block">尚未读取到原生集成</b><span className="mt-2 block text-sm text-[var(--muted)]">请确认 HA 连接账号可以读取配置项与注册表</span></div></div>}
        {integrations.map((integration) => {
          const loaded = integration.state === "loaded";
          const labels = [integration.entryCount ? `${integration.entryCount} 配置` : "", integration.deviceCount ? `${integration.deviceCount} 设备` : "", integration.entityCount ? `${integration.entityCount} 实体` : "", integration.serviceCount ? `${integration.serviceCount} 操作` : ""].filter(Boolean);
          return <article key={integration.domain} className="glass integration-tile rounded-[var(--r-xl)] p-5">
            <div className="flex items-start justify-between gap-3"><span className="integration-icon"><IntegrationIcon domain={integration.domain} /></span><span className={`integration-health ${loaded ? "loaded" : ""}`}><i />{integrationState(integration.state)}</span></div>
            <div><b className="line-clamp-1 text-base">{integrationNames[integration.domain] || integration.title || integration.domain}</b><p className="mb-0 mt-1 text-[11px] text-[var(--muted)]">{integration.domain}</p></div>
            <div className="integration-counts">{labels.map((label) => <span key={label}>{label}</span>)}</div>
          </article>;
        })}
      </div>}
    </section>
  );
}
