import { ha } from "@/server/ha";
import { route } from "@/server/http";
import { kioskHub } from "@/server/kiosk/hub";
import { files, readJson } from "@/server/store";

export const GET = route({ access: "user" }, async () => ({
  service: { status: "online", uptime: Math.round(process.uptime()), memoryMb: Math.round(process.memoryUsage().rss / 1_048_576) },
  ha: { connected: ha.isConnected() },
  hub: kioskHub.status(),
  kiosk: await readJson<{ lastSeen?: string; mode?: string; page?: string }>(files.kiosk, {}),
}));
