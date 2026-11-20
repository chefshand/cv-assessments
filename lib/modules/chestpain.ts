import type { ClinicalModule, FieldDef, Inputs, Metric, Recommendation, RuleResult } from "../types";
import { ageSex, arr, fmt, list, num, str, yes } from "../util";
import { cites } from "../citations";

// 2021 AHA/ACC chest pain guideline (stable chest pain pathways) and 2023
// AHA/ACC chronic coronary disease guideline. Pretest probability uses the
// contemporary table (Juarez-Orozco 2019) referenced by both.

const FEATURES = [
  { value: "constrictive", label: "Substernal / constrictive (incl. jaw, arm)" },
  { value: "exertional", label: "Provoked by exertion or stress" },
  { value: "relieved", label: "Relieved by rest or nitroglycerin within 5 min" },
];
const RF = [
  { value: "diabetes", label: "Diabetes" }, { value: "htn", label: "Hypertension" }, { value: "lipids", label: "Dyslipidemia" },
  { value: "smoker", label: "Smoking" }, { value: "fhx", label: "Family history premature CAD" }, { value: "ckd", label: "CKD" }, { value: "pad", label: "PAD / other vascular" },
];

// [age band][sex][typical, atypical, nonanginal, dyspnea] in %
const PTP: Record<string, Record<"male" | "female", number[]>> = {
  "30": { male: [3, 4, 1, 0], female: [5, 3, 1, 3] },
  "40": { male: [22, 10, 3, 12], female: [10, 6, 2, 3] },
  "50": { male: [32, 17, 11, 20], female: [13, 6, 3, 9] },
  "60": { male: [44, 26, 22, 27], female: [16, 11, 9, 14] },
  "70": { male: [52, 34, 24, 32], female: [27, 19, 14, 12] },
};

export function pretestProbability(age: number, sex: "male" | "female", nFeatures: number, dyspnea: boolean): number {
  const band = age >= 70 ? "70" : age >= 60 ? "60" : age >= 50 ? "50" : age >= 40 ? "40" : "30";
  const idx = dyspnea && nFeatures < 2 ? 3 : nFeatures >= 3 ? 0 : nFeatures === 2 ? 1 : 2;
  return PTP[band][sex][idx];
}

const fields: FieldDef[] = [
  { key: "age", label: "Age", type: "number", unit: "y", section: "Patient" },
  { key: "sex", label: "Sex", type: "select", section: "Patient", options: [ { value: "female", label: "Female" }, { value: "male", label: "Male" } ] },
  { key: "acute", label: "Rest pain / crescendo / ongoing in last 48 h", type: "bool", section: "Symptoms" },
  { key: "features", label: "Anginal features", type: "multi", section: "Symptoms", options: FEATURES },
  { key: "dyspnea", label: "Exertional dyspnea is the main symptom", type: "bool", section: "Symptoms" },
  { key: "riskFactors", label: "Risk factors", type: "multi", section: "Symptoms", options: RF },
  { key: "knownCad", label: "Known CAD", type: "select", section: "Known disease", options: [ { value: "none", label: "None" }, { value: "nonobstructive", label: "Nonobstructive (<50%)" }, { value: "obstructive", label: "Obstructive / prior MI / PCI / CABG" } ] },
  { key: "cac", label: "Prior CAC score", type: "number", unit: "AU", section: "Known disease" },
  { key: "canExercise", label: "Can exercise (≥5 METs)", type: "bool", section: "Testing factors" },
  { key: "ecgInterpretable", label: "ECG interpretable for exercise (no LBBB, paced, ≥1 mm ST depression, digoxin, WPW)", type: "bool", section: "Testing factors" },
  { key: "ef", label: "LVEF", type: "number", unit: "%", section: "Testing factors" },
  { key: "onGdmt", label: "Already on optimal preventive / antianginal therapy", type: "bool", section: "Testing factors" },
  { key: "contrastIssue", label: "CCTA limitation (eGFR <30, contrast allergy, AF/high HR, BMI >40)", type: "bool", section: "Testing factors" },
  {
    key: "result", label: "Test result (if done)", type: "select", section: "Results",
    options: [
      { value: "normal", label: "Normal / no CAD" }, { value: "nonobstructive", label: "CCTA nonobstructive plaque" },
      { value: "intermediate", label: "CCTA 40-90% stenosis" }, { value: "high_risk_anatomy", label: "CCTA LM ≥50% / 3VD / prox LAD ≥70%" },
      { value: "mild_ischemia", label: "Stress: mild ischemia (<10%)" }, { value: "high_risk_stress", label: "Stress: high-risk (≥10% ischemia, TID, EF drop)" },
    ],
  },
  { key: "refractory", label: "Lifestyle-limiting angina despite ≥2 antianginals", type: "bool", section: "Results" },
  { key: "antianginals", label: "Antianginals", type: "multi", section: "Results", options: [ { value: "bb", label: "Beta-blocker" }, { value: "ccb", label: "CCB" }, { value: "nitrate", label: "Long-acting nitrate" }, { value: "ranolazine", label: "Ranolazine" } ] },
];

export function evaluateChestPain(v: Inputs): RuleResult {
  const recs: Recommendation[] = [];
  const metrics: Metric[] = [];
  const missing: string[] = [];
  const plan: string[] = [];
  const age = num(v, "age");
  const sex = str(v, "sex") as "male" | "female" | null;
  const feats = arr(v, "features");
  const rf = arr(v, "riskFactors");
  const known = str(v, "knownCad") ?? "none";
  const cac = num(v, "cac");
  const result = str(v, "result");
  const ef = num(v, "ef");
  const anti = arr(v, "antianginals");

  if (yes(v, "acute")) {
    recs.push({ text: "Acute or unstable features (rest, crescendo or ongoing pain within 48 h): send to the ED for ECG and high-sensitivity troponin; do not use outpatient stress testing (1).", severity: "urgent", cite: ["chestpain2021"], cor: "1", ap: "Given unstable features, referred to the emergency department for ECG and high-sensitivity troponin evaluation" });
    return { headline: "Possible ACS: ED evaluation", metrics, recommendations: recs, missing, ap: `Chest pain with unstable features: ${ageSex(v)}. Per the 2021 AHA/ACC chest pain guideline, referred to the emergency department for ECG and high-sensitivity troponin.` };
  }

  const nF = feats.length;
  const type = yes(v, "dyspnea") && nF < 2 ? "exertional dyspnea" : nF >= 3 ? "typical angina" : nF === 2 ? "atypical angina" : "nonanginal chest pain";
  let ptp: number | null = null;
  if (age != null && sex) {
    ptp = pretestProbability(age, sex, nF, yes(v, "dyspnea"));
    // Clinical likelihood is raised by risk factors and lowered by CAC 0.
    metrics.push({ label: "Pretest probability", value: `${ptp}%`, note: `${type}; ${ptp <= 15 ? "≤15%: low" : "intermediate-high"}` });
  } else missing.push("Age and sex (pretest probability)");
  if (!feats.length && v.dyspnea == null) missing.push("Anginal features");
  const riskBump = rf.length >= 2 || rf.includes("diabetes") || rf.includes("pad");
  const low = ptp != null && ptp <= 15 && !riskBump && (cac == null || cac === 0);
  const effLow = low || (cac === 0 && ptp != null && ptp <= 15);
  if (ptp != null && ptp <= 15 && riskBump) metrics.push({ label: "Clinical likelihood", value: "raised", note: `risk factors: ${list(rf)}` });

  let headline = "";
  if (result) {
    switch (result) {
      case "normal":
        headline = "No CAD on testing: noncardiac causes, prevention";
        recs.push({ text: "No obstructive CAD or ischemia: evaluate noncardiac causes; no further routine testing for 2 years (CCTA) absent new symptoms.", severity: "info", cite: ["chestpain2021"], ap: "" });
        plan.push("evaluate noncardiac causes; no further ischemic testing unless symptoms change");
        break;
      case "nonobstructive":
        headline = "Nonobstructive CAD: intensify prevention";
        recs.push({ text: "Nonobstructive plaque: preventive therapy (statin per plaque burden, aspirin if no bleeding risk is reasonable), risk factor control; consider INOCA/microvascular evaluation if persistent angina (2a).", severity: "action", cite: ["chestpain2021", "ccd2023"], ap: "Nonobstructive coronary atherosclerosis; start/intensify statin therapy and risk factor modification" });
        plan.push("statin and aspirin with risk factor control for nonobstructive CAD");
        break;
      case "intermediate":
        headline = "CCTA 40-90% stenosis: FFR-CT or stress imaging";
        recs.push({ text: "Stenosis 40-90% on CCTA: FFR-CT or stress imaging is reasonable to determine hemodynamic significance (2a); proceed to ICA if functionally significant with refractory symptoms.", severity: "action", cite: ["chestpain2021"], cor: "2a", ap: "Obtain FFR-CT or stress imaging to assess hemodynamic significance of intermediate stenosis" });
        plan.push("FFR-CT or stress imaging for the intermediate lesion");
        break;
      case "high_risk_anatomy":
        headline = "High-risk anatomy: invasive angiography";
        recs.push({ text: "Left main ≥50%, 3-vessel or proximal LAD ≥70% disease: invasive coronary angiography with Heart Team discussion of revascularization (1).", severity: "urgent", cite: ["chestpain2021", "ccd2023"], cor: "1", ap: "High-risk coronary anatomy; refer for invasive coronary angiography and Heart Team review" });
        plan.push("invasive coronary angiography");
        break;
      case "mild_ischemia":
        headline = "Mild ischemia: GDMT first";
        recs.push({ text: "Mild ischemia: guideline-directed medical therapy; invasive strategy not routinely needed (ISCHEMIA). Angiography if symptoms remain lifestyle-limiting.", severity: "action", cite: ["ccd2023"], ap: "" });
        plan.push("guideline-directed medical therapy for mild ischemia");
        break;
      case "high_risk_stress":
        headline = "High-risk stress test: invasive angiography";
        recs.push({ text: "High-risk stress findings (≥10% ischemic myocardium, TID, EF drop, large defect): invasive coronary angiography (1).", severity: "urgent", cite: ["chestpain2021"], cor: "1", ap: "High-risk stress findings; refer for invasive coronary angiography" });
        plan.push("invasive coronary angiography");
        break;
    }
  } else if (known === "obstructive") {
    headline = "Known obstructive CAD: optimize GDMT; stress imaging if symptoms persist";
    recs.push({ text: `Known obstructive CAD with ${yes(v, "refractory") ? "refractory" : "stable"} symptoms: optimize antianginals${yes(v, "refractory") ? "; invasive angiography is reasonable for lifestyle-limiting angina despite GDMT (1)" : "; stress imaging (PET, SPECT, CMR or echo) to assess ischemia if symptoms persist on therapy (1)"}.`, severity: "action", cite: ["chestpain2021", "ccd2023"], cor: "1", ap: "" });
    plan.push(yes(v, "refractory") ? "invasive coronary angiography for refractory angina" : "optimize antianginal therapy and obtain stress imaging if symptoms persist");
  } else if (known === "nonobstructive") {
    headline = "Known nonobstructive CAD: CCTA or stress testing if new symptoms";
    recs.push({ text: "Known nonobstructive CAD with new/worsening symptoms: CCTA is reasonable to look for progression (2a); stress testing reasonable (2a). Consider INOCA evaluation.", severity: "action", cite: ["chestpain2021"], cor: "2a", ap: "" });
    plan.push("CCTA to assess for plaque progression");
  } else if (ptp != null) {
    if (effLow) {
      headline = `Low risk (PTP ${ptp}%): testing can be deferred`;
      recs.push({ text: `Low-risk stable chest pain${cac === 0 ? " with CAC 0" : ""}: deferring testing is reasonable (2a); if testing is desired, CAC score or exercise ECG is a reasonable first test. Address noncardiac causes and prevention.`, severity: "info", cite: ["chestpain2021"], cor: "2a", ap: "Low pretest probability; reasonable to defer cardiac testing with focus on prevention and evaluation of noncardiac causes" });
      plan.push("defer ischemic testing; prevention and noncardiac evaluation");
    } else {
      const old = age != null && age >= 65;
      const calcified = cac != null && cac >= 400;
      const ccta = !old && !calcified && !yes(v, "contrastIssue") && !yes(v, "onGdmt");
      const exOk = yes(v, "canExercise") && yes(v, "ecgInterpretable");
      let test: string;
      if (ccta) test = "coronary CTA (1), preferred given age <65 and not on preventive therapy (2a)";
      else if (calcified || old) test = `stress imaging (PET/SPECT, stress echo or CMR) (1)${calcified ? `, preferred given CAC ${fmt(cac!, 0)} (CCTA less accurate with heavy calcium)` : ", favored at age ≥65"}${yes(v, "canExercise") ? "; exercise preferred if able" : "; pharmacologic if unable to exercise"}`;
      else test = `stress imaging (1)${yes(v, "contrastIssue") ? " given CCTA limitation" : ""}`;
      headline = `Intermediate-high risk${ptp != null ? ` (PTP ${ptp}%)` : ""}: ${ccta ? "CCTA" : "stress imaging"}`;
      recs.push({ text: `Intermediate-high risk stable chest pain, no known CAD: ${test}.${exOk && !ccta ? " Exercise ECG alone is reasonable at intermediate risk with an interpretable ECG (2a)." : ""}`, severity: "action", cite: ["chestpain2021"], cor: "1", ap: "" });
      plan.push(ccta ? "coronary CT angiography" : `${yes(v, "canExercise") ? "exercise" : "pharmacologic"} stress imaging`);
    }
    if (ef == null && (rf.includes("htn") || type === "exertional dyspnea")) recs.push({ text: "TTE is reasonable to assess LV function, valves and wall motion when structural disease is suspected (2a).", severity: "info", cite: ["chestpain2021"], cor: "2a", ap: "" });
  }

  // Medical therapy for CAD
  if (known !== "none" || (result && result !== "normal")) {
    recs.push({ text: "Chronic coronary disease GDMT: high-intensity statin (LDL goal per 2026 lipid guideline), aspirin 81 mg (clopidogrel if intolerant), BP <130/80; SGLT2i or GLP-1 RA with diabetes; low-dose colchicine may be considered (2b). Beta-blockers for angina, or if MI within 1 year or LVEF ≤50%; not routinely needed long-term otherwise.", severity: "action", cite: ["ccd2023", "lipid2026"], cor: "1", ap: "" });
    plan.push("high-intensity statin, aspirin, BP <130/80, cardiac rehabilitation where eligible");
    if (feats.length >= 2 && !anti.length) {
      recs.push({ text: "Angina: start a beta-blocker or calcium channel blocker as first-line antianginal (1); add a long-acting nitrate or ranolazine if needed; sublingual NTG for all.", severity: "action", cite: ["ccd2023"], cor: "1", ap: "Start antianginal therapy with a beta-blocker or calcium channel blocker, plus sublingual nitroglycerin as needed" });
    }
  }
  plan.push("sublingual nitroglycerin as needed with instructions to call 911 for pain lasting over 5 minutes despite nitroglycerin");

  const apExtra = recs.filter((r) => r.ap).map((r) => r.ap!.replace(/\.$/, ""));
  const ap = [
    `${known === "obstructive" ? "Chronic coronary disease with" : "Stable"} ${type === "exertional dyspnea" ? "exertional dyspnea" : `chest pain (${type})`}: ${ageSex(v)}${rf.length ? ` with ${list(rf.map((r) => RF.find((x) => x.value === r)!.label.toLowerCase()))}` : ""}${cac != null ? `; prior CAC ${fmt(cac, 0)}` : ""}${ptp != null && known === "none" ? `; pretest probability of obstructive CAD ${ptp}%` : ""}${ef != null ? `; LVEF ${fmt(ef, 0)}%` : ""}.`,
    `Per the 2021 AHA/ACC chest pain and 2023 chronic coronary disease guidelines, plan: ${plan.join("; ")}.`,
    apExtra.length ? apExtra.join(". ") + "." : "",
  ].filter(Boolean).join(" ");

  return { headline, metrics, recommendations: recs, missing, ap };
}

export const chestPainModule: ClinicalModule = {
  id: "chestpain",
  title: "Chest Pain & Stable CAD",
  short: "Chest pain",
  icon: "💢",
  description: "Pretest probability, which test (CCTA vs stress imaging vs defer), acting on results, chronic coronary disease GDMT — 2021 AHA/ACC chest pain and 2023 CCD guidelines.",
  placeholder: "e.g. 56M exertional substernal pressure relieved by rest for 2 months, HTN, smoker, LDL 150, can exercise, normal ECG, no known CAD, not on statin",
  fields,
  evaluate: evaluateChestPain,
  citations: cites("chestpain2021", "ccd2023", "lipid2026"),
};
