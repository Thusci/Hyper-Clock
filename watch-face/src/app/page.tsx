import { WatchFace } from "@/components/display/watch-face";
import defaultConfig from "../../data/default-config.json";
import type { AppConfig } from "@/types/config";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const controlUrl = process.env.CONTROL_PLANE_URL ?? process.env.NEXT_PUBLIC_CONTROL_PLANE_URL ?? "http://127.0.0.1:3001";
  let config = defaultConfig as AppConfig;
  try {
    const response = await fetch(`${controlUrl}/api/public/config`, {
      cache: "no-store",
      headers: { "x-kiosk-key": process.env.KIOSK_SHARED_SECRET ?? "" },
      signal: AbortSignal.timeout(1800),
    });
    if (response.ok) config = await response.json() as AppConfig;
  } catch { /* A local fallback keeps the clock available when control plane is offline. */ }
  return <WatchFace initialConfig={config} controlUrl={process.env.NEXT_PUBLIC_CONTROL_PLANE_URL ?? ""} />;
}
