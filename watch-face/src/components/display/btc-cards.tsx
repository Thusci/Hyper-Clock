"use client";

import { useEffect, useMemo, useState } from "react";
import { Bitcoin, Trophy } from "lucide-react";
import type { BtcAccount, BtcFeed } from "@/types/config";

/**
 * BTC-HARVA on the home face (feed `btc`, see back-stage/src/server/harva.ts).
 *
 *   BtcTrendCard     the long one: BTC/USDT, 24 h change and the last 24 h as a hairline chart
 *   BtcAccountsCard  the small one: rolls through the totals and every virtual account (W/L, P&L)
 *
 * Both render the last known values when HARVA is unreachable and say how old they are;
 * they never blank out on a failed refresh.
 */
const STALE_MS = 2 * 60_000;
const ROLL_MS = 6000;

const usd = (value: number, digits = 0) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
const signedUsd = (value: number | null) => value == null ? "--" : `${value > 0 ? "+" : value < 0 ? "−" : ""}${usd(Math.abs(value), 2)}`;
const clock = (iso: string | null, timezone: string) => iso ? new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)) : "--:--";
const tone = (value: number | null) => value == null || value === 0 ? "" : value > 0 ? "up" : "down";

function useNow(everyMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(timer);
  }, [everyMs]);
  return now;
}

/** Line and area paths for a 300×64 box; the live price, when newer, extends the last point. */
function sparkline(closes: number[], live: number | null) {
  const values = live != null ? [...closes, live] : closes;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || 1;
  const x = (index: number) => (index / Math.max(1, values.length - 1)) * 300;
  const y = (value: number) => 4 + (1 - (value - low) / span) * 56;
  const line = values.map((value, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join("");
  return { line, area: `${line}L300,64L0,64Z`, end: { x: 300, y: y(values.at(-1)!) }, base: y(values[0]) };
}

export function BtcTrendCard({ btc, timezone }: { btc: BtcFeed; timezone: string }) {
  const now = useNow(15_000);
  const price = btc.price ?? btc.day?.closes.at(-1) ?? null;
  const open = btc.day?.open ?? null;
  const change = price != null && open ? (price - open) / open : null;
  const path = useMemo(() => btc.day && btc.day.closes.length > 1 ? sparkline(btc.day.closes, btc.price) : null, [btc.day, btc.price]);
  const stale = !btc.priceAt || now - new Date(btc.priceAt).getTime() > STALE_MS;
  const direction = tone(change);

  return (
    <article className={`glass ambient-card btc-trend-card rounded-[var(--r-lg)] ${direction}`}>
      <div className="btc-head">
        <span className="ambient-label"><Bitcoin size={13} />BTC / USDT</span>
        <span className={`btc-live ${stale ? "stale" : ""}`}>{stale ? `缓存 · ${clock(btc.priceAt, timezone)}` : "24H"}</span>
      </div>
      <div className="btc-price-row">
        <strong className="btc-price">{price == null ? "--" : usd(price)}</strong>
        <span className={`btc-change ${direction}`}>{change == null ? "" : `${change >= 0 ? "+" : "−"}${Math.abs(change * 100).toFixed(2)}%`}</span>
      </div>
      {path && btc.day ? (
        <div className="btc-chart">
          <div className="btc-plot">
            <svg viewBox="0 0 300 64" preserveAspectRatio="none" aria-hidden="true">
              <line className="btc-open" x1="0" x2="300" y1={path.base} y2={path.base} />
              <path className="btc-area" d={path.area} />
              <path className="btc-line" d={path.line} />
            </svg>
            <i className="btc-dot" style={{ top: `${(path.end.y / 64) * 100}%` }} />
          </div>
          <div className="btc-scale"><span>高 {usd(btc.day.high)}</span><span>低 {usd(btc.day.low)}</span></div>
        </div>
      ) : <p className="ambient-detail">{btc.error ? "BTC-HARVA 暂不可达" : "等待 BTC-HARVA 行情"}</p>}
    </article>
  );
}

type Slide = { key: string; title: string; badge?: string; wins: number; losses: number; winRate: number | null; pnl: number | null; detail: string };

function accountSlide(account: BtcAccount): Slide {
  const streak = account.streak ? ` · ${account.streak.kind.toUpperCase() === "WIN" ? "连胜" : account.streak.kind.toUpperCase() === "LOSS" ? "连败" : "连续"} ${account.streak.n}` : "";
  return {
    key: `account-${account.id}`,
    title: account.name,
    badge: account.mode === "ai" ? "AI" : "规则",
    wins: account.wins,
    losses: account.losses,
    winRate: account.winRate,
    pnl: account.pnl,
    detail: `${account.windowsTraded} 个窗口${account.openPositions ? ` · 持仓 ${account.openPositions}` : ""}${streak}${account.active ? "" : " · 已停用"}`,
  };
}

export function BtcAccountsCard({ btc, timezone }: { btc: BtcFeed; timezone: string }) {
  const slides = useMemo<Slide[]>(() => {
    const accounts = btc.accounts;
    if (!accounts.length) return [];
    const wins = accounts.reduce((sum, account) => sum + account.wins, 0);
    const losses = accounts.reduce((sum, account) => sum + account.losses, 0);
    const pnl = accounts.reduce((sum, account) => sum + (account.pnl ?? 0), 0);
    const total: Slide = { key: "total", title: "全部账户", badge: `${accounts.length}`, wins, losses, winRate: wins + losses ? wins / (wins + losses) : null, pnl, detail: `更新 ${clock(btc.accountsAt, timezone)}` };
    return accounts.length > 1 ? [total, ...accounts.map(accountSlide)] : [{ ...accountSlide(accounts[0]), detail: `${accountSlide(accounts[0]).detail} · ${clock(btc.accountsAt, timezone)}` }];
  }, [btc.accounts, btc.accountsAt, timezone]);
  // Follow the slide by key, so an account appearing or disappearing does not make the card skip.
  const [activeKey, setActiveKey] = useState("total");
  const index = Math.max(0, slides.findIndex((slide) => slide.key === activeKey));
  const slide = slides[index];

  useEffect(() => {
    if (slides.length < 2) return;
    const timer = window.setInterval(() => setActiveKey((current) => {
      const at = slides.findIndex((item) => item.key === current);
      return slides[(at + 1) % slides.length].key;
    }), ROLL_MS);
    return () => window.clearInterval(timer);
  }, [slides]);

  return (
    <article className="glass ambient-card btc-accounts-card relative rounded-[var(--r-lg)]" aria-live="off">
      <span className="ambient-label"><Trophy size={13} />虚拟账户</span>
      {slide ? (
        <div key={slide.key} className="dynamic-card-content btc-slide">
          <span className="btc-slide-title">{slide.title}{slide.badge && <em>{slide.badge}</em>}</span>
          <strong className={`btc-pnl ${tone(slide.pnl)}`}>{signedUsd(slide.pnl)}</strong>
          <span className="btc-wl"><b className="up">{slide.wins} 胜</b><b className="down">{slide.losses} 负</b>{slide.winRate != null && <i>{Math.round(slide.winRate * 100)}%</i>}</span>
          <span className="btc-slide-detail">{slide.detail}</span>
        </div>
      ) : <p className="ambient-detail">{btc.error ? "BTC-HARVA 暂不可达" : "没有可读取的账户"}</p>}
      {slides.length > 1 && <div key={`progress-${slide?.key}`} className="card-progress absolute inset-x-0 bottom-0 h-[2px]" style={{ animationDuration: `${ROLL_MS}ms` }} />}
    </article>
  );
}
