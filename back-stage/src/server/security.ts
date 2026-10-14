import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { env, MIN_SECRET_LENGTH } from "./env";

/** Client IP as seen by the trusted gateway. Without a trusted proxy every caller is loopback. */
export function clientIp(request: Request) {
  if (!env().TRUST_PROXY_HEADERS) return "127.0.0.1";
  return request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export function isLanIp(ip: string) {
  const clean = ip.replace(/^::ffff:/, "");
  if (clean === "127.0.0.1" || clean === "::1") return true;
  const parts = clean.split(".").map(Number);
  if (parts.length === 4) {
    const [a, b] = parts;
    return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
  }
  return clean.startsWith("fc") || clean.startsWith("fd") || clean.startsWith("fe80:");
}

export function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** True when the request carries the kiosk shared secret (only the watch-face server knows it). */
export function hasKioskKey(request: Request) {
  const expected = env().KIOSK_SHARED_SECRET;
  const given = request.headers.get("x-kiosk-key");
  return Boolean(expected && expected.length >= MIN_SECRET_LENGTH && given && safeEqual(given, expected));
}

export const CSRF_COOKIE = "hc_csrf";

export function csrfToken() {
  return randomBytes(24).toString("base64url");
}

/** Same-origin check plus double-submit CSRF token, required on every cookie-authenticated write. */
export function verifyMutation(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (origin && host && new URL(origin).host !== host) return false;
  const cookie = request.headers.get("cookie")?.split(";").map((value) => value.trim()).find((value) => value.startsWith(`${CSRF_COOKIE}=`))?.slice(CSRF_COOKIE.length + 1);
  const header = request.headers.get("x-csrf-token");
  return Boolean(cookie && header && safeEqual(decodeURIComponent(cookie), header));
}

type Bucket = { tokens: number; updated: number };
const holder = globalThis as unknown as { hcRate?: Map<string, Bucket> };
const buckets = holder.hcRate ?? new Map<string, Bucket>();
holder.hcRate = buckets;

/** Token bucket keyed by caller: `capacity` burst, refilled at `refillPerSecond`. */
export function allowRate(key: string, capacity = 20, refillPerSecond = 4) {
  const now = Date.now();
  const old = buckets.get(key) ?? { tokens: capacity, updated: now };
  const tokens = Math.min(capacity, old.tokens + (now - old.updated) / 1000 * refillPerSecond);
  if (tokens < 1) {
    buckets.set(key, { tokens, updated: now });
    return false;
  }
  buckets.set(key, { tokens: tokens - 1, updated: now });
  return true;
}

export function ipHash(ip: string) {
  return createHash("sha256").update(ip).digest("hex");
}
