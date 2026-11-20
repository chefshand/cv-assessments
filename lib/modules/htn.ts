import type { ClinicalModule, FieldDef, Inputs, Metric, Recommendation, RuleResult } from "../types";
import { arr, ageSex, fmt, list, num, pct, str, yes } from "../util";
import { runPrevent } from "./ascvd";
import { cites } from "../citations";

// 2025 AHA/ACC high blood pressure guideline. Categories unchanged from 2017;
// PREVENT (10-yr total CVD) replaces the PCE for stage 1 treatment decisions.

export const HTN_MEDS = [
  { value: "acei_arb", label: "ACEi / ARB", noun: "an ACE inhibitor or ARB", short: "an ACE inhibitor/ARB" },
  { value: "ccb", label: "Dihydropyridine CCB", short: "a dihydropyridine CCB", noun: "a long-acting dihydropyridine CCB (amlodipine)" },
  { value: "thiazide", label: "Thiazide-type diuretic", short: "a thiazide-type diuretic", noun: "a thiazide-type diuretic (chlorthalidone or indapamide preferred)" },
  { value: "mra", label: "Spironolactone / eplerenone", short: "an MRA", noun: "spironolactone" },
  { value: "bb", label: "Beta-blocker", short: "a beta-blocker", noun: "a beta-blocker" },
  { value: "other", label: "Other (clonidine, hydralazine, alpha-blocker…)", short: "another agent", noun: "another agent" },
];
const FIRST_LINE = ["acei_arb", "ccb", "thiazide"];

const fields: FieldDef[] = [
  { key: "age", label: "Age", type: "number", unit: "y", section: "Patient" },
  { key: "sex", label: "Sex", type: "select", section: "Patient", options: [ { value: "female", label: "Female" }, { value: "male", label: "Male" } ] },
  { key: "sbp", label: "Systolic BP", type: "number", unit: "mmHg", section: "Blood pressure", help: "Average of ≥2 readings on ≥2 occasions." },
  { key: "dbp", label: "Diastolic BP", type: "number", unit: "mmHg", section: "Blood pressure" },
  {
    key: "bpSource", label: "Source of BP values", type: "select", section: "Blood pressure",
    options: [ { value: "office", label: "Office only" }, { value: "home", label: "Home BP confirmed" }, { value: "abpm", label: "24-h ABPM" } ],
  },
  { key: "meds", label: "Current BP medications", type: "multi", section: "Treatment", options: HTN_MEDS.map(({ value, label }) => ({ value, label })), extractHint: "Map drug names to classes: lisinopril/losartan → acei_arb; amlodipine/nifedipine → ccb; HCTZ/chlorthalidone/indapamide → thiazide; spironolactone/eplerenone → mra; metoprolol/carvedilol → bb." },
  { key: "maxDoses", label: "Doses maximized / optimal", type: "bool", section: "Treatment" },
  { key: "adherent", label: "Adherence confirmed", type: "bool", section: "Treatment" },
  { key: "interfering", label: "Interfering substances (NSAIDs, decongestants, stimulants, alcohol, OCP…)", type: "bool", section: "Treatment" },
  { key: "clinicalCvd", label: "Clinical CVD (CAD, stroke, PAD, HF)", type: "bool", section: "Comorbidities" },
  { key: "hf", label: "Heart failure", type: "bool", section: "Comorbidities" },
  { key: "diabetes", label: "Diabetes", type: "bool", section: "Comorbidities" },
  { key: "egfr", label: "eGFR", type: "number", unit: "mL/min/1.73m²", section: "Comorbidities" },
  { key: "uacr", label: "Urine albumin/creatinine", type: "number", unit: "mg/g", section: "Comorbidities" },
  { key: "k", label: "Potassium", type: "number", unit: "mmol/L", step: 0.1, section: "Comorbidities" },
  { key: "bmi", label: "BMI", type: "number", unit: "kg/m²", section: "Comorbidities" },
  { key: "osa", label: "Sleep apnea (known or suspected)", type: "bool", section: "Comorbidities" },
  { key: "paScreened", label: "Already screened for primary aldosteronism", type: "bool", section: "Comorbidities" },
  { key: "pregnancy", label: "Pregnant or planning pregnancy", type: "bool", section: "Comorbidities", showIf: (v) => v.sex !== "male" },
  { key: "totalChol", label: "Total cholesterol", type: "number", unit: "mg/dL", section: "PREVENT inputs" },
  { key: "hdl", label: "HDL-C", type: "number", unit: "mg/dL", section: "PREVENT inputs" },
  { key: "smoker", label: "Current smoker", type: "bool", section: "PREVENT inputs" },
  { key: "statin", label: "On statin", type: "select", section: "PREVENT inputs", options: [ { value: "none", label: "No" }, { value: "moderate", label: "Yes" } ] },
];

export function bpCategory(s: number, d: number | null): { key: "normal" | "elevated" | "stage1" | "stage2"; label: string } {
  const dd = d ?? 0;
  if (s >= 140 || dd >= 90) return { key: "stage2", label: "Stage 2 hypertension" };
  if (s >= 130 || dd >= 80) return { key: "stage1", label: "Stage 1 hypertension" };
  if (s >= 120) return { key: "elevated", label: "Elevated BP" };
  return { key: "normal", label: "Normal BP" };
}

export function evaluateHtn(v: Inputs): RuleResult {
  const recs: Recommendation[] = [];
  const metrics: Metric[] = [];
  const missing: string[] = [];
  const plan: string[] = [];
  const s = num(v, "sbp");
  const d = num(v, "dbp");
  if (s == null) return { headline: "Enter systolic (and diastolic) BP", metrics: [], recommendations: [], missing: ["Systolic BP"], ap: "" };
  if (d == null) missing.push("Diastolic BP");
  const meds = arr(v, "meds");
  const treated = meds.length > 0;
  const cat = bpCategory(s, d);
  const bp = `${fmt(s, 0)}${d != null ? `/${fmt(d, 0)}` : ""} mmHg`;
  const egfr = num(v, "egfr");
  const uacr = num(v, "uacr");
  const k = num(v, "k");
  const bmiV = num(v, "bmi");
  const ckd = (egfr != null && egfr < 60) || (uacr != null && uacr >= 30);
  const pregnant = yes(v, "pregnancy");
  const source = str(v, "bpSource");
  metrics.push({ label: "BP", value: bp, note: `${cat.label}${source ? ` (${source === "abpm" ? "ABPM" : source})` : ""}` });

  const severe = s >= 180 || (d ?? 0) >= 120;
  if (severe) {
    recs.push({ text: "BP ≥180/120: assess for acute target-organ damage (chest pain, dyspnea, neuro symptoms, vision change, AKI). If present, this is a hypertensive emergency needing ED care. If absent (severe hypertension without acute target-organ damage), restart or intensify oral therapy and recheck within days; avoid rapid IV lowering.", severity: "urgent", cite: ["htn2025"], ap: "Severe hypertension without symptoms of acute target-organ damage reported; will intensify oral therapy with close follow-up" });
  }

  // PREVENT
  const pv = runPrevent({ ...v, bpTx: treated });
  let prevent10: number | null = null;
  if (pv.res) {
    prevent10 = pv.res.tenYear.total_cvd;
    metrics.push({ label: "PREVENT 10-yr total CVD", value: pct(prevent10), note: prevent10 >= 7.5 ? "≥7.5%: high risk" : "<7.5%" });
  }
  const highRisk = yes(v, "clinicalCvd") || yes(v, "hf") || yes(v, "diabetes") || ckd || (prevent10 != null && prevent10 >= 7.5);
  const target = "<130/80 mmHg";
  metrics.push({ label: "BP target", value: target, note: "SBP <120 encouraged if tolerated" });

  // Pregnancy short-circuits drug choice
  if (pregnant) {
    recs.push({ text: "Pregnancy (or planning): treat at ≥140/90; labetalol or long-acting nifedipine preferred. ACE inhibitors, ARBs, ARNI, MRAs and direct renin inhibitors are contraindicated; stop before conception. Low-dose aspirin from 12-16 weeks if at risk for preeclampsia. Coordinate with obstetrics / cardio-obstetrics.", severity: "warning", cite: ["htn2025"], cor: "1", ap: "Given pregnancy/planned pregnancy, will use labetalol or long-acting nifedipine and avoid ACE inhibitors/ARBs, coordinating with obstetrics" });
  } else if (meds.includes("acei_arb") && str(v, "sex") === "female" && (num(v, "age") ?? 99) < 50) {
    recs.push({ text: "Woman of reproductive potential on an ACEi/ARB: counsel on teratogenicity and contraception; switch before conception.", severity: "info", cite: ["htn2025"], ap: "" });
  }

  // Out-of-office confirmation
  if (!treated && source !== "home" && source !== "abpm" && cat.key !== "normal" && !severe) {
    recs.push({ text: "Confirm the diagnosis with out-of-office readings (validated home BP monitor or 24-h ABPM) to exclude white-coat or detect masked hypertension.", severity: "action", cite: ["htn2025"], cor: "1", ap: "Confirm with home BP monitoring (validated cuff, seated, 2 readings twice daily for a week)" });
  }

  let headline = "";
  const uncontrolled = s >= 130 || (d ?? 0) >= 80;
  const firstLineMissing = FIRST_LINE.filter((m) => !meds.includes(m));
  const resistantUncontrolled = treated && uncontrolled && FIRST_LINE.every((m) => meds.includes(m));
  const resistantControlled = !uncontrolled && meds.length >= 4;
  const resistant = resistantUncontrolled || resistantControlled;

  if (!treated) {
    if (cat.key === "stage2") {
      headline = `${cat.label} (${bp}): start 2 first-line agents`;
      if (!pregnant) {
        const combo = ckd && uacr != null && uacr >= 30 ? "an ACEi/ARB plus a dihydropyridine CCB or thiazide-type diuretic" : "two first-line agents from different classes (ACEi/ARB + dihydropyridine CCB or thiazide-type diuretic)";
        recs.push({ text: `Stage 2: start lifestyle changes plus ${combo}, preferably as a single-pill combination (1).`, severity: "action", cite: ["htn2025"], cor: "1", ap: "" });
        plan.push(`start ${combo}, preferably as a single-pill combination`);
      }
    } else if (cat.key === "stage1") {
      if (highRisk) {
        const why = list([yes(v, "clinicalCvd") && "clinical CVD", yes(v, "hf") && "heart failure", yes(v, "diabetes") && "diabetes", ckd && "CKD", prevent10 != null && prevent10 >= 7.5 && `PREVENT 10-yr CVD risk ${pct(prevent10)}`].filter(Boolean) as string[]);
        headline = `${cat.label} with high risk: start medication`;
        if (!pregnant) {
          const agent = ckd && uacr != null && uacr >= 30 ? "an ACE inhibitor or ARB (albuminuria)" : "one first-line agent (ACEi/ARB, dihydropyridine CCB, or thiazide-type diuretic)";
          recs.push({ text: `Stage 1 with ${why}: start lifestyle changes plus ${agent} (1).`, severity: "action", cite: ["htn2025"], cor: "1", ap: "" });
          plan.push(`given ${why}, start ${agent} with lifestyle changes`);
        }
      } else {
        headline = `${cat.label}, lower risk: lifestyle for 3-6 months`;
        if (prevent10 == null) missing.push(`PREVENT inputs (${pv.missing.join(", ")}) to decide on medication for stage 1`);
        recs.push({ text: `Stage 1 without CVD, diabetes or CKD${prevent10 != null ? ` and PREVENT ${pct(prevent10)} (<7.5%)` : ""}: lifestyle changes for 3-6 months; start medication if BP remains ≥130/80.`, severity: "action", cite: ["htn2025"], cor: "1", ap: "" });
        plan.push("lifestyle changes for 3-6 months, then start medication if BP remains ≥130/80");
      }
    } else {
      headline = cat.key === "elevated" ? `Elevated BP (${bp}): lifestyle, recheck in 3-6 months` : `Normal BP (${bp})`;
      if (cat.key === "elevated") plan.push("lifestyle changes and recheck BP in 3-6 months");
      else plan.push("rescreen BP annually");
    }
  } else if (!uncontrolled) {
    headline = `Controlled on ${meds.length} agent${meds.length > 1 ? "s" : ""} (${bp})`;
    plan.push("continue current regimen");
  } else if (!resistantUncontrolled) {
    const next = firstLineMissing.map((m) => HTN_MEDS.find((x) => x.value === m)!.noun);
    const pick = ckd && uacr != null && uacr >= 30 && firstLineMissing.includes("acei_arb") ? [HTN_MEDS[0].noun] : next.slice(0, 1);
    headline = `Above goal on ${meds.length} agent${meds.length > 1 ? "s" : ""}: add ${pick[0].split(" (")[0]}`;
    if (v.maxDoses === false) {
      recs.push({ text: "Doses not maximized: uptitrate current agents or add a complementary first-line class; single-pill combinations improve adherence.", severity: "action", cite: ["htn2025"], ap: "" });
    }
    recs.push({ text: `Above goal (${bp}, target ${target}): add ${pick[0]}${next.length > 1 ? `; next option ${next.slice(1).join(" or ")}` : ""}. Prefer a single-pill combination. Recheck in about 4 weeks.`, severity: "action", cite: ["htn2025"], cor: "1", ap: "" });
    plan.push(`add ${pick[0]}, ideally as a single-pill combination, and recheck in 4 weeks`);
  }

  if (resistant) {
    headline = resistantUncontrolled ? `Apparent resistant hypertension (${bp} on ${meds.length} agents)` : `Controlled resistant hypertension (${meds.length} agents)`;
    const checks: string[] = [];
    if (!yes(v, "adherent")) checks.push("adherence");
    if (source !== "home" && source !== "abpm") checks.push("out-of-office BP (exclude white-coat effect)");
    if (v.interfering !== false) checks.push("interfering substances (NSAIDs, decongestants, stimulants, alcohol)");
    if (checks.length) recs.push({ text: `Exclude pseudoresistance: confirm ${list(checks)}, proper cuff technique, and optimal diuretic (chlorthalidone/indapamide; loop diuretic if eGFR <30).`, severity: "action", cite: ["htn2025"], ap: "" });
    if (resistantUncontrolled && !meds.includes("mra") && !pregnant) {
      const ok = (k == null || k < 4.5) && (egfr == null || egfr >= 45);
      recs.push({ text: ok ? "Add spironolactone 12.5-25 mg daily (add an MRA in resistant hypertension unless contraindicated); check K and creatinine in 1-2 and 4 weeks." : `MRA is the preferred 4th agent, but ${k != null && k >= 4.5 ? `K is ${fmt(k, 1)}` : ""}${k != null && k >= 4.5 && egfr != null && egfr < 45 ? " and " : ""}${egfr != null && egfr < 45 ? `eGFR is ${fmt(egfr, 0)}` : ""}: use with close K monitoring or consider a beta-blocker, amiloride, hydralazine or clonidine.`, severity: "action", cite: ["htn2025"], cor: "1", ap: "" });
      if (ok) plan.push("add spironolactone 12.5-25 mg daily with BMP in 1-2 weeks");
    }
    if (!yes(v, "paScreened")) {
      recs.push({ text: "Screen for primary aldosteronism with a morning aldosterone and renin (all adults with resistant hypertension, regardless of potassium). Most BP medications can continue; MRAs interfere. Use the Aldosteronism module to interpret.", severity: "action", cite: ["htn2025", "pa2025"], cor: "1", ap: "Screen for primary aldosteronism with plasma aldosterone and renin" });
    }
    if (v.osa !== false) recs.push({ text: "Evaluate for obstructive sleep apnea (STOP-BANG / sleep study) and other secondary causes (renal artery stenosis, CKD, thyroid, Cushing, pheochromocytoma) as indicated.", severity: "action", cite: ["htn2025"], ap: "Evaluate for obstructive sleep apnea" });
    recs.push({ text: "Renal denervation may be considered at an experienced center for resistant hypertension despite optimal therapy (office SBP 140-180, eGFR ≥40) (2b).", severity: "info", cite: ["htn2025"], cor: "2b", ap: "" });
  } else if (!yes(v, "paScreened") && ((k != null && k < 3.5) || (treated && cat.key === "stage2"))) {
    recs.push({ text: `${k != null && k < 3.5 ? `Hypokalemia (K ${fmt(k, 1)})` : "Stage 2 hypertension on treatment"}: screen for primary aldosteronism (aldosterone and renin). The 2025 Endocrine Society guideline supports screening all adults with hypertension.`, severity: "action", cite: ["pa2025", "htn2025"], ap: "Screen for primary aldosteronism with plasma aldosterone and renin" });
  }

  // Compelling indications
  if (ckd && uacr != null && uacr >= 30 && !meds.includes("acei_arb") && !pregnant) {
    recs.push({ text: `Albuminuria (UACR ${fmt(uacr, 0)} mg/g): an ACE inhibitor or ARB is preferred (1). ${yes(v, "diabetes") ? "With type 2 diabetes, add an SGLT2 inhibitor and consider finerenone for kidney/CV protection." : "Consider an SGLT2 inhibitor if eGFR ≥20."}`, severity: "action", cite: ["htn2025"], cor: "1", ap: "" });
  }
  if (uacr == null) {
    recs.push({ text: "Check urine albumin-to-creatinine ratio (recommended for all adults with hypertension), plus BMP, lipids, A1c, TSH, CBC, urinalysis and ECG if not done.", severity: "action", cite: ["htn2025"], ap: "Check UACR, BMP, A1c, lipids and ECG" });
  }
  if (k != null && k < 3.5 && meds.includes("thiazide")) recs.push({ text: `K ${fmt(k, 1)} on a thiazide: replete and consider adding a K-sparing agent (spironolactone or amiloride).`, severity: "warning", cite: ["htn2025"], ap: "" });
  if (bmiV != null && bmiV >= 27) {
    recs.push({ text: `BMI ${fmt(bmiV, 1)}: weight loss lowers BP; a GLP-1 receptor agonist (or tirzepatide) can be considered as adjunct therapy for hypertension with overweight/obesity.`, severity: "info", cite: ["htn2025"], ap: bmiV >= 30 ? "Discussed weight management, including GLP-1-based therapy" : "" });
  }
  if (yes(v, "hf")) recs.push({ text: "Heart failure: use GDMT agents for BP (ARNI/ACEi/ARB, evidence-based beta-blocker, MRA, SGLT2i); avoid non-dihydropyridine CCBs in HFrEF. See the Heart failure module.", severity: "info", cite: ["htn2025", "hf2022"], ap: "" });

  recs.push({ text: "Lifestyle: sodium <2,300 mg/day (ideally <1,500), potassium-enriched salt substitute if no CKD/hyperkalemia risk, DASH-style diet, 150 min/week aerobic activity, weight loss if needed, and no alcohol or as little as possible (≤2 drinks/day men, ≤1 women).", severity: "info", cite: ["htn2025"], ap: "" });
  plan.push("sodium <1,500-2,300 mg/day, DASH-style diet, regular aerobic exercise, and limit alcohol");
  if (cat.key !== "normal" || treated) plan.push(`BP goal ${target} (systolic <120 if tolerated) with home BP log${treated || cat.key !== "elevated" ? " and follow-up in 4-6 weeks" : ""}`);

  const apExtra = recs.filter((r) => r.ap).map((r) => r.ap!.replace(/\.$/, ""));
  const comorb = [yes(v, "diabetes") && "diabetes", ckd && "CKD", yes(v, "clinicalCvd") && "clinical CVD", yes(v, "hf") && "heart failure"].filter(Boolean) as string[];
  const ap = [
    `${resistant ? "Resistant hypertension" : cat.key === "normal" || cat.key === "elevated" ? cat.label : `Hypertension, ${cat.key === "stage2" ? "stage 2" : "stage 1"}`}: ${ageSex(v)}${comorb.length ? ` with ${list(comorb)}` : ""}, BP ${bp}${source === "home" ? " by home monitoring" : source === "abpm" ? " by ABPM" : ""}${treated ? ` on ${list(meds.map((m) => HTN_MEDS.find((x) => x.value === m)!.short))}` : ", untreated"}${prevent10 != null ? `; PREVENT 10-year total CVD risk ${pct(prevent10)}` : ""}.`,
    plan.length ? `Per the 2025 AHA/ACC BP guideline, plan: ${plan.join("; ")}.` : "",
    apExtra.length ? apExtra.join(". ") + "." : "",
  ].filter(Boolean).join(" ");

  return { headline: severe ? `Severe BP ${bp}: rule out target-organ damage` : headline, metrics, recommendations: recs, missing, ap };
}

export const htnModule: ClinicalModule = {
  id: "htn",
  title: "Hypertension",
  short: "HTN",
  icon: "🩺",
  description: "BP category, PREVENT-based treatment threshold, next drug step, resistant HTN workup (MRA, aldosteronism, OSA) — 2025 AHA/ACC.",
  placeholder: "e.g. 62F, home BP averaging 148/88 on amlodipine 10, lisinopril 40 and chlorthalidone 25, adherent, K 3.6, eGFR 72, UACR 45, BMI 33, no diabetes",
  fields,
  evaluate: evaluateHtn,
  citations: cites("htn2025", "prevent", "pa2025"),
};
