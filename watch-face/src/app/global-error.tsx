"use client";

import { useEffect } from "react";

/** The root layout itself failed: nothing of the face can render, so reload after a pause. */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error("[hyper-clock] root layout crashed", error);
    const timer = window.setTimeout(() => window.location.reload(), 10_000);
    return () => window.clearTimeout(timer);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body style={{ margin: 0, minHeight: "100dvh", display: "grid", placeItems: "center", background: "#0d0c0b", color: "#a39d94", font: "14px system-ui, sans-serif" }}>
        <title>Hyper Clock</title>
        <p>表盘正在恢复…</p>
      </body>
    </html>
  );
}
