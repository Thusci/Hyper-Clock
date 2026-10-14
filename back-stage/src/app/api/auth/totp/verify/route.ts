import { z } from "zod";
import { finishEnrollment, readSession, signedInResponse } from "@/server/auth";
import { HttpError, route } from "@/server/http";
import { audit } from "@/server/store";

/** Confirms a new authenticator. "setup" signs the user in; "renew" keeps the current session. */
export const POST = route(
  {
    access: "public", csrf: true, rate: { key: "totp-verify", capacity: 10, refillPerSecond: .1, message: "尝试次数过多，请稍后再试" },
    body: z.object({ ticket: z.string().min(1).max(2000), code: z.string().min(6).max(12), purpose: z.enum(["setup", "renew"]) }), invalidBody: "请输入 6 位验证码",
  },
  async ({ body, ip }) => {
    const session = body.purpose === "renew" ? await readSession(ip) : null;
    if (body.purpose === "renew" && !session) throw new HttpError(401, "Unauthorized");
    const user = await finishEnrollment(body.ticket, body.code, body.purpose, session?.username);
    await audit({ type: `auth.totp.${body.purpose}`, username: user?.username ?? session?.username ?? "unknown", ip, success: Boolean(user) });
    if (!user) throw new HttpError(401, "验证码不正确或二维码已过期，请重新开始");
    return body.purpose === "setup" ? signedInResponse(user, ip) : { ok: true };
  },
);
