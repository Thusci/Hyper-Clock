import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/server/env";
import { CSRF_COOKIE, csrfToken, clientIp, hasKioskKey, isLanIp } from "@/server/security";

/**
 * Runs before every request: the network boundary.
 * 1. Reject non-LAN callers (unless ALLOW_WAN, or the caller is the kiosk with its secret).
 * 2. Strip credentials from legacy /login?username=… links.
 * 3. Issue the CSRF cookie that mutating routes check, and set baseline security headers.
 */
export function proxy(request: NextRequest) {
  if (!env().ALLOW_WAN && !isLanIp(clientIp(request)) && !hasKioskKey(request)) {
    return NextResponse.json({ error: "LAN access only" }, { status: 403 });
  }
  const { pathname, searchParams } = request.nextUrl;
  const legacyLogin = pathname === "/login" && (searchParams.has("username") || searchParams.has("password"));
  const response = legacyLogin ? NextResponse.redirect(new URL("/login", request.url)) : NextResponse.next();
  if (!request.cookies.has(CSRF_COOKIE)) {
    response.cookies.set(CSRF_COOKIE, csrfToken(), { sameSite: "strict", secure: env().COOKIE_SECURE, path: "/", maxAge: 43_200 });
  }
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("referrer-policy", "same-origin");
  response.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
