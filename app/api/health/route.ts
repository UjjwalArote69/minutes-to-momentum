import { connection } from "next/server";

// GET /api/health -> {"ok":true}. For uptime pingers and Render's health check: touches neither
// the AI nor the database. connection() keeps it answered live per request (with Cache Components
// a GET handler would otherwise be prerendered at build time). Diagnostics live at /api/status.
export async function GET() {
  await connection();
  return Response.json({ ok: true });
}
