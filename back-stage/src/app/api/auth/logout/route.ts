import { NextResponse } from "next/server";
import { readSession, revokeSession, SESSION_COOKIE } from "@/server/auth";
import { route } from "@/server/http";
import { audit } from "@/server/store";

export const POST = route({ access: "public", csrf: true }, async ({ ip }) => {
  const session = await readSession(ip);
  if (session) {
    await revokeSession(session.sessionId);
    await audit({ type: "auth.logout", username: session.username, ip });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { expires: new Date(0), path: "/", httpOnly: true });
  return response;
});
