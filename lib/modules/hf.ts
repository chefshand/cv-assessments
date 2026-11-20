import type { ClinicalModule, FieldDef, Inputs, Metric, Recommendation, RuleResult } from "../types";
import { ageSex, fmt, list, num, str, yes } from "../util";
import { cites } from "../citations";

// 2022 AHA/ACC/HFSA HF guideline, 2024 ACC HFrEF ECDP (GDMT start/titration),
// 2026 ACC HFpEF ECDP (SGLT2i + nonsteroidal MRA as optimal medical therapy).

const fields: FieldDef[] = [
  { key: "age", label: "Age", type: "number", unit: "y", section: "Patient" },
  { key: "sex", label: "Sex", type: "select", section: "Patient", options: [ { value: "female", label: "Female" }, { value: "male", label: "Male" } ] },
  { key: "black", label: "Self-identified Black (for hydralazine-nitrate)", type: "bool", section: "Patient" },
  { key: "ef", label: "Current LVEF", type: "number", unit: "%", section: "Phenotype" },
  { key: "lowestEf", label: "Lowest prior LVEF", type: "number", unit: "%", section: "Phenotype", help: "For HF with improved EF (prior ≤40%)." },
  { key: "nyha", label: "NYHA class", type: "select", section: "Phenotype", options: [ { value: "1", label: "I" }, { value: "2", label: "II" }, { value: "3", label: "III" }, { value: "4", label: "IV" } ], extractHint: "Roman numerals → '1'-'4'." },
  { key: "ischemic", label: "Ischemic cardiomyopathy", type: "bool", section: "Phenotype" },
  { key: "congested", label: "Volume overloaded now", type: "bool", section: "Phenotype" },
  { key: "recentHosp", label: "HF hospitalization / IV diuretic in last 6 months", type: "bool", section: "Phenotype" },
  { key: "amyloidFlags", label: "Amyloid red flags (LVH ≥12 mm, carpal tunnel, low voltage, AS, neuropathy)", type: "bool", section: "Phenotype" },
  { key: "sbp", label: "Systolic BP", type: "number", unit: "mmHg", section: "Vitals & labs" },
  { key: "hr", label: "Heart rate", type: "number", unit: "bpm", section: "Vitals & labs" },
  { key: "rhythm", label: "Rhythm", type: "select", section: "Vitals & labs", options: [ { value: "sinus", label: "Sinus" }, { value: "af", label: "AF / flutter" } ] },
  { key: "k", label: "Potassium", type: "number", unit: "mmol/L", step: 0.1, section: "Vitals & labs" },
  { key: "egfr", label: "eGFR", type: "number", unit: "mL/min/1.73m²", section: "Vitals & labs" },
  { key: "ntprobnp", label: "NT-proBNP", type: "number", unit: "pg/mL", section: "Vitals & labs" },
  { key: "ferritin", label: "Ferritin", type: "number", unit: "ng/mL", section: "Vitals & labs" },
  { key: "tsat", label: "Transferrin saturation", type: "number", unit: "%", section: "Vitals & labs" },
  { key: "bmi", label: "BMI", type: "number", unit: "kg/m²", section: "Vitals & labs" },
  { key: "diabetes", label: "Type 2 diabetes", type: "bool", section: "Vitals & labs" },
  {
    key: "raas", label: "RAAS inhibitor", type: "select", section: "Current GDMT",
    options: [ { value: "none", label: "None" }, { value: "acei", label: "ACE inhibitor" }, { value: "arb", label: "ARB" }, { value: "arni", label: "Sacubitril/valsartan" } ],
  },
  { key: "raasTarget", label: "RAAS/ARNI at target dose", type: "bool", section: "Current GDMT", showIf: (v) => v.raas != null && v.raas !== "none" },
  {
    key: "bb", label: "Beta-blocker", type: "select", section: "Current GDMT",
    options: [ { value: "none", label: "None" }, { value: "ebb", label: "Carvedilol / metoprolol succinate / bisoprolol" }, { value: "other", label: "Other (metoprolol tartrate, atenolol…)" } ],
    extractHint: "metoprolol succinate/Toprol XL, carvedilol, bisoprolol → ebb; metoprolol tartrate/atenolol/nebivolol → other.",
  },
  { key: "bbTarget", label: "Beta-blocker at target dose", type: "bool", section: "Current GDMT", showIf: (v) => v.bb === "ebb" },
  { key: "mra", label: "MRA", type: "select", section: "Current GDMT", options: [ { value: "none", label: "None" }, { value: "spiro", label: "Spironolactone / eplerenone" }, { value: "finerenone", label: "Finerenone" } ] },
  { key: "sglt2", label: "SGLT2 inhibitor", type: "bool", section: "Current GDMT" },
  { key: "glp1", label: "GLP-1 RA / tirzepatide", type: "bool", section: "Current GDMT" },
  { key: "loop", label: "Loop diuretic", type: "bool", section: "Current GDMT" },
  { key: "monthsGdmt", label: "Months on optimized GDMT", type: "number", unit: "mo", section: "Devices" },
  { key: "qrs", label: "QRS duration", type: "number", unit: "ms", section: "Devices" },
  { key: "lbbb", label: "LBBB morphology", type: "bool", section: "Devices" },
  { key: "icd", label: "Has ICD", type: "bool", section: "Devices" },
  { key: "crt", label: "Has CRT", type: "bool", section: "Devices" },
];

export function hfType(ef: number, lowest: number | null): { key: "hfref" | "hfmref" | "hfimpef" | "hfpef"; label: string } {
  if (ef <= 40) return { key: "hfref", label: "HFrEF" };
  if (lowest != null && lowest <= 40) return { key: "hfimpef", label: "HFimpEF" };
  if (ef < 50) return { key: "hfmref", label: "HFmrEF" };
  return { key: "hfpef", label: "HFpEF" };
}

export function evaluateHf(v: Inputs): RuleResult {
  const recs: Recommendation[] = [];
  const metrics: Metric[] = [];
  const missing: string[] = [];
  const plan: string[] = [];
  const ef = num(v, "ef");
  if (ef == null) return { headline: "Enter the current LVEF", metrics: [], recommendations: [], missing: ["LVEF"], ap: "" };
  const t = hfType(ef, num(v, "lowestEf"));
  const nyha = Number(str(v, "nyha") ?? "0");
  const sbp = num(v, "sbp");
  const hr = num(v, "hr");
  const k = num(v, "k");
  const egfr = num(v, "egfr");
  const raas = str(v, "raas") ?? "none";
  const bb = str(v, "bb") ?? "none";
  const mra = str(v, "mra") ?? "none";
  const sglt2 = yes(v, "sglt2");
  const af = str(v, "rhythm") === "af";
  const bmiV = num(v, "bmi");

  for (const [key, label] of [["sbp", "SBP"], ["k", "Potassium"], ["egfr", "eGFR"], ["nyha", "NYHA class"]] as const) if (v[key] == null) missing.push(label);
  if (v.hr == null && (t.key === "hfref" || t.key === "hfimpef")) missing.push("Heart rate");

  metrics.push({ label: "Phenotype", value: t.label, note: `LVEF ${fmt(ef, 0)}%${t.key === "hfimpef" ? ` (lowest ${fmt(num(v, "lowestEf")!, 0)}%)` : ""}` });
  if (nyha) metrics.push({ label: "NYHA", value: ["", "I", "II", "III", "IV"][nyha] });

  const lowBp = sbp != null && sbp < 100;
  const hypotension = sbp != null && sbp < 90;
  const highK = k != null && k >= 5.0;
  const brady = hr != null && hr < 60;
  const mraOk = !highK && (egfr == null || egfr > 30);
  const sglt2Ok = egfr == null || egfr >= 20;
  const starts: string[] = [];
  const titrate: string[] = [];

  if (v.congested === true) {
    recs.push({ text: `Volume overload: ${yes(v, "loop") ? "intensify loop diuretic (double dose or add thiazide-type for resistance)" : "start a loop diuretic (furosemide 20-40 mg or torsemide 10-20 mg daily)"} with BMP in 1 week; reassess within 1-2 weeks.`, severity: "action", cite: ["hf2022"], cor: "1", ap: "" });
    plan.push(yes(v, "loop") ? "intensify loop diuretic with BMP in 1 week" : "start a loop diuretic with BMP in 1 week");
  }

  if (t.key === "hfref" || t.key === "hfimpef") {
    // ARNI / ACEi / ARB
    if (raas === "none") {
      if (hypotension) titrate.push("SBP <90: hold off on RAAS inhibitor until BP allows");
      else starts.push(`start sacubitril/valsartan 24/26 mg BID${lowBp ? " (low starting dose given SBP <100)" : ""}`);
    } else if (raas !== "arni") {
      if (!hypotension) starts.push(`switch ${raas === "acei" ? "ACE inhibitor (after 36-hour washout)" : "ARB"} to sacubitril/valsartan`);
    } else if (v.raasTarget === false) titrate.push(lowBp ? "sacubitril/valsartan: limited by SBP <100" : "uptitrate sacubitril/valsartan toward 97/103 mg BID");
    // Beta-blocker
    if (bb === "none") {
      if (brady) titrate.push(`HR ${fmt(hr!, 0)}: beta-blocker limited by bradycardia`);
      else if (v.congested === true) titrate.push("start an evidence-based beta-blocker once euvolemic");
      else starts.push("start carvedilol 3.125 mg BID, metoprolol succinate 12.5-25 mg daily, or bisoprolol 1.25 mg daily");
    } else if (bb === "other") starts.push("switch to an evidence-based beta-blocker (carvedilol, metoprolol succinate or bisoprolol)");
    else if (v.bbTarget === false) titrate.push(brady ? "beta-blocker: limited by HR <60" : "uptitrate beta-blocker (targets: carvedilol 25 mg BID [50 mg BID if >85 kg], metoprolol succinate 200 mg, bisoprolol 10 mg)");
    // MRA
    if (mra === "none") {
      if (mraOk) starts.push(`start spironolactone 12.5-25 mg daily${egfr != null && egfr < 50 ? " (12.5 mg given eGFR <50)" : ""}`);
      else titrate.push(`MRA withheld: ${highK ? `K ${fmt(k!, 1)} ≥5.0` : `eGFR ${fmt(egfr!, 0)} ≤30`}${highK ? " (a potassium binder may enable MRA)" : ""}`);
    }
    // SGLT2i
    if (!sglt2) {
      if (sglt2Ok) starts.push("start dapagliflozin 10 mg or empagliflozin 10 mg daily");
      else titrate.push("SGLT2i not started: eGFR <20");
    }
    if (highK && mra !== "none") titrate.push(`K ${fmt(k!, 1)}: ${k! > 5.5 ? "hold MRA" : "do not uptitrate MRA; recheck K"}`);

    const pillars = [raas !== "none", bb === "ebb", mra !== "none", sglt2].filter(Boolean).length;
    metrics.push({ label: "GDMT pillars", value: `${pillars}/4`, note: "ARNI/ACEi/ARB, beta-blocker, MRA, SGLT2i" });

    if (starts.length) {
      recs.push({ text: `Start/optimize GDMT (1): ${starts.join("; ")}. Multiple agents can be started together or in quick succession; order is flexible. Recheck BMP in 1-2 weeks after RAAS/MRA changes and titrate every 1-2 weeks.`, severity: "action", cite: ["hfref2024", "hf2022"], cor: "1", ap: "" });
      plan.push(starts.join("; "));
    }
    if (titrate.length) {
      recs.push({ text: `Titration notes: ${titrate.join("; ")}.`, severity: "info", cite: ["hfref2024"], ap: "" });
      const up = titrate.filter((x) => x.startsWith("uptitrate"));
      if (up.length) plan.push(up.join("; "));
    }
    if (!starts.length && pillars === 4) plan.push("continue quadruple GDMT at maximally tolerated doses");

    if (t.key === "hfimpef") {
      recs.push({ text: "HF with improved EF: continue GDMT, including after EF recovery; withdrawal leads to relapse (1).", severity: "action", cite: ["hf2022"], cor: "1", ap: "Continue GDMT despite improved LVEF" });
    }
    if (t.key === "hfref") {
      if (yes(v, "black") && nyha >= 3) recs.push({ text: "Self-identified Black patient, NYHA III-IV on optimal GDMT: add hydralazine-isosorbide dinitrate (1).", severity: "action", cite: ["hf2022"], cor: "1", ap: "Add hydralazine-isosorbide dinitrate" });
      if (!af && hr != null && hr >= 70 && ef <= 35 && nyha >= 2 && nyha <= 3 && bb === "ebb" && v.bbTarget === true) recs.push({ text: `Sinus HR ${fmt(hr, 0)} ≥70 on a beta-blocker at maximally tolerated dose: ivabradine is reasonable (2a).`, severity: "info", cite: ["hf2022"], cor: "2a", ap: "" });
      if (yes(v, "recentHosp")) recs.push({ text: "Worsening HF (recent hospitalization/IV diuretic) on GDMT: vericiguat may be considered (2b).", severity: "info", cite: ["hf2022"], cor: "2b", ap: "" });
      if (nyha === 4 || (yes(v, "recentHosp") && (hypotension || (egfr != null && egfr < 30)))) recs.push({ text: "Advanced HF features (NYHA IV, recurrent hospitalization, hypotension/renal limits to GDMT): refer to an advanced HF center for LVAD/transplant evaluation or palliative care discussion (1).", severity: "urgent", cite: ["hf2022"], cor: "1", ap: "Refer to advanced heart failure clinic" });
    }

    // Devices
    const months = num(v, "monthsGdmt");
    const qrs = num(v, "qrs");
    if (t.key === "hfref" && ef <= 35) {
      if (months == null) missing.push("Months on optimized GDMT (for ICD/CRT timing)");
      const ready = months != null && months >= 3;
      if (!yes(v, "icd") && !yes(v, "crt")) {
        if (!ready) recs.push({ text: "LVEF ≤35%: reassess EF after ≥3 months of optimized GDMT (≥40 days post-MI, ≥90 days post-revascularization) before primary-prevention ICD decisions. A wearable defibrillator is not routinely needed.", severity: "action", cite: ["hf2022"], ap: "Repeat echocardiogram after 3 months of optimized GDMT to reassess ICD candidacy" });
        else if (nyha >= 2 && nyha <= 3) recs.push({ text: `LVEF ${fmt(ef, 0)}% ≤35% with NYHA ${nyha === 2 ? "II" : "III"} after ≥3 months of GDMT: primary-prevention ICD recommended if expected survival >1 year (1).`, severity: "action", cite: ["hf2022"], cor: "1", ap: "Meets criteria for primary-prevention ICD; will refer to electrophysiology" });
        else if (nyha === 1 && yes(v, "ischemic") && ef <= 30) recs.push({ text: "Ischemic cardiomyopathy, LVEF ≤30%, NYHA I, ≥40 days post-MI: primary-prevention ICD recommended (1).", severity: "action", cite: ["hf2022"], cor: "1", ap: "Meets criteria for primary-prevention ICD; will refer to electrophysiology" });
      }
      if (qrs == null) missing.push("QRS duration / morphology (CRT)");
      else if (!yes(v, "crt") && qrs >= 120 && nyha >= 2) {
        const lb = yes(v, "lbbb");
        const cor = !af && lb && qrs >= 150 ? "1" : lb || qrs >= 150 ? "2a" : nyha >= 3 ? "2b" : null;
        if (cor) recs.push({ text: `QRS ${fmt(qrs, 0)} ms ${lb ? "LBBB" : "non-LBBB"}${af ? " in AF" : ""}, LVEF ≤35%, NYHA ${["", "I", "II", "III", "IV"][nyha]} on GDMT: CRT ${cor === "1" ? "indicated" : cor === "2a" ? "reasonable" : "may be considered"} (${cor})${af ? "; requires near-100% biventricular pacing (rate control or AV-node ablation)" : ""}.`, severity: "action", cite: ["hf2022"], cor, ap: `Candidate for cardiac resynchronization therapy (QRS ${fmt(qrs, 0)} ms${lb ? " LBBB" : ""}); refer to electrophysiology` });
      }
    }
  } else if (t.key === "hfmref") {
    if (!sglt2 && sglt2Ok) starts.push("an SGLT2 inhibitor (dapagliflozin or empagliflozin 10 mg) (2a)");
    if (mra === "none" && !highK && (egfr == null || egfr >= 25)) starts.push("finerenone (10 mg if eGFR 25-60, 20 mg if >60; target 20-40 mg) or spironolactone (2b)");
    if (raas === "none" && !lowBp) starts.push("an ARNI, ACEi or ARB (2b)");
    if (bb === "none" && !brady) starts.push("an evidence-based beta-blocker (2b)");
    if (starts.length) {
      recs.push({ text: `HFmrEF: ${starts.join("; ")}. Repeat echo to watch for EF trajectory (many behave like HFrEF or improve).`, severity: "action", cite: ["hf2022", "hfpef2026"], ap: "" });
      plan.push(`start ${starts.map((x) => x.replace(/ \(2[ab]\)/, "")).join("; ")}`);
    }
  } else {
    // HFpEF, 2026 ECDP
    if (!sglt2 && sglt2Ok) starts.push("an SGLT2 inhibitor (dapagliflozin or empagliflozin 10 mg daily)");
    if (mra === "none") {
      if (!highK && (egfr == null || egfr >= 25)) starts.push(`finerenone ${egfr != null && egfr <= 60 ? "10" : "20"} mg daily (titrate to ${egfr != null && egfr <= 60 ? "20" : "40"} mg), preferred over spironolactone`);
      else titrate.push(`MRA withheld: ${highK ? `K ${fmt(k!, 1)} ≥5.0` : `eGFR ${fmt(egfr!, 0)} <25`}`);
    } else if (mra === "spiro") titrate.push("on spironolactone/eplerenone: finerenone is the preferred nonsteroidal MRA in the 2026 ECDP; switching is reasonable");
    if (starts.length) {
      recs.push({ text: `HFpEF optimal medical therapy: ${starts.join(" plus ")} absent contraindications. Check K and eGFR at 4 weeks after starting finerenone.`, severity: "action", cite: ["hfpef2026"], ap: "" });
      plan.push(`start ${starts.join(" and ")}`);
    }
    if (titrate.length) recs.push({ text: titrate.join("; ") + ".", severity: "info", cite: ["hfpef2026"], ap: "" });
    if (bmiV != null && bmiV >= 30 && !yes(v, "glp1")) {
      recs.push({ text: `Obesity (BMI ${fmt(bmiV, 1)}): add semaglutide 2.4 mg weekly or tirzepatide for symptoms, function and weight (STEP-HFpEF, SUMMIT).`, severity: "action", cite: ["hfpef2026"], ap: "Start incretin-based therapy (semaglutide or tirzepatide) for obesity-related HFpEF" });
    }
    if (raas === "none" && sbp != null && sbp >= 110) recs.push({ text: "ARNI or ARB may be considered, particularly with LVEF toward the lower normal range or with hypertension.", severity: "info", cite: ["hfpef2026", "hf2022"], cor: "2b", ap: "" });
    if (bb !== "none") recs.push({ text: "Beta-blocker in HFpEF: keep only for a specific indication (AF rate control, angina, post-MI); otherwise consider tapering, especially with chronotropic incompetence.", severity: "info", cite: ["hfpef2026"], ap: "" });
    recs.push({ text: "Treat contributing comorbidities: BP control, AF (rhythm control often helps), sleep apnea, CKD and diabetes; prescribe exercise training or cardiac rehabilitation and weight loss.", severity: "info", cite: ["hfpef2026"], ap: "Optimize comorbidities (BP, AF, sleep apnea) and encourage exercise training and weight loss" });
  }

  if (yes(v, "amyloidFlags") && t.key !== "hfref") {
    recs.push({ text: "Amyloid red flags: evaluate for cardiac amyloidosis. Serum free light chains plus serum and urine immunofixation first, then Tc-99m PYP/DPD scintigraphy. See the ATTR-CM module.", severity: "action", cite: ["attr2025", "hfpef2026"], cor: "1", ap: "Evaluate for cardiac amyloidosis with serum free light chains, serum/urine immunofixation and technetium pyrophosphate scintigraphy" });
  }

  // Iron
  const fer = num(v, "ferritin");
  const ts = num(v, "tsat");
  if (fer != null && (fer < 100 || (fer < 300 && ts != null && ts < 20))) {
    recs.push({ text: `Iron deficiency (ferritin ${fmt(fer, 0)}${ts != null ? `, TSAT ${fmt(ts, 0)}%` : ""}): IV iron (ferric carboxymaltose or ferric derisomaltose) improves functional status${t.key === "hfref" || t.key === "hfmref" ? " (2a)" : ""}; evaluate for GI blood loss as indicated.`, severity: "action", cite: ["hf2022"], cor: t.key === "hfref" || t.key === "hfmref" ? "2a" : undefined, ap: "Iron deficiency present; will arrange IV iron" });
  } else if (fer == null) missing.push("Ferritin / TSAT (iron deficiency)");

  if (yes(v, "diabetes") && !sglt2 && sglt2Ok && !starts.some((s) => s.includes("SGLT2") || s.includes("gliflozin"))) {
    recs.push({ text: "Type 2 diabetes: SGLT2 inhibitor is recommended for HF and kidney protection.", severity: "action", cite: ["hf2022"], cor: "1", ap: "" });
  }
  recs.push({ text: "Self-care: daily weights, sodium restriction (avoid excess; individualized), avoid NSAIDs and non-dihydropyridine CCBs (HFrEF), vaccinations, and cardiac rehabilitation referral.", severity: "info", cite: ["hf2022"], ap: "" });
  plan.push("daily weights, avoid NSAIDs, cardiac rehabilitation, BMP in 1-2 weeks after medication changes and follow-up in 2-4 weeks for titration");

  const headline = t.key === "hfref"
    ? `HFrEF (EF ${fmt(ef, 0)}%): ${starts.length ? `${starts.length} GDMT change${starts.length > 1 ? "s" : ""} to make` : "on 4 pillars; titrate/devices"}`
    : t.key === "hfimpef" ? `HFimpEF (EF ${fmt(ef, 0)}%, was ${fmt(num(v, "lowestEf")!, 0)}%): continue GDMT`
    : t.key === "hfmref" ? `HFmrEF (EF ${fmt(ef, 0)}%): SGLT2i ± MRA/ARNI`
    : `HFpEF (EF ${fmt(ef, 0)}%): SGLT2i + finerenone${bmiV != null && bmiV >= 30 ? " + incretin" : ""}`;

  const gdmt = [
    raas !== "none" && (raas === "arni" ? "sacubitril/valsartan" : raas === "acei" ? "ACE inhibitor" : "ARB"),
    bb !== "none" && "beta-blocker", mra !== "none" && (mra === "finerenone" ? "finerenone" : "MRA"), sglt2 && "SGLT2 inhibitor", yes(v, "glp1") && "GLP-1-based therapy",
  ].filter(Boolean) as string[];
  const apExtra = recs.filter((r) => r.ap).map((r) => r.ap!.replace(/\.$/, ""));
  const ap = [
    `Heart failure with ${t.key === "hfref" ? "reduced" : t.key === "hfimpef" ? "improved" : t.key === "hfmref" ? "mildly reduced" : "preserved"} ejection fraction${yes(v, "ischemic") ? " (ischemic)" : ""}: ${ageSex(v)}, LVEF ${fmt(ef, 0)}%${t.key === "hfimpef" ? ` (previously ${fmt(num(v, "lowestEf")!, 0)}%)` : ""}${nyha ? `, NYHA class ${["", "I", "II", "III", "IV"][nyha]}` : ""}${v.congested === true ? ", volume overloaded" : v.congested === false ? ", euvolemic" : ""}${sbp != null ? `, SBP ${fmt(sbp, 0)}` : ""}${hr != null ? `, HR ${fmt(hr, 0)}` : ""}${k != null ? `, K ${fmt(k, 1)}` : ""}${egfr != null ? `, eGFR ${fmt(egfr, 0)}` : ""}. Current therapy: ${gdmt.length ? list(gdmt) : "no GDMT"}.`,
    `Plan: ${plan.join("; ")}.`,
    apExtra.length ? apExtra.join(". ") + "." : "",
  ].filter(Boolean).join(" ");

  return { headline, metrics, recommendations: recs, missing, ap };
}

export const hfModule: ClinicalModule = {
  id: "hf",
  title: "Heart Failure",
  short: "HF",
  icon: "🫀",
  description: "Classify by EF, find GDMT gaps, titrate by BP/HR/K/eGFR, iron, ICD/CRT eligibility — 2022 AHA/ACC/HFSA, 2024 HFrEF and 2026 HFpEF ACC pathways.",
  placeholder: "e.g. 68M ischemic CM, EF 30% for 4 months, NYHA II, euvolemic, BP 112/70, HR 74 sinus, K 4.4, eGFR 58, on lisinopril 10 and metoprolol succinate 50, QRS 156 LBBB",
  fields,
  evaluate: evaluateHf,
  citations: cites("hf2022", "hfref2024", "hfpef2026", "attr2025"),
};
