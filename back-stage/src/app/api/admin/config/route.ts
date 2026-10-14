import { readConfig, writeConfig } from "@/server/config";
import { HttpError, requireUser, route } from "@/server/http";
import { audit } from "@/server/store";

export const GET = route({ access: "user" }, () => readConfig());

export const PUT = route({ access: "admin", csrf: true }, async (context) => {
  const user = requireUser(context);
  try {
    const value = await writeConfig(await context.request.json());
    await audit({ type: "config.update", username: user.username, ip: context.ip });
    return value;
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Invalid config");
  }
});
