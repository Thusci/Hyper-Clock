import "server-only";
import { z } from "zod";

/**
 * The single place that reads process.env. Every other module asks `env()` so the
 * deployment surface is documented here and nowhere else.
 */
const flag = z.string().optional().transform((value) => value === "true");

const schema = z.object({
  HA_URL: z.string().optional().transform((value) => value?.replace(/\/+$/, "") || undefined),
  HA_TOKEN: z.string().optional().transform((value) => value || undefined),
  SESSION_SECRET: z.string().optional(),
  KIOSK_SHARED_SECRET: z.string().optional(),
  BOOTSTRAP_ADMIN_USERNAME: z.string().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().optional(),
  /** "password": username + password. "totp": username + authenticator code; the password is only used to enrol. */
  AUTH_METHOD: z.string().optional().transform((value) => (value?.trim().toLowerCase() === "totp" ? "totp" : "password") as "password" | "totp"),
  ALLOW_WAN: flag,
  TRUST_PROXY_HEADERS: flag,
  COOKIE_SECURE: flag,
  SYSTEM_API_ENABLED: flag,
  WATCH_FACE_ORIGIN: z.string().default("http://127.0.0.1:3000"),
  /** Q775 sidecar (daemon/): when set, the screen is switched through its backlight API. */
  Q775_SIDECAR_URL: z.string().optional().transform((value) => value?.replace(/\/+$/, "") || undefined),
  Q775_SIDECAR_TOKEN: z.string().optional().transform((value) => value || undefined),
  DISPLAY_OFF_COMMAND: z.string().optional(),
  DISPLAY_ON_COMMAND: z.string().optional(),
  /** BTC-HARVA (optional): base URL and read-only API keys, comma-separated, one per HARVA user whose accounts should show. */
  HARVA_URL: z.string().optional().transform((value) => value?.trim().replace(/\/+$/, "") || undefined),
  HARVA_API_KEYS: z.string().optional().transform((value) => [...new Set((value ?? "").split(/[\s,]+/).filter(Boolean))]),
});

export type Env = z.infer<typeof schema>;

/** Secrets shorter than this are treated as "not configured". */
export const MIN_SECRET_LENGTH = 32;
/** The only directory display commands may be executed from. */
export const SYSTEM_BIN_DIR = "/opt/hyper-clock/bin/";

let cached: Env | undefined;

export function env(): Env {
  cached ??= schema.parse(process.env);
  return cached;
}

export function haConfigured() {
  const { HA_URL, HA_TOKEN } = env();
  return Boolean(HA_URL && HA_TOKEN);
}

export function harvaConfigured() {
  const { HARVA_URL, HARVA_API_KEYS } = env();
  return Boolean(HARVA_URL && HARVA_API_KEYS.length);
}
