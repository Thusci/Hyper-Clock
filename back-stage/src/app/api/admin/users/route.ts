import { z } from "zod";
import { listUsers, removeUser, toPublicUser, upsertUser } from "@/server/auth";
import { HttpError, requireUser, route } from "@/server/http";
import { audit } from "@/server/store";

const account = z.object({
  username: z.string().min(3).max(40).regex(/^[a-zA-Z0-9_-]+$/),
  password: z.string().min(12).max(200).optional(),
  role: z.enum(["admin", "viewer"]),
  disabled: z.boolean().optional(),
});

const failure = (error: unknown) => new HttpError(400, error instanceof Error ? error.message : "Failed");

export const GET = route({ access: "admin" }, async () => (await listUsers()).map(toPublicUser));

export const PUT = route({ access: "admin", csrf: true, body: account, invalidBody: "账号信息无效" }, async (context) => {
  const user = requireUser(context);
  try {
    const users = await upsertUser(context.body);
    await audit({ type: "user.upsert", username: user.username, target: context.body.username, role: context.body.role });
    return users;
  } catch (error) {
    throw failure(error);
  }
});

export const DELETE = route({ access: "admin", csrf: true }, async (context) => {
  const user = requireUser(context);
  const username = new URL(context.request.url).searchParams.get("username");
  if (!username || username === user.username) throw new HttpError(400, "不能删除当前账号");
  try {
    await removeUser(username);
    await audit({ type: "user.delete", username: user.username, target: username });
    return { ok: true };
  } catch (error) {
    throw failure(error);
  }
});
