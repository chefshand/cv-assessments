import type { ClinicalModule, FieldDef, Inputs, Metric, Recommendation, RuleResult } from "../types";
import { ageSex, arr, fmt, list, num, str, yes } from "../util";
import { cites } from "../citations";

// 2023 ACC/AHA/ACCP/HRS AF guideline. Stroke risk by CHA2DS2-VASc (annual
// risk ≥2% → anticoagulate), DOAC doses per US labeling with Cockcroft-Gault.

const OACS = [
  { value: "none", label: "None" }, { value: "apixaban", label: "Apixaban" }, { value: "rivaroxaban", label: "Rivaroxaban" },
  { value: "dabigatran", label: "Dabigatran" }, { value: "edoxaban", label: "Edoxaban" }, { value: "warfarin", label: "Warfarin" },
];

const BLEED = [
  { value: "major_bleed", label: "Prior major bleed" }, { value: "antiplatelet", label: "Antiplatelet / NSAID" }, { value: "alcohol", label: "Alcohol ≥8 drinks/wk" },
  { value: "labile_inr", label: "Labile INR" }, { value: "liver", label: "Liver disease" }, { value: "uncontrolled_htn", label: "Uncontrolled HTN (SBP >160)" },
  { value: "anemia", label: "Anemia / thrombocytopenia" }, { value: "falls", label: "Frequent falls / frailty" },
];

const fields: FieldDef[] = [
  { key: "age", label: "Age", type: "number", unit: "y", section: "Patient" },
  { key: "sex", label: "Sex", type: "select", section: "Patient", options: [ { value: "female", label: "Female" }, { value: "male", label: "Male" } ] },
  { key: "weightKg", label: "Weight", type: "number", unit: "kg", section: "Patient", extractHint: "lb / 2.205." },
  { key: "creatinine", label: "Creatinine", type: "number", unit: "mg/dL", step: 0.01, section: "Patient", extractHint: "µmol/L / 88.4." },
  { key: "dialysis", label: "On dialysis", type: "bool", section: "Patient" },
  {
    key: "afType", label: "AF pattern", type: "select", section: "AF",
    options: [ { value: "paroxysmal", label: "Paroxysmal" }, { value: "persistent", label: "Persistent (>7 d)" }, { value: "longstanding", label: "Long-standing persistent (>12 mo)" }, { value: "permanent", label: "Permanent" }, { value: "device", label: "Device-detected (AHRE) only" } ],
  },
  { key: "ahreHours", label: "Longest device-detected episode", type: "number", unit: "h", step: 0.1, section: "AF", showIf: (v) => v.afType === "device" },
  { key: "recent", label: "Diagnosed within the past year", type: "bool", section: "AF" },
  { key: "symptomatic", label: "Symptomatic from AF", type: "bool", section: "AF" },
  { key: "hr", label: "Resting heart rate", type: "number", unit: "bpm", section: "AF" },
  { key: "ef", label: "LVEF", type: "number", unit: "%", section: "AF" },
  { key: "chf", label: "Heart failure / LV dysfunction", type: "bool", section: "CHA₂DS₂-VASc" },
  { key: "htn", label: "Hypertension", type: "bool", section: "CHA₂DS₂-VASc" },
  { key: "diabetes", label: "Diabetes", type: "bool", section: "CHA₂DS₂-VASc" },
  { key: "stroke", label: "Prior stroke / TIA / thromboembolism", type: "bool", section: "CHA₂DS₂-VASc" },
  { key: "vascular", label: "Vascular disease (MI, PAD, aortic plaque)", type: "bool", section: "CHA₂DS₂-VASc" },
  { key: "mechValve", label: "Mechanical heart valve", type: "bool", section: "Special" },
  { key: "msMod", label: "Moderate-severe rheumatic mitral stenosis", type: "bool", section: "Special" },
  { key: "hcmAmyloid", label: "HCM or cardiac amyloidosis", type: "bool", section: "Special" },
  {
    key: "bleed", label: "Bleeding risk factors", type: "multi", section: "Bleeding",
    options: BLEED,
  },
  { key: "oacContra", label: "Long-term OAC contraindicated (nonreversible bleeding risk)", type: "bool", section: "Bleeding" },
  { key: "oac", label: "Current anticoagulant", type: "select", section: "Therapy", options: OACS, extractHint: "Eliquis → apixaban; Xarelto → rivaroxaban; Pradaxa → dabigatran; Savaysa → edoxaban; Coumadin → warfarin." },
  { key: "oacDose", label: "Current dose", type: "number", unit: "mg", step: 0.5, section: "Therapy", help: "Per dose (e.g., apixaban 5, rivaroxaban 20).", showIf: (v) => v.oac != null && v.oac !== "none" && v.oac !== "warfarin" },
  { key: "pgp", label: "On a P-gp inhibitor (dronedarone, verapamil, ketoconazole…)", type: "bool", section: "Therapy" },
  { key: "rate", label: "Rate/rhythm drugs", type: "multi", section: "Therapy", options: [ { value: "bb", label: "Beta-blocker" }, { value: "ccb", label: "Diltiazem / verapamil" }, { value: "digoxin", label: "Digoxin" }, { value: "aad", label: "Antiarrhythmic" } ] },
  { key: "ablation", label: "Prior AF ablation", type: "bool", section: "Therapy" },
  { key: "cad", label: "Coronary disease", type: "bool", section: "Risk factors" },
  { key: "bmi", label: "BMI", type: "number", unit: "kg/m²", section: "Risk factors" },
  { key: "osa", label: "Sleep apnea (known/suspected)", type: "bool", section: "Risk factors" },
  { key: "alcoholUse", label: "Regular alcohol use", type: "bool", section: "Risk factors" },
];

export function chadsVasc(v: Inputs): number {
  const age = num(v, "age") ?? 0;
  return (yes(v, "chf") ? 1 : 0) + (yes(v, "htn") ? 1 : 0) + (age >= 75 ? 2 : age >= 65 ? 1 : 0) + (yes(v, "diabetes") ? 1 : 0) +
    (yes(v, "stroke") ? 2 : 0) + (yes(v, "vascular") ? 1 : 0) + (str(v, "sex") === "female" ? 1 : 0);
}

export function crCl(age: number, kg: number, cr: number, female: boolean): number {
  return ((140 - age) * kg) / (72 * cr) * (female ? 0.85 : 1);
}

/** Labeled DOAC dose for AF. Returns text and mg per dose (null = avoid). */
export function doacDose(drug: string, o: { age: number | null; kg: number | null; cr: number | null; crcl: number | null; dialysis: boolean; pgp: boolean }): { mg: number | null; text: string } {
  const { age, kg, cr, crcl, dialysis, pgp } = o;
  switch (drug) {
    case "apixaban": {
      const n = [age != null && age >= 80, kg != null && kg <= 60, cr != null && cr >= 1.5].filter(Boolean).length;
      if (dialysis) return { mg: (age != null && age >= 80) || (kg != null && kg <= 60) ? 2.5 : 5, text: `apixaban ${(age != null && age >= 80) || (kg != null && kg <= 60) ? "2.5" : "5"} mg BID (dialysis, per label)` };
      return n >= 2 ? { mg: 2.5, text: "apixaban 2.5 mg BID (≥2 of: age ≥80, weight ≤60 kg, Cr ≥1.5)" } : { mg: 5, text: `apixaban 5 mg BID${n === 1 ? " (only 1 dose-reduction criterion, so full dose)" : ""}` };
    }
    case "rivaroxaban":
      if (crcl == null) return { mg: 20, text: "rivaroxaban 20 mg daily with evening meal (15 mg if CrCl ≤50)" };
      if (crcl < 15 || dialysis) return { mg: null, text: "rivaroxaban: avoid at CrCl <15 / dialysis (apixaban preferred)" };
      return crcl <= 50 ? { mg: 15, text: `rivaroxaban 15 mg daily with evening meal (CrCl ${fmt(crcl, 0)})` } : { mg: 20, text: "rivaroxaban 20 mg daily with evening meal" };
    case "dabigatran":
      if (crcl == null) return { mg: 150, text: "dabigatran 150 mg BID (75 mg BID if CrCl 15-30)" };
      if (crcl < 15 || dialysis) return { mg: null, text: "dabigatran: avoid at CrCl <15 / dialysis" };
      if (crcl <= 30) return { mg: 75, text: `dabigatran 75 mg BID (CrCl ${fmt(crcl, 0)})` };
      return pgp && crcl <= 50 ? { mg: 75, text: "dabigatran 75 mg BID (CrCl 30-50 with dronedarone/ketoconazole)" } : { mg: 150, text: "dabigatran 150 mg BID" };
    case "edoxaban":
      if (crcl == null) return { mg: 60, text: "edoxaban 60 mg daily (30 mg if CrCl 15-50; avoid if CrCl >95)" };
      if (crcl < 15 || dialysis) return { mg: null, text: "edoxaban: avoid at CrCl <15" };
      if (crcl > 95) return { mg: null, text: `edoxaban: avoid at CrCl ${fmt(crcl, 0)} >95 (reduced efficacy)` };
      return crcl <= 50 || (kg != null && kg <= 60) || pgp ? { mg: 30, text: "edoxaban 30 mg daily (CrCl 15-50, weight ≤60 kg or P-gp inhibitor)" } : { mg: 60, text: "edoxaban 60 mg daily" };
  }
  return { mg: null, text: "" };
}

export function evaluateAf(v: Inputs): RuleResult {
  const recs: Recommendation[] = [];
  const metrics: Metric[] = [];
  const missing: string[] = [];
  const plan: string[] = [];
  const age = num(v, "age");
  const female = str(v, "sex") === "female";
  if (age == null || str(v, "sex") == null) missing.push("Age and sex");
  const score = chadsVasc(v);
  const nonSex = score - (female ? 1 : 0);
  const kg = num(v, "weightKg"), cr = num(v, "creatinine");
  const crcl = age != null && kg != null && cr != null ? crCl(age, kg, cr, female) : null;
  const type = str(v, "afType");
  const oac = str(v, "oac") ?? "none";
  const ef = num(v, "ef");
  const hr = num(v, "hr");
  const rate = arr(v, "rate");
  const bleed = arr(v, "bleed");
  const dialysis = yes(v, "dialysis");
  const valvular = yes(v, "mechValve") || yes(v, "msMod");

  metrics.push({ label: "CHA₂DS₂-VASc", value: String(score), note: `CHA₂DS₂-VA ${nonSex}` });
  if (crcl != null) metrics.push({ label: "CrCl (Cockcroft-Gault)", value: `${fmt(crcl, 0)} mL/min` });
  else missing.push("Weight and creatinine (CrCl for DOAC dosing)");
  metrics.push({ label: "Bleeding risk factors", value: String(bleed.length), note: bleed.length ? "address modifiable factors" : undefined });

  // Anticoagulation decision
  let indicated: "yes" | "reasonable" | "no" = "no";
  let why = "";
  if (valvular) { indicated = "yes"; why = yes(v, "mechValve") ? "mechanical valve" : "moderate-severe rheumatic MS"; }
  else if (yes(v, "hcmAmyloid")) { indicated = "yes"; why = "HCM/cardiac amyloidosis (anticoagulate regardless of score)"; }
  else if (type === "device") {
    const h = num(v, "ahreHours");
    if (h != null && h >= 24 && nonSex >= 2) { indicated = "reasonable"; why = `device-detected AF ≥24 h with CHA₂DS₂-VASc ≥3 (2a)`; }
    else if (h != null && h >= 5 / 60 && nonSex >= 2) { indicated = "reasonable"; why = "device-detected AF 5 min-24 h with CHA₂DS₂-VASc ≥3: may be reasonable with shared decision-making (2b; ARTESiA/NOAH showed less stroke but more bleeding)"; }
    else why = "device-detected AF below anticoagulation thresholds";
  } else if (nonSex >= 2) { indicated = "yes"; why = `CHA₂DS₂-VASc ${score} (≥2% annual stroke risk)`; }
  else if (nonSex === 1) { indicated = "reasonable"; why = `CHA₂DS₂-VASc ${score} (1-2% annual stroke risk)`; }
  else why = `CHA₂DS₂-VASc ${score} (low risk)`;

  let doseText = "";
  if (indicated !== "no") {
    if (yes(v, "oacContra") && !valvular) {
      recs.push({ text: `${why}, but long-term anticoagulation contraindicated due to nonreversible bleeding risk: percutaneous left atrial appendage occlusion is reasonable (2a).`, severity: "action", cite: ["af2023"], cor: "2a", ap: "Given contraindication to long-term anticoagulation, refer for left atrial appendage occlusion evaluation" });
      plan.push("refer for left atrial appendage occlusion");
    } else if (valvular) {
      doseText = "warfarin (INR 2-3; 2.5-3.5 for mitral mechanical valve)";
      recs.push({ text: `${why}: warfarin required; DOACs are contraindicated (1).`, severity: oac === "warfarin" ? "info" : "urgent", cite: ["af2023", "valve2020"], cor: "1", ap: oac === "warfarin" ? "Continue warfarin" : "Transition to warfarin; DOACs are contraindicated" });
      plan.push(oac === "warfarin" ? "continue warfarin with INR monitoring" : "transition to warfarin");
    } else {
      const drug = oac !== "none" && oac !== "warfarin" ? oac : "apixaban";
      const d = doacDose(drug, { age, kg, cr, crcl, dialysis, pgp: yes(v, "pgp") });
      doseText = d.text;
      if (oac === "none") {
        recs.push({ text: `${why}: oral anticoagulation ${indicated === "yes" ? "recommended (1)" : "reasonable (2a)"}; DOAC preferred over warfarin (1). Suggested: ${d.text}.`, severity: "action", cite: ["af2023"], cor: indicated === "yes" ? "1" : "2a", ap: "" });
        plan.push(`start ${d.text.split(" (")[0]}`);
      } else if (oac === "warfarin") {
        recs.push({ text: `${why}: on warfarin. Switching to a DOAC is recommended unless contraindicated (1) — e.g., ${d.text} — especially with labile INR.`, severity: "action", cite: ["af2023"], cor: "1", ap: "" });
        plan.push("consider transition from warfarin to a DOAC");
      } else {
        const cur = num(v, "oacDose");
        if (cur == null) missing.push("Current DOAC dose");
        if (d.mg == null) { recs.push({ text: `${d.text}.`, severity: "urgent", cite: ["af2023"], ap: `Change anticoagulant: ${d.text}` }); plan.push("change anticoagulant (current agent not appropriate at this renal function)"); }
        else if (cur != null && Math.abs(cur - d.mg) > 0.01) {
          recs.push({ text: `Dose check: on ${drug} ${fmt(cur, 1)} mg, labeled dose is ${d.text}. ${cur < d.mg ? "Off-label underdosing increases stroke risk." : "Dose exceeds label for renal function/age/weight; bleeding risk."}`, severity: "warning", cite: ["af2023"], ap: `Adjust ${drug} to ${d.mg} mg per labeled dosing` });
          plan.push(`adjust to ${d.text.split(" (")[0]}`);
        } else plan.push(`continue ${d.text.split(" (")[0]} (appropriately dosed)`);
      }
    }
  } else {
    recs.push({ text: `${why}: anticoagulation not indicated; reassess stroke risk at least annually and with new risk factors. Aspirin is not recommended for stroke prevention in AF.`, severity: "info", cite: ["af2023"], cor: "3", ap: "" });
    plan.push("no anticoagulation at this time; reassess stroke risk annually");
  }
  if (bleed.length) recs.push({ text: `Bleeding risk factors (${list(bleed.map((b) => BLEED.find((o) => o.value === b)?.label.toLowerCase() ?? b))}): modify where possible (stop unneeded antiplatelets/NSAIDs, control BP, limit alcohol); bleeding scores alone should not be used to withhold anticoagulation.`, severity: "info", cite: ["af2023"], ap: "" });

  // Rate control
  if (hr != null) {
    metrics.push({ label: "Resting HR", value: `${fmt(hr, 0)} bpm` });
    if (hr >= 110 || (hr >= 100 && yes(v, "symptomatic"))) {
      const ok = ef == null || ef > 40;
      recs.push({ text: `Rate control: HR ${fmt(hr, 0)}. ${ok ? "Beta-blocker or diltiazem/verapamil" : "Beta-blocker (avoid diltiazem/verapamil with LVEF ≤40%); digoxin as add-on"} to a resting HR <100-110 (lenient <110 acceptable if asymptomatic with preserved EF).${ef != null && ef < 50 ? " Consider tachycardia-mediated cardiomyopathy." : ""}`, severity: "action", cite: ["af2023"], cor: "1", ap: "" });
      plan.push(`${rate.includes("bb") || rate.includes("ccb") ? "uptitrate" : "start"} rate control (${ok ? "beta-blocker or nondihydropyridine CCB" : "beta-blocker"}) to resting HR <100-110`);
    }
  } else if (type !== "device") missing.push("Resting heart rate");
  if (rate.includes("ccb") && ef != null && ef <= 40) recs.push({ text: "Diltiazem/verapamil with LVEF ≤40%: avoid (3: Harm); switch to a beta-blocker.", severity: "warning", cite: ["af2023"], cor: "3", ap: "Discontinue nondihydropyridine calcium channel blocker given reduced LVEF" });

  // Rhythm control
  if (type !== "permanent" && type !== "device") {
    const reasons: string[] = [];
    if (yes(v, "symptomatic")) reasons.push("symptoms");
    if (ef != null && ef <= 50) reasons.push(`LVEF ${fmt(ef, 0)}%`);
    if (yes(v, "recent")) reasons.push("diagnosis within 1 year (early rhythm control, EAST-AFNET 4)");
    if (reasons.length) {
      const abl = ef != null && ef <= 50 ? "Catheter ablation is recommended in selected patients with HFrEF to improve symptoms, LVEF and outcomes (1)" : type === "paroxysmal" && yes(v, "symptomatic") ? "Catheter ablation is first-line (1) in selected symptomatic paroxysmal AF, typically younger with few comorbidities" : "Catheter ablation is useful for symptomatic AF when antiarrhythmics are ineffective, not tolerated or not preferred (1)";
      const aad = ef != null && ef <= 40 ? "amiodarone or dofetilide" : yes(v, "cad") ? "dronedarone, sotalol or dofetilide" : "flecainide or propafenone (with AV-nodal blocker), dronedarone, sotalol or dofetilide";
      recs.push({ text: `Rhythm control favored (${list(reasons)}). ${abl}. Antiarrhythmic options: ${aad}.${type === "persistent" || type === "longstanding" ? " Cardioversion: ≥3 weeks therapeutic anticoagulation (or TEE) before and ≥4 weeks after." : ""}`, severity: "action", cite: ["af2023"], cor: yes(v, "recent") && reasons.length === 1 ? "2b" : "1", ap: "" });
      plan.push(`${yes(v, "ablation") ? "discuss repeat ablation vs antiarrhythmic therapy" : "refer to electrophysiology to discuss catheter ablation vs antiarrhythmic therapy"} for rhythm control`);
    }
  }

  // Risk factor modification
  const rf: string[] = [];
  const bmi = num(v, "bmi");
  if (bmi != null && bmi >= 27) rf.push(`weight loss ≥10% (BMI ${fmt(bmi, 1)}) (1)`);
  if (yes(v, "alcoholUse")) rf.push("alcohol abstinence or minimization (1)");
  if (v.osa !== false) rf.push("screen for sleep apnea");
  rf.push("BP control, regular exercise, smoking cessation");
  recs.push({ text: `Risk factor modification reduces AF burden: ${rf.join("; ")}.`, severity: "action", cite: ["af2023"], cor: "1", ap: "" });
  plan.push(`risk factor modification (${rf.map((x) => x.replace(/ \(1\)/, "").replace(/ \(BMI [^)]+\)/, "")).join(", ")})`);
  if (ef == null) missing.push("LVEF (TTE)");

  const typeLabel = type === "device" ? "Device-detected AF" : type ? `${type === "longstanding" ? "Long-standing persistent" : type[0].toUpperCase() + type.slice(1)} AF` : "Atrial fibrillation";
  const headline = `${typeLabel}, CHA₂DS₂-VASc ${score}: ${indicated === "yes" ? "anticoagulate" : indicated === "reasonable" ? "anticoagulation reasonable" : "no anticoagulation"}${doseText && !valvular ? ` (${doseText.split(" (")[0]})` : ""}`;
  const comps = [yes(v, "chf") && "heart failure", yes(v, "htn") && "hypertension", yes(v, "diabetes") && "diabetes", yes(v, "stroke") && "prior stroke/TIA", yes(v, "vascular") && "vascular disease"].filter(Boolean) as string[];
  const apExtra = recs.filter((r) => r.ap).map((r) => r.ap!.replace(/\.$/, ""));
  const ap = [
    `${typeLabel}: ${ageSex(v)}${comps.length ? ` with ${list(comps)}` : ""}; CHA₂DS₂-VASc ${score}${crcl != null ? `, CrCl ${fmt(crcl, 0)} mL/min` : ""}${hr != null ? `, resting HR ${fmt(hr, 0)}` : ""}${ef != null ? `, LVEF ${fmt(ef, 0)}%` : ""}${yes(v, "symptomatic") ? ", symptomatic" : v.symptomatic === false ? ", asymptomatic" : ""}. Current anticoagulation: ${oac === "none" ? "none" : `${oac}${num(v, "oacDose") != null ? ` ${fmt(num(v, "oacDose")!, 1)} mg` : ""}`}.`,
    `Per the 2023 ACC/AHA/ACCP/HRS AF guideline, plan: ${plan.join("; ")}.`,
    apExtra.length ? apExtra.join(". ") + "." : "",
  ].filter(Boolean).join(" ");

  return { headline, metrics, recommendations: recs, missing, ap };
}

export const afModule: ClinicalModule = {
  id: "af",
  title: "Atrial Fibrillation",
  short: "AF",
  icon: "〰️",
  description: "CHA₂DS₂-VASc, DOAC choice and renal/age/weight dosing check, rate vs rhythm control, ablation, LAAO, device-detected AF, risk factors — 2023 ACC/AHA/ACCP/HRS.",
  placeholder: "e.g. 81F paroxysmal AF, HTN, diabetes, 58 kg, Cr 1.3, on apixaban 5 mg BID, HR 72, EF 60%, symptomatic palpitations, BMI 29",
  fields,
  evaluate: evaluateAf,
  citations: cites("af2023", "valve2020"),
};
