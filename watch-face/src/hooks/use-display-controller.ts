"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppConfig, DisplayMode } from "@/types/config";

export function useDisplayController(config: AppConfig, pageCount: number) {
  const [mode, setMode] = useState<DisplayMode>("full");
  const [page, setPage] = useState(0);
  const pressedAt = useRef<number | null>(null);
  const minimalTimer = useRef(0);
  const offTimer = useRef(0);

  const sendDisplay = useCallback((action: "on" | "off") => {
    void fetch("/api/control", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "display", action }),
    });
  }, []);

  const armTimers = useCallback(() => {
    window.clearTimeout(minimalTimer.current);
    window.clearTimeout(offTimer.current);
    minimalTimer.current = window.setTimeout(() => setMode("minimal"), config.idle.minimalAfterMs);
    offTimer.current = window.setTimeout(() => {
      setMode("off");
      sendDisplay("off");
    }, config.idle.screenOffAfterMs);
  }, [config.idle.minimalAfterMs, config.idle.screenOffAfterMs, sendDisplay]);

  const wake = useCallback(() => {
    if (mode === "off") sendDisplay("on");
    setMode("full");
    armTimers();
  }, [armTimers, mode, sendDisplay]);

  const externalWake = useCallback((target: Exclude<DisplayMode, "off">) => {
    setMode((current) => {
      if (current === "off") sendDisplay("on");
      return target;
    });
    armTimers();
  }, [armTimers, sendDisplay]);

  useEffect(() => {
    armTimers();
    return () => { window.clearTimeout(minimalTimer.current); window.clearTimeout(offTimer.current); };
  }, [armTimers]);

  useEffect(() => {
    const isPageKey = (key: string) => ["Meta", "Super", "OS", "AudioVolumeUp", "AudioVolumeDown"].includes(key);
    const onDown = (event: KeyboardEvent) => {
      if (!isPageKey(event.key) || event.repeat) return;
      event.preventDefault();
      if (mode !== "full") wake();
      pressedAt.current = performance.now();
    };
    const onUp = (event: KeyboardEvent) => {
      if (!isPageKey(event.key) || pressedAt.current === null) return;
      event.preventDefault();
      const held = performance.now() - pressedAt.current;
      pressedAt.current = null;
      if (["Meta", "Super", "OS"].includes(event.key) && held >= config.idle.winLongPressMs) {
        if (config.voice.enabled && held < config.idle.minimalLongPressMs) {
          window.dispatchEvent(new CustomEvent("hyperclock:voice"));
        } else {
          setMode((current) => current === "minimal" ? "full" : "minimal");
        }
      } else if (mode === "full") {
        const direction = event.key === "AudioVolumeDown" ? -1 : 1;
        setPage((current) => (current + direction + pageCount) % pageCount);
      }
      armTimers();
    };
    window.addEventListener("keydown", onDown, { capture: true });
    window.addEventListener("keyup", onUp, { capture: true });
    return () => {
      window.removeEventListener("keydown", onDown, { capture: true });
      window.removeEventListener("keyup", onUp, { capture: true });
    };
  }, [armTimers, config.idle.minimalLongPressMs, config.idle.winLongPressMs, config.voice.enabled, mode, pageCount, wake]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const activePage = config.pages.filter((item) => item.enabled)[page]?.id ?? "home";
      void fetch("/api/control", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "kiosk", mode, page: activePage }) });
    }, 30000);
    return () => window.clearInterval(timer);
  }, [config.pages, mode, page]);

  return { mode, page, setPage, wake, externalWake };
}
