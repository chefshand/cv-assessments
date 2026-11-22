import { NextResponse } from "next/server";
import { getModule } from "@/lib/modules";
import { apiError, NO_STORE } from "@/lib/claude";
import { extractModule, MAX_CHARS } from "@/lib/extract";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: { module?: string; text?: string; multi?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: NO_STORE });
  }
  const m = body.module ? getModule(body.module) : undefined;
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!m) return NextResponse.json({ error: "Unknown module" }, { status: 400, headers: NO_STORE });
  if (!text) return NextResponse.json({ error: "No text provided" }, { status: 400, headers: NO_STORE });
  if (text.length > MAX_CHARS) return NextResponse.json({ error: `Text too long (max ${MAX_CHARS} characters)` }, { status: 413, headers: NO_STORE });

  try {
    const out = await extractModule(m, text, { multi: body.multi === true });
    return NextResponse.json(out, { headers: NO_STORE });
  } catch (e) {
    const { status, message } = apiError(e);
    return NextResponse.json({ error: message }, { status, headers: NO_STORE });
  }
}
