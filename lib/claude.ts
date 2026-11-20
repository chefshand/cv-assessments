// Server-only Claude helpers. Nothing here logs request or response bodies.
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

let client: Anthropic | null = null;
export function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");
  client ??= new Anthropic({ maxRetries: 2, timeout: 60_000 });
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
  if (res.stop_reason === "refusal") throw new Error("The model declined this request.");
  if (res.stop_reason === "max_tokens") throw new Error("Response was cut off; try shorter input.");
  return res.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
}

export const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export function apiError(e: unknown): { status: number; message: string } {
  if (e instanceof Anthropic.AuthenticationError) return { status: 500, message: "Anthropic API key is invalid." };
  if (e instanceof Anthropic.RateLimitError) return { status: 429, message: "Rate limited by the AI service; try again shortly." };
  if (e instanceof Anthropic.APIConnectionError) return { status: 502, message: "Could not reach the AI service." };
  if (e instanceof Anthropic.APIError) return { status: 502, message: `AI service error (${e.status ?? "unknown"}).` };
  return { status: 500, message: e instanceof Error ? e.message : "Unexpected error" };
}
