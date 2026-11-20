import type { ClinicalModule, FieldDef, Inputs, Metric, Recommendation, RuleResult } from "../types";
import { ageSex, arr, fmt, list, num, str, yes } from "../util";
import { cites } from "../citations";

export const PA_MEDS = [
  // Renin-raising -> lower ARR -> false-negative risk
  { value: "mra", label: "MRA (spironolactone/eplerenone/finerenone)", effect: "fn", washout: "4 weeks", noun: "an MRA" },
  { value: "enac", label: "Amiloride / triamterene", effect: "fn", washout: "4 weeks", noun: "amiloride/triamterene" },
  { value: "diuretic", label: "Thiazide / loop diuretic", effect: "fn", washout: "4 weeks", noun: "a thiazide/loop diuretic" },
  { value: "acei", label: "ACE inhibitor", effect: "fn", washout: "2 weeks", noun: "an ACE inhibitor" },
  { value: "arb", label: "ARB / ARNI", effect: "fn", washout: "2 weeks", noun: "an ARB/ARNI" },
  { value: "dhp", label: "Dihydropyridine CCB", effect: "fn", washout: "2 weeks", noun: "a dihydropyridine CCB" },
  { value: "sglt2", label: "SGLT2 inhibitor", effect: "fn", washout: "2 weeks", noun: "an SGLT2 inhibitor" },
  // Renin-lowering -> raise ARR -> false-positive risk
  { value: "bb", label: "Beta-blocker", effect: "fp", washout: "2 weeks", noun: "a beta-blocker" },
  { value: "a2", label: "Clonidine / methyldopa", effect: "fp", washout: "2 weeks (taper clonidine)", noun: "clonidine/methyldopa" },
  { value: "nsaid", label: "NSAIDs", effect: "fp", washout: "2 weeks", noun: "NSAIDs" },
  { value: "estrogen", label: "Estrogen OCP / HRT", effect: "fp_drc", washout: "6 weeks (if switching contraception)", noun: "estrogen" },
  { value: "ssri", label: "SSRI", effect: "fp_minor", washout: "-", noun: "an SSRI" },
  { value: "aliskiren", label: "Aliskiren", effect: "aliskiren", washout: "2 weeks", noun: "aliskiren" },
  // Minimal effect (acceptable during testing)
  { value: "verapamil", label: "Verapamil SR", effect: "neutral", washout: "-", noun: "verapamil SR" },
  { value: "hydralazine", label: "Hydralazine", effect: "neutral", washout: "-", noun: "hydralazine" },
  { value: "alpha", label: "Doxazosin / prazosin / terazosin", effect: "neutral", washout: "-", noun: "an alpha-1 blocker" },
] as const;

const fields: FieldDef[] = [
  { key: "age", label: "Age", type: "number", unit: "y", section: "Patient" },
  { key: "sex", label: "Sex", type: "select", section: "Patient", options: [ { value: "female", label: "Female" }, { value: "male", label: "Male" } ] },
  { key: "aldo", label: "Plasma aldosterone", type: "number", section: "Labs", extractHint: "Numeric value only; unit goes in aldoUnit." },
  { key: "aldoUnit", label: "Aldosterone unit", type: "select", section: "Labs", options: [ { value: "ng/dL", label: "ng/dL" }, { value: "pmol/L", label: "pmol/L" } ] },
  { key: "aldoAssay", label: "Aldosterone assay", type: "select", section: "Labs", help: "LC-MS/MS reads ~25-30% lower than immunoassay; Quest and LabCorp use LC-MS/MS.", options: [ { value: "lcms", label: "LC-MS/MS" }, { value: "immuno", label: "Immunoassay" } ] },
  { key: "renin", label: "Renin", type: "number", section: "Labs", extractHint: "If reported as '<0.6' or similar, use the number (0.6)." },
  { key: "reninType", label: "Renin assay", type: "select", section: "Labs", options: [ { value: "pra", label: "PRA (ng/mL/h)" }, { value: "drc_mu", label: "DRC (mU/L)" }, { value: "drc_pg", label: "DRC (pg/mL)" } ] },
  { key: "k", label: "Potassium at time of test", type: "number", unit: "mmol/L", step: 0.1, section: "Labs" },
  { key: "kSupplement", label: "On K+ supplement", type: "bool", section: "Labs" },
  { key: "egfr", label: "eGFR", type: "number", section: "Labs" },
  {
    key: "meds", label: "Medications at time of testing", type: "multi", section: "Medications at testing",
    options: PA_MEDS.map((m) => ({ value: m.value, label: m.label })),
  },
  {
    key: "clinical", label: "Clinical context", type: "multi", section: "Clinical",
    options: [
      { value: "resistant", label: "Resistant HTN" },
      { value: "hypok_spont", label: "Spontaneous hypokalemia" },
      { value: "hypok_diuretic", label: "Diuretic-induced hypokalemia" },
      { value: "incidentaloma", label: "Adrenal incidentaloma" },
      { value: "af", label: "AF without structural cause" },
      { value: "osa", label: "Sleep apnea" },
      { value: "young", label: "HTN onset <40 / FHx early stroke" },
      { value: "fhx_pa", label: "FHx primary aldosteronism" },
    ],
  },
  {
    key: "ct", label: "Adrenal CT", type: "select", section: "Next steps (if known)",
    options: [ { value: "not_done", label: "Not done" }, { value: "normal", label: "Normal" }, { value: "unilateral", label: "Unilateral adenoma >1 cm" }, { value: "bilateral", label: "Bilateral / hyperplasia" } ],
  },
  { key: "confirmed", label: "Confirmatory test positive", type: "bool", section: "Next steps (if known)" },
  { key: "surgeryCandidate", label: "Would consider adrenalectomy", type: "bool", section: "Next steps (if known)" },
];

export interface PaInterpretation {
  aldoNgdl: number;
  aldoPmol: number;
  reninSuppressed: boolean;
  aldoHigh: boolean;
  arr: number;
  arrCutoff: number;
  arrUnits: string;
  arrHigh: boolean;
  status: "positive" | "negative" | "indeterminate";
}

export function interpretPa(v: Inputs): PaInterpretation | null {
  const aldo = num(v, "aldo");
  const renin = num(v, "renin");
  if (aldo == null || renin == null) return null;
  const unit = str(v, "aldoUnit") ?? (aldo > 100 ? "pmol/L" : "ng/dL");
  const assay = str(v, "aldoAssay") ?? "lcms";
  const rtype = str(v, "reninType") ?? (renin > 40 ? "drc_mu" : "pra");
  const aldoNgdl = unit === "pmol/L" ? aldo / 27.7 : aldo;
  const aldoPmol = aldoNgdl * 27.7;
  const isPra = rtype === "pra";
  const reninVal = rtype === "drc_pg" ? renin * 1.67 : renin; // pg/mL -> mU/L
  const reninSuppressed = isPra ? reninVal <= 1.0 : reninVal <= 8.2;
  const aldoHigh = assay === "lcms" ? aldoNgdl >= 7.5 : aldoNgdl >= 10;
  // Floor renin at a typical lower limit of detection to avoid inflated ratios.
  const floored = isPra ? Math.max(reninVal, 0.5) : Math.max(reninVal, 2);
  const arrV = isPra ? aldoNgdl / floored : aldoPmol / floored;
  const arrCutoff = isPra ? (assay === "lcms" ? 15 : 20) : assay === "lcms" ? 52 : 70;
  const arrHigh = arrV > arrCutoff;
  const status = reninSuppressed && aldoHigh && arrHigh ? "positive" : !reninSuppressed ? "negative" : "indeterminate";
  return {
    aldoNgdl, aldoPmol, reninSuppressed, aldoHigh, arr: arrV, arrCutoff,
    arrUnits: isPra ? "ng/dL per ng/mL/h" : "pmol/L per mU/L", arrHigh, status,
  };
}

export function evaluatePa(v: Inputs): RuleResult {
  const recs: Recommendation[] = [];
  const metrics: Metric[] = [];
  const missing: string[] = [];
  const plan: string[] = [];
  const r = interpretPa(v);
  const meds = arr(v, "meds");
  const clin = arr(v, "clinical");
  const k = num(v, "k");
  const rtype = str(v, "reninType") ?? "pra";
  const assay = str(v, "aldoAssay");
  if (!r) {
    return {
      headline: "Enter aldosterone and renin",
      metrics: [], missing: ["Aldosterone", "Renin"], ap: "",
      recommendations: [{ text: "2025 Endocrine Society: screen ALL adults with hypertension using aldosterone, renin and potassium; medication withdrawal is not required for initial screening.", severity: "info", cite: ["pa2025"], cor: "conditional" }],
    };
  }
  if (!assay) missing.push("Aldosterone assay (assumed LC-MS/MS; immunoassay uses higher cutoffs)");
  if (!str(v, "reninType")) missing.push("Renin assay type (PRA vs DRC)");
  if (k == null) missing.push("Potassium at time of testing");

  metrics.push({ label: "Aldosterone", value: `${fmt(r.aldoNgdl, 1)} ng/dL`, note: `${fmt(r.aldoPmol, 0)} pmol/L; ${r.aldoHigh ? "not suppressed" : "below screening threshold"} (≥${assay === "immuno" ? "10" : "7.5"} ng/dL)` });
  metrics.push({ label: "Renin", value: `${num(v, "renin")} ${rtype === "pra" ? "ng/mL/h" : rtype === "drc_pg" ? "pg/mL" : "mU/L"}`, note: r.reninSuppressed ? "suppressed" : "not suppressed" });
  metrics.push({ label: "ARR", value: fmt(r.arr, 1), note: `${r.arrUnits}; cutoff >${r.arrCutoff} (${assay === "immuno" ? "immunoassay" : "LC-MS/MS"})` });
  if (k != null) metrics.push({ label: "K+", value: `${k} mmol/L`, note: k < 3.5 ? "hypokalemic" : undefined });

  const medObjs = PA_MEDS.filter((m) => meds.includes(m.value));
  const fnMeds = medObjs.filter((m) => m.effect === "fn" || (m.effect === "aliskiren" && rtype !== "pra"));
  const fpMeds = medObjs.filter((m) => m.effect === "fp" || (m.effect === "fp_drc" && rtype !== "pra") || (m.effect === "aliskiren" && rtype === "pra"));
  const onMra = meds.includes("mra");
  const hypoK = k != null && k < 3.5;
  const spontHypoK = clin.includes("hypok_spont") || (hypoK && !meds.includes("diuretic"));

  let status = r.status;
  let statusText = "";
  const interferenceNotes: string[] = [];

  if (status === "positive") {
    statusText = "positive screen (suppressed renin with non-suppressed aldosterone and elevated ARR)";
    if (fnMeds.length) {
      interferenceNotes.push(`positive despite renin-raising medications (${list(fnMeds.map((m) => m.noun))}), which strengthens the result`);
    }
    if (fpMeds.length) {
      const strong = r.aldoNgdl >= 15 || spontHypoK;
      interferenceNotes.push(`${list(fpMeds.map((m) => m.noun))} can suppress renin and cause a false-positive ARR${strong ? ", although marked aldosterone excess/hypokalemia makes a false positive less likely" : ""}`);
      if (!strong) {
        recs.push({
          text: `Possible false positive from renin-suppressing drugs (${list(fpMeds.map((m) => m.label))}). If clinically safe, repeat aldosterone/renin after ${list(fpMeds.map((m) => m.washout))} off these agents, substituting verapamil SR, hydralazine, or an alpha-1 blocker. Taper clonidine (avoid abrupt withdrawal).`,
          severity: "warning", cite: ["pa2025", "pa2016"],
          ap: `Because ${list(fpMeds.map((m) => m.noun))} may suppress renin, will consider repeating testing after a washout with substitution of verapamil SR, hydralazine or an alpha-blocker`,
        });
      }
    }
    if (onMra) interferenceNotes.push("renin remains suppressed on an MRA, so the MRA did not invalidate the result");
  } else if (status === "negative") {
    statusText = "negative screen (renin not suppressed)";
    if (fnMeds.length) {
      status = "indeterminate";
      statusText = `renin not suppressed, but ${list(fnMeds.map((m) => m.label))} raise renin and may cause a false negative`;
      recs.push({
        text: `Possible false negative: renin-raising drugs (${list(fnMeds.map((m) => m.label))}). If suspicion persists (resistant HTN, hypokalemia, AF, incidentaloma), repeat after withdrawal (${list([...new Set(fnMeds.map((m) => `${m.label}: ${m.washout}`))])}) using verapamil SR, hydralazine, and/or alpha-1 blockers for BP, or refer to endocrinology.`,
        severity: "action", cite: ["pa2025", "pa2016"],
        ap: `Renin is not suppressed, but ${list(fnMeds.map((m) => m.noun))} can raise renin and mask primary aldosteronism; if suspicion persists, will repeat testing after medication washout with BP covered by verapamil SR, hydralazine, or an alpha-blocker`,
      });
    }
  } else {
    statusText = "indeterminate (renin suppressed, aldosterone below the screening threshold)";
    recs.push({ text: "Suppressed renin with low/intermediate aldosterone: consider low-renin hypertension, licorice, exogenous mineralocorticoid, Liddle syndrome or CAH; mild PA is still possible, particularly if hypokalemic. Repeat after potassium correction or refer if suspicion is high.", severity: "action", cite: ["pa2025"], ap: "" });
    if (fpMeds.length) recs.push({ text: `Renin may be suppressed by ${list(fpMeds.map((m) => m.label))}.`, severity: "info", cite: ["pa2016"], ap: "" });
  }

  // Potassium
  if (hypoK) {
    recs.push({
      text: `K+ ${k} mmol/L: hypokalemia lowers aldosterone secretion and can cause false-negative/indeterminate results. Replete potassium to normal before repeat testing.`,
      severity: status === "positive" ? "info" : "action", cite: ["pa2025"],
      ap: status === "positive" ? "" : `Potassium was ${k} mmol/L at testing, which can blunt aldosterone; will replete and repeat testing`,
    });
  }
  const egfr = num(v, "egfr");
  if (egfr != null && egfr < 45) {
    recs.push({ text: `eGFR ${egfr}: CKD can raise the ARR (false positive) and complicates MRA use; interpret with nephrology/endocrinology input.`, severity: "info", cite: ["pa2016"], ap: "" });
  }
  if (meds.includes("estrogen") && rtype !== "pra") {
    recs.push({ text: "Estrogen-containing contraception/HRT lowers DRC (not PRA) and can falsely raise the ARR; PRA is preferred in these patients.", severity: "info", cite: ["pa2016"], ap: "" });
  }

  // Next steps
  const confirmed = yes(v, "confirmed");
  const ct = str(v, "ct");
  const surgery = v.surgeryCandidate === false ? false : v.surgeryCandidate === true ? true : null;
  const age = num(v, "age");
  if (status === "positive") {
    const skipConfirm = (spontHypoK && r.aldoNgdl >= 20) || surgery === false;
    plan.push("refer to endocrinology");
    if (!confirmed) {
      if (skipConfirm) {
        recs.push({ text: surgery === false ? "Patient would not pursue surgery: confirmatory testing can be skipped; start MRA therapy." : "Spontaneous hypokalemia + suppressed renin + aldosterone ≥20 ng/dL: diagnosis is highly likely and confirmatory (suppression) testing may be skipped.", severity: "action", cite: ["pa2025"], ap: "" });
        plan.push(surgery === false ? "since adrenalectomy would not be pursued, proceed directly to targeted MRA therapy" : "confirmatory suppression testing may be bypassed given the strong biochemical phenotype");
      } else {
        recs.push({ text: "Aldosterone suppression (confirmatory) testing, e.g., seated saline infusion (2 L NS over 4 h), oral sodium loading, or captopril challenge per local expertise; no single gold standard.", severity: "action", cite: ["pa2025"], ap: "" });
        plan.push("arrange aldosterone suppression testing (e.g., seated saline infusion or oral salt loading)");
      }
    }
    if (confirmed || skipConfirm) {
      if (surgery !== false) {
        if (!ct || ct === "not_done") plan.push("obtain adrenal-protocol CT");
        const directSurgery = age != null && age < 35 && spontHypoK && r.aldoNgdl >= 20 && ct === "unilateral";
        if (directSurgery) plan.push("age <35 with hypokalemia, marked aldosterone excess and a unilateral adenoma >1 cm, so may proceed to adrenalectomy without adrenal vein sampling");
        else if (ct === "bilateral") plan.push("bilateral findings on CT; adrenal vein sampling only if surgery is desired and disease may still be unilateral, otherwise MRA therapy");
        else plan.push("adrenal vein sampling for lateralization if a surgical candidate");
        plan.push("screen for cortisol co-secretion with a 1 mg overnight dexamethasone suppression test before AVS/surgery");
      }
    }
    recs.push({
      text: "Medical therapy (bilateral disease or non-surgical): spironolactone 12.5-25 mg daily (or eplerenone 25-50 mg twice daily; amiloride if MRA-intolerant), titrated until renin is no longer suppressed; check K+ and creatinine within 1 week of starting/dose change and renin at 2-3 months.",
      severity: "action", cite: ["pa2025"], cor: "conditional", ap: "",
    });
    if (surgery === false || ct === "bilateral") plan.push("start spironolactone 12.5-25 mg daily, titrating to unsuppress renin, with K+/creatinine in 1 week and renin in 2-3 months");
  } else if (status === "negative") {
    plan.push("primary aldosteronism is unlikely; continue standard hypertension care");
    plan.push("rescreen if hypertension worsens or becomes resistant, new hypokalemia develops, or atrial fibrillation occurs without structural heart disease");
  } else {
    plan.push(hypoK ? "replete potassium and repeat aldosterone/renin" : "repeat aldosterone/renin under optimized conditions (normokalemia, interfering drugs adjusted when safe), or refer to endocrinology if suspicion is high");
  }

  const headline =
    status === "positive" ? "Positive PA screen — refer to endocrinology" :
    status === "negative" ? "Negative screen — PA unlikely" : "Indeterminate — interpret with caution";

  const ctx: string[] = [];
  if (clin.length) {
    const opts = (fields.find((f) => f.key === "clinical") as { options: { value: string; label: string }[] }).options;
    const nouns: Record<string, string> = {
      resistant: "resistant hypertension", hypok_spont: "spontaneous hypokalemia", hypok_diuretic: "diuretic-induced hypokalemia",
      incidentaloma: "an adrenal incidentaloma", af: "atrial fibrillation", osa: "obstructive sleep apnea",
      young: "early-onset hypertension", fhx_pa: "a family history of primary aldosteronism",
    };
    ctx.push(list(clin.map((c) => nouns[c] ?? opts.find((o) => o.value === c)!.label)));
  }
  const apExtra = recs.filter((x) => x.ap).map((x) => x.ap!.replace(/\.$/, ""));
  const ap = [
    `Primary aldosteronism screening: ${ageSex(v)}${ctx.length ? ` with ${ctx.join(", ")}` : " with hypertension"}.`,
    `Aldosterone ${fmt(r.aldoNgdl, 1)} ng/dL${assay ? ` (${assay === "lcms" ? "LC-MS/MS" : "immunoassay"})` : ""}, ${rtype === "pra" ? "PRA" : "direct renin"} ${num(v, "renin")} ${rtype === "pra" ? "ng/mL/h" : rtype === "drc_pg" ? "pg/mL" : "mU/L"}, ARR ${fmt(r.arr, 1)}${k != null ? `, K+ ${k}` : ""}${medObjs.length ? `, drawn on ${list(medObjs.map((m) => m.noun))}` : ""}.`,
    `Per the 2025 Endocrine Society guideline this is a ${statusText}${interferenceNotes.length ? `; ${interferenceNotes.join("; ")}` : ""}.`,
    plan.length ? `Plan: ${plan.join("; ")}.` : "",
    apExtra.length ? apExtra.join(". ") + "." : "",
  ].filter(Boolean).join(" ");

  return { headline, metrics, recommendations: recs, missing, ap };
}

export const paModule: ClinicalModule = {
  id: "pa",
  title: "Primary Aldosteronism",
  short: "Aldo",
  icon: "🧪",
  description: "Aldosterone/renin/ARR interpretation with medication & potassium interference and next steps — 2025 Endocrine Society.",
  placeholder: "e.g. 49F resistant HTN, aldo 14 ng/dL (LC-MS/MS), PRA 0.4, K 3.4, on lisinopril, amlodipine, metoprolol and HCTZ at time of draw",
  fields,
  evaluate: evaluatePa,
  citations: cites("pa2025", "pa2016"),
};
