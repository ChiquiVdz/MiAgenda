import { NextResponse } from "next/server";
import { coreRuntime } from "@/lib/core-runtime";
import { cleanupCoreCron } from "../../../../../reconstruction/core/src/retention";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "La tarea de retención no está configurada." }, { status: 503, headers });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "No autorizado." }, { status: 401, headers });
  try { return NextResponse.json(await cleanupCoreCron(coreRuntime().db), { headers }); }
  catch { return NextResponse.json({ error: "No pudimos completar la limpieza." }, { status: 503, headers }); }
}
