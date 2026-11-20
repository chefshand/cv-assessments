import type { ClinicalModule, FieldDef, Inputs, Metric, Recommendation, RuleResult } from "../types";
import { ageSex, arr, fmt, list, num, str, yes } from "../util";
import { cites } from "../citations";

// 2022 ESC cardio-oncology guideline (HFA-ICOS baseline risk, CTRCD
// definitions, surveillance schedules, cardioprotection, survivorship), with
// the 2025 ACC Concise Clinical Guidance for BTK, immune checkpoint and VEGF
// inhibitors, and the 2017 ASCO survivorship guideline.

const THERAPIES = [
  { value: "anthracycline", label: "Anthracycline" },
  { value: "her2", label: "HER2-targeted (trastuzumab, pertuzumab, T-DM1, T-DXd)" },
  { value: "ici", label: "Immune checkpoint inhibitor" },
  { value: "fluoropyrimidine", label: "5-FU / capecitabine" },
  { value: "vegfi", label: "VEGF inhibitor / VEGFR TKI" },
  { value: "btki", label: "BTK inhibitor (ibrutinib, acalabrutinib, zanubrutinib)" },
  { value: "proteasome", label: "Proteasome inhibitor (carfilzomib, bortezomib)" },
  { value: "imid", label: "IMiD (lenalidomide, pomalidomide, thalidomide)" },
  { value: "cart", label: "CAR-T cell therapy" },
  { value: "qt_drug", label: "QT-prolonging (arsenic, ribociclib, vandetanib…)" },
  { value: "endocrine", label: "Aromatase inhibitor / ADT" },
  { value: "radiation", label: "Chest / mediastinal radiation" },
];

const NOUN: Record<string, string> = {
  anthracycline: "an anthracycline", her2: "HER2-targeted therapy", ici: "an immune checkpoint inhibitor", fluoropyrimidine: "a fluoropyrimidine",
  vegfi: "a VEGF inhibitor", btki: "a BTK inhibitor", proteasome: "a proteasome inhibitor", imid: "an immunomodulatory drug", cart: "CAR-T therapy",
  qt_drug: "a QT-prolonging agent", endocrine: "endocrine therapy", radiation: "chest radiation",
};

// Doxorubicin-equivalent conversion (ESC 2022)
const ANTHRA = [
  { value: "doxorubicin", label: "Doxorubicin", factor: 1 },
  { value: "epirubicin", label: "Epirubicin", factor: 0.8 },
  { value: "daunorubicin", label: "Daunorubicin", factor: 0.6 },
  { value: "idarubicin", label: "Idarubicin", factor: 5 },
  { value: "mitoxantrone", label: "Mitoxantrone", factor: 10 },
  { value: "liposomal", label: "Liposomal doxorubicin", factor: 1 },
];

const fields: FieldDef[] = [
  { key: "age", label: "Age", type: "number", unit: "y", section: "Patient" },
  { key: "sex", label: "Sex", type: "select", section: "Patient", options: [ { value: "female", label: "Female" }, { value: "male", label: "Male" } ] },
  { key: "cancer", label: "Cancer", type: "select", section: "Patient", options: [ { value: "breast", label: "Breast" }, { value: "lymphoma", label: "Lymphoma" }, { value: "leukemia", label: "Leukemia (incl. CLL)" }, { value: "myeloma", label: "Myeloma" }, { value: "other", label: "Other" } ] },
  { key: "phase", label: "Phase", type: "select", section: "Patient", options: [ { value: "pre", label: "Before treatment" }, { value: "on", label: "On treatment" }, { value: "survivor", label: "Completed treatment (survivor)" } ] },
  { key: "yearsSince", label: "Years since completing treatment", type: "number", unit: "y", step: 0.5, section: "Patient", showIf: (v) => v.phase === "survivor" },
  { key: "therapies", label: "Cancer therapies (current, planned or prior)", type: "multi", section: "Therapy", options: THERAPIES, extractHint: "Adriamycin/AC/R-CHOP → anthracycline; Herceptin/Perjeta/Kadcyla/Enhertu → her2; pembrolizumab/nivolumab/ipilimumab → ici; capecitabine/Xeloda/5-FU/FOLFOX → fluoropyrimidine; bevacizumab/sunitinib/pazopanib/lenvatinib → vegfi; ibrutinib → btki; carfilzomib/bortezomib → proteasome; lenalidomide/Revlimid → imid." },
  { key: "anthraAgent", label: "Anthracycline agent", type: "select", section: "Therapy", options: ANTHRA.map(({ value, label }) => ({ value, label })), showIf: (v) => Array.isArray(v.therapies) && v.therapies.includes("anthracycline") },
  { key: "anthraDose", label: "Cumulative anthracycline dose (given + planned)", type: "number", unit: "mg/m²", section: "Therapy", showIf: (v) => Array.isArray(v.therapies) && v.therapies.includes("anthracycline"), extractHint: "If cycles are given (e.g., 4 cycles of AC at doxorubicin 60 mg/m²), multiply: 240." },
  { key: "mhd", label: "Radiation mean heart dose", type: "number", unit: "Gy", step: 0.5, section: "Therapy", showIf: (v) => Array.isArray(v.therapies) && v.therapies.includes("radiation") },
  { key: "hfCm", label: "Prior heart failure / cardiomyopathy", type: "bool", section: "Baseline risk (HFA-ICOS)" },
  { key: "severeVhd", label: "Severe valve disease", type: "bool", section: "Baseline risk (HFA-ICOS)" },
  { key: "cad", label: "CAD (MI, PCI/CABG, stable angina)", type: "bool", section: "Baseline risk (HFA-ICOS)" },
  { key: "priorAnthra", label: "Prior anthracycline (earlier cancer)", type: "bool", section: "Baseline risk (HFA-ICOS)" },
  { key: "priorRt", label: "Prior chest/mediastinal radiation", type: "bool", section: "Baseline risk (HFA-ICOS)" },
  { key: "riskFactors", label: "CV risk factors", type: "multi", section: "Baseline risk (HFA-ICOS)", options: [ { value: "htn", label: "Hypertension" }, { value: "diabetes", label: "Diabetes" }, { value: "ckd", label: "CKD" }, { value: "smoker", label: "Current/recent smoker" }, { value: "obesity", label: "BMI >30" }, { value: "af", label: "AF / arrhythmia" } ] },
  { key: "baseTnHigh", label: "Elevated baseline troponin", type: "bool", section: "Baseline risk (HFA-ICOS)" },
  { key: "baseNpHigh", label: "Elevated baseline BNP/NT-proBNP", type: "bool", section: "Baseline risk (HFA-ICOS)" },
  { key: "baselineEf", label: "Baseline LVEF", type: "number", unit: "%", section: "Function" },
  { key: "ef", label: "Current LVEF", type: "number", unit: "%", section: "Function" },
  { key: "glsDrop", label: "Relative GLS decline from baseline", type: "number", unit: "%", section: "Function" },
  { key: "biomarkerRise", label: "New troponin or NP rise", type: "bool", section: "Function" },
  { key: "hfSymptoms", label: "HF symptoms", type: "bool", section: "Function" },
  { key: "sbp", label: "Systolic BP", type: "number", unit: "mmHg", section: "Other toxicities" },
  { key: "dbp", label: "Diastolic BP", type: "number", unit: "mmHg", section: "Other toxicities" },
  { key: "qtc", label: "QTc (Fridericia)", type: "number", unit: "ms", section: "Other toxicities" },
  { key: "iciMyocarditis", label: "Suspected ICI myocarditis (troponin rise, chest pain, arrhythmia, myositis)", type: "bool", section: "Other toxicities" },
  { key: "chestPainFp", label: "Chest pain during 5-FU/capecitabine", type: "bool", section: "Other toxicities" },
  { key: "afNew", label: "AF on current therapy", type: "bool", section: "Other toxicities" },
  { key: "ldl", label: "LDL-C", type: "number", unit: "mg/dL", section: "Other toxicities" },
];

type Risk = "low" | "moderate" | "high" | "very high";

/** HFA-ICOS baseline risk (simplified to factors shared across anthracycline and HER2 tables). */
export function hfaIcos(v: Inputs): { risk: Risk; points: number; high: string[]; medium: string[] } {
  const age = num(v, "age");
  const bef = num(v, "baselineEf") ?? num(v, "ef");
  const rf = arr(v, "riskFactors");
  if (yes(v, "hfCm")) return { risk: "very high", points: 0, high: ["prior HF/cardiomyopathy"], medium: [] };
  const high = [
    yes(v, "severeVhd") && "severe valve disease",
    yes(v, "cad") && "coronary artery disease",
    bef != null && bef < 50 && `baseline LVEF ${fmt(bef, 0)}%`,
    age != null && age >= 80 && "age ≥80",
    yes(v, "priorAnthra") && "prior anthracycline",
    yes(v, "priorRt") && "prior chest radiation",
  ].filter(Boolean) as string[];
  const m2 = [age != null && age >= 65 && age < 80 && "age 65-79", bef != null && bef >= 50 && bef < 55 && `LVEF ${fmt(bef, 0)}%`].filter(Boolean) as string[];
  const m1 = [
    ...rf.filter((x) => x !== "af").map((x) => ({ htn: "hypertension", diabetes: "diabetes", ckd: "CKD", smoker: "smoking", obesity: "obesity" } as Record<string, string>)[x]),
    yes(v, "baseTnHigh") && "elevated baseline troponin",
    yes(v, "baseNpHigh") && "elevated baseline natriuretic peptide",
  ].filter(Boolean) as string[];
  const points = m2.length * 2 + m1.length;
  const risk: Risk = high.length || points >= 5 ? "high" : points >= 2 ? "moderate" : "low";
  return { risk, points, high, medium: [...m2, ...m1] };
}

export function doxEquivalent(agent: string | null, dose: number): number {
  return dose * (ANTHRA.find((a) => a.value === agent)?.factor ?? 1);
}

/** ESC 2022 cancer therapy-related cardiac dysfunction grading. */
export function ctrcd(v: Inputs): { grade: "none" | "mild" | "moderate" | "severe" | "symptomatic"; text: string } {
  const ef = num(v, "ef"), b = num(v, "baselineEf"), gls = num(v, "glsDrop");
  const bio = yes(v, "biomarkerRise");
  if (yes(v, "hfSymptoms")) return { grade: "symptomatic", text: "symptomatic CTRCD (heart failure)" };
  if (ef == null) return { grade: "none", text: "" };
  if (ef < 40) return { grade: "severe", text: `new LVEF ${fmt(ef, 0)}% (<40%)` };
  const drop = b != null ? b - ef : 0;
  const glsHit = gls != null && gls > 15;
  if (ef < 50 && (drop >= 10 || glsHit || bio)) return { grade: "moderate", text: `LVEF ${fmt(ef, 0)}%${b != null ? ` (from ${fmt(b, 0)}%)` : ""}${glsHit ? `, GLS down ${fmt(gls!, 0)}%` : ""}${bio ? ", biomarker rise" : ""}` };
  if (ef >= 50 && (glsHit || bio)) return { grade: "mild", text: `LVEF ${fmt(ef, 0)}% with ${[glsHit && `relative GLS decline ${fmt(gls!, 0)}%`, bio && "new biomarker rise"].filter(Boolean).join(" and ")}` };
  return { grade: "none", text: "" };
}

export function evaluateCardioOnc(v: Inputs): RuleResult {
  const recs: Recommendation[] = [];
  const metrics: Metric[] = [];
  const missing: string[] = [];
  const plan: string[] = [];
  const th = arr(v, "therapies");
  const phase = str(v, "phase") ?? "on";
  if (!th.length) return { headline: "Select the cancer therapies", metrics: [], recommendations: [], missing: ["Cancer therapies"], ap: "" };
  if (str(v, "phase") == null) missing.push("Treatment phase (defaulting to on treatment)");
  const has = (t: string) => th.includes(t);

  const ico = hfaIcos(v);
  const highRisk = ico.risk === "high" || ico.risk === "very high";
  metrics.push({ label: "HFA-ICOS baseline risk", value: ico.risk, note: [...ico.high, ...ico.medium].join(", ") || "no risk factors entered" });

  let doxEq: number | null = null;
  if (has("anthracycline")) {
    const d = num(v, "anthraDose");
    if (d != null) {
      doxEq = doxEquivalent(str(v, "anthraAgent"), d);
      metrics.push({ label: "Doxorubicin-equivalent", value: `${fmt(doxEq, 0)} mg/m²`, note: doxEq >= 250 ? "≥250: high-risk exposure" : "<250" });
    } else missing.push("Cumulative anthracycline dose");
  }
  const mhd = num(v, "mhd");
  if (has("radiation") && mhd != null) metrics.push({ label: "Mean heart dose", value: `${fmt(mhd, 1)} Gy`, note: mhd >= 25 ? "very high" : mhd >= 15 ? "high" : mhd >= 5 ? "moderate" : "low" });

  // CTRCD
  const c = ctrcd(v);
  if (c.grade !== "none") metrics.push({ label: "CTRCD", value: c.grade, note: c.text });
  const cardiotoxic = has("anthracycline") || has("her2");
  if (cardiotoxic && num(v, "ef") == null && num(v, "baselineEf") == null) missing.push("LVEF (baseline and current)");

  if (c.grade === "symptomatic" || c.grade === "severe") {
    recs.push({ text: `${c.grade === "symptomatic" ? "Symptomatic" : "Severe asymptomatic"} CTRCD (${c.text}): interrupt anthracycline/HER2 therapy and start HF GDMT (ACEi/ARB/ARNI, beta-blocker, MRA, SGLT2i); multidisciplinary decision with oncology before any rechallenge (1).`, severity: "urgent", cite: ["esco2022", "hf2022"], cor: "1", ap: `Cancer therapy-related cardiac dysfunction (${c.text}); recommend holding cardiotoxic therapy and starting guideline-directed heart failure therapy, discussed with oncology` });
    plan.push("hold anthracycline/HER2 therapy and start HF GDMT; repeat echo in 3-6 weeks to guide rechallenge");
  } else if (c.grade === "moderate") {
    recs.push({ text: `Moderate asymptomatic CTRCD (${c.text}): start ACEi/ARB and beta-blocker (1). ${has("her2") ? "Continue HER2 therapy with cardioprotection and closer echo (every 2-3 cycles) (2a)." : ""}${has("anthracycline") ? " Temporarily interrupt anthracycline; resume after multidisciplinary review (2a)." : ""}`.trim(), severity: "warning", cite: ["esco2022"], cor: "1", ap: `Moderate cancer therapy-related cardiac dysfunction (${c.text}); start ACE inhibitor/ARB and beta-blocker with closer surveillance` });
    plan.push("start ACE inhibitor/ARB and beta-blocker; repeat echo every 2-3 cycles");
  } else if (c.grade === "mild") {
    recs.push({ text: `Mild asymptomatic CTRCD (${c.text}): continue cancer therapy; ACEi/ARB and/or beta-blocker should be considered, especially with GLS or biomarker changes (2a). Repeat echo and biomarkers in 3-6 weeks.`, severity: "action", cite: ["esco2022"], cor: "2a", ap: `Mild cancer therapy-related cardiac dysfunction (${c.text})` });
    plan.push("continue cancer therapy with consideration of cardioprotection; repeat echo and biomarkers in 3-6 weeks");
  }

  // Baseline / surveillance schedules
  if (phase !== "survivor") {
    if (has("anthracycline")) {
      const sched = highRisk
        ? "echo at baseline, every 2 cycles, at completion, then 3 and 12 months after; troponin ± NP before every cycle"
        : ico.risk === "moderate"
          ? `echo at baseline${doxEq != null && doxEq >= 250 ? ", after reaching 250 mg/m²" : ", after 250 mg/m² if reached"}, at completion and 12 months after; troponin ± NP every 2 cycles`
          : "echo at baseline and 12 months after completion (consider after 250 mg/m²); troponin ± NP at baseline and after completion";
      recs.push({ text: `Anthracycline surveillance (${ico.risk} risk): ${sched}. Use the same modality and lab; GLS where available.`, severity: "action", cite: ["esco2022"], cor: "1", ap: "" });
      plan.push(`anthracycline surveillance: ${sched}`);
      if (highRisk || (doxEq != null && doxEq >= 250)) {
        recs.push({ text: "High-risk anthracycline exposure: ACEi/ARB and beta-blocker should be considered for primary prevention (2a); statin for high/very-high risk (2a); dexrazoxane or liposomal doxorubicin should be considered with oncology (2a). Minimize cumulative dose where feasible.", severity: "action", cite: ["esco2022"], cor: "2a", ap: "Given high baseline risk, recommend primary cardioprotection with ACE inhibitor/ARB, beta-blocker and statin, and discussed dexrazoxane or liposomal doxorubicin with oncology" });
      }
    }
    if (has("her2")) {
      const sched = highRisk
        ? "echo at baseline, every 2 cycles (about every 6 weeks) during therapy, at completion, then 3 and 12 months after; troponin ± NP every 2-3 cycles"
        : "echo at baseline and every 3 months during therapy (may extend to every 4 months in low-risk patients with stable function), and 12 months after completion; troponin ± NP at baseline and periodically";
      recs.push({ text: `HER2-targeted therapy surveillance (${ico.risk} risk): ${sched}.`, severity: "action", cite: ["esco2022"], cor: "1", ap: "" });
      plan.push(`HER2 surveillance: ${sched}`);
    }
    if (has("ici")) {
      recs.push({ text: "Immune checkpoint inhibitor: baseline ECG and troponin (1), NP; echo in high-risk patients. Serial troponin before doses 2-4 is reasonable (2a); any troponin rise warrants urgent myocarditis evaluation even with normal LVEF.", severity: "action", cite: ["esco2022", "accco2025"], cor: "1", ap: "" });
      plan.push("baseline ECG, troponin and NT-proBNP before immune checkpoint inhibitor, with serial troponin before doses 2-4");
    }
    if (has("fluoropyrimidine")) recs.push({ text: "Fluoropyrimidine: assess CV risk and baseline ECG; vasospasm presents as chest pain with ST changes during infusion/oral course.", severity: "info", cite: ["esco2022"], ap: "" });
    if (has("vegfi")) {
      recs.push({ text: "VEGF inhibitor: hypertension is the most common toxicity. BP at every visit and home BP daily in cycle 1, then every 2-3 weeks. Treat ≥140/90 (≥130/80 if high CV risk) with ACEi/ARB or dihydropyridine CCB (avoid diltiazem/verapamil with CYP3A4 TKIs). Hold the VEGFi if SBP ≥180 or DBP ≥110 until controlled.", severity: "action", cite: ["esco2022", "accco2025"], ap: "" });
      plan.push("home BP monitoring with treatment of BP ≥140/90 during VEGF inhibitor therapy");
    }
    if (has("btki")) {
      recs.push({ text: "BTK inhibitor: BP every visit, ECG every 3-6 months; screen for AF. If AF: beta-blocker for rate; avoid diltiazem, verapamil, amiodarone, dronedarone (interactions); factor Xa inhibitor preferred if anticoagulating, weighing BTKi bleeding risk; consider switching to a second-generation BTKi with oncology.", severity: "action", cite: ["accco2025"], ap: "" });
      plan.push("BP at each visit and ECG every 3-6 months on BTK inhibitor");
    }
    if (has("proteasome")) recs.push({ text: "Carfilzomib: baseline echo, NP and BP; HF, hypertension and ACS risk. Monitor BP each cycle; echo if symptoms or NP rise. Bortezomib has lower cardiotoxicity.", severity: "action", cite: ["esco2022"], ap: "" });
    if (has("imid")) recs.push({ text: "IMiD (lenalidomide/pomalidomide/thalidomide): high VTE risk, so thromboprophylaxis with aspirin or anticoagulant per myeloma VTE risk score.", severity: "action", cite: ["esco2022"], ap: "" });
    if (has("cart")) recs.push({ text: "CAR-T: baseline ECG, echo and troponin/NP in patients with CV disease; cytokine release syndrome can cause hypotension, arrhythmia and LV dysfunction.", severity: "info", cite: ["esco2022"], ap: "" });
    if (has("endocrine")) recs.push({ text: "Aromatase inhibitor / ADT: raises lipids and CV risk; assess and treat CV risk factors (lipids, BP, glucose) per primary prevention guidelines.", severity: "info", cite: ["esco2022"], ap: "" });
  }

  // Toxicities present now
  if (yes(v, "iciMyocarditis")) {
    recs.unshift({ text: "Suspected ICI myocarditis: hold the ICI, admit with telemetry, ECG/troponin/echo and cardiac MRI; start IV methylprednisolone 500-1000 mg daily for 3 days without waiting for confirmation once likely (1); endomyocardial biopsy if diagnosis uncertain.", severity: "urgent", cite: ["esco2022", "accco2025"], cor: "1", ap: "Suspected immune checkpoint inhibitor myocarditis; recommend holding immunotherapy, hospital admission with telemetry, cardiac MRI and high-dose corticosteroids" });
    plan.unshift("admit for suspected immune checkpoint inhibitor myocarditis");
  }
  if (yes(v, "chestPainFp")) {
    recs.unshift({ text: "Chest pain on 5-FU/capecitabine: stop the drug, ECG and troponin, nitrates/CCB for vasospasm, and exclude ACS. Rechallenge only after multidisciplinary review with prophylactic nitrate + CCB, or switch regimen.", severity: "urgent", cite: ["esco2022"], ap: "Chest pain on fluoropyrimidine concerning for coronary vasospasm; hold drug, ECG and troponin, nitrate and calcium channel blocker, and discuss alternatives with oncology" });
  }
  const sbp = num(v, "sbp"), dbp = num(v, "dbp");
  if (sbp != null && (sbp >= 140 || (dbp ?? 0) >= 90 || (highRisk && sbp >= 130))) {
    recs.push({ text: `BP ${fmt(sbp, 0)}${dbp != null ? `/${fmt(dbp, 0)}` : ""}: treat to <130/80 (<140/90 acceptable during active therapy); ACEi/ARB or dihydropyridine CCB first-line${sbp >= 180 || (dbp ?? 0) >= 110 ? "; severe, so hold VEGFi/TKI until controlled and coordinate with oncology" : ""}.`, severity: sbp >= 180 ? "urgent" : "action", cite: ["esco2022", "htn2025"], ap: "" });
    plan.push("treat hypertension with ACE inhibitor/ARB or dihydropyridine CCB");
  }
  const qtc = num(v, "qtc");
  if (qtc != null && (has("qt_drug") || qtc >= 480)) {
    recs.push({ text: qtc >= 500 ? `QTc ${fmt(qtc, 0)} ms ≥500: interrupt the QT-prolonging drug, correct K/Mg, review co-medications; restart at a lower dose or alternative only after QTc <480 (1).` : qtc >= 480 ? `QTc ${fmt(qtc, 0)} ms (480-500): continue with weekly ECG, correct electrolytes, minimize other QT drugs.` : `QTc ${fmt(qtc, 0)} ms: continue; ECG at baseline, after dose changes and periodically.`, severity: qtc >= 500 ? "urgent" : qtc >= 480 ? "warning" : "info", cite: ["esco2022"], ap: qtc >= 500 ? `QTc ${fmt(qtc, 0)} ms; recommend interrupting the QT-prolonging agent and correcting electrolytes` : "" });
  }
  if (yes(v, "afNew") && !has("btki")) recs.push({ text: "AF during cancer therapy: anticoagulate by CHA₂DS₂-VASc weighed against bleeding/thrombocytopenia (DOAC preferred unless interactions/GI cancers raise bleeding risk); see the AF module.", severity: "action", cite: ["esco2022", "af2023"], ap: "" });

  // Survivorship
  if (phase === "survivor") {
    const highSurv = (doxEq != null && doxEq >= 250) || (mhd != null && mhd >= 15) || (has("anthracycline") && has("radiation")) || highRisk;
    recs.push({ text: highSurv
      ? "High-risk survivor (anthracycline ≥250 mg/m², mean heart dose ≥15 Gy, combined anthracycline + chest RT, or high baseline risk): echo at 1, 3 and 5 years after therapy, then every 5 years (2a); annual CV risk assessment."
      : "Low/moderate-risk survivor: echo 12 months after completion; then consider echo every 5 years and annual CV risk factor assessment.", severity: "action", cite: ["esco2022", "asco2017"], cor: highSurv ? "2a" : "2b", ap: "" });
    plan.push(highSurv ? "survivorship echo at 1, 3 and 5 years after therapy, then every 5 years" : "survivorship echo every 5 years with annual risk factor assessment");
    if (has("radiation")) {
      recs.push({ text: "Chest radiation survivor: radiation-associated CAD, valve and pericardial disease appear 5-10+ years later. Consider CAD screening (CCTA or functional testing) from 5 years after RT in high-dose survivors, and echo every 5 years for valve disease; aggressive risk factor control.", severity: "action", cite: ["esco2022"], cor: "2b", ap: "Given prior chest radiation, will screen for radiation-associated coronary and valve disease" });
    }
    if (yes(v, "hfCm") === false && num(v, "ef") != null && num(v, "ef")! < 50) recs.push({ text: "Reduced LVEF in a survivor: treat as HF with GDMT; see the Heart failure module.", severity: "action", cite: ["hf2022"], ap: "" });
  }

  // Risk factor management
  const ldl = num(v, "ldl");
  if (highRisk || has("radiation") || has("endocrine") || (ldl != null && ldl >= 100)) {
    recs.push({ text: `Optimize CV risk factors (BP, lipids, glucose, smoking, exercise); cancer survivors with prior anthracycline/chest RT are at elevated ASCVD and HF risk.${ldl != null ? ` LDL ${fmt(ldl, 0)} mg/dL: statin per ASCVD risk (see ASCVD module).` : ""}`, severity: "info", cite: ["esco2022", "lipid2026"], ap: "" });
  }
  plan.push("aerobic exercise and cardiovascular risk factor optimization");

  const headline = yes(v, "iciMyocarditis") ? "Suspected ICI myocarditis: admit, steroids"
    : c.grade !== "none" ? `CTRCD ${c.grade}: ${c.grade === "mild" ? "continue therapy, consider cardioprotection" : c.grade === "moderate" ? "cardioprotection, closer imaging" : "hold therapy, HF GDMT"}`
    : phase === "survivor" ? `Survivor, ${ico.risk} risk: long-term surveillance`
    : `HFA-ICOS ${ico.risk} risk: ${has("anthracycline") || has("her2") ? "surveillance schedule" : "monitoring plan"}`;

  const thLabel = th.map((t) => (t === "anthracycline" && str(v, "anthraAgent") ? ANTHRA.find((a) => a.value === str(v, "anthraAgent"))!.label.toLowerCase() : NOUN[t] ?? t));
  const apExtra = recs.filter((r) => r.ap).map((r) => r.ap!.replace(/\.$/, ""));
  const cancer = str(v, "cancer");
  const ap = [
    `Cardio-oncology${cancer && cancer !== "other" ? `, ${cancer === "leukemia" ? "leukemia" : cancer === "breast" ? "breast cancer" : cancer}` : ""}: ${ageSex(v)} ${phase === "pre" ? "planned for" : phase === "survivor" ? `who completed${num(v, "yearsSince") != null ? ` ${fmt(num(v, "yearsSince")!, 1)} years ago` : ""}` : "receiving"} ${list(thLabel)}${doxEq != null ? ` (cumulative doxorubicin-equivalent ${fmt(doxEq, 0)} mg/m²)` : ""}${mhd != null ? `, mean heart dose ${fmt(mhd, 1)} Gy` : ""}. HFA-ICOS baseline risk ${ico.risk}${[...ico.high, ...ico.medium].length ? ` (${[...ico.high, ...ico.medium].join(", ")})` : ""}.${num(v, "ef") != null ? ` LVEF ${fmt(num(v, "ef")!, 0)}%${num(v, "baselineEf") != null ? ` (baseline ${fmt(num(v, "baselineEf")!, 0)}%)` : ""}${num(v, "glsDrop") != null ? `, relative GLS change -${fmt(num(v, "glsDrop")!, 0)}%` : ""}.` : ""}`,
    `Per the 2022 ESC cardio-oncology guideline${has("ici") || has("btki") || has("vegfi") ? " and 2025 ACC guidance" : ""}, plan: ${plan.join("; ")}.`,
    apExtra.length ? apExtra.join(". ") + "." : "",
  ].filter(Boolean).join(" ");

  return { headline, metrics, recommendations: recs, missing, ap };
}

export const cardioOncModule: ClinicalModule = {
  id: "cardioonc",
  title: "Cardio-Oncology",
  short: "Cardio-onc",
  icon: "🎗️",
  description: "Baseline risk (HFA-ICOS), anthracycline dose, HER2/ICI/VEGFi/BTKi/5-FU monitoring, echo-GLS-troponin schedules, CTRCD grading, cardioprotection, survivorship — 2022 ESC, 2025 ACC.",
  placeholder: "e.g. 58F HER2+ breast cancer, 4 cycles AC (doxorubicin 240 mg/m²) then trastuzumab/pertuzumab, HTN, BMI 32, baseline EF 62%, now EF 54% with GLS down 17%, troponin normal, BP 142/88",
  fields,
  evaluate: evaluateCardioOnc,
  citations: cites("esco2022", "accco2025", "asco2017", "hf2022"),
};
