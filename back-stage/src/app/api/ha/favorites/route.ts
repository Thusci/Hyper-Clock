import { z } from "zod";
import { requireUser, route } from "@/server/http";
import { files, readJson, updateJson } from "@/server/store";

type Favorites = Record<string, string[]>;

export const GET = route({ access: "user" }, async (context) => {
  const all = await readJson<Favorites>(files.favorites, {});
  return { entityIds: all[requireUser(context).username] ?? [] };
});

export const PUT = route({ access: "user", csrf: true, body: z.object({ entityIds: z.array(z.string()).max(100) }), invalidBody: "Invalid favorites" }, async (context) => {
  const username = requireUser(context).username;
  await updateJson<Favorites>(files.favorites, {}, (all) => ({ ...all, [username]: context.body.entityIds }));
  return { ok: true };
});
