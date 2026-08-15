import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ensureBootstrap } from "@/lib/bootstrap";
import { sessionFromRequest } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { DEFAULT_CLIENT_MESSAGE01, DEFAULT_EMAIL_SUBJECT01, sendClientMessage } from "@/lib/messaging";
import {
  BUSINESS_WHATSAPP_NUMBER,
  DEFAULT_WHATSAPP_INQUIRY_MESSAGE,
  buildWhatsAppInquiryUrl,
  renderWhatsAppInquiry,
} from "@/lib/whatsapp";

export const runtime = "nodejs";

const allowedServices = new Set(["Evening Gowns", "Alterations", "Fitting", "1st Fitting (Evening gown )", "2nd Fitting (Evening gown )", "Final Fitting (Evening gown )", "1st Fitting (Bridal gown )", "2nd Fitting (Bridal gown )", "Final Fitting (Bridal gown )"]);

type AppointmentDoc = {
  id: string; client: string; phone: string; email: string; service: string; date: string;
  start: string; end: string; status: string; called: boolean; notes?: string; designerAssigned?: string; placementStatus?: string;
};

function unauthorized() { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }

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
    const appointments = documents.map((item) => ({ id: item.id, client: item.client, phone: item.phone, email: item.email, service: item.service, date: item.date, start: item.start, end: item.end, status: item.status, called: item.called, notes: item.notes || "", designerAssigned: item.designerAssigned || "", placementStatus: item.placementStatus || "Not placed" }));
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
    const required = ["client", "phone", "email", "service", "date", "start", "end"];
    if (required.some((key) => !String(body[key] || "").trim())) return NextResponse.json({ error: "Missing required appointment fields." }, { status: 400 });
    if (!allowedServices.has(String(body.service).trim())) return NextResponse.json({ error: "Invalid service." }, { status: 400 });
    const normalizedPhone = String(body.phone).replace(/\D/g, "").replace(/^974/, "");
    const db = await getDb();
    const blocked = await db.collection("blacklist").findOne({ normalizedPhone });
    if (blocked) return NextResponse.json({ error: "This phone number is blacklisted." }, { status: 409 });

    const appointment = {
      id: randomUUID(), client: String(body.client).trim(), phone: String(body.phone).trim(),
      email: String(body.email).trim().toLowerCase(), service: String(body.service), date: String(body.date),
      start: String(body.start), end: String(body.end), status: "Confirmed", called: false,
      designerAssigned: String(body.designerAssigned || "").trim(), placementStatus: "Not placed",
      notes: String(body.notes || "").trim(), createdAt: new Date(), updatedAt: new Date(),
    };

    const whatsappMessageTemplate = String(body.whatsappMessage || DEFAULT_WHATSAPP_INQUIRY_MESSAGE).trim();
    const emailMessageTemplate = String(body.emailMessage || DEFAULT_CLIENT_MESSAGE01).trim();
    const subjectTemplate = String(body.emailSubject || DEFAULT_EMAIL_SUBJECT01).trim();

    if (!whatsappMessageTemplate || !emailMessageTemplate || !subjectTemplate) {
      return NextResponse.json({ error: "WhatsApp inquiry, email subject, and email message cannot be empty." }, { status: 400 });
    }
    if (whatsappMessageTemplate.length > 4000 || emailMessageTemplate.length > 4000 || subjectTemplate.length > 200) {
      return NextResponse.json({ error: "The appointment notification content is too long." }, { status: 400 });
    }

    await db.collection("appointments").insertOne(appointment);

    const context = {
      name: appointment.client,
      phone: appointment.phone,
      email: appointment.email,
      service: appointment.service,
      date: appointment.date,
      time: appointment.start,
    };

    const whatsappMessage = renderWhatsAppInquiry(whatsappMessageTemplate, context);
    const whatsappUrl = buildWhatsAppInquiryUrl(whatsappMessage);
    const delivery = await sendClientMessage(context, {
      channel: "email",
      emailMessageTemplate,
      subjectTemplate,
    });

    await db.collection("appointments").updateOne(
      { id: appointment.id },
      {
        $set: {
          appointmentNotification: {
            whatsapp: {
              mode: "click_to_chat",
              businessNumber: BUSINESS_WHATSAPP_NUMBER,
              url: whatsappUrl,
            },
            email: delivery.email,
          },
          notificationAttemptedAt: new Date(),
          notificationContent: { whatsappMessageTemplate, emailMessageTemplate, subjectTemplate },
        },
      },
    );

    return NextResponse.json({ appointment, delivery, whatsappUrl }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Could not create appointment." }, { status: 500 });
  }
}
