import { z } from "zod";
import { authenticate, authMethod, signedInResponse } from "@/server/auth";
import { HttpError, route } from "@/server/http";
import { audit } from "@/server/store";

const credentials = z.object({
  username: z.string().min(1).max(80),
  password: z.string().min(1).max(200).optional(),
  code: z.string().max(12).optional(),
});

export const POST = route(
  { access: "public", csrf: true, rate: { key: "login", capacity: 6, refillPerSecond: .05, message: "尝试次数过多，请稍后再试" } },
  async ({ request, ip }) => {
    const parsed = credentials.safeParse(await request.json().catch(() => null));
    const result = parsed.success ? await authenticate(parsed.data) : null;
    const username = parsed.success ? parsed.data.username : "invalid";
    if (result && "setupRequired" in result) {
      await audit({ type: "auth.totp.setup-required", username, ip });
      return { setupRequired: true };
    }
    await audit({ type: "auth.login", method: authMethod(), username, ip, success: Boolean(result) });
    if (!result) throw new HttpError(401, authMethod() === "totp" ? "账号或验证码不正确" : "账号或密码不正确");
    return signedInResponse(result.user, ip);
  },
);
