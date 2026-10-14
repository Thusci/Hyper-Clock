import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticate, createSession, SESSION_COOKIE } from "@/server/auth";
import { env } from "@/server/env";
import { HttpError, route } from "@/server/http";
import { audit } from "@/server/store";

const credentials = z.object({ username: z.string().min(1).max(80), password: z.string().min(1).max(200) });

export const POST = route(
  { access: "public", csrf: true, rate: { key: "login", capacity: 6, refillPerSecond: .05, message: "尝试次数过多，请稍后再试" } },
  async ({ request, ip }) => {
    const parsed = credentials.safeParse(await request.json().catch(() => null));
    const user = parsed.success ? await authenticate(parsed.data.username, parsed.data.password) : null;
    await audit({ type: "auth.login", username: parsed.success ? parsed.data.username : "invalid", ip, success: Boolean(user) });
    if (!user) throw new HttpError(401, "账号或密码不正确");
    const session = await createSession(user, ip);
    const response = NextResponse.json({ ok: true, role: user.role });
    response.cookies.set(SESSION_COOKIE, session.token, { httpOnly: true, sameSite: "strict", secure: env().COOKIE_SECURE, path: "/", maxAge: session.maxAge });
    return response;
  },
);
