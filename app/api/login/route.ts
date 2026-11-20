import { NextResponse } from "next/server";
import { AUTH_COOKIE, AUTH_MAX_AGE, expectedToken, safeEqual } from "@/lib/auth";

export const runtime = "nodejs";

// Slow down guessing: per-instance failure counter with a short lockout.
const fails = new Map<string, { n: number; until: number }>();

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const f = fails.get(ip);
  if (f && f.until > Date.now()) {
    return NextResponse.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
  }
  const pass = process.env.APP_PASSCODE;
  if (!pass) {
    return NextResponse.json({ error: "APP_PASSCODE is not configured on the server." }, { status: 500 });
  }
  let body: { passcode?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* ignore */
  }
  const given = typeof body.passcode === "string" ? body.passcode : "";
  if (!safeEqual(given, pass)) {
    const n = (f?.n ?? 0) + 1;
    fails.set(ip, { n, until: n >= 5 ? Date.now() + 5 * 60_000 : 0 });
    await new Promise((r) => setTimeout(r, 600));
    return NextResponse.json({ error: "Incorrect passcode" }, { status: 401 });
  }
  fails.delete(ip);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, (await expectedToken())!, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: AUTH_MAX_AGE,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(AUTH_COOKIE);
  return res;
}
