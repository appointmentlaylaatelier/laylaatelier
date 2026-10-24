import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/bootstrap";
import { sessionFromRequest } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { DEFAULT_CLIENT_MESSAGE01, DEFAULT_EMAIL_SUBJECT01, sendClientMessage } from "@/lib/messaging";
import { APPOINTMENT_TYPES, inferAppointmentType, isServiceCompatible, type AppointmentType } from "@/lib/services";
import { formatTimeRange12 } from "@/lib/time";
import {
  BUSINESS_WHATSAPP_NUMBER,
  DEFAULT_WHATSAPP_INQUIRY_MESSAGE,
  buildWhatsAppClientUrl,
  renderWhatsAppInquiry,
} from "@/lib/whatsapp";

export const runtime = "nodejs";

const allowedTypes = new Set<string>(APPOINTMENT_TYPES);
const activeBlockingStatuses = new Set(["Confirmed", "Arrived", "Walk-in"]);

type AppointmentDoc = {
  id: string; client: string; phone: string; email?: string; appointmentType?: string; service: string; date: string;
  start: string; end: string; status: string; called: boolean; notes?: string; designerAssigned?: string; placementStatus?: string;
};

function unauthorized() { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
function backendErrorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
function maskedEmail(value: string) {
  const [local, domain] = value.split("@");
  if (!local || !domain) return value;
  return `${local.slice(0, 2)}***@${domain}`;
}
function overlaps(startA: string, endA: string, startB: string, endB: string) {
  return startA < endB && endA > startB;
}

export async function GET(request: NextRequest) {
  const session = sessionFromRequest(request);
  if (!session) return unauthorized();
  try {
    await ensureBootstrap();
    const db = await getDb();
    const from = request.nextUrl.searchParams.get("from");
    const to = request.nextUrl.searchParams.get("to");
    const status = request.nextUrl.searchParams.get("status");
    const query: Record<string, unknown> = {};
    if (from || to) query.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
    if (status && status !== "All") query.status = status;
    const documents = await db.collection("appointments").find(query).sort({ date: 1, start: 1 }).toArray() as AppointmentDoc[];
    const appointments = documents.map((item) => ({
      id: item.id,
      client: item.client,
      phone: item.phone,
      email: item.email || "",
      appointmentType: inferAppointmentType(item.service, item.appointmentType),
      service: item.service,
      date: item.date,
      start: item.start,
      end: item.end,
      status: item.status,
      called: item.called,
      notes: item.notes || "",
      designerAssigned: item.designerAssigned || "",
      placementStatus: item.placementStatus || "Not placed",
    }));
    return NextResponse.json({ appointments });
  } catch {
    return NextResponse.json({ error: "Could not load appointments." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = sessionFromRequest(request);
  if (!session) return unauthorized();
  if (session.role !== "receptionist") return NextResponse.json({ error: "Only receptionists can create appointments." }, { status: 403 });

  try {
    await ensureBootstrap();
    const body = await request.json();
    const required = ["client", "phone", "appointmentType", "service", "date", "start", "end"];
    if (required.some((key) => !String(body[key] || "").trim())) {
      return NextResponse.json({ error: "Missing required appointment fields." }, { status: 400 });
    }

    const appointmentType = String(body.appointmentType).trim() as AppointmentType;
    const service = String(body.service).trim();
    if (!allowedTypes.has(appointmentType)) return NextResponse.json({ error: "Invalid appointment type." }, { status: 400 });
    if (!isServiceCompatible(appointmentType, service)) return NextResponse.json({ error: "Invalid service for the selected appointment type." }, { status: 400 });

    const phone = String(body.phone).trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const date = String(body.date).trim();
    const start = String(body.start).trim();
    const end = String(body.end).trim();
    if (!/^\d{7,15}$/.test(phone)) return NextResponse.json({ error: "Phone number must contain digits only (7 to 15 digits)." }, { status: 400 });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
    if (end <= start) return NextResponse.json({ error: "The end time must be later than the start time." }, { status: 400 });

    const normalizedPhone = phone.replace(/\D/g, "").replace(/^974/, "");
    const db = await getDb();
    const blocked = await db.collection("blacklist").findOne({ normalizedPhone });
    if (blocked) return NextResponse.json({ error: "This phone number is blacklisted." }, { status: 409 });

    const existingEmail = email
      ? await db.collection("appointments").findOne({ email }, { projection: { _id: 1 } })
      : null;
    if (existingEmail) return NextResponse.json({ error: "This email address is already used by another appointment." }, { status: 409 });

    // New Dress appointments reserve the selected date/time. Fittings are intentionally allowed to overlap.
    if (appointmentType === "New Dress") {
      const sameDay = await db.collection("appointments").find({ date, status: { $nin: ["Canceled", "No show"] } }).toArray() as AppointmentDoc[];
      const conflict = sameDay.find(item => {
        const itemType = inferAppointmentType(String(item.service || ""), item.appointmentType);
        return itemType === "New Dress" && activeBlockingStatuses.has(String(item.status || "Confirmed")) && overlaps(start, end, String(item.start || ""), String(item.end || ""));
      });
      if (conflict) {
        return NextResponse.json({
          error: `This New Dress time slot overlaps ${conflict.client}'s existing appointment (${formatTimeRange12(conflict.start, conflict.end)}). Cancel or mark the existing appointment as No show before reusing the slot.`,
        }, { status: 409 });
      }
    }

    const appointment = {
      id: randomUUID(),
      client: String(body.client).trim(),
      phone,
      email,
      appointmentType,
      service,
      date,
      start,
      end,
      status: "Confirmed",
      called: false,
      designerAssigned: String(body.designerAssigned || "").trim(),
      placementStatus: "Not placed",
      notes: String(body.notes || "").trim(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const whatsappMessageTemplate = String(body.whatsappMessage || DEFAULT_WHATSAPP_INQUIRY_MESSAGE).trim();
    const emailMessageTemplate = String(body.emailMessage || DEFAULT_CLIENT_MESSAGE01).trim();
    const subjectTemplate = String(body.emailSubject || DEFAULT_EMAIL_SUBJECT01).trim();

    if (!whatsappMessageTemplate) return NextResponse.json({ error: "WhatsApp inquiry cannot be empty." }, { status: 400 });
    if (email && (!emailMessageTemplate || !subjectTemplate)) return NextResponse.json({ error: "Email subject and email message cannot be empty when a customer email is provided." }, { status: 400 });
    if (whatsappMessageTemplate.length > 4000 || (email && (emailMessageTemplate.length > 4000 || subjectTemplate.length > 200))) {
      return NextResponse.json({ error: "The appointment notification content is too long." }, { status: 400 });
    }

    await db.collection("appointments").insertOne(appointment);

    const context = {
      name: appointment.client,
      phone: appointment.phone,
      email: appointment.email,
      service: appointment.service,
      date: appointment.date,
      time: formatTimeRange12(appointment.start, appointment.end),
    };

    const whatsappMessage = renderWhatsAppInquiry(whatsappMessageTemplate, context);
    const whatsappUrl = buildWhatsAppClientUrl(appointment.phone, whatsappMessage);

    let emailResult: { ok: boolean; skipped?: boolean; error?: string };
    if (!appointment.email) {
      emailResult = { ok: false, skipped: true, error: "No customer email provided." };
    } else {
      console.info("[appointments] Sending confirmation email", { appointmentId: appointment.id, to: maskedEmail(appointment.email), subject: subjectTemplate });
      try {
        const delivery = await sendClientMessage(context, { channel: "email", emailMessageTemplate, subjectTemplate });
        emailResult = delivery.email || { ok: false, error: "Email service did not return a delivery result." };
      } catch (emailError) {
        const message = backendErrorMessage(emailError);
        console.error("[appointments] Confirmation email threw an unexpected backend error", { appointmentId: appointment.id, to: maskedEmail(appointment.email), error: message, stack: emailError instanceof Error ? emailError.stack : undefined });
        emailResult = { ok: false, error: message };
      }
      if (!emailResult.ok) {
        console.error("[appointments] Confirmation email failed", { appointmentId: appointment.id, to: maskedEmail(appointment.email), error: emailResult.error || "Email delivery failed", skipped: emailResult.skipped || false });
      } else {
        console.info("[appointments] Confirmation email sent", { appointmentId: appointment.id, to: maskedEmail(appointment.email) });
      }
    }

    const responseDelivery = { email: emailResult };
    await db.collection("appointments").updateOne(
      { id: appointment.id },
      { $set: {
        appointmentNotification: {
          whatsapp: { mode: "click_to_chat", businessNumber: BUSINESS_WHATSAPP_NUMBER, clientNumber: appointment.phone, url: whatsappUrl },
          email: emailResult,
        },
        notificationAttemptedAt: appointment.email ? new Date() : null,
        notificationContent: { whatsappMessageTemplate, emailMessageTemplate, subjectTemplate },
      } },
    );

    return NextResponse.json({ appointment, delivery: responseDelivery, whatsappUrl }, { status: 201 });
  } catch (error) {
    const message = backendErrorMessage(error);
    console.error("[appointments] POST /api/appointments failed", { error: message, stack: error instanceof Error ? error.stack : undefined });
    return NextResponse.json({ error: "Could not create appointment.", backendError: message }, { status: 500 });
  }
}
