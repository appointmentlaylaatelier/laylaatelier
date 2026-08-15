import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/bootstrap";
import { hashPassword } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";

export const runtime = "nodejs";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const token = String(body.token || "").trim();
    const password = String(body.password || "");
    if (!token) return NextResponse.json({ error: "The password reset link is invalid." }, { status: 400 });
    if (password.length < 8) return NextResponse.json({ error: "New password must be at least 8 characters." }, { status: 400 });

    await ensureBootstrap();
    const db = await getDb();
    const tokenHash = hashToken(token);
    const reset = await db.collection("password_reset_tokens").findOne({
      tokenHash,
      usedAt: null,
      expiresAt: { $gt: new Date() },
    });
    if (!reset) return NextResponse.json({ error: "This password reset link is invalid or has expired." }, { status: 400 });

    const { salt, hash } = hashPassword(password);
    const userUpdate = await db.collection("users").updateOne(
      { id: reset.userId },
      { $set: { passwordSalt: salt, passwordHash: hash, passwordUpdatedAt: new Date(), updatedAt: new Date() } },
    );
    if (!userUpdate.matchedCount) return NextResponse.json({ error: "This password reset link is no longer valid." }, { status: 400 });

    await db.collection("password_reset_tokens").updateOne(
      { tokenHash, usedAt: null },
      { $set: { usedAt: new Date(), invalidatedReason: "used" } },
    );
    await db.collection("password_reset_tokens").updateMany(
      { userId: reset.userId, usedAt: null },
      { $set: { usedAt: new Date(), invalidatedReason: "password_changed" } },
    );

    return NextResponse.json({ message: "Password updated. You can now sign in with your new password." });
  } catch {
    return NextResponse.json({ error: "Could not reset the password." }, { status: 500 });
  }
}
