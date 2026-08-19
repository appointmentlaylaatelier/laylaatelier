import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { createTextPdf } from "@/lib/pdf";
import { formatTimeRange12 } from "@/lib/time";

export const runtime = "nodejs";

type ReportAppointment = { client?: string; phone?: string; email?: string; date?: string; start?: string; end?: string; service?: string; status?: string; called?: boolean; designerAssigned?: string; placementStatus?: string };
function clean(value: unknown) { return String(value ?? "").replace(/\s+/g, " ").trim(); }

export async function GET(request: NextRequest) {
  const session = sessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const type = request.nextUrl.searchParams.get("type") === "clients" ? "clients" : "appointments";
    const from = request.nextUrl.searchParams.get("from") || "0000-01-01";
    const to = request.nextUrl.searchParams.get("to") || "9999-12-31";
    const status = request.nextUrl.searchParams.get("status");
    const selectedServices = request.nextUrl.searchParams.getAll("service").filter(Boolean);
    const query: Record<string, unknown> = { date: { $gte: from, $lte: to } };
    if (status && status !== "All") query.status = status;
    if (selectedServices.length) query.service = { $in: selectedServices };
    const db = await getDb();
    const appointments = await db.collection("appointments").find(query).sort({ date: 1, start: 1 }).toArray() as ReportAppointment[];

    let title = "LELA ATELIER - Appointment Report"; let rows: string[];
    if (type === "clients") {
      title = "LELA ATELIER - Client Report";
      const clients = new Map<string, { client: string; phone: string; email: string; count: number; lastDate: string }>();
      for (const item of appointments) {
        const key = clean(item.email).toLowerCase() || clean(item.phone); const existing = clients.get(key);
        if (existing) { existing.count += 1; if (clean(item.date) > existing.lastDate) existing.lastDate = clean(item.date); }
        else clients.set(key, { client: clean(item.client), phone: clean(item.phone), email: clean(item.email), count: 1, lastDate: clean(item.date) });
      }
      rows = ["CLIENT | PHONE | EMAIL | APPOINTMENTS | LAST APPOINTMENT", ...Array.from(clients.values()).map((c) => `${c.client} | ${c.phone} | ${c.email} | ${c.count} | ${c.lastDate}`)];
    } else {
      rows = ["CLIENT | DATE/TIME | SERVICE | DESIGNER | VISIT STATUS | ORDER STATUS", ...appointments.map((a) => `${clean(a.client)} | ${clean(a.date)} ${formatTimeRange12(clean(a.start), clean(a.end))} | ${clean(a.service)} | ${clean(a.designerAssigned) || "—"} | ${clean(a.status)} | ${clean(a.placementStatus) || "Not placed"}`)];
    }
    if (rows.length === 2) rows.push("No records found for this date range.");
    const pdf = createTextPdf(title, `Range: ${from} to ${to}${status && status !== "All" ? ` | Status: ${status}` : ""}${selectedServices.length ? ` | Services: ${selectedServices.join(", ")}` : ""}`, rows);
    const filename = `atelier-${type}-${from}-to-${to}.pdf`;
    return new NextResponse(pdf, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not generate report." }, { status: 500 });
  }
}
