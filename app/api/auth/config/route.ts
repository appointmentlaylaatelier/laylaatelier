import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    managerEmail: process.env.MANAGER_EMAIL || process.env.SEED_MANAGER_EMAIL || "manager@atelier.pk",
    receptionistEmail: process.env.RECEPTIONIST_EMAIL || process.env.SEED_RECEPTIONIST_EMAIL || "reception@atelier.pk",
  });
}
