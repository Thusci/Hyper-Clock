import { NextResponse } from "next/server";
import { env } from "@/server/env";
import { HttpError, route } from "@/server/http";

/** Proxies an HA camera stream so the browser never sees the HA address or token. */
export const GET = route({ access: "user" }, async ({ params }) => {
  const { HA_URL, HA_TOKEN } = env();
  const entityId = params.entityId ?? "";
  if (!/^camera\.[a-z0-9_]+$/.test(entityId) || !HA_URL || !HA_TOKEN) throw new HttpError(400, "Invalid camera");
  const upstream = await fetch(`${HA_URL}/api/camera_proxy_stream/${encodeURIComponent(entityId)}`, { headers: { authorization: `Bearer ${HA_TOKEN}` }, cache: "no-store" });
  if (!upstream.ok || !upstream.body) return NextResponse.json({ error: "Camera unavailable" }, { status: 502 });
  return new Response(upstream.body, { headers: { "content-type": upstream.headers.get("content-type") || "multipart/x-mixed-replace", "cache-control": "no-store" } });
});
