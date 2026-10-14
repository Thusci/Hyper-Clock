"use client";

import { Activity, Cpu, Database, HardDrive, Server, Thermometer, Zap } from "lucide-react";
import type { AppConfig, HassEntity, HassEntityMap } from "@/types/config";
import { PageHeader } from "./page-header";

type MetricKey = keyof AppConfig["entities"]["systemMetrics"];
const meta: Record<MetricKey,{label:string;unit:string;icon:typeof Cpu}> = {
  cpu:{label:"CPU",unit:"%",icon:Cpu}, memory:{label:"内存",unit:"%",icon:Database}, disk:{label:"磁盘",unit:"%",icon:HardDrive}, power:{label:"功率",unit:"W",icon:Zap}, temperature:{label:"温度",unit:"°C",icon:Thermometer}, uptime:{label:"运行时间",unit:"",icon:Activity},
};
function valid(entity?: HassEntity) { return entity && !["unknown","unavailable","none",""] .includes(entity.state); }
/*
 * Q775 metrics come from the q775_bridge integration (daemon/), whose entity ids end in
 * stable suffixes. Exact suffixes matter: a loose /q775.*disk/ would pick one of the
 * read-only snap mounts (always 100 %) and /q775.*cpu/ could pick cpu_frequency_max_mhz.
 */
const bridgeSuffixes: Record<MetricKey, RegExp[]> = {
  cpu: [/^sensor\.q775_.*_cpu_percent$/],
  memory: [/^sensor\.q775_.*_memory_percent$/],
  disk: [/^sensor\.q775_.*_disk_used$/],
  power: [/^sensor\.q775_.*_q775_current_power$/, /^sensor\.q775_.*_current_power$/],
  temperature: [/^sensor\.q775_.*_cpu_temperature$/, /^sensor\.q775_.*_package_id_0$/, /^sensor\.q775_.*_x86_pkg_temp$/, /^sensor\.q775_.*_core_0$/],
  uptime: [/^sensor\.q775_.*_system_uptime$/, /^sensor\.uptime$/],
};
const genericPatterns: Record<MetricKey, RegExp[]> = {
  cpu: [/cpu.*(usage|percent|load)/i], memory: [/(memory|ram).*(usage|percent)/i], disk: [/disk.*(use|usage)$/i], power: [/power$/i], temperature: [/cpu.*temp/i], uptime: [/uptime$/i],
};

function findMetric(key: MetricKey, config: AppConfig, entities: HassEntityMap) {
  const bound = config.entities.systemMetrics[key];
  if (bound && valid(entities[bound])) return entities[bound];
  const all = Object.values(entities).filter(valid);
  for (const pattern of bridgeSuffixes[key]) {
    const match = all.find((entity) => pattern.test(entity.entity_id));
    if (match) return match;
  }
  return all.find((entity) => genericPatterns[key].some((pattern) => pattern.test(entity.entity_id)));
}

const bridgeValue = (entities: HassEntityMap, suffix: RegExp) => Object.values(entities).find((entity) => valid(entity) && suffix.test(entity.entity_id));
function numeric(entity?: HassEntity) { const value=Number(entity?.state); return Number.isFinite(value) ? value : undefined; }

/** Uptime arrives either as a boot timestamp (sensor.uptime) or as a duration (q775 bridge, seconds). */
function uptimeText(entity?: HassEntity) {
  if (!entity || !valid(entity)) return "--";
  let minutes: number;
  const seconds = Number(entity.state);
  if (Number.isFinite(seconds)) {
    const unit = String(entity.attributes.unit_of_measurement ?? "s");
    minutes = seconds * ({ s: 1 / 60, min: 1, h: 60, d: 1440 }[unit] ?? 1 / 60);
  } else {
    const date = new Date(entity.state);
    if (Number.isNaN(date.getTime())) return entity.state;
    minutes = (Date.now() - date.getTime()) / 60_000;
  }
  minutes = Math.max(0, Math.floor(minutes));
  const days = Math.floor(minutes / 1440), hours = Math.floor((minutes % 1440) / 60), mins = minutes % 60;
  return days ? `${days}天 ${hours}小时` : hours ? `${hours}小时 ${mins}分` : `${mins}分钟`;
}
function Ring({ value, label, unit, icon:Icon, estimated=false }: {value?:number;label:string;unit:string;icon:typeof Cpu;estimated?:boolean}) {
  const normalized = Math.max(0,Math.min(100,value ?? 0));
  return <article className="glass system-ring-card rounded-[var(--r-xl)] p-5"><div className="flex items-center justify-between"><span className="card-kicker">{label}</span><Icon size={18}/></div><div className="system-ring mx-auto mt-3" style={{"--metric":`${normalized * 3.6}deg`} as React.CSSProperties}><div><strong>{value == null ? "--" : Math.round(value*10)/10}</strong><small>{value == null ? "" : unit}</small></div></div><p className="mb-0 mt-3 text-center text-[11px] text-[var(--muted)]">{value == null ? "等待 HA 实体" : estimated ? "基于真实 CPU 负载估算" : "Home Assistant 实时数据"}</p></article>;
}

export function SystemPage({config,entities,status,usingCache}:{config:AppConfig;entities:HassEntityMap;status:"connecting"|"connected"|"offline";usingCache:boolean}) {
  const found = Object.fromEntries((Object.keys(meta) as MetricKey[]).map((key)=>[key,findMetric(key,config,entities)])) as Record<MetricKey,HassEntity|undefined>;
  const cpu=numeric(found.cpu), memory=numeric(found.memory), disk=numeric(found.disk), temperature=numeric(found.temperature);
  // On AC the bridge measures power through the battery, which reads 0 W; treat that as "no measurement".
  const onAc = bridgeValue(entities, /^binary_sensor\.q775_.*_external_power$/)?.state === "on";
  const measured = numeric(found.power);
  const realPower = measured != null && !(measured === 0 && onAc) ? measured : undefined;
  const estimatedPower=realPower ?? (cpu == null ? undefined : 3.2 + cpu*.045);
  const battery = numeric(bridgeValue(entities, /^sensor\.q775_.*_battery_level$/) ?? bridgeValue(entities, /^sensor\.q775_.*_cmb1_capacity$/) ?? bridgeValue(entities, /^sensor\.q775_.*_bat\d?_capacity$/));
  const lux = numeric(bridgeValue(entities, /^sensor\.q775_.*_ambient_light$/) ?? bridgeValue(entities, /^sensor\.q775_.*_illuminance_calculated$/));
  const swap = numeric(bridgeValue(entities, /^sensor\.q775_.*_swap_percent$/));
  return <section className="system-layout h-full p-7 xl:p-9" aria-label="Q775 状态"><PageHeader kicker="Device · 主机遥测" title="Q775 运行状态" tone="green" aside={<span className="inline-flex items-center gap-2"><i className={`status-dot ${status==="connected"?"active":status==="offline"?"offline":""}`}/>{usingCache?"显示缓存":status==="connected"?"实时同步":"正在连接"}</span>} /><div className="system-dashboard grid min-h-0 grid-cols-[1.15fr_.85fr] gap-4"><div className="grid grid-cols-2 gap-4"><Ring value={cpu} {...meta.cpu}/><Ring value={memory} {...meta.memory}/><Ring value={disk} {...meta.disk}/><Ring value={estimatedPower} {...meta.power} estimated={realPower==null&&estimatedPower!=null}/></div><div className="grid grid-rows-[1fr_auto] gap-4"><article className="glass system-machine relative overflow-hidden rounded-[var(--r-xl)] p-7"><div className="system-machine-glow"/><Server size={34}/><p className="card-kicker mt-6">DEVICE HEALTH</p><h3 className="mb-2 mt-2 text-3xl font-semibold tracking-[-.045em]">{config.deviceName}</h3><p className="m-0 max-w-sm text-sm leading-6 text-[var(--muted)]">指标来自 Q775 硬件桥（q775_bridge）；缺失项保持空白，不使用演示值。</p><div className="mt-6 grid grid-cols-2 gap-3"><div className="dynamic-stat"><span>核心温度</span><b>{temperature==null?"--":`${Math.round(temperature*10)/10}°`}</b></div><div className="dynamic-stat"><span>运行时间</span><b className="truncate text-base!">{uptimeText(found.uptime)}</b></div><div className="dynamic-stat"><span>电池{onAc ? " · 外接电源" : ""}</span><b>{battery==null?"--":`${Math.round(battery)}%`}</b></div><div className="dynamic-stat"><span>环境光 · 交换区</span><b className="truncate text-base!">{lux==null?"--":`${Math.round(lux)} lx`}{swap==null?"":` · ${Math.round(swap)}%`}</b></div></div></article><article className="glass flex items-center gap-4 rounded-[var(--r-lg)] p-5"><Zap className="text-[var(--amber)]"/><div><b className="text-sm">电耗模型</b><p className="mb-0 mt-1 text-xs leading-5 text-[var(--muted)]">电池供电时读取实测功率；接入电源时电池电流为 0，改用真实 CPU 占用估算约 3.2–7.7 W，并明确标注。</p></div></article></div></div></section>;
}
