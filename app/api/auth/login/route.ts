import { NextRequest, NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/bootstrap";
import { getDb } from "@/lib/mongodb";
import { sessionCookieName, sessionCookieOptions, signSession, verifyPassword, type SessionUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    await ensureBootstrap();
    const body = await request.json();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!email || !password) return NextResponse.json({ error: "Email and password are required." }, { status: 400 });

    const db = await getDb();
    const user = await db.collection("users").findOne({ email });
    if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }

    const safeUser: SessionUser = { id: user.id, name: user.name, email: user.email, role: user.role };
    const response = NextResponse.json({ user: safeUser });
    response.cookies.set(sessionCookieName(), signSession(safeUser), sessionCookieOptions());
    return response;
  } catch {
    return NextResponse.json({ error: "Authentication service is unavailable." }, { status: 500 });
  }
}
