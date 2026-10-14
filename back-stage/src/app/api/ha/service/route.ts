import { z } from "zod";
import { ha } from "@/server/ha";
import { HttpError, requireUser, route } from "@/server/http";
import { audit } from "@/server/store";

/** Domains a logged-in admin may control from /ha and /admin/ha-control. */
const CONTROLLABLE = new Set(["light", "switch", "fan", "input_boolean", "automation", "scene", "cover", "climate"]);

const serviceCall = z.object({
  entityId: z.string().regex(/^[a-z_]+\.[a-z0-9_]+$/),
  domain: z.string().regex(/^[a-z_]+$/),
  service: z.enum(["turn_on", "turn_off", "toggle"]),
  data: z.record(z.string(), z.unknown()).optional(),
}).refine((value) => value.domain === value.entityId.split(".")[0]);

export const POST = route(
  { access: "admin", csrf: true, rate: { key: "ha", capacity: 20, refillPerSecond: 4, message: "操作过于频繁" }, body: serviceCall, invalidBody: "Invalid command" },
  async (context) => {
    const { body, ip } = context;
    if (!CONTROLLABLE.has(body.domain)) throw new HttpError(403, "Domain is not controllable");
    await ha.call(body.domain, body.service, body.entityId, body.data);
    await audit({ type: "ha.command", username: requireUser(context).username, ip, entityId: body.entityId, service: body.service });
    return { ok: true };
  },
);
