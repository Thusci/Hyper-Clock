import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { env, SYSTEM_BIN_DIR } from "./env";
import { HttpError } from "./http";
import { audit } from "./store";

const exec = promisify(execFile);

/**
 * Screen on/off. Simulated unless SYSTEM_API_ENABLED=true. Two backends, in order:
 *   1. the Q775 sidecar (daemon/, POST /api/v1/display): kernel backlight, works under any
 *      display server and needs no access to the X session — the recommended path;
 *   2. a fixed, pre-installed executable in /opt/hyper-clock/bin (legacy xrandr scripts),
 *      never anything taken from the request.
 */
export async function setDisplay(action: "on" | "off", source: "admin" | "kiosk", ip: string) {
  const { SYSTEM_API_ENABLED, Q775_SIDECAR_URL, Q775_SIDECAR_TOKEN, DISPLAY_OFF_COMMAND, DISPLAY_ON_COMMAND } = env();
  if (!SYSTEM_API_ENABLED) return { ok: true, simulated: true };

  if (Q775_SIDECAR_URL && Q775_SIDECAR_TOKEN) {
    let response: Response;
    try {
      response = await fetch(`${Q775_SIDECAR_URL}/api/v1/display`, {
        method: "POST",
        headers: { authorization: `Bearer ${Q775_SIDECAR_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ power: action }),
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
      });
    } catch {
      throw new HttpError(502, "Q775 sidecar unreachable");
    }
    if (!response.ok) throw new HttpError(502, `Q775 sidecar refused the display command (${response.status})`);
    await audit({ type: `display.${action}`, source, ip, via: "sidecar" });
    return { ok: true, display: await response.json().catch(() => null) };
  }

  const command = action === "off" ? DISPLAY_OFF_COMMAND : DISPLAY_ON_COMMAND;
  if (!command?.startsWith(SYSTEM_BIN_DIR) || command.includes("..")) throw new HttpError(503, "Command not allowlisted");
  try {
    await exec(command, [], { timeout: 5000, windowsHide: true });
  } catch {
    throw new HttpError(502, "Display command failed");
  }
  await audit({ type: `display.${action}`, source, ip, via: "command" });
  return { ok: true };
}
