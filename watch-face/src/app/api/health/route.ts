import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ status: "ok", service: "hyper-clock", uptime: Math.round(process.uptime()), timestamp: new Date().toISOString() });
}
