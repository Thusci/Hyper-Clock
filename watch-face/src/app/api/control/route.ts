import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const secret = process.env.KIOSK_SHARED_SECRET;
  const controlUrl = process.env.CONTROL_PLANE_URL ?? "http://back-stage:3001";
  if (!secret || secret.length < 32) return NextResponse.json({ error: "Kiosk bridge is not configured" }, { status: 503 });
  const response = await fetch(`${controlUrl}/api/public/control`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-kiosk-key": secret },
    body: await request.text(),
    cache: "no-store",
  });
  return new NextResponse(response.body, { status: response.status, headers: { "content-type": "application/json" } });
}
