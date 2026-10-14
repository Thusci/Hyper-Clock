import { z } from "zod";
import { startRenewal } from "@/server/auth";
import { HttpError, requireUser, route } from "@/server/http";
import { audit } from "@/server/store";

/** Signed-in renewal: the current code (when one is enrolled) authorises a new QR code. */
export const POST = route(
  {
    access: "user", csrf: true, rate: { key: "totp-renew", capacity: 6, refillPerSecond: .05, message: "尝试次数过多，请稍后再试" },
    body: z.object({ code: z.string().max(12).default("") }), invalidBody: "请输入当前验证码",
  },
  async (context) => {
    const user = requireUser(context);
    const enrollment = await startRenewal(user.username, context.body.code);
    await audit({ type: "auth.totp.renew-start", username: user.username, ip: context.ip, success: Boolean(enrollment) });
    if (!enrollment) throw new HttpError(401, "当前验证码不正确");
    return enrollment;
  },
);
