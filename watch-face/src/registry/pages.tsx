import type { ComponentType } from "react";
import { CalendarPage } from "@/components/display/calendar-page";
import { DevicesPage } from "@/components/display/devices-page";
import { HomePage } from "@/components/display/home-page";
import { PageHeader } from "@/components/display/page-header";
import { SchedulePage } from "@/components/display/schedule-page";
import { SensorsPage } from "@/components/display/sensors-page";
import { StocksPage } from "@/components/display/stocks-page";
import { SystemPage } from "@/components/display/system-page";
import { WeatherPage } from "@/components/display/weather-page";
import type { SolarState } from "@/hooks/use-solar-theme";
import type { AppConfig, FeedMap, HaCatalog, HassEntityMap } from "@/types/config";

/**
 * Everything a page may read. Pages take what they need; the watch face passes all of it.
 */
export type PageProps = {
  config: AppConfig;
  entities: HassEntityMap;
  catalog: HaCatalog;
  feeds: FeedMap;
  status: "connecting" | "connected" | "offline";
  solar: SolarState;
  usingCache: boolean;
  cachedAt: string | null;
};

/**
 * Page registry — the single extension point of the watch face.
 *
 * To add a page:
 *   1. build a component that accepts PageProps (or adapt an existing one below),
 *   2. register it here under a new kind,
 *   3. add the same kind to back-stage/src/shared/page-kinds.ts so the admin can enable it.
 * New back-end data arrives through `feeds[name]`, so no plumbing is needed in between.
 */
export const pageRegistry: Record<string, ComponentType<PageProps>> = {
  home: (p) => <HomePage config={p.config} entities={p.entities} catalog={p.catalog} agenda={p.feeds.agenda ?? {}} forecast={p.feeds.weather ?? null} btc={p.feeds.btc ?? null} status={p.status} solar={p.solar} usingCache={p.usingCache} cachedAt={p.cachedAt} />,
  weather: (p) => <WeatherPage config={p.config} entities={p.entities} forecast={p.feeds.weather ?? null} solar={p.solar} />,
  devices: (p) => <DevicesPage entities={p.entities} catalog={p.catalog} />,
  schedule: (p) => <SchedulePage config={p.config} agenda={p.feeds.agenda ?? {}} />,
  calendar: (p) => <CalendarPage config={p.config} agenda={p.feeds.agenda ?? {}} />,
  system: (p) => <SystemPage config={p.config} entities={p.entities} status={p.status} usingCache={p.usingCache} />,
  stocks: (p) => <StocksPage config={p.config} entities={p.entities} history={p.feeds.history ?? {}} />,
  sensors: (p) => <SensorsPage config={p.config} entities={p.entities} />,
};

function UnknownPage({ kind }: { kind: string }) {
  return (
    <section className="sensors-page h-full">
      <PageHeader kicker="Update · 需要更新" title="此页面暂不可用" tone="amber" />
      <div className="glass page-empty rounded-[var(--r-xl)]"><p className="m-0 text-sm text-[var(--muted)]">表盘尚未包含 “{kind}” 页面，请更新 watch-face。</p></div>
    </section>
  );
}

export function renderPage(kind: string, props: PageProps) {
  const Page = pageRegistry[kind];
  return Page ? <Page {...props} /> : <UnknownPage kind={kind} />;
}
