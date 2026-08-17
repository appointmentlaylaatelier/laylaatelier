import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";

export const runtime = "nodejs";

const statuses = new Set(["Confirmed", "Canceled", "Arrived", "No show", "Walk-in"]);
const allowedServices = new Set(["Alterations", "Evening Gowns", "Bridal Gowns", "1st Fitting (Evening gown)", "2nd Fitting (Evening gown)", "Final Fitting (Evening gown)", "1st Fitting (Bridal gown)", "2nd Fitting (Bridal gown)", "Final Fitting (Bridal gown)"]);

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function canManageAppointments(role: string) {
  return role === "receptionist" || role === "manager";
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = sessionFromRequest(request);
  if (!session) return unauthorized();
  if (!canManageAppointments(session.role)) {
    return NextResponse.json({ error: "You do not have permission to update appointments." }, { status: 403 });
  }

  try {
    const { id } = await context.params;
    const body = await request.json();
    const allowed = ["client", "phone", "email", "called", "status", "notes", "date", "start", "end", "service", "designerAssigned", "placementStatus"] as const;
    const patch: Record<string, unknown> = { updatedAt: new Date() };

    for (const key of allowed) {
      if (!(key in body)) continue;
      if (["client", "phone", "email", "date", "start", "end", "service"].includes(key)) {
        const value = String(body[key] ?? "").trim();
        if (!value) return NextResponse.json({ error: `${key} cannot be empty.` }, { status: 400 });
        if (key === "service" && !allowedServices.has(value)) return NextResponse.json({ error: "Invalid service." }, { status: 400 });
        patch[key] = key === "email" ? value.toLowerCase() : value;
      } else if (key === "notes" || key === "designerAssigned") {
        patch[key] = String(body[key] ?? "").trim();
      } else if (key === "placementStatus") {
        const value = String(body[key] ?? "Not placed");
        if (!["Placed", "Not placed", "Follow-up"].includes(value)) return NextResponse.json({ error: "Invalid order status." }, { status: 400 });
        patch[key] = value;
      } else if (key === "called") {
        patch[key] = Boolean(body[key]);
      } else if (key === "status") {
        const value = String(body[key] ?? "");
        if (!statuses.has(value)) return NextResponse.json({ error: "Invalid appointment status." }, { status: 400 });
        patch[key] = value;
      }
    }

    const db = await getDb();
    const existing = await db.collection("appointments").findOne({ id });
    if (!existing) return NextResponse.json({ error: "Appointment not found." }, { status: 404 });

    const nextStart = typeof patch.start === "string" ? patch.start : String(existing.start || "");
    const nextEnd = typeof patch.end === "string" ? patch.end : String(existing.end || "");
    if (nextStart && nextEnd && nextEnd <= nextStart) {
      return NextResponse.json({ error: "The end time must be later than the start time." }, { status: 400 });
    }

    if (typeof patch.phone === "string") {
      const normalizedPhone = patch.phone.replace(/\D/g, "").replace(/^974/, "");
      const existingPhone = String(existing.phone || "").replace(/\D/g, "").replace(/^974/, "");
      if (normalizedPhone !== existingPhone) {
        const blocked = await db.collection("blacklist").findOne({ normalizedPhone });
        if (blocked) return NextResponse.json({ error: "This phone number is blacklisted." }, { status: 409 });
      }
    }

    await db.collection("appointments").updateOne({ id }, { $set: patch });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not update appointment." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = sessionFromRequest(request);
  if (!session) return unauthorized();
  if (!canManageAppointments(session.role)) {
    return NextResponse.json({ error: "You do not have permission to delete appointments." }, { status: 403 });
  }

  try {
    const { id } = await context.params;
    const db = await getDb();
    const result = await db.collection("appointments").deleteOne({ id });
    if (!result.deletedCount) return NextResponse.json({ error: "Appointment not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not delete appointment." }, { status: 500 });
  }
}
