import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { getModelName } from "@/lib/ai";

// GET /api/health -> confirms the DB tables exist and which env vars are set.
// Never returns secret values, only true/false.
export async function GET() {
  await connection();
  const tables = (
    getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[]
  ).map((t) => t.name);

  return Response.json({
    ok: true,
    tables,
    env: {
      GEMINI_API_KEY: Boolean(process.env.GEMINI_API_KEY?.trim()),
      GEMINI_MODEL: getModelName(),
      NOTION_TOKEN: Boolean(process.env.NOTION_TOKEN?.trim()),
      NOTION_DATABASE_ID: Boolean(process.env.NOTION_DATABASE_ID?.trim()),
    },
  });
}
