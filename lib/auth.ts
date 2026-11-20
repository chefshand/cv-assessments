// Simple passcode gate. The passcode lives only in the APP_PASSCODE env var;
// the cookie holds an HMAC derived from it, so changing the passcode signs
// everyone out. Uses Web Crypto so it runs in both the proxy and route handlers.

export const AUTH_COOKIE = "cva_auth";
export const AUTH_MAX_AGE = 60 * 60 * 24 * 90; // 90 days

const enc = new TextEncoder();

async function hmac(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(msg));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function passcodeConfigured(): boolean {
  return !!process.env.APP_PASSCODE;
}

export async function expectedToken(): Promise<string | null> {
  const pass = process.env.APP_PASSCODE;
  if (!pass) return null;
  return hmac(pass, `cv-assessments:v1:${process.env.AUTH_SECRET ?? ""}`);
}

/** Constant-time string compare. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function isAuthed(cookieValue: string | undefined): Promise<boolean> {
  const exp = await expectedToken();
  if (!exp) return process.env.NODE_ENV !== "production"; // open in local dev only
  return !!cookieValue && safeEqual(cookieValue, exp);
}
