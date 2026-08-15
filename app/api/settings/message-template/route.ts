import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth";
import { ensureBootstrap } from "@/lib/bootstrap";
import { getDb } from "@/lib/mongodb";
import { DEFAULT_CLIENT_MESSAGE02, DEFAULT_EMAIL_SUBJECT02 } from "@/lib/messaging";

export const runtime = "nodejs";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(request: NextRequest) {
  if (!sessionFromRequest(request)) return unauthorized();
  try {
    await ensureBootstrap();
    const db = await getDb();
    const [setting, legacy] = await Promise.all([
      db.collection("settings").findOne({ key: "messagingTemplate" }),
      db.collection("settings").findOne({ key: "whatsappMessage" }),
    ]);
    const value = setting?.value && typeof setting.value === "object" ? setting.value : {};
    return NextResponse.json({
      subject: typeof value.subject === "string" ? value.subject : DEFAULT_EMAIL_SUBJECT02,
      message: typeof value.message === "string" ? value.message : (typeof legacy?.value === "string" ? legacy.value : DEFAULT_CLIENT_MESSAGE02),
    });
  } catch {
    return NextResponse.json({ error: "Could not load the message template." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  if (!sessionFromRequest(request)) return unauthorized();
  try {
    const body = await request.json();
    const subject = String(body.subject || "").trim();
    const message = String(body.message || "").trim();
    if (!subject) return NextResponse.json({ error: "Email subject cannot be empty." }, { status: 400 });
    if (!message) return NextResponse.json({ error: "Message cannot be empty." }, { status: 400 });
    if (subject.length > 200) return NextResponse.json({ error: "Email subject is too long." }, { status: 400 });
    if (message.length > 4000) return NextResponse.json({ error: "Message is too long." }, { status: 400 });
    await ensureBootstrap();
    const db = await getDb();
    await db.collection("settings").updateOne(
      { key: "messagingTemplate" },
      { $set: { key: "messagingTemplate", value: { subject, message }, updatedAt: new Date() } },
      { upsert: true },
    );
    return NextResponse.json({ subject, message });
  } catch {
    return NextResponse.json({ error: "Could not save the message template." }, { status: 500 });
  }
}
