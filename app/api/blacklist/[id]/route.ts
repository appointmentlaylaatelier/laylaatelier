import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";

export const runtime = "nodejs";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function normalizePhone(value: string) {
  return value.replace(/\D/g, "").replace(/^974/, "");
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = sessionFromRequest(request);
  if (!session) return unauthorized();

  try {
    const { id } = await context.params;
    const body = await request.json();
    const name = String(body.name || "").trim();
    const phone = String(body.phone || "").trim();
    const reason = String(body.reason || "").trim();
    if (!name || !phone || !reason) return NextResponse.json({ error: "Name, phone and reason are required." }, { status: 400 });
    if (!/^\d{7,15}$/.test(phone)) return NextResponse.json({ error: "Phone number must contain digits only (7 to 15 digits)." }, { status: 400 });

    const normalizedPhone = normalizePhone(phone);
    const db = await getDb();
    const duplicate = await db.collection("blacklist").findOne({ normalizedPhone, id: { $ne: id } });
    if (duplicate) return NextResponse.json({ error: "That phone number is already blacklisted." }, { status: 409 });

    const result = await db.collection("blacklist").updateOne(
      { id },
      { $set: { name, phone, normalizedPhone, reason, updatedAt: new Date(), updatedBy: session.id } },
    );
    if (!result.matchedCount) return NextResponse.json({ error: "Blacklisted client not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not update blacklisted client." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = sessionFromRequest(request);
  if (!session) return unauthorized();

  try {
    const { id } = await context.params;
    const db = await getDb();
    const result = await db.collection("blacklist").deleteOne({ id });
    if (!result.deletedCount) return NextResponse.json({ error: "Blacklisted client not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not delete blacklisted client." }, { status: 500 });
  }
}
