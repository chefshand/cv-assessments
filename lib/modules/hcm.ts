import type { ClinicalModule, FieldDef, Inputs, Metric, Recommendation, RuleResult } from "../types";
import { ageSex, fmt, list, num, pct, str, yes } from "../util";
import { cites } from "../citations";

// 2024 AHA/ACC HCM guideline; HCM Risk-SCD (O'Mahony 2014) for 5-yr SCD risk.

const fields: FieldDef[] = [
  { key: "age", label: "Age", type: "number", unit: "y", section: "Patient" },
  { key: "sex", label: "Sex", type: "select", section: "Patient", options: [ { value: "female", label: "Female" }, { value: "male", label: "Male" } ] },
  { key: "nyha", label: "NYHA class", type: "select", section: "Patient", options: [ { value: "1", label: "I" }, { value: "2", label: "II" }, { value: "3", label: "III" }, { value: "4", label: "IV" } ] },
  { key: "maxWall", label: "Max LV wall thickness", type: "number", unit: "mm", section: "Imaging", extractHint: "Convert cm to mm (1.8 cm = 18)." },
  { key: "la", label: "LA diameter (PLAX)", type: "number", unit: "mm", section: "Imaging" },
  { key: "lvotRest", label: "LVOT gradient at rest", type: "number", unit: "mmHg", section: "Imaging" },
  { key: "lvotProvoked", label: "LVOT gradient provoked (Valsalva/exercise)", type: "number", unit: "mmHg", section: "Imaging" },
  { key: "ef", label: "LVEF", type: "number", unit: "%", section: "Imaging" },
  { key: "apicalAneurysm", label: "LV apical aneurysm", type: "bool", section: "Imaging" },
  { key: "lge", label: "LGE extent on CMR", type: "number", unit: "% LV mass", section: "Imaging" },
  { key: "cmrDone", label: "Cardiac MRI done", type: "bool", section: "Imaging" },
  { key: "arrest", label: "Prior cardiac arrest / sustained VT", type: "bool", section: "SCD risk" },
  { key: "fhxScd", label: "FHx SCD in 1st-degree/close relative ≤50 y", type: "bool", section: "SCD risk" },
  { key: "syncope", label: "Unexplained (likely arrhythmic) syncope", type: "bool", section: "SCD risk" },
  { key: "nsvt", label: "NSVT on monitoring", type: "bool", section: "SCD risk" },
  { key: "icd", label: "Has ICD", type: "bool", section: "SCD risk" },
  { key: "af", label: "Atrial fibrillation / flutter", type: "bool", section: "Other" },
  {
    key: "meds", label: "Current HCM therapy", type: "multi", section: "Therapy",
    options: [
      { value: "bb", label: "Beta-blocker" }, { value: "ccb", label: "Verapamil / diltiazem" }, { value: "disopyramide", label: "Disopyramide" },
      { value: "mavacamten", label: "Mavacamten" }, { value: "aficamten", label: "Aficamten" }, { value: "diuretic", label: "Diuretic" }, { value: "vasodilator", label: "Vasodilator (DHP CCB, nitrate, ACEi/ARB)" },
    ],
    extractHint: "Camzyos → mavacamten; Myqorzo → aficamten.",
  },
  { key: "srt", label: "Prior myectomy / alcohol septal ablation", type: "bool", section: "Therapy" },
  { key: "genetic", label: "Genetic testing", type: "select", section: "Family", options: [ { value: "positive", label: "Pathogenic variant found" }, { value: "negative", label: "Negative / VUS" }, { value: "not_done", label: "Not done" } ] },
  { key: "familyScreened", label: "First-degree relatives screened", type: "bool", section: "Family" },
  { key: "athlete", label: "Wants vigorous / competitive exercise", type: "bool", section: "Family" },
];

/** HCM Risk-SCD 5-year probability (%). Validated for age ≥16. */
export function hcmRiskScd(i: { age: number; maxWall: number; la: number; lvot: number; fhxScd: boolean; nsvt: boolean; syncope: boolean }): number {
  const pi = 0.15939858 * i.maxWall - 0.00294271 * i.maxWall ** 2 + 0.0259082 * i.la + 0.00446131 * i.lvot +
    0.4583082 * (i.fhxScd ? 1 : 0) + 0.82639195 * (i.nsvt ? 1 : 0) + 0.71650361 * (i.syncope ? 1 : 0) - 0.01799934 * i.age;
  return (1 - Math.pow(0.998, Math.exp(pi))) * 100;
}

export function evaluateHcm(v: Inputs): RuleResult {
  const recs: Recommendation[] = [];
  const metrics: Metric[] = [];
  const missing: string[] = [];
  const plan: string[] = [];
  const mwt = num(v, "maxWall");
  if (mwt == null) return { headline: "Enter maximal LV wall thickness", metrics: [], recommendations: [], missing: ["Max wall thickness"], ap: "" };
  const age = num(v, "age");
  const la = num(v, "la");
  const rest = num(v, "lvotRest");
  const prov = num(v, "lvotProvoked");
  const ef = num(v, "ef");
  const lge = num(v, "lge");
  const nyha = Number(str(v, "nyha") ?? "0");
  const meds = (v.meds as string[] | null) ?? [];
  const maxGrad = Math.max(rest ?? 0, prov ?? 0);
  const obstructive = maxGrad >= 30;
  const sig = maxGrad >= 50;
  const symptomatic = nyha >= 2;
  const onCmi = meds.includes("mavacamten") || meds.includes("aficamten");

  metrics.push({ label: "Max wall", value: `${fmt(mwt, 0)} mm`, note: mwt >= 30 ? "massive LVH (≥30 mm)" : undefined });
  if (rest != null || prov != null) metrics.push({ label: "Peak LVOT gradient", value: `${fmt(maxGrad, 0)} mmHg`, note: obstructive ? (sig ? "obstructive, ≥50 (hemodynamically significant)" : "obstructive (≥30)") : "nonobstructive (<30)" });
  else missing.push("LVOT gradient at rest and with provocation");
  if (ef != null) metrics.push({ label: "LVEF", value: `${fmt(ef, 0)}%` });

  // SCD risk
  let riskScd: number | null = null;
  if (age != null && age >= 16 && la != null) {
    riskScd = hcmRiskScd({ age, maxWall: mwt, la, lvot: maxGrad, fhxScd: yes(v, "fhxScd"), nsvt: yes(v, "nsvt"), syncope: yes(v, "syncope") });
    metrics.push({ label: "HCM Risk-SCD (5-yr)", value: pct(riskScd, 1), note: riskScd >= 6 ? "high (≥6%)" : riskScd >= 4 ? "intermediate (4-6%)" : "low (<4%)" });
  } else missing.push(age != null && age < 16 ? "HCM Risk-SCD not validated <16 y (use HCM Risk-Kids)" : "LA diameter and age (HCM Risk-SCD)");

  const major = [
    yes(v, "fhxScd") && "family history of HCM-related SCD",
    mwt >= 30 && "massive LVH ≥30 mm",
    yes(v, "syncope") && "unexplained syncope",
    yes(v, "apicalAneurysm") && "LV apical aneurysm",
    ef != null && ef < 50 && `LVEF ${fmt(ef, 0)}% (<50%)`,
  ].filter(Boolean) as string[];
  const minor = [lge != null && lge >= 15 && `extensive LGE (${fmt(lge, 0)}%)`, yes(v, "nsvt") && "NSVT"].filter(Boolean) as string[];

  let icdText = "";
  if (yes(v, "icd")) icdText = "ICD in place";
  else if (yes(v, "arrest")) {
    icdText = "secondary-prevention ICD indicated";
    recs.push({ text: "Prior cardiac arrest or sustained VT: ICD recommended (1).", severity: "urgent", cite: ["hcm2024"], cor: "1", ap: "Refer to electrophysiology for secondary-prevention ICD" });
  } else if (major.length) {
    icdText = "primary-prevention ICD reasonable";
    recs.push({ text: `Major SCD risk marker${major.length > 1 ? "s" : ""}: ${list(major)}. Primary-prevention ICD is reasonable (2a) after shared decision-making${riskScd != null ? `; HCM Risk-SCD ${pct(riskScd, 1)} helps frame absolute risk` : ""}.`, severity: "action", cite: ["hcm2024", "hcmriskscd"], cor: "2a", ap: `Given ${list(major)}, primary-prevention ICD is reasonable; shared decision-making and referral to electrophysiology` });
  } else if (minor.length) {
    icdText = "ICD may be considered";
    recs.push({ text: `No major risk markers, but ${list(minor)}: ICD may be considered (2b) with shared decision-making${riskScd != null ? ` (HCM Risk-SCD ${pct(riskScd, 1)})` : ""}.`, severity: "action", cite: ["hcm2024"], cor: "2b", ap: `Given ${list(minor)}, discussed that a primary-prevention ICD may be considered` });
  } else {
    icdText = "no ICD indication";
    recs.push({ text: `No major SCD risk markers${riskScd != null ? ` and HCM Risk-SCD ${pct(riskScd, 1)}` : ""}: ICD not indicated. Reassess SCD risk every 1-2 years and with any clinical change.`, severity: "info", cite: ["hcm2024"], ap: "" });
  }
  if (!yes(v, "cmrDone") && lge == null) recs.push({ text: "Cardiac MRI for LGE extent, apical aneurysm and maximal wall thickness (SCD risk) if not done; repeat every 3-5 years.", severity: "action", cite: ["hcm2024"], cor: "1", ap: "Obtain cardiac MRI for SCD risk stratification" });
  if (v.nsvt == null) missing.push("Ambulatory monitor (NSVT)");

  // Symptom / obstruction therapy
  let therapy = "";
  if (obstructive && symptomatic) {
    if (!meds.includes("bb") && !meds.includes("ccb")) {
      therapy = "start nonvasodilating beta-blocker";
      recs.push({ text: "Symptomatic obstructive HCM: start a nonvasodilating beta-blocker titrated to effect (metoprolol, bisoprolol, propranolol) (1); verapamil or diltiazem if beta-blocker ineffective/not tolerated (1).", severity: "action", cite: ["hcm2024"], cor: "1", ap: "Start a nonvasodilating beta-blocker, titrated to symptoms and heart rate" });
    } else if (!onCmi && !yes(v, "srt")) {
      const efOk = ef == null || ef >= 55;
      therapy = efOk ? "add cardiac myosin inhibitor" : "CMI not started (LVEF <55%)";
      recs.push({ text: `Persistent symptoms on ${meds.includes("bb") ? "beta-blocker" : "verapamil/diltiazem"}${sig ? ` with gradient ${fmt(maxGrad, 0)} mmHg` : ""}: ${efOk ? "add a cardiac myosin inhibitor (mavacamten, or aficamten approved Dec 2025) (1)" : "LVEF <55% precludes starting a cardiac myosin inhibitor"}; disopyramide with an AV-nodal agent is an alternative (1). ${nyha >= 3 && sig ? "Septal reduction therapy (myectomy or alcohol septal ablation) at an experienced HCM center is recommended for NYHA III-IV with gradient ≥50 (1)." : ""}`.trim(), severity: "action", cite: ["hcm2024"], cor: "1", ap: efOk ? `Persistent symptoms with LVOT obstruction despite first-line therapy; will start a cardiac myosin inhibitor (mavacamten or aficamten) with echocardiographic monitoring${nyha >= 3 && sig ? ", and discuss septal reduction therapy at an HCM center" : ""}` : "" });
      if (efOk) recs.push({ text: "CMI safety: baseline LVEF ≥55%; echo monitoring of LVEF and gradient per REMS/label schedule (mavacamten: weeks 4, 8, 12 then every 12 weeks, and after dose changes); hold if LVEF <50% or with intercurrent HF/illness. Check CYP2C19/CYP3A4 interactions. Mavacamten: effective contraception (reduces hormonal contraceptive efficacy) and avoid in pregnancy.", severity: "warning", cite: ["hcm2024"], ap: "" });
    } else if (onCmi) {
      therapy = "continue CMI with echo monitoring";
      if (ef != null && ef < 50) recs.push({ text: `LVEF ${fmt(ef, 0)}% <50% on a cardiac myosin inhibitor: interrupt therapy and repeat echo in about 4 weeks per label.`, severity: "urgent", cite: ["hcm2024"], ap: "LVEF has fallen below 50% on myosin inhibitor; will hold therapy and repeat echocardiogram in 4 weeks" });
      else recs.push({ text: "On a cardiac myosin inhibitor: continue scheduled echo (LVEF, LVOT gradient) and dose adjustment per REMS/label.", severity: "action", cite: ["hcm2024"], ap: "Continue cardiac myosin inhibitor with scheduled echocardiographic monitoring per REMS" });
    }
    if (meds.includes("vasodilator") || meds.includes("diuretic")) recs.push({ text: "Obstructive HCM: stop or minimize vasodilators (DHP CCBs, nitrates, ACEi/ARB, PDE5i) and high-dose diuretics, which worsen obstruction.", severity: "warning", cite: ["hcm2024"], cor: "3", ap: "Discontinue vasodilators that may worsen LVOT obstruction" });
  } else if (obstructive && !symptomatic) {
    therapy = "observe; no therapy for asymptomatic obstruction";
    recs.push({ text: "Asymptomatic obstruction: no gradient-reduction therapy needed; exercise testing reasonable to confirm functional capacity. Avoid dehydration and vasodilators.", severity: "info", cite: ["hcm2024"], ap: "" });
  } else if (symptomatic) {
    therapy = "beta-blocker or verapamil/diltiazem for nonobstructive symptoms";
    recs.push({ text: `Symptomatic nonobstructive HCM${prov == null ? " (confirm no provocable gradient with Valsalva/exercise echo)" : ""}: beta-blocker or verapamil/diltiazem for angina/dyspnea (1); cautious diuretics for congestion. Cardiac myosin inhibitors are not indicated in nonobstructive HCM.${ef != null && ef < 50 ? " LVEF <50% (hypokinetic/end-stage HCM): treat with HFrEF GDMT and refer to advanced HF." : ""}`, severity: "action", cite: ["hcm2024"], cor: "1", ap: "" });
  }
  if (therapy && !recs.some((r) => r.ap && /myosin|beta-blocker, titrated/.test(r.ap))) plan.push(therapy);
  if (yes(v, "af")) recs.push({ text: "AF in HCM: anticoagulate regardless of CHA₂DS₂-VASc (DOAC first-line) (1); rhythm control often needed.", severity: "action", cite: ["hcm2024"], cor: "1", ap: "Anticoagulation for atrial fibrillation regardless of CHA2DS2-VASc score" });

  // Family / genetics
  const g = str(v, "genetic");
  if (g === "not_done" || g == null) recs.push({ text: "Genetic counseling and testing of the proband (1) to enable cascade testing.", severity: "action", cite: ["hcm2024"], cor: "1", ap: "Refer for genetic counseling and testing" });
  if (!yes(v, "familyScreened")) recs.push({ text: `Screen first-degree relatives with ECG and echo${g === "positive" ? "; cascade genetic testing, and genotype-negative relatives can be released from surveillance" : ""} (1). Genotype-positive/phenotype-negative or untested relatives: repeat every 1-2 years in children/adolescents and every 3-5 years in adults.`, severity: "action", cite: ["hcm2024"], cor: "1", ap: `Recommend screening of first-degree relatives with ECG and echocardiogram${g === "positive" ? " and cascade genetic testing" : ""}` });

  // Surveillance and lifestyle
  recs.push({ text: "Surveillance: TTE every 1-2 years (sooner with symptom change); 24-48 h ambulatory monitor every 1-2 years; CMR every 3-5 years; exercise testing for symptoms or provocable gradient.", severity: "info", cite: ["hcm2024"], ap: "" });
  plan.push("TTE and ambulatory ECG monitor every 1-2 years with CMR every 3-5 years for risk restratification");
  recs.push({ text: yes(v, "athlete") ? "Vigorous or competitive sports: reasonable after comprehensive evaluation and shared decision-making with an HCM expert (2a); have an emergency action plan." : "Mild-to-moderate recreational exercise is beneficial and recommended (1). Maintain hydration; avoid dehydration and heavy alcohol.", severity: "info", cite: ["hcm2024"], ap: "" });
  plan.push(yes(v, "athlete") ? "discussed participation in vigorous exercise through shared decision-making" : "encourage mild-to-moderate recreational exercise and hydration");

  const headline = `${obstructive ? "Obstructive" : "Nonobstructive"} HCM${riskScd != null ? `, Risk-SCD ${pct(riskScd, 1)}` : ""}: ${icdText}`;
  const apExtra = recs.filter((r) => r.ap).map((r) => r.ap!.replace(/\.$/, ""));
  const ap = [
    `Hypertrophic cardiomyopathy, ${obstructive ? "obstructive" : "nonobstructive"}: ${ageSex(v)}${nyha ? `, NYHA class ${["", "I", "II", "III", "IV"][nyha]}` : ""}, maximal wall thickness ${fmt(mwt, 0)} mm${rest != null ? `, resting LVOT gradient ${fmt(rest, 0)} mmHg` : ""}${prov != null ? `${rest != null ? " and" : ","} provoked ${fmt(prov, 0)} mmHg` : ""}${ef != null ? `, LVEF ${fmt(ef, 0)}%` : ""}${la != null ? `, LA ${fmt(la, 0)} mm` : ""}${lge != null ? `, LGE ${fmt(lge, 0)}%` : ""}.`,
    `SCD risk: ${major.length ? `major risk markers present (${list(major)})` : "no major risk markers"}${riskScd != null ? `; HCM Risk-SCD 5-year risk ${pct(riskScd, 1)}` : ""}; ${icdText}.`,
    `Per the 2024 AHA/ACC HCM guideline, plan: ${plan.join("; ")}.`,
    apExtra.length ? apExtra.join(". ") + "." : "",
  ].filter(Boolean).join(" ");

  return { headline, metrics, recommendations: recs, missing, ap };
}

export const hcmModule: ClinicalModule = {
  id: "hcm",
  title: "Hypertrophic Cardiomyopathy",
  short: "HCM",
  icon: "💪",
  description: "SCD risk (HCM Risk-SCD + enhancers), ICD decision, obstruction therapy incl. mavacamten/aficamten eligibility and echo monitoring, family screening, exercise — 2024 AHA/ACC.",
  placeholder: "e.g. 45M HCM, septum 22 mm, LA 44 mm, LVOT 35 rest / 85 Valsalva, EF 70%, NYHA II on metoprolol 100, no syncope, no FHx SCD, LGE 8%, NSVT none on Zio",
  fields,
  evaluate: evaluateHcm,
  citations: cites("hcm2024", "hcmriskscd"),
};
