import "server-only";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { readSession } from "./auth";
import { env } from "./env";
import { allowRate, clientIp, hasKioskKey, verifyMutation } from "./security";
import type { SessionUser } from "@/types";

/**
 * Every API route is declared as `route(policy, action)`.
 *
 *   1. access  — who may call: "public", "kiosk" (shared secret), "user" or "admin" (session)
 *   2. csrf    — cookie-authenticated writes must pass same-origin + double-submit checks
 *   3. rate    — optional token bucket per caller
 *   4. body    — optional zod schema; the action receives the parsed value
 *   5. action  — returns a plain object (sent as JSON) or a Response; throw HttpError to fail
 *
 * The order is fixed, so reading the policy object tells you exactly what a route enforces.
 */
export type Access = "public" | "kiosk" | "user" | "admin";

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

type Policy<Body> = {
  access: Access;
  csrf?: boolean;
  rate?: { key: string; capacity: number; refillPerSecond: number; message?: string };
  body?: z.ZodType<Body>;
  invalidBody?: string;
  /** Adds the watch-face CORS headers (only for routes the kiosk browser may call directly). */
  cors?: boolean;
};

export type RouteContext<Body> = {
  request: Request;
  ip: string;
  user: SessionUser | null;
  body: Body;
  params: Record<string, string>;
};

type NextContext = { params?: Promise<Record<string, string>> };

export function corsHeaders() {
  return { "access-control-allow-origin": env().WATCH_FACE_ORIGIN, "access-control-allow-credentials": "false", "cache-control": "no-store", vary: "Origin" };
}

/** A logged-in caller is guaranteed here; narrows `user` for actions behind "user"/"admin". */
export function requireUser(context: { user: SessionUser | null }): SessionUser {
  if (!context.user) throw new HttpError(401, "Unauthorized");
  return context.user;
}

export function route<Body = undefined>(policy: Policy<Body>, action: (context: RouteContext<Body>) => Promise<unknown> | unknown) {
  return async (request: Request, next?: NextContext): Promise<Response> => {
    try {
      const ip = clientIp(request);
      let user: SessionUser | null = null;

      if (policy.access === "kiosk" && !hasKioskKey(request)) throw new HttpError(401, "Unauthorized");
      if (policy.access === "user" || policy.access === "admin") {
        user = await readSession(ip);
        if (!user) throw new HttpError(401, "Unauthorized");
        if (policy.access === "admin" && user.role !== "admin") throw new HttpError(403, "Read-only account");
      }
      if (policy.csrf && !verifyMutation(request)) throw new HttpError(403, "CSRF check failed");
      if (policy.rate && !allowRate(`${policy.rate.key}:${user?.username ?? "-"}:${ip}`, policy.rate.capacity, policy.rate.refillPerSecond)) {
        throw new HttpError(429, policy.rate.message ?? "Rate limited");
      }

      let body = undefined as Body;
      if (policy.body) {
        const parsed = policy.body.safeParse(await request.json().catch(() => undefined));
        if (!parsed.success) throw new HttpError(400, policy.invalidBody ?? "Invalid request");
        body = parsed.data;
      }

      const result = await action({ request, ip, user, body, params: next?.params ? await next.params : {} });
      const response = result instanceof Response ? result : NextResponse.json(result ?? { ok: true });
      if (policy.cors) for (const [key, value] of Object.entries(corsHeaders())) response.headers.set(key, value);
      return response;
    } catch (error) {
      if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status, headers: policy.cors ? corsHeaders() : undefined });
      console.error("[route]", error);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  };
}

/** Pre-flight response for routes the watch face may call cross-origin. */
export function corsPreflight(methods: string) {
  return () => new Response(null, { status: 204, headers: { ...corsHeaders(), "access-control-allow-methods": methods, "access-control-allow-headers": "content-type" } });
}
