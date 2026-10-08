export const dynamic = "force-dynamic";

/** Identifies our local server without exposing accounts, credentials or DB state. */
export function GET() {
  return Response.json({ app: "MiAgenda", mode: process.env.NODE_ENV }, { headers: { "Cache-Control": "no-store" } });
}
