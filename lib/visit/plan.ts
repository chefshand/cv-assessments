// Whole-visit assessment: one dictation feeds several modules. Each module's
// deterministic rules run unchanged on its own inputs; this file only (1)
// shares facts that mean the same thing across modules, (2) derives a few
// cross-module inputs (marked so the clinician can see and override them),
// and (3) reconciles overlapping recommendations into one A&P.
import type { FieldDef, FieldValue, Inputs, RuleResult, Severity } from "../types";
import { MODULES, getModule } from "../modules";
import { billingHints, type BillingHints, type RiskItem } from "../billing";
import { arr, num, str, yes } from "../util";

/** Keys whose meaning differs by module even where the type matches. */
const NEVER_SHARE = new Set(["symptoms", "meds", "priorYears", "riskFactors", "statin"]);

const sig = (f: FieldDef) => `${f.type}:${"options" in f ? f.options.map((o) => o.value).join("|") : ""}`;

/** Fields used by ≥2 of the chosen modules with the same meaning: key → module ids. */
export function sharedFields(ids: string[]): { key: string; field: FieldDef; modules: string[] }[] {
  const by = new Map<string, { field: FieldDef; modules: string[]; sigs: Set<string> }>();
  for (const id of ids) {
    const m = getModule(id);
    if (!m) continue;
    for (const f of m.fields) {
      if (NEVER_SHARE.has(f.key)) continue;
      const e = by.get(f.key) ?? { field: f, modules: [], sigs: new Set<string>() };
      e.modules.push(id);
      e.sigs.add(sig(f));
      by.set(f.key, e);
    }
  }
  return [...by.entries()]
    .filter(([, e]) => e.modules.length > 1 && e.sigs.size === 1)
    .map(([key, e]) => ({ key, field: e.field, modules: e.modules }));
}

/**
 * Make shared facts agree across modules after extraction: the first module
 * (in module order) that has a value supplies it to the others. Returns the
 * keys where modules disagreed so the confirm screen can flag them.
 */
export function unifyShared(byModule: Record<string, Inputs>, ids: string[]): { inputs: Record<string, Inputs>; conflicts: string[] } {
  const out: Record<string, Inputs> = {};
  for (const id of ids) out[id] = { ...(byModule[id] ?? {}) };
  const conflicts: string[] = [];
  for (const s of sharedFields(ids)) {
    const vals = s.modules.map((id) => out[id][s.key]).filter((v) => v !== undefined && v !== null);
    if (!vals.length) continue;
    if (new Set(vals.map((v) => JSON.stringify(v))).size > 1) conflicts.push(s.key);
    for (const id of s.modules) out[id][s.key] = vals[0] as FieldValue;
  }
  return { inputs: out, conflicts };
}

// ---------------------------------------------------------------- derivations

export type Derived = Record<string, Record<string, string>>; // module → key → reason

function fieldOf(id: string, key: string): FieldDef | undefined {
  return getModule(id)?.fields.find((f) => f.key === key);
}

/**
 * Fill a few blank inputs from another module's facts (e.g., AF's
 * CHA₂DS₂-VASc hypertension point from the BP module). Only blanks are filled;
 * anything the clinician sets wins.
 */
export function deriveInputs(byModule: Record<string, Inputs>, ids: string[]): { effective: Record<string, Inputs>; derived: Derived } {
  const eff: Record<string, Inputs> = {};
  const derived: Derived = {};
  for (const id of ids) { eff[id] = { ...(byModule[id] ?? {}) }; derived[id] = {}; }
  const fill = (id: string, key: string, value: FieldValue, why: string) => {
    if (!eff[id] || !fieldOf(id, key)) return;
    if (eff[id][key] !== undefined && eff[id][key] !== null) return;
    eff[id][key] = value;
    derived[id][key] = why;
  };
  const any = (pred: (v: Inputs, id: string) => boolean) => ids.some((id) => pred(byModule[id] ?? {}, id));

  // Statin: same fact, different option lists (HTN only asks yes/no).
  const statinSrc = ids.map((id) => str(byModule[id] ?? {}, "statin")).find(Boolean);
  if (statinSrc) {
    for (const id of ids) {
      const f = fieldOf(id, "statin");
      if (f?.type !== "select") continue;
      const v = f.options.some((o) => o.value === statinSrc) ? statinSrc : statinSrc === "none" ? "none" : "moderate";
      fill(id, "statin", v, "from statin noted elsewhere");
    }
  }

  // Hypertension facts from the BP module.
  const h = byModule.htn;
  if (h) {
    const meds = arr(h, "meds");
    const s = num(h, "sbp"), d = num(h, "dbp");
    const hasHtn = meds.length > 0 || (s != null && s >= 130) || (d != null && d >= 80);
    if (hasHtn) for (const id of ["af", "syncope"]) fill(id, "htn", true, meds.length ? "on BP medication (HTN module)" : `BP ${s ?? "?"}/${d ?? "?"} (HTN module)`);
    if (meds.length) for (const id of ["cac", "ascvd"]) fill(id, "bpTx", true, "on BP medication (HTN module)");
  }

  // Heart failure / clinical CVD into HTN and AF.
  const hfKnown = ids.includes("hf") || any((v) => yes(v, "chf") || yes(v, "hf"));
  if (hfKnown) {
    fill("htn", "hf", true, ids.includes("hf") ? "heart failure assessed this visit" : "heart failure noted");
    fill("af", "chf", true, ids.includes("hf") ? "heart failure assessed this visit" : "heart failure noted");
  }
  if (any((v) => yes(v, "priorAscvd"))) fill("htn", "clinicalCvd", true, "known ASCVD");

  // Uncontrolled BP is a bleeding risk factor on anticoagulation.
  const sbpAny = ids.map((id) => num(byModule[id] ?? {}, "sbp")).find((x) => x != null);
  if (eff.af && sbpAny != null && sbpAny > 160 && eff.af.bleed === undefined) {
    eff.af.bleed = ["uncontrolled_htn"];
    derived.af.bleed = `SBP ${sbpAny} >160`;
  }
  return { effective: eff, derived };
}

// ---------------------------------------------------------------- merge

export interface VisitRun {
  id: string;
  title: string;
  icon: string;
  result: RuleResult;
  /** A&P paragraph after cross-module edits (e.g., primary-prevention aspirin removed). */
  ap: string;
  /** Recommendation indexes superseded by a cross-module note. */
  superseded: number[];
}

export interface VisitNote {
  text: string;
  severity: Severity;
  cite?: string[];
  modules: string[];
}

export interface VisitPlan {
  runs: VisitRun[];
  notes: VisitNote[];
  ap: string;
  effective: Record<string, Inputs>;
  derived: Derived;
}

const SEV_RANK: Record<Severity, number> = { urgent: 0, warning: 1, action: 2, info: 3 };

function safeEval(id: string, v: Inputs): RuleResult {
  const m = getModule(id)!;
  try {
    return m.evaluate(v);
  } catch (e) {
    return { headline: "Could not evaluate", metrics: [], recommendations: [{ text: String(e), severity: "warning" }], missing: [], ap: "" };
  }
}

export function runVisit(byModule: Record<string, Inputs>, idsIn: string[]): VisitPlan {
  const ids = MODULES.map((m) => m.id).filter((id) => idsIn.includes(id));
  const { effective, derived } = deriveInputs(byModule, ids);
  const runs: VisitRun[] = ids.map((id) => {
    const m = getModule(id)!;
    const result = safeEval(id, effective[id]);
    return { id, title: m.title, icon: m.icon, result, ap: result.ap, superseded: [] };
  });
  const get = (id: string) => runs.find((r) => r.id === id);
  const notes: VisitNote[] = [];

  // R1. Anticoagulation for AF vs aspirin from the prevention modules.
  const af = get("af");
  const afv = effective.af ?? {};
  const onOac = !!str(afv, "oac") && str(afv, "oac") !== "none";
  const anticoag = !!af && !yes(afv, "oacContra") && (onOac || /: anticoagulat(e|ion reasonable)/.test(af.result.headline));
  if (anticoag) {
    const onAspirin = ids.some((id) => yes(effective[id], "aspirin") || arr(effective[id], "meds").includes("aspirin"));
    const ppSources = ["cac", "ascvd"].map(get).filter((r): r is VisitRun => !!r && /aspirin/i.test(r.ap + r.result.recommendations.map((x) => x.text).join(" ")));
    const cad = ids.some((id) => yes(effective[id], "priorAscvd") || yes(effective[id], "cad")) || !!get("chestpain") && /aspirin/i.test(get("chestpain")!.ap);
    for (const r of ppSources) {
      r.ap = r.ap
        .replace(/;\s*consider aspirin 81 mg daily[^;.]*/i, "")
        .replace(/\s*Low-dose aspirin may be considered[^.]*\./i, "");
      r.result.recommendations.forEach((x, i) => { if (/aspirin[^.]*may be considered/i.test(x.text)) r.superseded.push(i); });
    }
    if (ppSources.length || onAspirin || cad) {
      const verb = onOac ? "is anticoagulated" : "will start anticoagulation";
      let text: string;
      if (cad) {
        text = `Antithrombotic therapy: the patient ${verb} for AF. With chronic coronary disease more than 12 months after ACS or PCI, anticoagulant monotherapy is recommended over adding aspirin (1); continue aspirin only for a recent ACS/PCI indication, with a defined stop date.`;
      } else {
        text = `Aspirin: the patient ${verb} for AF, so aspirin for primary prevention is not added${ppSources.length ? " despite the calcium score" : ""}; adding aspirin to an anticoagulant increases major bleeding without lowering stroke risk.${onAspirin ? " Stop current aspirin unless there is a separate indication (e.g., ACS or PCI within 12 months)." : ""}`;
      }
      notes.push({ text, severity: onAspirin ? "warning" : "action", cite: ["af2023", "prim2019", ...(cad ? ["ccd2023"] : [])], modules: ["af", ...ppSources.map((r) => r.id), ...(cad && get("chestpain") ? ["chestpain"] : [])] });
    }
    const sbp = ids.map((id) => num(effective[id], "sbp")).find((x) => x != null);
    if (sbp != null && sbp > 160 && get("htn")) {
      notes.push({ text: `Bleeding risk: SBP ${sbp} (>160) is a modifiable bleeding risk factor on anticoagulation, which adds urgency to the BP plan.`, severity: "action", cite: ["af2023", "htn2025"], modules: ["af", "htn"] });
    }
  }

  // R2. Two LDL-C goals (CAC and risk-category modules): use the stricter one.
  const goalOf = (r?: VisitRun) => {
    if (!r) return null;
    const t = [r.result.headline, ...r.result.metrics.filter((x) => /LDL-C goal/i.test(x.label)).map((x) => `LDL-C goal ${x.value}`)].join(" ");
    const m = /LDL-C goal\s*<\s*(\d+)/i.exec(t);
    return m ? Number(m[1]) : null;
  };
  const gCac = goalOf(get("cac")), gAscvd = goalOf(get("ascvd"));
  if (gCac != null && gAscvd != null && gCac !== gAscvd) {
    notes.push({ text: `LDL-C goal: the calcium score supports <${gCac} mg/dL and the risk category supports <${gAscvd} mg/dL; use the stricter goal, <${Math.min(gCac, gAscvd)} mg/dL.`, severity: "action", cite: ["lipid2026"], modules: ["cac", "ascvd"] });
  }

  // R3. AF rate control also lowers BP.
  const htn = get("htn");
  if (af && htn && af.result.recommendations.some((x) => /^Rate control/.test(x.text)) && /\b(start|add)\b/i.test(htn.ap)) {
    notes.push({ text: "BP and rate control: the beta-blocker or diltiazem started for AF rate control will also lower BP. Recheck BP on it before adding another antihypertensive, and count it in the BP regimen.", severity: "info", cite: ["af2023", "htn2025"], modules: ["af", "htn"] });
  }

  // Order: problems with urgent items first, then app order.
  const worst = (r: VisitRun) => Math.min(4, ...r.result.recommendations.map((x) => SEV_RANK[x.severity ?? "info"]));
  runs.sort((a, b) => (worst(a) === 0 ? 0 : 1) - (worst(b) === 0 ? 0 : 1));

  const parts = runs.filter((r) => r.ap).map((r, i) => `${i + 1}. ${r.ap.trim()}`);
  if (notes.length) parts.push(`Across problems: ${notes.map((n) => n.text).join(" ")}`);
  return { runs, notes, ap: parts.join("\n\n"), effective, derived };
}

/** One billing seed for the whole visit: every problem, union of risk elements. */
export function visitBillingHints(plan: VisitPlan): BillingHints {
  const problems: BillingHints["problems"] = [];
  const risk = new Set<RiskItem>();
  const interp = new Set<string>();
  for (const r of plan.runs) {
    if (!r.ap) continue;
    const h = billingHints(r.id, r.title, plan.effective[r.id] ?? {}, r.ap, r.result.headline);
    problems.push(...h.problems);
    h.risk.forEach((x) => risk.add(x));
    h.interpretations.forEach((x) => interp.add(x));
  }
  return { problems, risk: [...risk], interpretations: [...interp] };
}
