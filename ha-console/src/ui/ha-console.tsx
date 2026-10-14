"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AirVent, Aperture, ArchiveRestore, Blinds, Bluetooth, Bot, Box, BriefcaseBusiness, CalendarClock, ChevronRight, CircleAlert, Cloud, CloudSun, Fan, GitBranch, Heart, House, Languages, Leaf, Lightbulb, ListChecks, LoaderCircle, Power, Radio, RadioTower, Router, Search, Sparkles, Sun, ThermometerSun, TimerReset, Unplug, Wifi, WifiOff, X } from "lucide-react";
import type { HaCatalog, HaCatalogEntity, HaCatalogIntegration, HaRole } from "../types";

type Filter = "all" | "online" | "offline" | "favorites";
type View = "entities" | "integrations";
type LiveMap = Record<string, { state: string; attributes: Record<string, unknown> }>;

const domainMeta: Record<string, { label: string; icon: typeof Lightbulb }> = {
  light: { label: "灯光", icon: Lightbulb }, switch: { label: "开关", icon: Unplug }, sensor: { label: "传感器", icon: ThermometerSun },
  binary_sensor: { label: "二元传感器", icon: ThermometerSun }, climate: { label: "空调", icon: AirVent }, fan: { label: "风扇", icon: Fan },
  cover: { label: "窗帘", icon: Blinds }, camera: { label: "摄像头", icon: Aperture }, scene: { label: "场景", icon: Sparkles }, automation: { label: "自动化", icon: Bot },
};
const integrationNames: Record<string, string> = {
  version: "版本", workday: "工作日", season: "季节", sun: "日出日落", time_date: "时间和日期", uptime: "正常运行时间",
  icloud: "Apple iCloud", backup: "备份", bluetooth: "Bluetooth", google_translate: "Google Translate 文字转语音",
  ibeacon: "iBeacon Tracker", met: "Met.no 天气", radio_browser: "Radio Browser", shopping_list: "购物清单", todo: "待办事项", upnp: "UPnP / IGD",
};
const controllable = new Set(["light", "switch", "fan", "input_boolean", "automation"]);
const unavailable = new Set(["unavailable", "unknown"]);

function IntegrationIcon({ domain }: { domain: string }) {
  const Icon = domain === "version" ? GitBranch : domain === "workday" ? BriefcaseBusiness : domain === "season" ? Leaf : domain === "sun" ? Sun : domain === "time_date" ? CalendarClock : domain === "uptime" ? TimerReset : domain === "icloud" ? Cloud : domain === "backup" ? ArchiveRestore : domain === "bluetooth" ? Bluetooth : domain === "google_translate" ? Languages : domain === "ibeacon" ? RadioTower : domain === "met" ? CloudSun : domain === "radio_browser" ? Radio : domain === "shopping_list" || domain === "todo" ? ListChecks : domain === "upnp" ? Router : Box;
  return <Icon size={21} strokeWidth={1.7} />;
}

function integrationState(value: string) {
  return value === "loaded" ? "已加载" : value === "setup_retry" ? "正在重试" : value === "setup_error" ? "加载失败" : value === "not_loaded" ? "未加载" : value || "已发现";
}

export function HaConsole({ role, embedded = false }: { role: HaRole; embedded?: boolean }) {
  const [catalog, setCatalog] = useState<HaCatalog>({ connected: false, areas: [], integrations: [], entities: [] });
  const [live, setLive] = useState<LiveMap>({});
  const [view, setView] = useState<View>("entities");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [area, setArea] = useState("all");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [selected, setSelected] = useState<HaCatalogEntity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const streamRef = useRef<EventSource | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/ha/catalog", { credentials: "same-origin" }).then((response) => { if (!response.ok) throw new Error("无法读取 Home Assistant 目录"); return response.json(); }),
      fetch("/api/ha/favorites", { credentials: "same-origin" }).then((response) => response.ok ? response.json() : { entityIds: [] }),
    ]).then(([nextCatalog, favoriteData]) => {
      setCatalog({ connected: Boolean(nextCatalog.connected), areas: nextCatalog.areas ?? [], integrations: nextCatalog.integrations ?? [], entities: nextCatalog.entities ?? [] });
      setFavorites(favoriteData.entityIds);
    }).catch((reason) => setError(reason.message)).finally(() => setLoading(false));
  }, []);

  const visible = useMemo(() => catalog.entities.filter((entity) => {
    const state = live[entity.entityId]?.state ?? entity.state ?? "unknown";
    const matchesSearch = `${entity.name} ${entity.entityId}`.toLowerCase().includes(query.toLowerCase());
    const matchesArea = area === "all" || entity.areaId === area;
    const matchesFilter = filter === "all" || (filter === "favorites" ? favorites.includes(entity.entityId) : filter === "offline" ? unavailable.has(state) : !unavailable.has(state));
    return matchesSearch && matchesArea && matchesFilter && !entity.disabled;
  }), [area, catalog.entities, favorites, filter, live, query]);
  const visibleIntegrations = useMemo(() => catalog.integrations.filter((item) => `${integrationNames[item.domain] ?? item.title} ${item.domain}`.toLowerCase().includes(query.toLowerCase())), [catalog.integrations, query]);
  const streamKey = useMemo(() => view === "entities" ? visible.slice(0, 100).map((item) => item.entityId).join(",") : "", [view, visible]);

  useEffect(() => {
    streamRef.current?.close();
    if (!streamKey) return;
    const source = new EventSource(`/api/ha/stream?ids=${encodeURIComponent(streamKey)}`);
    source.addEventListener("entities", (event) => setLive((current) => ({ ...current, ...JSON.parse((event as MessageEvent).data) })));
    source.onerror = () => setCatalog((current) => ({ ...current, connected: false }));
    source.onopen = () => setCatalog((current) => ({ ...current, connected: true }));
    streamRef.current = source;
    return () => source.close();
  }, [streamKey]);

  async function command(entity: HaCatalogEntity, service?: string, data: Record<string, unknown> = {}) {
    if (role !== "admin") return;
    setPending(entity.entityId);
    const csrf = document.cookie.split("; ").find((item) => item.startsWith("hc_csrf="))?.split("=")[1] ?? "";
    const response = await fetch("/api/ha/service", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf-token": decodeURIComponent(csrf) }, body: JSON.stringify({ entityId: entity.entityId, domain: entity.domain, service: service ?? (entity.domain === "scene" ? "turn_on" : "toggle"), data }) });
    if (!response.ok) setError((await response.json()).error ?? "操作未完成");
    setPending(null);
  }

  async function favorite(entityId: string) {
    const next = favorites.includes(entityId) ? favorites.filter((id) => id !== entityId) : [...favorites, entityId];
    setFavorites(next);
    const csrf = document.cookie.split("; ").find((item) => item.startsWith("hc_csrf="))?.split("=")[1] ?? "";
    await fetch("/api/ha/favorites", { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf-token": decodeURIComponent(csrf) }, body: JSON.stringify({ entityIds: next }) });
  }

  return (
    <div className={`ha-console-shell text-[#f4f7fb] ${embedded ? "" : "min-h-dvh bg-[#080a0e]"}`}>
      <div className={embedded ? "w-full pb-12" : "mx-auto max-w-[1900px] px-4 pb-24 pt-5 sm:px-6 lg:px-8"}>
        <header className={`ha-console-header sticky top-0 z-20 mb-5 border-b border-white/[.07] bg-[#11151c]/92 pb-4 pt-1 backdrop-blur-2xl ${embedded ? "" : "-mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"}`}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><p className="m-0 text-xs font-medium text-[#8fb4ff]">Home Assistant 实时目录</p><h1 className="m-0 mt-1 text-3xl font-semibold tracking-[-.045em]">家的控制</h1></div>
            <div className="flex items-center gap-3"><div className="ha-view-switch"><button className={view === "entities" ? "active" : ""} onClick={() => setView("entities")}>设备与实体</button><button className={view === "integrations" ? "active" : ""} onClick={() => setView("integrations")}>原生集成</button></div><span className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-medium ${catalog.connected ? "bg-emerald-400/10 text-emerald-300" : "bg-red-400/10 text-red-300"}`}>{catalog.connected ? <Wifi size={15} /> : <WifiOff size={15} />}{catalog.connected ? "实时连接" : "连接中断"}</span></div>
          </div>
          <div className="mt-5 flex flex-col gap-3 xl:flex-row">
            <label className="relative flex-1"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={view === "entities" ? "搜索设备名称或实体 ID" : "搜索集成名称或域"} className="w-full rounded-2xl border border-white/[.08] bg-white/[.055] py-3 pl-11 pr-4 text-sm text-white outline-none ring-[#7da9ff] placeholder:text-white/25 focus:ring-2" /></label>
            {view === "entities" && <div className="flex gap-2 overflow-x-auto">{(["favorites", "all", "online", "offline"] as Filter[]).map((item) => <button key={item} onClick={() => setFilter(item)} className={`whitespace-nowrap rounded-2xl px-4 py-3 text-sm font-medium transition ${filter === item ? "bg-white text-black" : "bg-white/[.055] text-white/55 hover:bg-white/[.09] hover:text-white"}`}>{({ favorites: "收藏", all: "全部", online: "在线", offline: "离线" })[item]}</button>)}</div>}
          </div>
          {view === "entities" ? <div className="mt-3 flex gap-2 overflow-x-auto pb-1"><button onClick={() => setArea("all")} className={`rounded-full px-3 py-1.5 text-xs ${area === "all" ? "bg-[#7da9ff] text-[#07101f]" : "bg-white/[.055] text-white/60"}`}>所有房间</button>{catalog.areas.map((item) => <button key={item.areaId} onClick={() => setArea(item.areaId)} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs ${area === item.areaId ? "bg-[#7da9ff] text-[#07101f]" : "bg-white/[.055] text-white/60"}`}>{item.name}</button>)}</div> : <p className="mb-0 mt-3 text-xs text-white/40">{visibleIntegrations.length} 个集成 · 来自 HA 配置项、设备/实体注册表与服务动作</p>}
        </header>

        {error && <div className="mb-5 flex items-center justify-between rounded-2xl bg-red-400/10 p-4 text-sm text-red-300"><span className="flex items-center gap-2"><CircleAlert size={18} />{error}</span><button onClick={() => setError("")}><X size={17} /></button></div>}
        {loading ? <div className="grid min-h-72 place-items-center text-sm text-white/40"><div className="text-center"><LoaderCircle className="mx-auto mb-3 animate-spin" />正在整理 HA 目录…</div></div> : view === "integrations" ? <IntegrationGrid integrations={visibleIntegrations} /> : visible.length === 0 ? <div className="grid min-h-72 place-items-center text-center text-sm text-white/40"><div><House className="mx-auto mb-3" /><p>当前筛选条件下没有设备</p></div></div> : (
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(13rem,1fr))]">
            {visible.map((entity) => {
              const state = live[entity.entityId]?.state ?? entity.state ?? "unknown";
              const attrs = { ...entity.attributes, ...(live[entity.entityId]?.attributes ?? {}) };
              const active = state === "on" || entity.domain === "scene";
              const MetaIcon = domainMeta[entity.domain]?.icon ?? Power;
              const unit = attrs.unit_of_measurement as string | undefined;
              return <article key={entity.entityId} className={`group relative flex min-h-40 flex-col justify-between overflow-hidden rounded-[1.5rem] border p-4 transition active:scale-[.985] ${active ? "border-amber-300/20 bg-amber-300/[.09]" : "border-white/[.075] bg-white/[.045] hover:bg-white/[.065]"}`}>
                <div className="flex items-start justify-between"><button disabled={!controllable.has(entity.domain) || role !== "admin" || pending === entity.entityId} onClick={() => command(entity)} className={`grid size-10 place-items-center rounded-[.9rem] transition disabled:opacity-55 ${active ? "bg-amber-400 text-[#241700]" : "bg-white/[.07] text-white/55"}`}>{pending === entity.entityId ? <LoaderCircle size={19} className="animate-spin" /> : <MetaIcon size={20} />}</button><button onClick={() => favorite(entity.entityId)} aria-label="收藏" className="p-2 text-white/25"><Heart size={17} fill={favorites.includes(entity.entityId) ? "currentColor" : "none"} className={favorites.includes(entity.entityId) ? "text-rose-400" : ""} /></button></div>
                <button onClick={() => setSelected(entity)} className="mt-5 min-w-0 text-left"><b className="block truncate text-sm font-semibold">{entity.name}</b><span className={`mt-1 block truncate text-xs ${unavailable.has(state) ? "text-red-400" : "text-white/40"}`}>{unit ? `${state} ${unit}` : state}<ChevronRight size={13} className="ml-1 inline" /></span><code className="mt-2 block truncate text-[10px] text-white/20">{entity.entityId}</code></button>
              </article>;
            })}
          </div>
        )}
      </div>
      {selected && <DeviceSheet entity={selected} live={live[selected.entityId]} role={role} onClose={() => setSelected(null)} onCommand={command} />}
    </div>
  );
}

function IntegrationGrid({ integrations }: { integrations: HaCatalogIntegration[] }) {
  if (!integrations.length) return <div className="grid min-h-72 place-items-center text-center text-sm text-white/40"><div><Box className="mx-auto mb-3" /><p>当前搜索下没有原生集成</p></div></div>;
  return <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(16rem,1fr))]">{integrations.map((integration) => {
    const loaded = integration.state === "loaded";
    const counts = [integration.entryCount ? `${integration.entryCount} 配置` : "", integration.deviceCount ? `${integration.deviceCount} 设备` : "", integration.entityCount ? `${integration.entityCount} 实体` : "", integration.serviceCount ? `${integration.serviceCount} 操作` : ""].filter(Boolean);
    return <article key={integration.domain} className="grid min-h-44 grid-rows-[auto_1fr_auto] gap-4 rounded-[1.5rem] border border-white/[.075] bg-white/[.045] p-5 transition hover:bg-white/[.065]">
      <div className="flex items-start justify-between gap-3"><span className="grid size-11 place-items-center rounded-2xl bg-[#83adff]/10 text-[#83adff] ring-1 ring-[#83adff]/15"><IntegrationIcon domain={integration.domain} /></span><span className={`inline-flex items-center gap-1.5 text-[11px] ${loaded ? "text-emerald-300" : "text-amber-300"}`}><i className={`size-1.5 rounded-full ${loaded ? "bg-emerald-300" : "bg-amber-300"}`} />{integrationState(integration.state)}</span></div>
      <div><b className="line-clamp-1 text-base">{integrationNames[integration.domain] || integration.title || integration.domain}</b><p className="mb-0 mt-1 text-[11px] text-white/35">{integration.domain}</p></div>
      <div className="flex gap-1.5 overflow-hidden">{counts.map((value) => <span key={value} className="flex-none rounded-lg border border-white/[.07] bg-white/[.035] px-2 py-1 text-[10px] text-white/45">{value}</span>)}</div>
    </article>;
  })}</div>;
}

function DeviceSheet({ entity, live, role, onClose, onCommand }: { entity: HaCatalogEntity; live?: { state: string; attributes: Record<string, unknown> }; role: HaRole; onClose: () => void; onCommand: (entity: HaCatalogEntity, service?: string, data?: Record<string, unknown>) => Promise<void> }) {
  const state = live?.state ?? entity.state ?? "unknown";
  const attrs = { ...entity.attributes, ...(live?.attributes ?? {}) };
  const brightness = Math.round(Number(attrs.brightness ?? 0) / 2.55);
  return <div className="fixed inset-0 z-50 flex items-end bg-black/55 backdrop-blur-sm sm:items-center sm:justify-center" onPointerDown={(event) => event.target === event.currentTarget && onClose()}><section className="w-full rounded-t-[2rem] border border-white/[.08] bg-[#171a20] p-6 text-white shadow-2xl sm:max-w-lg sm:rounded-[2rem]"><div className="flex items-start justify-between"><div><p className="m-0 text-xs text-white/40">{entity.areaName ?? domainMeta[entity.domain]?.label ?? entity.domain}</p><h2 className="mb-1 mt-2 text-2xl font-semibold tracking-[-.035em]">{entity.name}</h2><code className="text-xs text-white/35">{entity.entityId}</code></div><button onClick={onClose} className="rounded-full bg-white/[.07] p-2"><X size={19} /></button></div>{entity.domain === "camera" && <img src={`/api/ha/camera/${encodeURIComponent(entity.entityId)}`} alt={entity.name} className="mt-6 aspect-video w-full rounded-2xl bg-black object-cover" />}{entity.domain === "light" && <label className="mt-7 block text-sm text-white/50">亮度 {brightness}%<input type="range" min="1" max="100" defaultValue={brightness || 50} disabled={role !== "admin"} onPointerUp={(event) => onCommand(entity, "turn_on", { brightness_pct: Number(event.currentTarget.value) })} className="mt-3 w-full accent-amber-400" /></label>}<div className="mt-7 flex items-center justify-between rounded-2xl bg-white/[.045] p-4"><div><b className="text-sm">当前状态</b><p className="mb-0 mt-1 text-xs text-white/40">{state}</p></div>{(controllable.has(entity.domain) || entity.domain === "scene") && <button disabled={role !== "admin"} onClick={() => onCommand(entity)} className="rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-black disabled:opacity-35">{entity.domain === "scene" ? "运行场景" : state === "on" ? "关闭" : "开启"}</button>}</div></section></div>;
}
