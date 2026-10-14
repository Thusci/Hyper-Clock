import "server-only";
import { env, harvaConfigured } from "./env";
import type { BtcAccount, BtcDay, BtcFeed } from "@/types";

/**
 * Read-only client for BTC-HARVA (the BTC "Up or Down" analytics service on the LAN).
 *
 * The API keys stay here; the watch face only ever sees the merged `BtcFeed`. Each part
 * refreshes on its own cadence and keeps its last good value (with its own timestamp) when
 * a request fails, so a HARVA restart shows slightly old numbers instead of blanks.
 *
 *   price     GET /api/ha/state                        every load (15 s)
 *   accounts  GET /api/ha/accounts, once per API key   every 30 s, merged and de-duplicated
 *   day       GET /api/market/series?tf=5m&minutes=1440 every 5 min, last 24 h of 5-minute closes
 */
const TIMEOUT_MS = 8000;
const ACCOUNTS_EVERY_MS = 30_000;
const DAY_EVERY_MS = 5 * 60_000;
const DAY_MINUTES = 24 * 60;

type HaState = { ready?: boolean; ts?: number | null; btc_binance?: number | null; btc_chainlink?: number | null; feeds_ok?: boolean };
type HaAccount = { id: number; name: string; mode?: string; active?: boolean; equity?: number | null; pnl?: number | null; win_rate?: number | null; windows_traded?: number; wins?: number; losses?: number; streak_kind?: string | null; streak_n?: number; open_positions?: number };
type Series = { ts?: number[]; c?: number[] };

async function get<T>(path: string, key: string): Promise<T> {
  const { HARVA_URL } = env();
  const response = await fetch(`${HARVA_URL}${path}`, { headers: { authorization: `Bearer ${key}` }, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`BTC-HARVA ${path}: HTTP ${response.status}`);
  return await response.json() as T;
}

const num = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
const age = (iso: string | null | undefined) => iso ? Date.now() - new Date(iso).getTime() : Infinity;

async function loadDay(key: string): Promise<BtcDay | null> {
  const series = await get<Series>(`/api/market/series?tf=5m&minutes=${DAY_MINUTES}`, key);
  const ts = series.ts ?? [];
  const closes = series.c ?? [];
  const points = ts.map((time, index) => [time, closes[index]] as const).filter((point): point is readonly [number, number] => Number.isFinite(point[0]) && Number.isFinite(point[1]));
  if (points.length < 2) return null;
  const values = points.map((point) => point[1]);
  return {
    start: points[0][0] * 1000,
    end: points.at(-1)![0] * 1000,
    open: values[0],
    high: Math.max(...values),
    low: Math.min(...values),
    closes: values.map((value) => Math.round(value * 100) / 100),
  };
}

async function loadAccounts(keys: string[]) {
  const results = await Promise.allSettled(keys.map((key) => get<{ accounts?: HaAccount[] }>("/api/ha/accounts", key)));
  const ok = results.filter((result): result is PromiseFulfilledResult<{ accounts?: HaAccount[] }> => result.status === "fulfilled");
  if (!ok.length) throw (results[0] as PromiseRejectedResult).reason;
  const byId = new Map<number, BtcAccount>();
  for (const result of ok) {
    for (const account of result.value.accounts ?? []) {
      // Two keys of the same HARVA user see the same accounts; the first copy wins.
      if (byId.has(account.id)) continue;
      byId.set(account.id, {
        id: account.id,
        name: account.name,
        mode: account.mode ?? "rules",
        active: account.active !== false,
        equity: num(account.equity),
        pnl: num(account.pnl),
        winRate: num(account.win_rate),
        windowsTraded: account.windows_traded ?? 0,
        wins: account.wins ?? 0,
        losses: account.losses ?? 0,
        streak: account.streak_kind && account.streak_n ? { kind: account.streak_kind, n: account.streak_n } : null,
        openPositions: account.open_positions ?? 0,
      });
    }
  }
  return { accounts: [...byId.values()].sort((a, b) => a.id - b.id), partial: ok.length < keys.length };
}

/** One refresh. `previous` is the last value the hub holds (possibly from the disk cache). */
export async function loadBtc(previous: BtcFeed | null | undefined): Promise<BtcFeed | null> {
  if (!harvaConfigured()) return null;
  const { HARVA_API_KEYS } = env();
  const key = HARVA_API_KEYS[0];
  const next: BtcFeed = {
    price: previous?.price ?? null,
    chainlink: previous?.chainlink ?? null,
    priceAt: previous?.priceAt ?? null,
    day: previous?.day ?? null,
    dayAt: previous?.dayAt ?? null,
    accounts: previous?.accounts ?? [],
    accountsAt: previous?.accountsAt ?? null,
    feedsOk: previous?.feedsOk ?? false,
    error: null,
  };
  const errors: string[] = [];
  const now = new Date().toISOString();

  const tasks: Promise<void>[] = [
    get<HaState>("/api/ha/state", key).then((state) => {
      const price = num(state.btc_binance);
      if (price != null) {
        next.price = price;
        next.chainlink = num(state.btc_chainlink);
        next.priceAt = state.ts ? new Date(state.ts * 1000).toISOString() : now;
      }
      next.feedsOk = Boolean(state.feeds_ok);
    }),
  ];
  if (age(next.accountsAt) >= ACCOUNTS_EVERY_MS) {
    tasks.push(loadAccounts(HARVA_API_KEYS).then(({ accounts, partial }) => {
      next.accounts = accounts;
      next.accountsAt = now;
      if (partial) errors.push("some API keys were refused");
    }));
  }
  if (age(next.dayAt) >= DAY_EVERY_MS) {
    tasks.push(loadDay(key).then((day) => {
      if (day) { next.day = day; next.dayAt = now; }
    }));
  }
  for (const result of await Promise.allSettled(tasks)) {
    if (result.status === "rejected") errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
  }
  next.error = errors.length ? errors.join("; ") : null;
  return next;
}
