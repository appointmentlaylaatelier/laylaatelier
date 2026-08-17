import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/bootstrap";
import { sessionFromRequest } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";

export const runtime = "nodejs";

type BlacklistDoc = { id: string; name: string; phone: string; reason: string; addedAt: Date | string };
function isDuplicateKey(error: unknown) { return typeof error === "object" && error !== null && "code" in error && (error as { code?: number }).code === 11000; }

export async function GET(request: NextRequest) {
  if (!sessionFromRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await ensureBootstrap();
    const db = await getDb();
    const documents = await db.collection("blacklist").find({}).sort({ addedAt: -1 }).toArray() as BlacklistDoc[];
    const items = documents.map((item) => ({ id: item.id, name: item.name, phone: item.phone, reason: item.reason, date: new Date(item.addedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) }));
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: "Could not load blacklist." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = sessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await ensureBootstrap();
    const body = await request.json();
    const name = String(body.name || "").trim(); const phone = String(body.phone || "").trim(); const reason = String(body.reason || "").trim();
    if (!name || !phone || !reason) return NextResponse.json({ error: "Name, phone and reason are required." }, { status: 400 });
    if (!/^\d{7,15}$/.test(phone)) return NextResponse.json({ error: "Phone number must contain digits only (7 to 15 digits)." }, { status: 400 });
    const normalizedPhone = phone.replace(/\D/g, "").replace(/^974/, "");
    const db = await getDb();
    const item = { id: randomUUID(), name, phone, normalizedPhone, reason, addedAt: new Date(), addedBy: session.id };
    await db.collection("blacklist").insertOne(item);
    return NextResponse.json({ item: { id: item.id, name, phone, reason, date: item.addedAt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) } }, { status: 201 });
  } catch (error: unknown) {
    if (isDuplicateKey(error)) return NextResponse.json({ error: "That phone number is already blacklisted." }, { status: 409 });
    return NextResponse.json({ error: "Could not add client to blacklist." }, { status: 500 });
  }
}
