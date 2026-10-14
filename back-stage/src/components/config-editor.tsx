"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Check, ChevronRight, Eye, LoaderCircle, Plus, Search, Save, Trash2, X } from "lucide-react";
import type { AppConfig, HaCatalog } from "@/types";
import { PAGE_KINDS } from "@/shared/page-kinds";

const field = "field";
type ListKey = Exclude<keyof AppConfig["entities"], "systemMetrics">;
type SystemKey = keyof AppConfig["entities"]["systemMetrics"];
type PickerTarget = { type:"weather"} | { type:"list"; key:ListKey } | { type:"system"; key:SystemKey };
type PickerState = { title:string; domains:string[]; target:PickerTarget; selected:string[] };
function csrf() { return decodeURIComponent(document.cookie.split("; ").find((value) => value.startsWith("hc_csrf="))?.split("=")[1] ?? ""); }

export function ConfigEditor({ initial, mode, readOnly = false }: { initial: AppConfig; mode: "dashboard" | "rules" | "voice"; readOnly?: boolean }) {
  const [config, setConfig] = useState(initial);
  const [status, setStatus] = useState("");
  const [catalog, setCatalog] = useState<HaCatalog | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [picker, setPicker] = useState<PickerState | null>(null);

  useEffect(() => {
    if (mode !== "dashboard") return;
    let disposed = false;
    fetch("/api/ha/catalog", { credentials:"same-origin" }).then(async (response) => {
      if (!response.ok) throw new Error("无法读取 Home Assistant 实体目录");
      const value = await response.json() as HaCatalog;
      if (!disposed) setCatalog(value);
    }).catch((error:unknown) => { if (!disposed) setCatalogError(error instanceof Error ? error.message : "HA 实体目录不可用"); });
    return () => { disposed = true; };
  }, [mode]);

  function openPicker(title:string, domains:string[], target:PickerTarget, selected:string[]) {
    if (!readOnly) setPicker({ title, domains, target, selected });
  }
  function applyPicker(ids:string[]) {
    if (!picker) return;
    if (picker.target.type === "weather") setConfig((current) => ({ ...current, weatherEntity:ids[0] ?? "" }));
    if (picker.target.type === "list") { const key=picker.target.key; setConfig((current) => ({ ...current, entities:{ ...current.entities, [key]:ids } })); }
    if (picker.target.type === "system") { const key=picker.target.key; setConfig((current) => ({ ...current, entities:{ ...current.entities, systemMetrics:{ ...current.entities.systemMetrics, [key]:ids[0] ?? "" } } })); }
    setPicker(null);
  }

  async function save() {
    setStatus("保存中…");
    const response = await fetch("/api/admin/config", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-csrf-token": csrf() },
      body: JSON.stringify(config),
    });
    setStatus(response.ok ? "已保存并推送到表盘" : `保存失败：${(await response.json()).error}`);
  }

  function move(index: number, delta: number) {
    const pages = [...config.pages];
    const next = index + delta;
    if (next < 0 || next >= pages.length) return;
    [pages[index], pages[next]] = [pages[next], pages[index]];
    setConfig({ ...config, pages });
  }

  return (
    <div>
      <Header mode={mode} />
      {mode === "dashboard" && <>
        <div className="config-source-summary mt-8 flex flex-wrap items-center justify-between gap-4 rounded-[1.4rem] border border-white/[.08] bg-white/[.025] px-5 py-4">
          <div><b className="text-sm">Home Assistant 数据目录</b><p className="mb-0 mt-1 text-xs text-[var(--muted)]">{catalog ? `${catalog.entities.filter((item) => !item.disabled).length} 个可用实体 · ${catalog.areas.length} 个空间` : catalogError || "正在读取设备树…"}</p></div>
          <span className={`inline-flex items-center gap-2 text-xs ${catalog?.connected ? "text-[var(--green)]" : "text-[var(--muted)]"}`}>{catalog ? <i className={`size-1.5 rounded-full ${catalog.connected ? "bg-[var(--green)]" : "bg-[var(--red)]"}`} /> : <LoaderCircle className="animate-spin" size={14}/>} {catalog?.connected ? "目录已同步" : catalogError ? "目录不可用" : "连接中"}</span>
        </div>

        <section className="config-section mt-8">
          <div className="config-section-copy"><h3>基本信息</h3><p>设置大屏名称，并选择天气页唯一的数据来源。</p></div>
          <div className="config-section-fields grid gap-4 md:grid-cols-2">
            <Label text="设备名称"><input className={field} value={config.deviceName} disabled={readOnly} onChange={(event) => setConfig({ ...config, deviceName: event.target.value })} /></Label>
            <BindingField text="天气来源" value={config.weatherEntity ? [config.weatherEntity] : []} catalog={catalog} readOnly={readOnly} onOpen={() => openPicker("选择天气来源",["weather"],{type:"weather"},config.weatherEntity?[config.weatherEntity]:[])} />
          </div>
        </section>

        <section className="config-section mt-8">
          <div className="config-section-copy"><h3>首页与内容</h3><p>这些内容会进入首页常驻卡片和动态翻卡。</p></div>
          <div className="config-section-fields grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {([
              ["日历", "calendars", ["calendar"]], ["课程表", "courses", ["calendar","sensor"]], ["设备快捷项", "lights", ["light","switch","fan","cover","climate"]],
              ["传感器", "sensors", ["sensor","binary_sensor"]], ["媒体", "mediaPlayers", ["media_player"]], ["简报", "briefings", ["sensor","input_text","todo"]],
              ["备忘", "memos", ["sensor","input_text","todo"]], ["股票", "stocks", ["sensor"]],
            ] as const).map(([label,key,domains]) => <BindingField key={key} text={label} value={config.entities[key]} catalog={catalog} readOnly={readOnly} onOpen={() => openPicker(`选择${label}`, [...domains], {type:"list",key}, config.entities[key])} />)}
          </div>
        </section>

        <section className="config-section mt-8">
          <div className="config-section-copy"><h3>Q775 系统指标</h3><p>优先读取 HA 真实数据；未绑定的指标保持空白。</p></div>
          <div className="config-section-fields grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {([['CPU 占用','cpu'],['内存占用','memory'],['磁盘占用','disk'],['实时功率','power'],['设备温度','temperature'],['运行时间','uptime']] as const).map(([label,key]) => <BindingField key={key} text={label} value={config.entities.systemMetrics[key]?[config.entities.systemMetrics[key]]:[]} catalog={catalog} readOnly={readOnly} onOpen={() => openPicker(`选择${label}`,["sensor"],{type:"system",key},config.entities.systemMetrics[key]?[config.entities.systemMetrics[key]]:[])} />)}
          </div>
        </section>

        <div className="mt-9 flex items-center justify-between">
          <h3 className="m-0 text-lg">表盘页面</h3>
          <button onClick={() => setConfig({ ...config, pages: [...config.pages, { id: `page-${Date.now()}`, title: "新页面", enabled: true, kind: "sensors", cards: [] }] })} className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm"><Plus size={15} />新增</button>
        </div>
        <div className="mt-4 space-y-3">
          {config.pages.map((page, index) => <article key={page.id} className="grid items-center gap-3 rounded-2xl border border-white/10 bg-white/[.025] p-4 sm:grid-cols-[auto_1fr_10rem_auto]">
            <input type="checkbox" checked={page.enabled} onChange={(event) => { const pages = [...config.pages]; pages[index] = { ...page, enabled: event.target.checked }; setConfig({ ...config, pages }); }} />
            <input className={field} value={page.title} onChange={(event) => { const pages = [...config.pages]; pages[index] = { ...page, title: event.target.value }; setConfig({ ...config, pages }); }} />
            <select className={field} value={page.kind} onChange={(event) => { const pages = [...config.pages]; pages[index] = { ...page, kind: event.target.value as typeof page.kind }; setConfig({ ...config, pages }); }}>{PAGE_KINDS.map((item) => <option key={item.kind} value={item.kind}>{item.label}</option>)}</select>
            <div className="flex gap-1"><button onClick={() => move(index, -1)} className="p-2"><ArrowUp size={16} /></button><button onClick={() => move(index, 1)} className="p-2"><ArrowDown size={16} /></button><button disabled={config.pages.length === 1} onClick={() => setConfig({ ...config, pages: config.pages.filter((_, item) => item !== index) })} className="p-2 text-[var(--red)] disabled:opacity-20"><Trash2 size={16} /></button></div>
          </article>)}
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <Label text="强调色"><input type="color" className="h-12 w-full rounded-xl bg-transparent" value={config.theme.accent} onChange={(event) => setConfig({ ...config, theme: { ...config.theme, accent: event.target.value } })} /></Label>
          <Label text={`卡片透明度 ${config.theme.cardOpacity}%`}><input type="range" min="20" max="100" value={config.theme.cardOpacity} onChange={(event) => setConfig({ ...config, theme: { ...config.theme, cardOpacity: Number(event.target.value) } })} className="mt-3 w-full" /></Label>
          <Label text={`时钟比例 ${config.theme.clockScale}%`}><input type="range" min="70" max="140" value={config.theme.clockScale} onChange={(event) => setConfig({ ...config, theme: { ...config.theme, clockScale: Number(event.target.value) } })} className="mt-3 w-full" /></Label>
        </div>
        <a href={process.env.NEXT_PUBLIC_WATCH_FACE_URL || "http://127.0.0.1:3000"} target="_blank" className="mt-7 inline-flex items-center gap-2 text-sm text-[var(--blue)]"><Eye size={16} />在新窗口预览表盘</a>
      </>}

      {mode === "rules" && <>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {[["进入极简模式（秒）", "minimalAfterMs", 1000], ["自动熄屏（秒）", "screenOffAfterMs", 1000], ["Win 长按（毫秒）", "winLongPressMs", 1], ["超长按阈值（毫秒）", "minimalLongPressMs", 1]].map(([label, key, scale]) => <Label key={String(key)} text={String(label)}><input type="number" className={field} value={config.idle[key as keyof typeof config.idle] / Number(scale)} onChange={(event) => setConfig({ ...config, idle: { ...config.idle, [String(key)]: Number(event.target.value) * Number(scale) } })} /></Label>)}
        </div>
        <div className="mt-10 flex items-center justify-between"><h3 className="m-0 text-lg">HA 唤醒触发器</h3><button onClick={() => setConfig({ ...config, wakeTriggers: [...config.wakeTriggers, { id: crypto.randomUUID(), entityId: "", mode: "full", enabled: true }] })} className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm"><Plus size={15} />添加规则</button></div>
        <div className="mt-4 space-y-3">{config.wakeTriggers.map((trigger, index) => <div key={trigger.id} className="grid gap-3 rounded-2xl border border-white/10 p-4 md:grid-cols-[auto_1fr_10rem_10rem_auto]">
          <input type="checkbox" checked={trigger.enabled} onChange={(event) => { const items = [...config.wakeTriggers]; items[index] = { ...trigger, enabled: event.target.checked }; setConfig({ ...config, wakeTriggers: items }); }} />
          <input className={field} placeholder="binary_sensor.motion" value={trigger.entityId} onChange={(event) => { const items = [...config.wakeTriggers]; items[index] = { ...trigger, entityId: event.target.value }; setConfig({ ...config, wakeTriggers: items }); }} />
          <input className={field} placeholder="目标状态（可选）" value={trigger.toState ?? ""} onChange={(event) => { const items = [...config.wakeTriggers]; items[index] = { ...trigger, toState: event.target.value || undefined }; setConfig({ ...config, wakeTriggers: items }); }} />
          <select className={field} value={trigger.mode} onChange={(event) => { const items = [...config.wakeTriggers]; items[index] = { ...trigger, mode: event.target.value as "full" | "minimal" }; setConfig({ ...config, wakeTriggers: items }); }}><option value="full">完整模式</option><option value="minimal">极简模式</option></select>
          <button onClick={() => setConfig({ ...config, wakeTriggers: config.wakeTriggers.filter((_, item) => item !== index) })}><Trash2 size={17} /></button>
        </div>)}</div>
        <ScreenTest />
      </>}

      {mode === "voice" && <div className="mt-8 max-w-2xl space-y-5">
        <Toggle label="启用语音助手" checked={config.voice.enabled} onChange={(enabled) => setConfig({ ...config, voice: { ...config.voice, enabled } })} />
        <Toggle label="启用语音唤醒词" checked={config.voice.wakeWord} onChange={(wakeWord) => setConfig({ ...config, voice: { ...config.voice, wakeWord } })} />
        <Toggle label="长按 Win 唤醒" checked={config.voice.winKey} onChange={(winKey) => setConfig({ ...config, voice: { ...config.voice, winKey } })} />
        <Label text="语音后端 API 地址"><input className={field} placeholder="https://voice.lan/api" value={config.voice.endpoint} onChange={(event) => setConfig({ ...config, voice: { ...config.voice, endpoint: event.target.value } })} /></Label>
        <Label text="语音触发长按阈值（毫秒）"><input type="number" className={field} value={config.idle.voiceLongPressMs} onChange={(event) => setConfig({ ...config, idle: { ...config.idle, voiceLongPressMs: Number(event.target.value) } })} /></Label>
        <p className="text-sm leading-7 text-[var(--muted)]">此页只保存接入合同。未部署受信任的语音容器前，不会打开麦克风或发送音频。</p>
      </div>}

      {!readOnly && <div className="mt-10 flex items-center gap-4 border-t border-white/10 pt-6"><button onClick={save} className="focus-ring flex items-center gap-2 rounded-xl bg-[var(--blue)] px-5 py-3 font-semibold text-black"><Save size={17} />保存更改</button><span className="text-sm text-[var(--muted)]">{status}</span></div>}
      {picker && <EntityPicker key={`${picker.target.type}-${"key" in picker.target ? picker.target.key : "weather"}`} picker={picker} catalog={catalog} onClose={() => setPicker(null)} onApply={applyPicker} />}
    </div>
  );
}

function Header({ mode }: { mode: "dashboard" | "rules" | "voice" }) {
  const map = { dashboard: ["表盘页面编辑器", "绑定 HA 实体并组织表盘内容"], rules: ["交互与省电规则", "控制超时、按键和 HA 唤醒事件"], voice: ["语音助手", "选择唤醒方式并连接独立语音服务"] };
  return <header><p className="mb-2 text-sm text-[var(--blue)]">配置</p><h2 className="m-0 font-display text-4xl font-semibold tracking-[-.05em]">{map[mode][0]}</h2><p className="text-sm text-[var(--muted)]">{map[mode][1]}</p></header>;
}
function Label({ text, children }: { text: string; children: ReactNode }) { return <label className="block text-sm text-[var(--muted)]"><span className="mb-2 block">{text}</span>{children}</label>; }
function BindingField({ text, value, catalog, readOnly, onOpen }: { text:string; value:string[]; catalog:HaCatalog|null; readOnly:boolean; onOpen:()=>void }) {
  const names = value.map((id) => catalog?.entities.find((item) => item.entityId === id)?.name || id);
  return <button type="button" disabled={readOnly} onClick={onOpen} className="binding-field focus-ring group text-left disabled:cursor-default"><span>{text}</span><div>{names.length ? <b title={names.join("、")}>{names.length === 1 ? names[0] : `${names[0]} 等 ${names.length} 项`}</b> : <b className="empty">未绑定</b>}<small>{value.length ? value.join(" · ") : "从 HA 设备树中选择"}</small></div><ChevronRight size={17}/></button>;
}
function EntityPicker({ picker, catalog, onClose, onApply }: { picker:PickerState; catalog:HaCatalog|null; onClose:()=>void; onApply:(ids:string[])=>void }) {
  const [query,setQuery] = useState("");
  const [selected,setSelected] = useState(picker.selected);
  const [manual,setManual] = useState("");
  const multiple = picker.target.type === "list";
  const entities = useMemo(() => (catalog?.entities ?? []).filter((item) => !item.disabled && (!picker.domains.length || picker.domains.includes(item.domain)) && `${item.name} ${item.entityId} ${item.areaName ?? ""}`.toLowerCase().includes(query.toLowerCase())).sort((a,b) => (a.areaName ?? "未分区").localeCompare(b.areaName ?? "未分区","zh-CN") || a.name.localeCompare(b.name,"zh-CN")), [catalog,picker.domains,query]);
  const toggle = (id:string) => setSelected((current) => multiple ? current.includes(id) ? current.filter((item) => item !== id) : [...current,id] : [id]);
  const addManual = () => { const id=manual.trim(); if(!/^[a-z_]+\.[a-z0-9_]+$/i.test(id)) return; setSelected((current) => multiple ? [...new Set([...current,id])] : [id]); setManual(""); };
  return <div className="entity-picker-backdrop fixed inset-0 z-50 grid place-items-center p-4" onPointerDown={(event) => event.target===event.currentTarget&&onClose()}><section className="entity-picker flex max-h-[86dvh] w-full max-w-3xl flex-col overflow-hidden rounded-[1.8rem] border border-white/10 bg-[#151920] shadow-2xl"><header className="flex items-start justify-between gap-4 border-b border-white/[.08] p-5 sm:p-6"><div><h3 className="m-0 text-xl font-semibold tracking-[-.03em]">{picker.title}</h3><p className="mb-0 mt-1.5 text-xs text-[var(--muted)]">{multiple ? "可以选择多个实体" : "此项只能选择一个实体"} · 已选择 {selected.length} 项</p></div><button type="button" onClick={onClose} className="rounded-full bg-white/[.06] p-2"><X size={18}/></button></header><div className="border-b border-white/[.08] p-4 sm:px-6"><label className="relative block"><Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30" size={16}/><input autoFocus value={query} onChange={(event)=>setQuery(event.target.value)} className="field pl-10!" placeholder="按名称、实体 ID 或空间搜索"/></label>{selected.length>0&&<div className="selected-entity-row mt-3 flex gap-2 overflow-x-auto">{selected.map((id)=><button type="button" key={id} onClick={()=>setSelected((current)=>current.filter((item)=>item!==id))} title={`移除 ${id}`}><span>{catalog?.entities.find((item)=>item.entityId===id)?.name||id}</span><X size={12}/></button>)}</div>}</div><div className="entity-picker-list min-h-44 flex-1 overflow-y-auto p-3 sm:p-4">{entities.length ? <div className="grid gap-2 sm:grid-cols-2">{entities.map((entity)=>{const active=selected.includes(entity.entityId);return <button type="button" key={entity.entityId} onClick={()=>toggle(entity.entityId)} className={`entity-choice ${active?"active":""}`}><span className="entity-choice-check">{active&&<Check size={14}/>}</span><span className="min-w-0"><b>{entity.name}</b><small>{entity.areaName ?? "未分区"} · {entity.entityId}</small></span></button>})}</div>:<div className="grid min-h-40 place-items-center text-center text-sm text-[var(--muted)]">{catalog ? "当前分类中没有匹配实体" : "正在读取 HA 实体目录"}</div>}</div><div className="flex flex-col gap-3 border-t border-white/[.08] bg-black/10 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div className="flex min-w-0 flex-1 gap-2"><input value={manual} onChange={(event)=>setManual(event.target.value)} onKeyDown={(event)=>event.key==="Enter"&&addManual()} className="field min-w-0" placeholder="也可输入完整实体 ID"/><button type="button" onClick={addManual} className="rounded-xl bg-white/[.07] px-3 text-xs whitespace-nowrap">加入</button></div><div className="flex justify-end gap-2"><button type="button" onClick={()=>setSelected([])} className="rounded-xl px-3 py-2.5 text-sm text-[var(--muted)]">清空</button><button type="button" onClick={onClose} className="rounded-xl px-3 py-2.5 text-sm text-[var(--muted)]">取消</button><button type="button" onClick={()=>onApply(selected)} className="rounded-xl bg-[var(--blue)] px-4 py-2.5 text-sm font-semibold text-[#07101f]">应用选择</button></div></div></section></div>;
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[.025] p-4"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="size-5" /></label>; }
function ScreenTest() { async function act(action: "on" | "off") { await fetch("/api/system/display", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf() }, body: JSON.stringify({ action, source: "admin" }) }); } return <div className="mt-8 rounded-2xl border border-white/10 p-5"><h3 className="mt-0">屏幕控制测试</h3><div className="flex gap-3"><button onClick={() => act("on")} className="rounded-xl bg-white px-4 py-2 text-sm text-black">点亮</button><button onClick={() => act("off")} className="rounded-xl bg-white/10 px-4 py-2 text-sm">熄屏</button></div></div>; }
