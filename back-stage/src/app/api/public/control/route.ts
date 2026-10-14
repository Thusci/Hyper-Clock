import { route } from "@/server/http";
import { runCommand } from "@/server/kiosk/commands";

/** Kiosk → control plane commands, dispatched by `kind` (see server/kiosk/commands.ts). */
export const POST = route(
  { access: "kiosk", rate: { key: "kiosk-control", capacity: 15, refillPerSecond: 3 } },
  async ({ request, ip }) => runCommand(await request.json().catch(() => null), { ip }),
);
