"use client";

import { useEffect } from "react";

/**
 * Last line of defence below the root layout. The kiosk has no one to press a button,
 * so it re-renders after a few seconds and reloads the page if that keeps failing.
 */
export default function FaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[hyper-clock] watch face crashed", error);
    const key = "hyper-clock:crash-retries";
    let tries = 0;
    try { tries = Number(window.sessionStorage.getItem(key) ?? 0); window.sessionStorage.setItem(key, String(tries + 1)); } catch { /* best effort */ }
    const timer = window.setTimeout(() => tries < 3 ? reset() : window.location.reload(), tries < 3 ? 4000 : 15_000);
    // A face that stays up for a minute is healthy again.
    const clear = window.setTimeout(() => { try { window.sessionStorage.removeItem(key); } catch { /* best effort */ } }, 60_000);
    return () => { window.clearTimeout(timer); window.clearTimeout(clear); };
  }, [error, reset]);

  return <main className="display-shell grid min-h-dvh place-items-center"><p className="text-sm text-[var(--muted)]">表盘正在恢复…</p></main>;
}
