"use client";

import { type CSSProperties, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Multigraph } from "./multigraph";
import { SafeBoundary } from "./safe-boundary";
import { SkyField } from "./sky-field";
import { VoiceOverlay } from "./voice-overlay";
import { useDisplayController } from "@/hooks/use-display-controller";
import { renderPage } from "@/registry/pages";
import { useHaStream } from "@/hooks/use-ha-stream";
import { useSolarTheme } from "@/hooks/use-solar-theme";
import { householdCatalog } from "@/lib/catalog";
import { resolveWeatherSnapshot } from "@/lib/weather-source";
import type { AppConfig } from "@/types/config";

export function WatchFace({ initialConfig, controlUrl }: { initialConfig: AppConfig; controlUrl: string }) {
  const [config, setConfig] = useState(initialConfig);
  const [voiceVisible, setVoiceVisible] = useState(false);
  const voiceTimer = useRef(0);
  const swipe = useRef<{ id: number; x: number; y: number; at: number; axis: "pending" | "horizontal" | "vertical" } | null>(null);
  const dragFrame = useRef(0);
  const pendingDrag = useRef(0);
  const [dragX, setDragX] = useState(0);
  const [skyReady, setSkyReady] = useState(false);
  const [hudPage, setHudPage] = useState<number | null>(null);
  const lastPage = useRef<number | null>(null);
  const pages = useMemo(() => {
    const enabled = config.pages.filter((item) => item.enabled);
    return enabled.length ? enabled : config.pages.slice(0, 1);
  }, [config.pages]);
  const controller = useDisplayController(config, pages.length);
  const activePageIndex = Math.min(controller.page, Math.max(0, pages.length - 1));
  const { externalWake } = controller;
  const acceptConfig = useCallback((next: AppConfig) => setConfig(next), []);
  const acceptWake = useCallback((mode: "full" | "minimal") => externalWake(mode), [externalWake]);
  const { entities, catalog: rawCatalog, feeds, status, usingCache, cachedAt } = useHaStream(controlUrl, acceptConfig, acceptWake);
  // Pages see only household devices; iBeacon passers-by are filtered once here (lib/catalog.ts).
  const catalog = useMemo(() => householdCatalog(rawCatalog), [rawCatalog]);
  const solar = useSolarTheme(entities, config.timezone, config.theme.burnInShift);
  const condition = resolveWeatherSnapshot(entities, config.weatherEntity, feeds.weather?.entityId).condition;
  const sunUp = solar.above;
  // The Q775's own ambient-light sensor (q775_bridge) dims the face in a dark room.
  const lux = Number(Object.values(entities).find((entity) => /^sensor\.q775_.*_(ambient_light|illuminance_calculated)$/.test(entity.entity_id))?.state);
  const dim = !Number.isFinite(lux) ? 0 : lux < 1 ? .5 : lux < 5 ? .36 : lux < 15 ? .2 : lux < 40 ? .08 : 0;
  const shellStyle = {
    "--accent": config.theme.accent,
    "--card-alpha": String(.3 + config.theme.cardOpacity / 180),
    "--drift-x": `${solar.offsetX}px`,
    "--drift-y": `${solar.offsetY}px`,
    // Cards light themselves from the same point as the sky's sun (or moon), keeping one light source on screen.
    "--light-x": `${Math.round((sunUp ? .12 + Math.min(1, Math.max(0, solar.progress)) * .76 : .78) * 100)}%`,
  } as CSSProperties;

  useEffect(() => {
    // Announce the page only when it changes, not on first paint.
    if (lastPage.current !== null && lastPage.current !== activePageIndex) setHudPage(activePageIndex);
    lastPage.current = activePageIndex;
  }, [activePageIndex]);

  useEffect(() => {
    if (hudPage === null) return;
    const timer = window.setTimeout(() => setHudPage(null), 1500);
    return () => window.clearTimeout(timer);
  }, [hudPage]);

  useEffect(() => {
    const listen = () => {
      window.clearTimeout(voiceTimer.current);
      setVoiceVisible(true);
      voiceTimer.current = window.setTimeout(() => setVoiceVisible(false), 8000);
    };
    window.addEventListener("hyperclock:voice", listen);
    return () => {
      window.removeEventListener("hyperclock:voice", listen);
      window.clearTimeout(voiceTimer.current);
      window.cancelAnimationFrame(dragFrame.current);
    };
  }, []);

  const pointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("button,input,select,textarea,a,[data-no-swipe],.forecast-row,.area-switcher,.device-grid,.integration-grid,.schedule-list,.calendar-agenda,.stock-list")) return;
    swipe.current = { id: event.pointerId, x: event.clientX, y: event.clientY, at: performance.now(), axis: "pending" };
  };
  const pointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const start = swipe.current;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (start.axis === "pending") {
      if (Math.hypot(dx, dy) < 10) return;
      start.axis = Math.abs(dx) > Math.abs(dy) * 1.15 ? "horizontal" : "vertical";
      if (start.axis === "horizontal") event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (start.axis !== "horizontal") return;
    const atStart = activePageIndex === 0 && dx > 0;
    const atEnd = activePageIndex === pages.length - 1 && dx < 0;
    pendingDrag.current = (atStart || atEnd) ? dx * .22 : dx * .72;
    if (!dragFrame.current) dragFrame.current = window.requestAnimationFrame(() => {
      setDragX(pendingDrag.current);
      dragFrame.current = 0;
    });
  };
  const pointerEnd = (event: ReactPointerEvent<HTMLElement>) => {
    const start = swipe.current;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const elapsed = Math.max(performance.now() - start.at, 1);
    if (event.type !== "pointercancel" && start.axis === "horizontal" && (Math.abs(dx) > 64 || Math.abs(dx / elapsed) > .55)) controller.setPage((current) => Math.max(0, Math.min(pages.length - 1, current + (dx < 0 ? 1 : -1))));
    window.cancelAnimationFrame(dragFrame.current);
    dragFrame.current = 0;
    pendingDrag.current = 0;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    swipe.current = null;
    setDragX(0);
  };

  if (controller.mode === "off") {
    return <main className="display-off min-h-dvh" onPointerDown={controller.wake}><span className="sr-only">屏幕已关闭，按任意功能键唤醒</span></main>;
  }

  if (controller.mode === "minimal") {
    return (
      <main className="display-shell power-save grid min-h-dvh place-items-center" style={shellStyle} onPointerDown={controller.wake}>
        <div className="display-drift"><SafeBoundary name="multigraph" retryMs={10_000}><Multigraph locale={config.locale} timezone={config.timezone} entities={entities} weatherEntity={config.weatherEntity} rising={solar.rising} setting={solar.setting} /></SafeBoundary></div>
        <span className="minimal-hint">按任意功能键唤醒</span>
      </main>
    );
  }

  return (
    <main className={`display-shell relative min-h-dvh ${skyReady ? "has-sky" : ""}`} data-solar-phase={solar.phase} style={shellStyle}>
      <SafeBoundary name="sky" retryMs={120_000}><SkyField phase={solar.phase} timezone={config.timezone} condition={condition} progress={solar.progress} sunUp={sunUp} onReady={setSkyReady} /></SafeBoundary>
      {!skyReady && <>
        <div className="ambient-orb ambient-orb-a" aria-hidden="true" />
        <div className="ambient-orb ambient-orb-b" aria-hidden="true" />
      </>}
      <div className="display-drift absolute inset-0 overflow-hidden touch-pan-y" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd}>
        <div className={`page-stage flex h-full ${dragX ? "dragging" : ""}`} style={{ transform: `translate3d(calc(-${activePageIndex * 100}% + ${dragX}px),0,0)` }}>
          {pages.map((page, index) => (
            <div key={page.id} className={`page-panel ${index === activePageIndex ? "active" : index < activePageIndex ? "before" : "after"}`} aria-hidden={activePageIndex !== index}>
              <SafeBoundary name={`page ${page.kind}`}>{renderPage(page.kind, { config, entities, catalog, feeds, status, solar, usingCache, cachedAt })}</SafeBoundary>
            </div>
          ))}
        </div>
      </div>
      <nav className="page-dots absolute bottom-5 left-1/2 z-10 flex -translate-x-1/2 gap-2 rounded-full px-3 py-2" aria-label="表盘页面">
        {pages.map((item, index) => <button key={item.id} onClick={() => controller.setPage(index)} aria-label={item.title} aria-current={activePageIndex === index ? "page" : undefined} className={`focus-ring h-1.5 rounded-full transition-all duration-500 ${activePageIndex === index ? "w-7 bg-[var(--ink)]/80" : "w-1.5 bg-[var(--ink)]/25"}`} />)}
      </nav>
      <div className="ambient-dim" style={{ opacity: dim }} aria-hidden="true" />
      {hudPage !== null && pages[hudPage] && <div key={`hud-${hudPage}`} className="page-hud" role="status">{pages[hudPage].title}<span>{hudPage + 1} / {pages.length}</span></div>}
      {voiceVisible && <VoiceOverlay configured={Boolean(config.voice.endpoint)} onClose={() => setVoiceVisible(false)} />}
    </main>
  );
}
