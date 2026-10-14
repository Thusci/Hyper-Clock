import { z } from "zod";
import { authMethod, startSetup } from "@/server/auth";
import { HttpError, route } from "@/server/http";
import { audit } from "@/server/store";

/** First sign-in with AUTH_METHOD=totp: verify the enrolment password and return the QR code. */
export const POST = route(
  {
    access: "public", csrf: true, rate: { key: "login", capacity: 6, refillPerSecond: .05, message: "尝试次数过多，请稍后再试" },
    body: z.object({ username: z.string().min(1).max(80), password: z.string().min(1).max(200) }), invalidBody: "请输入账号和密码",
  },
  async ({ body, ip }) => {
    if (authMethod() !== "totp") throw new HttpError(400, "当前未启用身份验证器登录");
    const enrollment = await startSetup(body.username, body.password);
    await audit({ type: "auth.totp.setup-start", username: body.username, ip, success: Boolean(enrollment) });
    if (!enrollment) throw new HttpError(401, "账号或密码不正确");
    return enrollment;
  },
);
