import { NextResponse } from "next/server";
import { getModule } from "@/lib/modules";
import { apiError, callClaude, NO_STORE } from "@/lib/claude";
import type { Inputs } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// The recommendation itself is always recomputed server-side by the
// deterministic rule engine; Claude only rewrites it into note-ready prose.
export async function POST(req: Request) {
  let body: { module?: string; inputs?: Inputs; style?: string; extra?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: NO_STORE });
  }
  const m = body.module ? getModule(body.module) : undefined;
  if (!m || !body.inputs || typeof body.inputs !== "object") {
    return NextResponse.json({ error: "Missing module or inputs" }, { status: 400, headers: NO_STORE });
  }
  const style = body.style === "bullets" ? "bullets" : body.style === "brief" ? "brief" : "paragraph";
  const extra = typeof body.extra === "string" ? body.extra.slice(0, 1000) : "";
  let result;
  try {
    result = m.evaluate(body.inputs);
  } catch {
    return NextResponse.json({ error: "Could not evaluate inputs" }, { status: 400, headers: NO_STORE });
  }

  const styleText =
    style === "bullets"
      ? "Format: a one-line assessment sentence, then a numbered plan list (one action per line). Plain text, no markdown bold or headers."
      : style === "brief"
        ? "Format: 2-3 sentences maximum, terse clinical shorthand acceptable."
        : "Format: one cohesive paragraph (4-8 sentences).";

  const system = `You write the Assessment & Plan entry for a cardiologist's clinic note.
You are given the output of a deterministic, guideline-based rule engine. Rewrite it into polished, natural, patient-specific clinical prose that can be pasted directly into an EHR note.

Hard rules:
- Preserve every number, threshold, drug, dose, interval and recommendation from the draft. Do not add any recommendation, test, drug or number that is not in the draft or the inputs.
- Keep the guideline attribution (e.g., "per the 2022 ACC/AHA aortic guideline").
- Write as the treating cardiologist ("Recommend…", "Will…"). No preamble, no headings like "Assessment:", no markdown, no disclaimers.
- Never include names or identifiers.
- ${styleText}`;

  const user = `Module: ${m.title}
Headline: ${result.headline}
Key metrics:
${result.metrics.map((x) => `- ${x.label}: ${x.value}${x.note ? ` (${x.note})` : ""}`).join("\n")}
Guideline recommendations:
${result.recommendations.map((r) => `- [${r.severity ?? "info"}] ${r.text}`).join("\n")}
Draft A&P (deterministic):
${result.ap}
${extra ? `\nClinician's additional context to weave in (do not add recommendations from it): ${extra}` : ""}`;

  try {
    const text = await callClaude({ system, user, effort: "low", maxTokens: 3000 });
    return NextResponse.json({ text }, { headers: NO_STORE });
  } catch (e) {
    const { status, message } = apiError(e);
    return NextResponse.json({ error: message }, { status, headers: NO_STORE });
  }
}
