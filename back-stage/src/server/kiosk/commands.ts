import "server-only";
import { z } from "zod";
import { setDisplay } from "../display";
import { ha } from "../ha";
import { HttpError } from "../http";
import { audit, files, readJson, writeJson } from "../store";

/**
 * What the kiosk may ask the control plane to do. Each command owns its schema and handler.
 * To add one: define it with `command(...)` and add it to `commands`. Nothing else changes —
 * POST /api/public/control dispatches on `kind`.
 */
type Context = { ip: string };
type Command<T extends { kind: string }> = { kind: T["kind"]; schema: z.ZodType<T>; run: (input: T, context: Context) => Promise<unknown> };

const command = <T extends { kind: string }>(definition: Command<T>) => definition as unknown as Command<{ kind: string }>;

/** The kiosk can only flip simple on/off domains, and only for entities that exist and are enabled. */
const KIOSK_DOMAINS = new Set(["light", "switch", "fan", "input_boolean", "automation"]);

export const commands = [
  command({
    kind: "ha",
    schema: z.object({ kind: z.literal("ha"), entityId: z.string().regex(/^[a-z0-9_]+\.[a-z0-9_]+$/), domain: z.string(), service: z.enum(["toggle", "turn_on", "turn_off"]) }),
    async run(input, { ip }) {
      if (input.domain !== input.entityId.split(".")[0] || !KIOSK_DOMAINS.has(input.domain)) throw new HttpError(403, "Unsupported entity domain");
      const entity = (await ha.catalog()).entities.find((item) => item.entityId === input.entityId && !item.disabled);
      if (!entity) throw new HttpError(404, "Entity does not exist");
      await ha.call(input.domain, input.service, input.entityId);
      await audit({ type: "kiosk.ha", entityId: input.entityId, service: input.service, ip });
      return { ok: true };
    },
  }),
  command({
    kind: "display",
    schema: z.object({ kind: z.literal("display"), action: z.enum(["on", "off"]) }),
    run: (input, { ip }) => setDisplay(input.action, "kiosk", ip),
  }),
  command({
    kind: "kiosk",
    schema: z.object({ kind: z.literal("kiosk"), mode: z.enum(["full", "minimal", "off"]), page: z.string().max(40) }),
    async run(input, { ip }) {
      const previous = await readJson<{ mode?: string; page?: string }>(files.kiosk, {});
      const state = { mode: input.mode, page: input.page, lastSeen: new Date().toISOString(), ip };
      await writeJson(files.kiosk, state);
      if (previous.mode !== state.mode || previous.page !== state.page) await audit({ type: "kiosk.state", ...state });
      return { ok: true };
    },
  }),
];

export async function runCommand(input: unknown, context: Context) {
  const kind = typeof input === "object" && input && "kind" in input ? String((input as { kind: unknown }).kind) : "";
  const definition = commands.find((item) => item.kind === kind);
  const parsed = definition?.schema.safeParse(input);
  if (!definition || !parsed?.success) throw new HttpError(400, "Invalid command");
  return definition.run(parsed.data, context);
}
