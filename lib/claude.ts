// Server-only Claude helpers. Nothing here logs request or response bodies.
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

/** Error whose message is safe to show to the client (never contains secrets). */
export class ConfigError extends Error {}

/**
 * Read and sanity-check the API key. Trims whitespace/quotes and a stray
 * "Bearer " prefix that often sneaks in when pasting into Vercel.
 */
export function readApiKey(raw: string | undefined = process.env.ANTHROPIC_API_KEY): string {
  const key = (raw ?? "").trim().replace(/^["']|["']$/g, "").replace(/^Bearer\s+/i, "").trim();
  if (!key) throw new ConfigError("Server misconfigured: ANTHROPIC_API_KEY is not set in Vercel.");
  if (!key.startsWith("sk-ant-") || /\s/.test(key)) {
    throw new ConfigError("Server misconfigured: ANTHROPIC_API_KEY in Vercel is malformed (it must be only the key, starting with sk-ant-, with no other text). Fix it in Vercel → Settings → Environment Variables and redeploy.");
  }
  return key;
}

let client: Anthropic | null = null;
let clientKey = "";
export function getClient(): Anthropic {
  const apiKey = readApiKey();
  if (!client || clientKey !== apiKey) {
    client = new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 });
    clientKey = apiKey;
  }
  return client;
}

export interface CallOpts {
  system: string;
  user: string;
  schema?: Record<string, unknown>;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}

/** Single Messages call; returns the text output. Throws on refusal. */
export async function callClaude(o: CallOpts): Promise<string> {
  const res = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: o.maxTokens ?? 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: o.system,
    messages: [{ role: "user", content: o.user }],
    output_config: {
      effort: o.effort ?? "low",
      ...(o.schema ? { format: { type: "json_schema" as const, schema: o.schema } } : {}),
    },
  });
  if (res.stop_reason === "refusal") throw new ConfigError("The AI declined this request. Try rephrasing.");
  if (res.stop_reason === "max_tokens") throw new ConfigError("The AI response was cut off; try shorter input.");
  return res.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
}

export const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * Map any error to a client-safe message. Raw SDK/runtime messages are never
 * returned: they can echo request headers (including the API key).
 */
export function apiError(e: unknown): { status: number; message: string } {
  if (e instanceof ConfigError) return { status: 500, message: e.message };
  if (e instanceof Anthropic.AuthenticationError) return { status: 500, message: "Server misconfigured: the Anthropic API key was rejected. Check ANTHROPIC_API_KEY in Vercel." };
  if (e instanceof Anthropic.PermissionDeniedError) return { status: 500, message: "The Anthropic API key does not have access to this model." };
  if (e instanceof Anthropic.RateLimitError) return { status: 429, message: "Rate limited by the AI service; try again shortly." };
  if (e instanceof Anthropic.APIConnectionError) return { status: 502, message: "Could not reach the AI service. Try again." };
  if (e instanceof Anthropic.APIError) return { status: 502, message: `AI service error (${e.status ?? "unknown"}). Try again.` };
  if (e instanceof SyntaxError) return { status: 502, message: "The AI returned an unreadable response. Try again." };
  return { status: 500, message: "The AI request failed. Try again." };
}
