import { route } from "@/server/http";
import { readAudit } from "@/server/store";

export const GET = route({ access: "user" }, ({ request }) => readAudit(Number(new URL(request.url).searchParams.get("limit") || 100)));
