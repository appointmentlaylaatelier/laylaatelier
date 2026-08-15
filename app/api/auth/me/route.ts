import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const session = sessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, name, email, role } = session;
  return NextResponse.json({ user: { id, name, email, role } });
}
