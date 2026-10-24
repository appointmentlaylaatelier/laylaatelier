import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { createCalendarPdf, createTextPdf, type AppointmentPdfSummary } from "@/lib/pdf";
import { inferAppointmentType } from "@/lib/services";
import { formatTimeRange12 } from "@/lib/time";

export const runtime = "nodejs";

type ReportAppointment = { client?: string; phone?: string; email?: string; appointmentType?: string; date?: string; start?: string; end?: string; service?: string; status?: string; called?: boolean; designerAssigned?: string; placementStatus?: string };
function clean(value: unknown) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function normalizePhone(value: unknown) { return clean(value).replace(/\D/g, "").replace(/^974/, ""); }

export async function GET(request: NextRequest) {
  const session = sessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const requestedType = request.nextUrl.searchParams.get("type");
    const type = requestedType === "clients" ? "clients" : requestedType === "calendar" ? "calendar" : "appointments";
    const view = request.nextUrl.searchParams.get("view") || "Schedule";
    const heading = request.nextUrl.searchParams.get("heading") || "";
    const period = request.nextUrl.searchParams.get("period") || "";
    const search = request.nextUrl.searchParams.get("search")?.trim() || "";
    const from = request.nextUrl.searchParams.get("from") || "0000-01-01";
    const to = request.nextUrl.searchParams.get("to") || "9999-12-31";
    const status = request.nextUrl.searchParams.get("status");
    const appointmentType = request.nextUrl.searchParams.get("appointmentType");
    const selectedServices = request.nextUrl.searchParams.getAll("service").filter(Boolean);
    const query: Record<string, unknown> = { date: { $gte: from, $lte: to } };
    if (status && status !== "All") query.status = status;
    if (selectedServices.length) query.service = { $in: selectedServices };
    const db = await getDb();
    let appointments = await db.collection("appointments").find(query).sort({ date: 1, start: 1 }).toArray() as ReportAppointment[];
    if (search) {
      const normalizedSearch = search.toLowerCase();
      const searchDigits = normalizePhone(search);
      appointments = appointments.filter(item => clean(item.client).toLowerCase().includes(normalizedSearch) || (!!searchDigits && normalizePhone(item.phone).includes(searchDigits)));
    }
    if (appointmentType && appointmentType !== "All") {
      appointments = appointments.filter(item => inferAppointmentType(clean(item.service), item.appointmentType) === appointmentType);
    }

    let title = "LELA ATELIER - Appointment Report";
    let rows: string[];
    if (type === "clients") {
      title = "LELA ATELIER - Client Report";
      const clients = new Map<string, { client: string; phone: string; email: string; count: number; lastDate: string }>();
      for (const item of appointments) {
        const key = clean(item.email).toLowerCase() || clean(item.phone); const existing = clients.get(key);
        if (existing) { existing.count += 1; if (clean(item.date) > existing.lastDate) existing.lastDate = clean(item.date); }
        else clients.set(key, { client: clean(item.client), phone: clean(item.phone), email: clean(item.email), count: 1, lastDate: clean(item.date) });
      }
      rows = ["CLIENT | PHONE | EMAIL | APPOINTMENTS | LAST APPOINTMENT", ...Array.from(clients.values()).map((c) => `${c.client} | ${c.phone} | ${c.email} | ${c.count} | ${c.lastDate}`)];
    } else if (type === "calendar") {
      title = "LELA ATELIER - Calendar Schedule";
      rows = [];
    } else {
      rows = ["CLIENT | DATE/TIME | TYPE | SERVICE | VISIT STATUS | ORDER STATUS", ...appointments.map((a) => `${clean(a.client)} | ${clean(a.date)} ${formatTimeRange12(clean(a.start), clean(a.end))} | ${inferAppointmentType(clean(a.service), a.appointmentType)} | ${clean(a.service)} | ${clean(a.status)} | ${clean(a.placementStatus) || "Not placed"}`)];
    }
    if (type !== "calendar" && rows.length === 1) rows.push("No records found for this date range.");

    const subtitleParts = [`Range: ${from} to ${to}`];
    if (period) subtitleParts.push(`Range view: ${period}`);
    if (type === "calendar") subtitleParts.push(`View: ${view}`);
    if (type !== "appointments") {
      if (appointmentType && appointmentType !== "All") subtitleParts.push(`Type: ${appointmentType}`);
      if (status && status !== "All") subtitleParts.push(`Status: ${status}`);
      if (selectedServices.length) subtitleParts.push(`Services: ${selectedServices.join(", ")}`);
      if (search) subtitleParts.push(`Search: ${search}`);
    }
    const appointmentSummary: AppointmentPdfSummary | undefined = type === "appointments" ? {
      canceled: appointments.filter(a => clean(a.status) === "Canceled").length,
      noShow: appointments.filter(a => clean(a.status) === "No show").length,
      placed: appointments.filter(a => (clean(a.placementStatus) || "Not placed") === "Placed").length,
      arrivedPlaced: appointments.filter(a => clean(a.status) === "Arrived" && (clean(a.placementStatus) || "Not placed") === "Placed").length,
      walkInPlaced: appointments.filter(a => clean(a.status) === "Walk-in" && (clean(a.placementStatus) || "Not placed") === "Placed").length,
      notPlaced: appointments.filter(a => (clean(a.placementStatus) || "Not placed") === "Not placed").length,
      followUp: appointments.filter(a => (clean(a.placementStatus) || "Not placed") === "Follow-up").length,
      walkIn: appointments.filter(a => clean(a.status) === "Walk-in").length,
      walkInNotPlaced: appointments.filter(a => clean(a.status) === "Walk-in" && (clean(a.placementStatus) || "Not placed") === "Not placed").length,
    } : undefined;
    const pdf = type === "calendar"
      ? createCalendarPdf(title, subtitleParts.join(" | "), appointments.map(item => ({ client: clean(item.client), appointmentType: inferAppointmentType(clean(item.service), item.appointmentType), date: clean(item.date), start: clean(item.start), end: clean(item.end), service: clean(item.service), status: clean(item.status) })), view, from, to, heading)
      : createTextPdf(title, subtitleParts.join(" | "), rows, appointmentSummary);
    const filename = type === "calendar" ? `atelier-calendar-${view.toLowerCase()}-${from}-to-${to}.pdf` : `atelier-${type}-${from}-to-${to}.pdf`;
    return new NextResponse(pdf, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not generate report." }, { status: 500 });
  }
}
