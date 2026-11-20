import type { ClinicalModule, FieldDef, Inputs, Metric, Recommendation, RuleResult } from "../types";
import { ageSex, arr, list, num, str, yes } from "../util";
import { cites } from "../citations";

export const SURGERY_TYPES = [
  { value: "cataract", label: "Cataract / ophthalmic", risk: "low", rcriHigh: false },
  { value: "endoscopy", label: "Endoscopy / superficial / breast / dental", risk: "low", rcriHigh: false },
  { value: "minor_ortho", label: "Minor ortho / hand / arthroscopy", risk: "low", rcriHigh: false },
  { value: "plastic", label: "Plastic / reconstructive (minor)", risk: "low", rcriHigh: false },
  { value: "ortho_major", label: "Major ortho (hip/knee/spine)", risk: "elevated", rcriHigh: false },
  { value: "intraperitoneal", label: "Intraperitoneal (abdominal)", risk: "elevated", rcriHigh: true },
  { value: "intrathoracic", label: "Intrathoracic", risk: "elevated", rcriHigh: true },
  { value: "vascular_supra", label: "Suprainguinal vascular / aortic", risk: "elevated", rcriHigh: true },
  { value: "vascular_infra", label: "Infrainguinal vascular / carotid", risk: "elevated", rcriHigh: false },
  { value: "uro_gyn", label: "Major urologic / gynecologic", risk: "elevated", rcriHigh: false },
  { value: "head_neck", label: "Head & neck", risk: "elevated", rcriHigh: false },
  { value: "neuro", label: "Neurosurgery", risk: "elevated", rcriHigh: false },
  { value: "transplant", label: "Transplant", risk: "elevated", rcriHigh: true },
] as const;

const fields: FieldDef[] = [
  { key: "age", label: "Age", type: "number", unit: "y", section: "Patient" },
  { key: "sex", label: "Sex", type: "select", section: "Patient", options: [ { value: "female", label: "Female" }, { value: "male", label: "Male" } ] },
  { key: "surgeryType", label: "Surgery", type: "select", section: "Surgery", options: SURGERY_TYPES.map((s) => ({ value: s.value, label: s.label })) },
  { key: "surgeryName", label: "Procedure name", type: "text", section: "Surgery" },
  {
    key: "urgency", label: "Timing", type: "select", section: "Surgery",
    options: [ { value: "emergency", label: "Emergency (<6 h)" }, { value: "urgent", label: "Urgent (6-24 h)" }, { value: "time_sensitive", label: "Time-sensitive (cancer, ≤3 mo)" }, { value: "elective", label: "Elective" } ],
  },
  { key: "procBleed", label: "Procedural bleeding risk", type: "select", section: "Surgery", options: [ { value: "low", label: "Low/moderate" }, { value: "high", label: "High" } ] },
  {
    key: "active", label: "Active cardiac conditions", type: "multi", section: "Active conditions",
    options: [
      { value: "acs", label: "ACS / unstable angina" },
      { value: "dhf", label: "Decompensated HF" },
      { value: "arrhythmia", label: "Uncontrolled/new arrhythmia" },
      { value: "sx_valve", label: "Symptomatic severe valve disease" },
      { value: "new_dyspnea", label: "New/worsening unexplained dyspnea" },
    ],
  },
  { key: "ihd", label: "Ischemic heart disease (MI, angina, + stress, nitrates, Q waves)", type: "bool", section: "RCRI" },
  { key: "hf", label: "History of heart failure", type: "bool", section: "RCRI" },
  { key: "cvd", label: "Stroke / TIA", type: "bool", section: "RCRI" },
  { key: "insulin", label: "Diabetes on insulin", type: "bool", section: "RCRI" },
  { key: "creatinine", label: "Creatinine", type: "number", unit: "mg/dL", step: 0.1, section: "RCRI" },
  {
    key: "functional", label: "Functional capacity", type: "select", section: "Functional capacity",
    options: [ { value: "good", label: "≥4 METs (2 flights of stairs)" }, { value: "poor", label: "<4 METs" }, { value: "unknown", label: "Unknown / can't assess" } ],
  },
  { key: "dasi", label: "DASI score", type: "number", min: 0, max: 58.2, section: "Functional capacity", help: ">34 ≈ adequate functional capacity" },
  { key: "bnp", label: "BNP", type: "number", unit: "pg/mL", section: "Biomarkers" },
  { key: "ntprobnp", label: "NT-proBNP", type: "number", unit: "pg/mL", section: "Biomarkers" },
  { key: "ef", label: "LVEF", type: "number", unit: "%", section: "Cardiac history" },
  { key: "echoWithinYear", label: "Echo within 12 months", type: "bool", section: "Cardiac history" },
  {
    key: "valve", label: "Valve disease", type: "multi", section: "Cardiac history",
    options: [
      { value: "severe_as", label: "Severe AS" }, { value: "mod_as", label: "Moderate AS" },
      { value: "severe_mr", label: "Severe MR" }, { value: "severe_ms", label: "Severe MS" },
      { value: "severe_ar", label: "Severe AR" }, { value: "prosthetic", label: "Prosthetic valve" },
    ],
  },
  {
    key: "stent", label: "Most recent coronary intervention", type: "select", section: "Coronary stents",
    options: [ { value: "none", label: "None" }, { value: "des", label: "DES" }, { value: "bms", label: "BMS" }, { value: "poba", label: "Balloon only" }, { value: "cabg", label: "CABG" } ],
  },
  { key: "stentMonths", label: "Months since PCI", type: "number", unit: "mo", section: "Coronary stents", showIf: (v) => ["des", "bms", "poba"].includes(String(v.stent)) },
  { key: "stentForAcs", label: "PCI was for ACS", type: "bool", section: "Coronary stents", showIf: (v) => ["des", "bms"].includes(String(v.stent)) },
  {
    key: "p2y12", label: "P2Y12 inhibitor", type: "select", section: "Medications",
    options: [ { value: "none", label: "None" }, { value: "clopidogrel", label: "Clopidogrel" }, { value: "ticagrelor", label: "Ticagrelor" }, { value: "prasugrel", label: "Prasugrel" } ],
  },
  {
    key: "anticoag", label: "Anticoagulant", type: "select", section: "Medications",
    options: [
      { value: "none", label: "None" }, { value: "apixaban", label: "Apixaban" }, { value: "rivaroxaban", label: "Rivaroxaban" },
      { value: "edoxaban", label: "Edoxaban" }, { value: "dabigatran", label: "Dabigatran" }, { value: "warfarin", label: "Warfarin" },
    ],
  },
  { key: "crcl", label: "CrCl", type: "number", unit: "mL/min", section: "Medications", showIf: (v) => v.anticoag === "dabigatran" },
  {
    key: "vteHighRisk", label: "Very high thrombotic risk", type: "multi", section: "Medications", showIf: (v) => v.anticoag === "warfarin",
    options: [ { value: "mech_mitral", label: "Mechanical mitral / older aortic valve" }, { value: "recent_stroke", label: "Stroke/TIA <3 mo" }, { value: "recent_vte", label: "VTE <3 mo" }, { value: "chads_high", label: "CHA₂DS₂-VASc ≥7" } ],
  },
  {
    key: "meds", label: "Other medications", type: "multi", section: "Medications",
    options: [
      { value: "bb", label: "Beta-blocker" }, { value: "statin", label: "Statin" }, { value: "raasi", label: "ACEi/ARB/ARNI" },
      { value: "sglt2", label: "SGLT2 inhibitor" }, { value: "glp1", label: "GLP-1 RA" }, { value: "aspirin", label: "Aspirin" },
    ],
  },
  { key: "raasiForHfref", label: "RAASi is for HFrEF", type: "bool", section: "Medications", showIf: (v) => Array.isArray(v.meds) && (v.meds as string[]).includes("raasi") },
  { key: "cied", label: "CIED", type: "select", section: "Devices", options: [ { value: "none", label: "None" }, { value: "ppm", label: "Pacemaker" }, { value: "icd", label: "ICD / CRT-D" } ] },
  { key: "pacerDependent", label: "Pacemaker-dependent", type: "bool", section: "Devices", showIf: (v) => v.cied === "ppm" || v.cied === "icd" },
  { key: "pulmHtn", label: "Pulmonary hypertension", type: "bool", section: "Cardiac history" },
];

/** RCRI 30-day MACE estimates: original Lee 1999 and updated (Duceppe/CCS 2017). */
export const RCRI_RISK = {
  lee: ["0.4%", "0.9%", "6.6%", "11%"],
  updated: ["3.9%", "6.0%", "10.1%", "15%"],
};

export function rcri(v: Inputs): { score: number; items: string[] } {
  const st = SURGERY_TYPES.find((s) => s.value === str(v, "surgeryType"));
  const items: string[] = [];
  if (st?.rcriHigh) items.push("high-risk surgery");
  if (yes(v, "ihd")) items.push("ischemic heart disease");
  if (yes(v, "hf")) items.push("heart failure");
  if (yes(v, "cvd")) items.push("cerebrovascular disease");
  if (yes(v, "insulin")) items.push("insulin-treated diabetes");
  if ((num(v, "creatinine") ?? 0) > 2) items.push("creatinine >2 mg/dL");
  return { score: items.length, items };
}

export function evaluatePeriop(v: Inputs): RuleResult {
  const recs: Recommendation[] = [];
  const metrics: Metric[] = [];
  const missing: string[] = [];
  const plan: string[] = [];
  const medPlan: string[] = [];
  const st = SURGERY_TYPES.find((s) => s.value === str(v, "surgeryType"));
  const urgency = str(v, "urgency") ?? "elective";
  const active = arr(v, "active");
  const valve = arr(v, "valve");
  const meds = arr(v, "meds");
  const procName = typeof v.surgeryName === "string" && v.surgeryName ? v.surgeryName : st?.label.toLowerCase() ?? "noncardiac surgery";
  if (!st) missing.push("Surgery type");
  if (!str(v, "urgency")) missing.push("Urgency (assumed elective)");

  const { score, items } = rcri(v);
  const idx = Math.min(score, 3);
  metrics.push({ label: "RCRI", value: `${score}`, note: `MACE ~${RCRI_RISK.lee[idx]} (Lee) / ${RCRI_RISK.updated[idx]} (updated, incl. death)` });

  // Functional capacity
  const dasi = num(v, "dasi");
  let fc = str(v, "functional");
  if (dasi != null) {
    const mets = (0.43 * dasi + 9.6) / 3.5;
    metrics.push({ label: "DASI", value: `${dasi}`, note: `≈${mets.toFixed(1)} METs; ${dasi > 34 ? ">34 adequate" : "≤34 reduced"}` });
    fc = dasi > 34 ? "good" : "poor";
  }
  if (!fc) missing.push("Functional capacity (METs or DASI)");

  const bnp = num(v, "bnp");
  const nt = num(v, "ntprobnp");
  const bnpHigh = (bnp != null && bnp >= 92) || (nt != null && nt >= 300);
  if (bnp != null) metrics.push({ label: "BNP", value: `${bnp} pg/mL`, note: bnp >= 92 ? "≥92: elevated risk" : "normal" });
  if (nt != null) metrics.push({ label: "NT-proBNP", value: `${nt} pg/mL`, note: nt >= 300 ? "≥300: elevated risk" : "normal" });

  const lowRiskSurgery = st?.risk === "low";
  const elevated = !lowRiskSurgery && (score >= 1 || (num(v, "age") ?? 0) >= 65);
  let disposition = "";

  // 1. Emergency
  if (urgency === "emergency") {
    disposition = "Emergency surgery: proceed without delay for cardiac testing; optimize hemodynamics, continue indicated cardiac medications, and use postoperative surveillance.";
    recs.push({ text: disposition, severity: "urgent", cite: ["periop2024"], cor: "1", ap: "" });
    plan.push("proceed with emergency surgery without delay for cardiac testing, with perioperative hemodynamic monitoring and postoperative troponin surveillance");
  } else if (active.some((a) => a !== "new_dyspnea")) {
    // 2. Active cardiac conditions
    const opts = (fields.find((f) => f.key === "active") as { options: { value: string; label: string }[] }).options;
    const names = active.filter((a) => a !== "new_dyspnea").map((a) => opts.find((o) => o.value === a)!.label);
    disposition = `Active cardiac condition (${list(names)}): delay ${urgency === "elective" ? "elective" : "nonemergent"} surgery for evaluation and treatment per GDMT.`;
    recs.push({ text: disposition, severity: "urgent", cite: ["periop2024"], cor: "1", ap: "" });
    plan.push(`recommend postponing ${urgency === "elective" ? "elective " : ""}surgery to evaluate and treat ${list(names.map((n) => n.toLowerCase()))}`);
  } else if (lowRiskSurgery) {
    disposition = "Low-risk procedure (<1% MACE): proceed without further cardiac testing.";
    recs.push({ text: disposition, severity: "action", cite: ["periop2024"], cor: "1", ap: "" });
    plan.push("low-risk procedure; may proceed without further preoperative cardiac testing");
  } else if (!elevated) {
    disposition = "RCRI 0 and age <65: low perioperative risk; proceed without further cardiac testing.";
    recs.push({ text: disposition, severity: "action", cite: ["periop2024", "rcri"], ap: "" });
    plan.push("low estimated perioperative risk; may proceed without further cardiac testing");
  } else {
    // 3. Elevated risk
    if (fc === "good") {
      disposition = "Elevated clinical risk but functional capacity ≥4 METs (DASI >34): proceed to surgery without further testing.";
      recs.push({ text: disposition, severity: "action", cite: ["periop2024", "dasi"], cor: "2a", ap: "" });
      plan.push("functional capacity is adequate (≥4 METs), so no further cardiac testing is needed before surgery");
    } else {
      if (bnp == null && nt == null) {
        recs.push({ text: "Elevated risk with poor/unknown functional capacity: measure BNP or NT-proBNP preoperatively for risk stratification (2a).", severity: "action", cite: ["periop2024"], cor: "2a", ap: "" });
        plan.push("check preoperative BNP or NT-proBNP for additional risk stratification");
        disposition = "Elevated risk, poor/unknown functional capacity: obtain BNP/NT-proBNP.";
      } else if (bnpHigh) {
        disposition = "Elevated risk with elevated natriuretic peptide: higher risk of MACE; proceed if clinically indicated with heightened monitoring.";
        recs.push({ text: "Elevated BNP/NT-proBNP: higher postoperative MACE risk. Share risk with patient/surgeon; postoperative troponin surveillance (24 and 48 h) and in-hospital monitoring are reasonable. Stress testing only if it would change management independent of surgery.", severity: "action", cite: ["periop2024"], cor: "2a", ap: "" });
        plan.push("natriuretic peptide is elevated, indicating higher perioperative risk; recommend postoperative troponin surveillance at 24 and 48 hours, telemetry, and stress testing only if indicated independent of surgery");
      } else {
        disposition = "Elevated clinical risk, normal natriuretic peptide: proceed without further testing.";
        recs.push({ text: disposition, severity: "action", cite: ["periop2024"], ap: "" });
        plan.push("natriuretic peptide is normal; may proceed without further cardiac testing");
      }
      recs.push({ text: "Pharmacologic stress testing is not recommended routinely; may be reasonable only if results would change management (e.g., symptoms suggesting ischemia).", severity: "info", cite: ["periop2024"], cor: "2b / 3", ap: "" });
    }
    recs.push({ text: "In elevated-risk patients, postoperative troponin surveillance (baseline, 24 h, 48 h) is reasonable to detect MINS.", severity: "info", cite: ["periop2024"], cor: "2b", ap: "" });
  }

  // TTE
  if (active.includes("new_dyspnea") || (valve.some((x) => x.startsWith("severe") || x === "mod_as") && !yes(v, "echoWithinYear"))) {
    recs.push({ text: "Preoperative TTE is reasonable for new/worsening dyspnea or HF symptoms, or known moderate-or-greater valve disease without echo in the past year/clinical change. Routine TTE is not recommended.", severity: "action", cite: ["periop2024"], cor: "2a", ap: "" });
    plan.push("obtain a preoperative transthoracic echocardiogram");
  }
  const ef = num(v, "ef");
  if (ef != null && ef < 40) {
    recs.push({ text: `LVEF ${ef}%: higher perioperative risk. Continue GDMT, assess volume status, consider invasive hemodynamic monitoring for high-risk surgery.`, severity: "action", cite: ["periop2024"], ap: "" });
  }

  // Valves
  if (valve.includes("severe_as")) {
    const sx = active.includes("sx_valve");
    recs.push({
      text: sx
        ? "Symptomatic severe AS: aortic valve replacement (TAVR/SAVR) before elective noncardiac surgery (1)."
        : "Asymptomatic severe AS: reasonable to proceed with elevated-risk elective surgery with invasive hemodynamic monitoring and avoidance of hypotension (2a); consider AVR first if otherwise indicated.",
      severity: sx ? "urgent" : "action", cite: ["periop2024", "valve2020"], cor: sx ? "1" : "2a",
      ap: sx ? "Given symptomatic severe aortic stenosis, recommend aortic valve replacement prior to elective surgery" : "For asymptomatic severe aortic stenosis, recommend invasive hemodynamic monitoring with avoidance of hypotension and tachycardia",
    });
  }
  if (valve.includes("severe_ms")) recs.push({ text: "Severe MS: rate control and euvolemia; consider percutaneous balloon valvotomy before elevated-risk elective surgery if anatomy suitable.", severity: "action", cite: ["periop2024", "valve2020"], ap: "" });
  if (valve.includes("severe_mr") || valve.includes("severe_ar")) recs.push({ text: "Asymptomatic severe regurgitation with preserved LV function: reasonable to proceed with hemodynamic monitoring.", severity: "info", cite: ["periop2024"], cor: "2a", ap: "" });

  // Stents
  const stent = str(v, "stent");
  const months = num(v, "stentMonths");
  if ((stent === "des" || stent === "bms" || stent === "poba") && months != null && urgency !== "emergency") {
    const min = stent === "poba" ? 0.5 : stent === "bms" ? 1 : yes(v, "stentForAcs") ? 12 : 6;
    const tsMin = stent === "des" ? 3 : min;
    const ok = months >= min || (urgency === "time_sensitive" && months >= tsMin);
    metrics.push({ label: "Time since PCI", value: `${months} mo`, note: ok ? "acceptable for surgery" : `delay to ≥${min} mo if possible` });
    if (!ok) {
      recs.push({
        text: `${stent.toUpperCase()} ${months} months ago: delay elective surgery until ≥${min} months after PCI${stent === "des" ? " (≥3 months may be acceptable for time-sensitive surgery when the risk of delay outweighs stent thrombosis risk)" : ""}. If surgery cannot be delayed, continue DAPT when possible.`,
        severity: "urgent", cite: ["periop2024"], cor: "1",
        ap: `Given ${stent === "des" ? "drug-eluting stent" : stent === "bms" ? "bare-metal stent" : "balloon angioplasty"} ${months} months ago, recommend deferring elective surgery until at least ${min} months after PCI if feasible`,
      });
    }
    medPlan.push("continue aspirin throughout the perioperative period given prior PCI unless bleeding risk is prohibitive");
  }
  const p2y12 = str(v, "p2y12");
  if (p2y12 && p2y12 !== "none") {
    const days = p2y12 === "prasugrel" ? 7 : 5;
    medPlan.push(`if acceptable from a stent standpoint, hold ${p2y12} ${days} days before surgery and resume within 24-48 hours once hemostasis allows`);
  }

  // Anticoagulation
  const ac = str(v, "anticoag");
  const highBleed = str(v, "procBleed") === "high";
  if (ac && ac !== "none") {
    if (ac === "warfarin") {
      const hr = arr(v, "vteHighRisk");
      medPlan.push(`hold warfarin 5 days before surgery with INR check the day before${hr.length ? "; bridging with LMWH is reasonable given very high thrombotic risk" : "; bridging is not recommended"}, resume 12-24 hours postoperatively`);
    } else if (ac === "dabigatran") {
      const crcl = num(v, "crcl");
      if (crcl == null) missing.push("CrCl (for dabigatran hold)");
      const pre = crcl != null && crcl < 50 ? (highBleed ? 4 : 2) : highBleed ? 2 : 1;
      medPlan.push(`hold dabigatran ${pre} day${pre > 1 ? "s" : ""} before surgery (last dose day -${pre + 1}), no bridging, resume ${highBleed ? "48-72" : "24"} hours postoperatively`);
    } else {
      const pre = highBleed ? 2 : 1;
      medPlan.push(`hold ${ac} ${pre} day${pre > 1 ? "s" : ""} before surgery (last dose day -${pre + 1}), no bridging, resume ${highBleed ? "48-72" : "24"} hours postoperatively`);
    }
    recs.push({ text: "DOAC interruption per PAUSE: 1 day off for low/moderate bleed-risk, 2 days for high bleed-risk (dabigatran longer if CrCl <50); no heparin bridging.", severity: "info", cite: ["pause", "periop2024"], ap: "" });
    if (!str(v, "procBleed")) missing.push("Procedural bleeding risk (for anticoagulant hold)");
  }

  // Other meds
  if (meds.includes("bb")) medPlan.push("continue beta-blocker");
  recs.push({ text: "Beta-blockers: continue if chronically taking (1); do not start on the day of surgery (3: Harm).", severity: "info", cite: ["periop2024"], ap: "" });
  if (meds.includes("statin")) medPlan.push("continue statin");
  else if (yes(v, "ihd") || yes(v, "cvd") || st?.value === "vascular_supra" || st?.value === "vascular_infra") {
    medPlan.push("start a statin given vascular disease");
    recs.push({ text: "Statin-naive patient with indication (e.g., vascular surgery/ASCVD): starting a statin perioperatively is reasonable.", severity: "action", cite: ["periop2024"], cor: "2a", ap: "" });
  }
  if (meds.includes("raasi")) {
    medPlan.push(yes(v, "raasiForHfref") ? "continue ACEi/ARB/ARNI given HFrEF" : "consider holding ACEi/ARB 24 hours before surgery to reduce intraoperative hypotension, resuming postoperatively when hemodynamically stable");
  }
  if (meds.includes("sglt2")) {
    medPlan.push("hold SGLT2 inhibitor 3 days before surgery (4 days for ertugliflozin) to reduce euglycemic ketoacidosis risk");
    recs.push({ text: "SGLT2 inhibitors: discontinue 3-4 days before surgery (2a).", severity: "action", cite: ["periop2024"], cor: "2a", ap: "" });
  }
  if (meds.includes("glp1")) {
    medPlan.push("GLP-1 RA may generally be continued with a 24-hour clear-liquid diet preoperatively; hold if escalation phase or GI symptoms, in coordination with anesthesia");
    recs.push({ text: "GLP-1 RA: most patients may continue; 24-h liquid diet before procedures and individualized holding for high-risk features (escalation phase, GI symptoms).", severity: "info", cite: ["glp1_2024", "periop2024"], ap: "" });
  }
  if (meds.includes("aspirin") && !(stent === "des" || stent === "bms")) {
    medPlan.push(yes(v, "ihd") || yes(v, "cvd") ? "continue aspirin for secondary prevention unless bleeding risk is prohibitive" : "aspirin used only for primary prevention may be held 7 days before surgery");
  }

  // Devices
  const cied = str(v, "cied");
  if (cied && cied !== "none") {
    plan.push(`${cied === "icd" ? "ICD" : "pacemaker"} interrogation within the last ${cied === "icd" ? "6" : "12"} months and a perioperative device plan${cied === "icd" ? " including suspension of tachytherapies (magnet or reprogramming) with external defibrillation available" : ""}${yes(v, "pacerDependent") ? "; pacer-dependent, so asynchronous pacing if monopolar electrocautery is used above the umbilicus" : ""}`);
    recs.push({ text: "CIED: confirm recent interrogation and coordinate a perioperative EMI plan with the device clinic.", severity: "action", cite: ["periop2024"], cor: "1", ap: "" });
  }
  if (yes(v, "pulmHtn")) recs.push({ text: "Pulmonary hypertension: high perioperative risk; continue pulmonary vasodilators and consider surgery at an experienced center.", severity: "warning", cite: ["periop2024"], ap: "Given pulmonary hypertension, continue pulmonary vasodilator therapy and consider surgery at an experienced center" });

  const headline =
    urgency === "emergency" ? "Emergency — proceed" :
    active.some((a) => a !== "new_dyspnea") ? "Active cardiac condition — delay elective surgery" :
    !elevated ? "Low risk — proceed" :
    fc === "good" ? "Elevated risk, good functional capacity — proceed" :
    bnp == null && nt == null ? "Elevated risk — check BNP/NT-proBNP" :
    bnpHigh ? "Elevated risk, BNP elevated — proceed with monitoring" : "Elevated risk, BNP normal — proceed";

  const apExtra = recs.filter((r) => r.ap).map((r) => r.ap!.replace(/\.$/, ""));
  const ap = [
    `Preoperative cardiovascular evaluation: ${ageSex(v)} planned for ${urgency === "time_sensitive" ? "time-sensitive" : urgency} ${procName}${st ? ` (${st.risk === "low" ? "low" : "elevated"}-risk procedure)` : ""}.`,
    `RCRI ${score}${items.length ? ` (${list(items)})` : ""}, estimated 30-day MACE ~${RCRI_RISK.lee[idx]}${score > 0 ? ` (${RCRI_RISK.updated[idx]} by updated estimates)` : ""}.`,
    fc ? `Functional capacity ${fc === "good" ? "≥4 METs" : fc === "poor" ? "<4 METs" : "unable to be assessed"}${dasi != null ? ` (DASI ${dasi})` : ""}.` : "",
    bnp != null || nt != null ? `${bnp != null ? `BNP ${bnp} pg/mL` : ""}${bnp != null && nt != null ? ", " : ""}${nt != null ? `NT-proBNP ${nt} pg/mL` : ""}${bnpHigh ? " (elevated)" : " (not elevated)"}.` : "",
    `Per the 2024 ACC/AHA perioperative guideline: ${plan.join("; ")}.`,
    apExtra.length ? apExtra.join(". ") + "." : "",
    medPlan.length ? `Medications: ${medPlan.join("; ")}.` : "",
  ].filter(Boolean).join(" ");

  return { headline, metrics, recommendations: recs, missing, ap };
}

export const periopModule: ClinicalModule = {
  id: "periop",
  title: "Preoperative Risk",
  short: "Pre-op",
  icon: "🩺",
  description: "RCRI, functional capacity/DASI, BNP, stents, valves, anticoagulant and medication holds — 2024 ACC/AHA perioperative guideline.",
  placeholder: "e.g. 72M for elective open colectomy, CAD s/p DES 8 months ago (stable), on aspirin + clopidogrel, insulin-dependent DM, Cr 1.4, can't climb a flight of stairs, on apixaban for AF, empagliflozin, lisinopril for HTN",
  fields,
  evaluate: evaluatePeriop,
  citations: cites("periop2024", "rcri", "dasi", "pause", "glp1_2024", "valve2020"),
};

