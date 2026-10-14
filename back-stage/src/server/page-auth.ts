import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { readSession } from "./auth";
import { clientIp } from "./security";

/** For server-rendered pages: the logged-in user, or a redirect to /login. */
export async function requirePageUser() {
  const user = await readSession(clientIp(new Request("http://local", { headers: await headers() })));
  if (!user) redirect("/login");
  return user;
}
