import { route } from "@/server/http";

export const GET = route({ access: "public" }, () => ({ status: "ok", service: "hyper-clock-back-stage", uptime: Math.round(process.uptime()) }));
