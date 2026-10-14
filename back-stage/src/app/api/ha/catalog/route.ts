import { NextResponse } from "next/server";
import { emptyCatalog, ha } from "@/server/ha";
import { route } from "@/server/http";

export const GET = route({ access: "user" }, async () => {
  try {
    return await ha.catalog();
  } catch {
    return NextResponse.json(emptyCatalog, { status: 502 });
  }
});
