import { createHash, randomBytes, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/bootstrap";
import { getDb } from "@/lib/mongodb";
import { sendTransactionalEmail } from "@/lib/messaging";

export const runtime = "nodejs";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = String(body.email || "").trim().toLowerCase();
    if (!email) return NextResponse.json({ error: "Enter your account email address." }, { status: 400 });
    if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
      return NextResponse.json({ error: "Password reset email is not configured. Add RESEND_API_KEY and RESEND_FROM_EMAIL to the server environment." }, { status: 503 });
    }

    await ensureBootstrap();
    const db = await getDb();
    const user = await db.collection("users").findOne({ email });

    if (user) {
      const token = randomBytes(32).toString("hex");
      const tokenHash = hashToken(token);
      const ttlMinutes = Math.max(5, Number(process.env.PASSWORD_RESET_TTL_MINUTES || 30));
      const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);

      await db.collection("password_reset_tokens").updateMany(
        { userId: user.id, usedAt: null },
        { $set: { usedAt: new Date(), invalidatedReason: "superseded" } },
      );
      await db.collection("password_reset_tokens").insertOne({
        id: randomUUID(),
        userId: user.id,
        email,
        tokenHash,
        expiresAt,
        usedAt: null,
        createdAt: new Date(),
      });

      const appUrl = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
      const resetUrl = `${appUrl}/?reset=${encodeURIComponent(token)}`;
      const subject = "Reset your LAYLA showroom password";
      const message = [
        "A password reset was requested for your LAYLA showroom account.",
        "",
        `Open this secure link to choose a new password: ${resetUrl}`,
        "",
        `This link expires in ${ttlMinutes} minutes and can only be used once.`,
        "If you did not request a password reset, you can ignore this email.",
      ].join("\n");
      await sendTransactionalEmail(email, subject, message);
    }

    return NextResponse.json({ message: "If that email belongs to an account, a password reset link has been sent." });
  } catch {
    return NextResponse.json({ error: "Could not start the password reset process." }, { status: 500 });
  }
}
