import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, isAuthed } from "./lib/auth";

export async function proxy(req: NextRequest) {
  const ok = await isAuthed(req.cookies.get(AUTH_COOKIE)?.value);
  if (ok) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except the login page/API, Next internals, and PWA static assets.
  matcher: ["/((?!login|api/login|_next/|manifest.webmanifest|sw.js|icons/|favicon.ico|robots.txt).*)"],
};
