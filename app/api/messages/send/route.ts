import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth";
import { ensureBootstrap } from "@/lib/bootstrap";
import { getDb } from "@/lib/mongodb";
import { DEFAULT_CLIENT_MESSAGE02, DEFAULT_EMAIL_SUBJECT02, deliverySummary, sendClientMessage, type EmailAttachment } from "@/lib/messaging";
import { formatTimeRange12 } from "@/lib/time";

export const runtime = "nodejs";

type Audience = "all" | "week" | "month" | "year" | "custom";
type AppointmentDoc = { client: string; phone: string; email: string; service: string; date: string; start: string; end: string };

function isoDate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function presetRange(audience: Exclude<Audience, "all" | "custom">) {
  const start = new Date(); const end = new Date();
  if (audience === "week") { const day = (start.getDay() + 6) % 7; start.setDate(start.getDate() - day); end.setTime(start.getTime()); end.setDate(start.getDate() + 6); }
  else if (audience === "month") { start.setDate(1); end.setMonth(end.getMonth() + 1, 0); }
  else { start.setMonth(0, 1); end.setMonth(11, 31); }
  return { from: isoDate(start), to: isoDate(end) };
}
function clientKey(item: AppointmentDoc) { return (item.email || item.phone.replace(/\D/g, "")).toLowerCase(); }

export async function POST(request: NextRequest) {
  const session = sessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    const audience = String(body.audience || "") as Audience;
    const validAudience: Audience[] = ["all", "week", "month", "year", "custom"];
    if (!validAudience.includes(audience)) return NextResponse.json({ error: "Invalid audience." }, { status: 400 });
    if (body.channel && body.channel !== "email") return NextResponse.json({ error: "Messaging campaigns support email only." }, { status: 400 });

    const message = String(body.message || DEFAULT_CLIENT_MESSAGE02).trim();
    const subject = String(body.subject || DEFAULT_EMAIL_SUBJECT02).trim();
    if (!message) return NextResponse.json({ error: "Message cannot be empty." }, { status: 400 });
    if (!subject) return NextResponse.json({ error: "Email subject cannot be empty." }, { status: 400 });

    let attachment: EmailAttachment | undefined;
    if (body.attachment) {
      const name = String(body.attachment.name || "image").trim();
      const type = String(body.attachment.type || "").trim();
      const data = String(body.attachment.data || "").trim();
      if (!type.startsWith("image/")) return NextResponse.json({ error: "Attachment must be an image." }, { status: 400 });
      if (!data) return NextResponse.json({ error: "Attachment data is missing." }, { status: 400 });
      const bytes = Buffer.from(data, "base64");
      if (bytes.length > 5 * 1024 * 1024) return NextResponse.json({ error: "Image attachment must be 5 MB or smaller." }, { status: 400 });
      attachment = { name, type, data };
    }

    let from: string | undefined; let to: string | undefined;
    if (audience === "all") to = isoDate();
    else if (audience === "custom") { from = String(body.from || ""); to = String(body.to || ""); if (!from || !to || from > to) return NextResponse.json({ error: "Choose a valid From and To date." }, { status: 400 }); }
    else ({ from, to } = presetRange(audience));

    await ensureBootstrap();
    const db = await getDb();
    const query: Record<string, unknown> = {};
    if (from || to) query.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
    const documents = await db.collection("appointments").find(query).sort({ date: -1, start: -1 }).toArray() as AppointmentDoc[];
    const unique = new Map<string, AppointmentDoc>();
    for (const item of documents) { const key = clientKey(item); if (key && !unique.has(key)) unique.set(key, item); }
    const clients = [...unique.values()];
    if (!clients.length) return NextResponse.json({ error: "No clients match the selected audience." }, { status: 400 });

    let emailDelivered = 0, emailFailed = 0, emailSkipped = 0;
    for (const client of clients) {
      const context = { name: client.client, phone: client.phone, email: client.email, service: client.service, date: client.date, time: formatTimeRange12(client.start, client.end) };
      const result = await sendClientMessage(context, { channel: "email", messageTemplate: message, subjectTemplate: subject, attachment });
      const summary = deliverySummary(result);
      emailDelivered += summary.delivered; emailFailed += summary.failed; emailSkipped += summary.skipped;
    }

    const campaign = { id: randomUUID(), audience, channel: "email", from: from || null, to: to || null, clientCount: clients.length, delivered: emailDelivered, failed: emailFailed, skipped: emailSkipped, emailDelivered, emailFailed, emailSkipped, attachmentName: attachment?.name || null, sentByRole: session.role, sentAt: new Date() };
    await db.collection("message_campaigns").insertOne(campaign);
    return NextResponse.json(campaign);
  } catch {
    return NextResponse.json({ error: "Could not process the email campaign." }, { status: 500 });
  }
}
