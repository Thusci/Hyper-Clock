import { z } from "zod";
import { setDisplay } from "@/server/display";
import { route } from "@/server/http";

/** Admin screen test. The kiosk turns the display on/off through /api/public/control instead. */
export const POST = route(
  { access: "admin", csrf: true, body: z.object({ action: z.enum(["on", "off"]) }), invalidBody: "Invalid action" },
  ({ body, ip }) => setDisplay(body.action, "admin", ip),
);
