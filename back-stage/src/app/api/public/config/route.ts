import { readConfig } from "@/server/config";
import { corsPreflight, route } from "@/server/http";

export const GET = route({ access: "public", cors: true }, () => readConfig());
export const OPTIONS = corsPreflight("GET,OPTIONS");
