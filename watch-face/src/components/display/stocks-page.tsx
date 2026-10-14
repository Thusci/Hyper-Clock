"use client";

import { useState } from "react";
import { BarChart3, TrendingDown, TrendingUp } from "lucide-react";
import type { AppConfig, HassEntityMap, HistoryMap } from "@/types/config";
import { formatStockNumber, resolveStockIds, stockChange, stockCurrency, stockDirection, stockNumber, stockPercent, stockPrice, stockSymbol, stockText } from "@/lib/stocks";
import { PageHeader } from "./page-header";

function points(values: number[]) {
  if (values.length < 2) return "";
  const min = Math.min(...values), max = Math.max(...values), range = max - min || 1;
  return values.map((value, index) => `${(index / (values.length - 1)) * 100},${92 - ((value - min) / range) * 76}`).join(" ");
}

function Sparkline({ values, compact = false }: { values: number[]; compact?: boolean }) {
  const path = points(values);
  if (!path) return compact ? <span className="mini-chart-empty"/> : <div className="stock-chart-empty">等待 HA 历史数据形成趋势</div>;
  const positive = values.at(-1)! >= values[0];
  return <svg className={`${compact ? "stock-mini-chart" : "stock-chart"} ${positive ? "positive" : "negative"}`} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points={path} fill="none" stroke="currentColor" strokeWidth={compact ? 4 : 2} vectorEffect="non-scaling-stroke"/></svg>;
}

export function StocksPage({ config, entities, history }: { config: AppConfig; entities: HassEntityMap; history: HistoryMap }) {
  const ids = resolveStockIds(config.entities.stocks, entities);
  const [selected, setSelected] = useState(0);
  const activeIndex = Math.min(selected, Math.max(0, ids.length - 1));
  const id = ids[activeIndex];
  const entity = entities[id];
  const values = history[id]?.map((point) => Number(point.state)).filter(Number.isFinite) ?? [];
  if (!ids.length) return <section className="stocks-layout h-full"><PageHeader kicker="Markets · 行情" title="行情" tone="amber" /><div className="glass page-empty rounded-[var(--r-xl)]"><div><BarChart3 className="mx-auto mb-5 text-[var(--blue)]" size={42}/><h2 className="m-0 text-3xl">等待股票实体</h2><p className="mt-3 text-sm leading-7 text-[var(--muted)]">在后台绑定 HACS Yahoo Finance 创建的传感器后，这里会读取当前价格和 HA 24 小时历史记录。</p></div></div></section>;

  const price = stockPrice(entity), change = stockChange(entity), percent = stockPercent(entity), positive = stockDirection(entity, values) >= 0;
  const Icon = positive ? TrendingUp : TrendingDown;
  const metrics = [
    ["开盘", stockNumber(entity, "regularMarketOpen")], ["当日最高", stockNumber(entity, "regularMarketDayHigh")],
    ["当日最低", stockNumber(entity, "regularMarketDayLow")], ["前收盘", stockNumber(entity, "regularMarketPreviousClose")],
    ["52 周最高", stockNumber(entity, "fiftyTwoWeekHigh")], ["成交量", stockNumber(entity, "regularMarketVolume")],
  ] as const;

  return <section className="stocks-layout h-full p-7 xl:p-9"><PageHeader kicker="Markets · 行情" title="行情" tone="amber" aside="Yahoo Finance 实体 · HA 24 小时历史" /><div className="stocks-dashboard grid min-h-0 grid-cols-[22rem_1fr] gap-4"><aside className="glass stock-list min-h-0 overflow-y-auto rounded-[var(--r-xl)] p-3">{ids.map((stockId, index) => { const item = entities[stockId]; const itemValues = history[stockId]?.map((point) => Number(point.state)).filter(Number.isFinite) ?? []; const direction = stockDirection(item, itemValues); const move = stockChange(item); return <button key={stockId} onClick={() => setSelected(index)} className={`stock-picker ${index === selected ? "active" : ""}`}><span className="stock-symbol"><b>{stockSymbol(item, stockId)}</b><small>{String(item?.attributes.friendly_name ?? stockCurrency(item) ?? "")}</small></span><Sparkline values={itemValues} compact/><span className="stock-quote"><b>{formatStockNumber(stockPrice(item))}</b><small className={direction >= 0 ? "positive" : "negative"}>{move == null ? "--" : `${move >= 0 ? "+" : ""}${move.toFixed(2)}`}</small></span></button>; })}</aside><article className="glass stock-detail relative min-h-0 overflow-hidden rounded-[var(--r-xl)] p-7"><div className="flex items-start justify-between gap-5"><div><div className="flex items-center gap-2"><p className="card-kicker">{stockSymbol(entity, id)}</p><span className="stock-market-state">{stockText(entity, "marketState") || "市场状态未知"}</span></div><strong className="mt-2 block font-display text-6xl tracking-[-.07em]">{formatStockNumber(price)}<small className="ml-2 text-base font-medium text-[var(--muted)]">{stockCurrency(entity)}</small></strong></div><span className={`stock-move ${positive ? "positive" : "negative"}`}><Icon size={18}/>{change == null ? "--" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}`} {percent == null ? "" : `${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%`}</span></div><div className="mt-5 h-[46%]"><Sparkline values={values}/></div><div className="stock-stats mt-4 grid grid-cols-6 gap-2">{metrics.map(([label, value]) => <div key={label}><span>{label}</span><b>{formatStockNumber(value, value && Math.abs(value) >= 100_000 ? 0 : 2)}</b></div>)}</div></article></div></section>;
}
