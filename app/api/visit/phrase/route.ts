import { NextResponse } from "next/server";
import { MODULES } from "@/lib/modules";
import { apiError, callClaude, NO_STORE } from "@/lib/claude";
import { runVisit } from "@/lib/visit/plan";
import type { Inputs } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// The merged plan is recomputed here by the same deterministic rules; Claude
// only rewrites it into note-ready prose.
export async function POST(req: Request) {
  let body: { inputs?: Record<string, Inputs>; style?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: NO_STORE });
  }
  const ids = MODULES.map((m) => m.id).filter((id) => body.inputs && typeof body.inputs[id] === "object");
  if (!ids.length) return NextResponse.json({ error: "Missing inputs" }, { status: 400, headers: NO_STORE });
  const plan = runVisit(body.inputs!, ids);
  if (!plan.ap) return NextResponse.json({ error: "Nothing to polish yet" }, { status: 400, headers: NO_STORE });
  const style = body.style === "brief" ? "brief" : body.style === "paragraph" ? "paragraph" : "bullets";
  const styleText =
    style === "brief"
      ? "Format: one numbered line per problem, terse clinical shorthand (problem: key finding; plan)."
      : style === "paragraph"
        ? "Format: one short paragraph per problem, each starting with the problem name and numbered 1., 2., …"
        : "Format: for each problem, a numbered heading line with the problem name and a one-line assessment, then the plan as short lines starting with \"- \".";

  const system = `You write the Assessment & Plan for a cardiologist's clinic note covering several problems.
You are given the output of deterministic, guideline-based rule engines, one per problem, plus cross-problem reconciliation notes. Rewrite it into one concise, patient-specific A&P that can be pasted into an EHR note.

Hard rules:
- Preserve every number, threshold, drug, dose, interval and recommendation in the draft. Do not add any recommendation, test, drug or number that is not in the draft.
- The cross-problem notes override the per-problem text where they conflict (e.g., aspirin not added because of anticoagulation). Put each note under the problem it affects instead of repeating it.
- Say each shared item once (e.g., one lipid panel, one BP goal) even if two problems mention it.
- Keep guideline attributions short (e.g., "per 2023 ACC/AHA AF guideline").
- Write as the treating cardiologist. No preamble, no markdown bold or headers, no disclaimers, no identifiers.
- ${styleText}`;

  const user = plan.runs.filter((r) => r.ap).map((r, i) => `Problem ${i + 1} (${r.title})
Headline: ${r.result.headline}
Metrics: ${r.result.metrics.map((x) => `${x.label} ${x.value}${x.note ? ` (${x.note})` : ""}`).join("; ")}
Draft: ${r.ap}`).join("\n\n") + (plan.notes.length ? `\n\nCross-problem notes:\n${plan.notes.map((n) => `- ${n.text}`).join("\n")}` : "");

  try {
    const text = await callClaude({ system, user, effort: "low", maxTokens: 4000 });
    return NextResponse.json({ text }, { headers: NO_STORE });
  } catch (e) {
    const { status, message } = apiError(e);
    return NextResponse.json({ error: message }, { status, headers: NO_STORE });
  }
}
