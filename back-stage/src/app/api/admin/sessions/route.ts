import { listSessions, revokeSession } from "@/server/auth";
import { HttpError, route } from "@/server/http";

export const GET = route({ access: "admin" }, () => listSessions());

export const DELETE = route({ access: "admin", csrf: true }, async ({ request }) => {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) throw new HttpError(400, "Missing id");
  await revokeSession(id);
  return { ok: true };
});
