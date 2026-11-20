// Office/outpatient E/M level from medical decision making (AMA CPT 2021+
// framework, current in 2026) or from total time, whichever supports the
// higher level. The two methods are alternatives and are never combined.
// Everything here is deterministic: the level comes only from elements the
// clinician confirms were performed and documented.

export type Level = 1 | 2 | 3 | 4; // straightforward, low, moderate, high
export const LEVEL_NAME = ["", "straightforward", "low", "moderate", "high"] as const;

export type ProblemStatus =
  | "minor" | "acute_uncomplicated" | "stable_chronic"
  | "chronic_progression" | "undiagnosed_uncertain" | "acute_systemic"
  | "chronic_severe" | "threat";

export const PROBLEM_STATUS: { value: ProblemStatus; label: string; help: string }[] = [
  { value: "stable_chronic", label: "Stable chronic illness", help: "At treatment goal, expected to last ≥1 year." },
  { value: "chronic_progression", label: "Chronic, not at goal / worsening / side effects", help: "AMA: a chronic illness not at its treatment goal is not stable, even without a change in symptoms." },
  { value: "chronic_severe", label: "Chronic with severe exacerbation or progression", help: "Significant risk of morbidity; may need escalation of care." },
  { value: "undiagnosed_uncertain", label: "New undiagnosed problem, uncertain prognosis", help: "Differential includes conditions with a high risk of morbidity (e.g., new chest pain, syncope, murmur with possible severe AS)." },
  { value: "acute_systemic", label: "Acute illness with systemic symptoms", help: "" },
  { value: "threat", label: "Threat to life or bodily function", help: "Near-term risk without treatment (e.g., symptomatic severe AS, possible ACS, syncope with high-risk features)." },
  { value: "acute_uncomplicated", label: "Acute uncomplicated", help: "" },
  { value: "minor", label: "Self-limited / minor", help: "" },
];

export type RiskItem =
  | "otc" | "rx" | "minor_surgery_risk" | "major_surgery_no_risk" | "sdoh"
  | "intensive_monitoring" | "major_surgery_risk" | "emergency_surgery" | "hospitalization" | "dnr";

export const RISK_ITEMS: { value: RiskItem; level: Level; label: string; help: string }[] = [
  { value: "rx", level: 3, label: "Prescription drug management", help: "Starting, stopping, changing dose, or deciding to continue a prescription after evaluating it." },
  { value: "major_surgery_no_risk", level: 3, label: "Decision on elective major surgery/procedure, no risk factors", help: "" },
  { value: "minor_surgery_risk", level: 3, label: "Decision on minor procedure with risk factors", help: "" },
  { value: "sdoh", level: 3, label: "Diagnosis/treatment significantly limited by social determinants", help: "E.g., cost, insurance, transportation changed the plan." },
  { value: "intensive_monitoring", level: 4, label: "Drug therapy requiring intensive monitoring for toxicity", help: "Lab/physiologic monitoring for adverse effects (not efficacy), e.g., mavacamten/aficamten REMS echo for LVEF, dofetilide/sotalol QTc, amiodarone toxicity labs, warfarin INR you manage." },
  { value: "major_surgery_risk", level: 4, label: "Decision on elective major surgery/procedure with patient or procedure risk factors", help: "E.g., referral decision for TAVR/SAVR, myectomy, ablation, ICD/CRT, cath/PCI in a patient with comorbidities." },
  { value: "emergency_surgery", level: 4, label: "Decision on emergency major surgery", help: "" },
  { value: "hospitalization", level: 4, label: "Decision regarding hospitalization / ED / escalation", help: "Includes sending the patient to the ED or deciding against admission after considering it." },
  { value: "dnr", level: 4, label: "Decision not to resuscitate or to de-escalate because of poor prognosis", help: "" },
  { value: "otc", level: 2, label: "OTC drugs / minor-risk management only", help: "" },
];

export const INTERP_OPTIONS = [
  { value: "ecg", label: "ECG tracing" },
  { value: "echo", label: "Echo images" },
  { value: "ct", label: "CT / CTA / CAC images" },
  { value: "mri", label: "Cardiac MRI images" },
  { value: "monitor", label: "Ambulatory monitor tracings" },
  { value: "stress", label: "Stress test images/tracings" },
  { value: "device", label: "Device interrogation" },
  { value: "cath", label: "Cath / angiogram images" },
];

export interface BillingInputs {
  visit: "new" | "established" | null;
  minutes: number | null;
  payer: "medicare" | "other";
  year: number;
  problems: { label: string; status: ProblemStatus }[];
  testsOrdered: number;
  resultsReviewed: number;
  externalNotes: number;
  historian: boolean;
  interpretations: string[]; // INTERP_OPTIONS values, not separately billed by you
  discussion: boolean;
  risk: RiskItem[];
  longitudinal: boolean;
  mod25: boolean;
  aco: boolean;
}

export const emptyBilling = (year = new Date().getFullYear()): BillingInputs => ({
  visit: null, minutes: null, payer: "medicare", year, problems: [], testsOrdered: 0, resultsReviewed: 0, externalNotes: 0,
  historian: false, interpretations: [], discussion: false, risk: [], longitudinal: false, mod25: false, aco: false,
});

export function problemLevel(ps: BillingInputs["problems"]): Level {
  const n = (s: ProblemStatus) => ps.filter((p) => p.status === s).length;
  if (n("chronic_severe") || n("threat")) return 4;
  if (n("chronic_progression") || n("undiagnosed_uncertain") || n("acute_systemic") || n("stable_chronic") >= 2) return 3;
  if (n("stable_chronic") || n("acute_uncomplicated") || n("minor") >= 2) return 2;
  return 1;
}

export function dataLevel(b: BillingInputs): { level: Level; cat1: number; categories: number } {
  const cat1Items = b.testsOrdered + b.resultsReviewed + b.externalNotes;
  // Category 1 for moderate/high: any 3 of tests/results/notes, or historian.
  const cat1Full = cat1Items + (b.historian ? 1 : 0) >= 3;
  const cat2 = b.interpretations.length > 0;
  const cat3 = b.discussion;
  const categories = [cat1Full, cat2, cat3].filter(Boolean).length;
  let level: Level = 1;
  if (categories >= 2) level = 4;
  else if (categories === 1) level = 3;
  else if (cat1Items >= 2 || b.historian) level = 2; // limited
  return { level, cat1: cat1Items, categories };
}

export function riskLevel(r: RiskItem[]): Level {
  return r.reduce<number>((m, x) => Math.max(m, RISK_ITEMS.find((i) => i.value === x)?.level ?? 1), 1) as Level;
}

/** MDM = the level met or exceeded by 2 of the 3 elements. */
export function mdmLevel(p: Level, d: Level, r: Level): Level {
  return [p, d, r].sort((a, b) => b - a)[1] as Level;
}

const CODES = { new: ["", "99202", "99203", "99204", "99205"], established: ["", "99212", "99213", "99214", "99215"] } as const;
// CPT total-time minimums (2024+ descriptors: "must be met or exceeded").
const TIME_MIN = { new: [0, 15, 30, 45, 60], established: [0, 10, 20, 30, 40] } as const;

export function timeLevel(visit: "new" | "established", minutes: number): Level | null {
  const t = TIME_MIN[visit];
  for (let l = 4; l >= 1; l--) if (minutes >= t[l]) return l as Level;
  return null;
}

/** Prolonged service units when the level is chosen by time at the top level. */
export function prolonged(visit: "new" | "established", minutes: number, payer: "medicare" | "other"): { code: string; units: number; threshold: number } | null {
  if (payer === "medicare") {
    const start = visit === "new" ? 89 : 69; // G2212: 15 min beyond the old maximum (74 / 54)
    if (minutes < start) return null;
    return { code: "G2212", units: 1 + Math.floor((minutes - start) / 15), threshold: start };
  }
  const start = visit === "new" ? 75 : 55; // CPT 99417: 15 min beyond the 60 / 40 minimum
  if (minutes < start) return null;
  return { code: "99417", units: 1 + Math.floor((minutes - start) / 15), threshold: start };
}

export interface BillingResult {
  ready: boolean;
  problem: Level;
  data: Level;
  risk: Level;
  mdm: Level;
  mdmCode: string | null;
  timeLevel: Level | null;
  timeCode: string | null;
  basis: "mdm" | "time" | null;
  code: string | null;
  prolonged: { code: string; units: number; threshold: number } | null;
  addOn: { code: string; text: string } | null;
  addOnNote: string;
  statement: string;
  gaps: string[];
  notes: string[];
}

const interpLabel = (v: string) => INTERP_OPTIONS.find((o) => o.value === v)?.label.toLowerCase() ?? v;
const plural = (n: number, s: string) => `${n} ${s}${n === 1 ? "" : "s"}`;

export function computeBilling(b: BillingInputs): BillingResult {
  const p = problemLevel(b.problems);
  const d = dataLevel(b);
  const r = riskLevel(b.risk);
  const mdm = mdmLevel(p, d.level, r);
  const visit = b.visit;
  const mdmCode = visit ? CODES[visit][mdm] : null;
  const tl = visit && b.minutes != null && b.minutes > 0 ? timeLevel(visit, b.minutes) : null;
  const timeCode = visit && tl ? CODES[visit][tl] : null;
  let basis: "mdm" | "time" | null = null;
  if (visit) basis = tl != null && tl > mdm ? "time" : "mdm";
  const code = basis === "time" ? timeCode : mdmCode;
  const pro = basis === "time" && tl === 4 && visit && b.minutes != null ? prolonged(visit, b.minutes, b.payer) : null;
  const notes: string[] = [];
  const gaps: string[] = [];

  // Add-on for longitudinal care
  let addOn: BillingResult["addOn"] = null;
  let addOnNote = "";
  if (b.longitudinal) {
    if (b.mod25) addOnNote = "Not reportable: the E/M carries modifier 25 for a same-day procedure (the only exceptions are preventive services, AWV and vaccine administration).";
    else if (b.payer !== "medicare") addOnNote = "Medicare rule. Many commercial plans do not pay it; check the payer.";
    if (!b.mod25) {
      if (b.year >= 2027) {
        addOn = b.aco
          ? { code: "Modifier B2", text: "Append modifier B2 to the E/M code (CY2027: replaces G2211 for Shared Savings Program / LEAD ACO participants; +32% of the E/M payment)." }
          : { code: "Modifier B1", text: "Append modifier B1 to the E/M code (CY2027: replaces G2211; +16% of the E/M payment)." };
      } else addOn = { code: "G2211", text: "Add G2211 (visit complexity inherent to longitudinal care) to the office E/M code." };
    }
  }

  // Statement
  const parts: string[] = [];
  const probs = b.problems.filter((x) => x.label.trim());
  if (probs.length) {
    const st = (s: ProblemStatus) => PROBLEM_STATUS.find((x) => x.value === s)!.label.toLowerCase();
    parts.push(`Problems addressed: ${probs.map((x) => `${x.label} (${st(x.status)})`).join("; ")}.`);
  }
  const data: string[] = [];
  if (b.testsOrdered) data.push(`ordered ${plural(b.testsOrdered, "unique test")}`);
  if (b.resultsReviewed) data.push(`reviewed ${plural(b.resultsReviewed, "unique test result")}`);
  if (b.externalNotes) data.push(`reviewed ${plural(b.externalNotes, "external note")} from outside sources`);
  if (b.historian) data.push("obtained history from an independent historian");
  if (b.interpretations.length) data.push(`independently interpreted the ${b.interpretations.map(interpLabel).join(", ")} (not separately reported)`);
  if (b.discussion) data.push("discussed management with an external physician/qualified health professional");
  if (data.length) parts.push(`Data: ${data.join("; ")}.`);
  const riskTxt = b.risk.map((x) => RISK_ITEMS.find((i) => i.value === x)!.label.toLowerCase());
  if (riskTxt.length) parts.push(`Risk of patient management: ${riskTxt.join("; ")}.`);

  let statement = "";
  if (visit) {
    const header = basis === "time"
      ? `I spent a total of ${b.minutes} minutes on the date of the encounter in the care of this patient, including reviewing records and tests, obtaining history, examination, counseling and education, ordering tests and medications, care coordination, and documentation. This excludes time spent on separately reported services. Level selected by total time (${code}${pro ? ` + ${pro.code} x${pro.units}` : ""}).`
      : `Medical decision making: ${LEVEL_NAME[mdm]} complexity (problems ${LEVEL_NAME[p]}, data ${LEVEL_NAME[d.level]}, risk ${LEVEL_NAME[r]}), supporting ${code}.`;
    statement = [header, parts.join(" "), addOn
      ? `${addOn.code === "G2211" ? "G2211" : addOn.code}: I serve as the continuing focal point for this patient's ${probs.length ? probs.map((x) => x.label).join(" and ") : "serious or complex cardiovascular condition"} and am providing ongoing longitudinal care; this visit is part of that continuing relationship.`
      : ""].filter(Boolean).join("\n");
  }

  // Gaps: only ask about things that would change the level, phrased "if you did it, document it".
  if (visit) {
    const target = Math.min(4, mdm + 1) as Level;
    if (mdm < 4) {
      const below = [
        { el: "problems", lv: p }, { el: "data", lv: d.level }, { el: "risk", lv: r },
      ].filter((x) => x.lv < target);
      for (const x of below) {
        if (x.el === "problems") {
          if (target === 3) gaps.push("If a chronic condition is not at its treatment goal, worsening, or causing side effects, state that explicitly (e.g., \"BP not at goal\", \"EF declined\", \"symptoms progressing\"). A second stable chronic condition you actually addressed also counts.");
          if (target === 4) gaps.push("If a condition poses a threat to life or bodily function (e.g., symptomatic severe AS, possible ACS, high-risk syncope) or is a severe exacerbation, document that assessment.");
        }
        if (x.el === "data") {
          const need: string[] = [];
          if (!b.interpretations.length) need.push("If you personally reviewed images or tracings (echo, ECG, CT, monitor) that you are not billing separately, write \"I independently interpreted …\" with your read");
          if (d.cat1 + (b.historian ? 1 : 0) < 3) need.push(`If you reviewed outside records, prior results or ordered tests, name each one (you have ${d.cat1}; 3 unique items make a category)`);
          if (!b.discussion) need.push("If you discussed management with another physician (e.g., surgeon, EP, PCP), document who and what was decided");
          gaps.push(`Data${target === 4 ? " (need 2 of 3 categories for high)" : ""}: ${need.join(". ")}.`);
        }
        if (x.el === "risk") {
          if (target === 3) gaps.push("If you started, stopped, changed, or chose to continue a prescription after reviewing it, document the drug and the decision (prescription drug management).");
          if (target === 4) gaps.push("If you made a decision about a procedure with risk factors (cath, TAVR, ablation, ICD), hospitalization/ED, or a drug that needs toxicity monitoring (mavacamten, dofetilide, amiodarone, warfarin), document the decision and the risk factors or monitoring plan.");
        }
      }
    }
    if (b.minutes == null) gaps.push("Record your total time on the date of service; if it supports a higher level than MDM, bill by time.");
  }
  if (b.interpretations.length) notes.push("Independent interpretation counts only if you do not bill the interpretation separately (e.g., not if you bill 93306 for that echo).");
  if (visit === "new") notes.push("New patient: not seen by you or a same-specialty colleague in your group within the past 3 years.");
  notes.push("MDM and time are alternative methods; the higher supported level is chosen, and they are never added together.");

  return {
    ready: !!visit, problem: p, data: d.level, risk: r, mdm, mdmCode, timeLevel: tl, timeCode, basis, code,
    prolonged: pro, addOn, addOnNote, statement, gaps, notes,
  };
}

/** Suggest MDM elements from a module's inputs and A&P. The clinician confirms each. */
export interface BillingHints {
  problems: { label: string; status: ProblemStatus }[];
  risk: RiskItem[];
  interpretations: string[];
}

const RX = /\b(start|switch|add|adjust|uptitrate|titrate|increase|decrease|reduce|stop|discontinue|hold|transition|continue)\b[^.;]*\b(mg|statin|ezetimibe|inhibitor|blocker|antagonist|diuretic|spironolactone|finerenone|sacubitril|apixaban|rivaroxaban|dabigatran|edoxaban|warfarin|tafamidis|acoramidis|vutrisiran|mavacamten|aficamten|semaglutide|tirzepatide|amlodipine|nitroglycerin|aspirin|anticoag|GDMT|antihypertensive|midodrine|therapy)/i;
const PROCEDURE = /\b(refer[^.;]*(surg|valve|TAVR|SAVR|ablation|electrophysiology|ICD|pacemaker|CRT|myectomy|septal|angiograph|catheter|repair|appendage)|invasive coronary angiography|cardiac resynchronization)/i;
const ED = /\b(emergency department|hospitaliz|admit)/i;

const PROBLEM_LABEL: Record<string, string> = {
  htn: "hypertension", hf: "heart failure", af: "atrial fibrillation", valve: "valvular heart disease", chestpain: "chest pain / coronary disease",
  syncope: "syncope", attr: "cardiac amyloidosis", hcm: "hypertrophic cardiomyopathy", ascvd: "ASCVD risk / dyslipidemia",
  cac: "coronary artery calcification", aorta: "thoracic aortic aneurysm", pa: "suspected primary aldosteronism", periop: "preoperative cardiovascular risk",
};

export function billingHints(moduleId: string, title: string, v: Record<string, unknown>, ap: string, headline: string): BillingHints {
  const risk = new Set<RiskItem>();
  if (RX.test(ap)) risk.add("rx");
  if (PROCEDURE.test(ap)) risk.add("major_surgery_risk");
  if (ED.test(ap)) risk.add("hospitalization");
  if (/mavacamten|aficamten|dofetilide|amiodarone/i.test(ap) || (moduleId === "af" && v.oac === "warfarin")) risk.add("intensive_monitoring");

  let status: ProblemStatus = "stable_chronic";
  const h = headline.toLowerCase();
  switch (moduleId) {
    case "htn": status = /controlled on|normal bp/.test(h) ? "stable_chronic" : /severe/.test(h) ? "chronic_severe" : "chronic_progression"; break;
    case "hf": status = v.nyha === "4" ? "chronic_severe" : v.congested === true || v.recentHosp === true || /change/.test(h) ? "chronic_progression" : "stable_chronic"; break;
    case "af": status = v.symptomatic === true || (typeof v.hr === "number" && v.hr >= 110) || /adjust|change/.test(ap) ? "chronic_progression" : "stable_chronic"; break;
    case "valve": status = v.symptoms === true && /severe/.test(h) ? "threat" : /intervention/.test(h) ? "chronic_progression" : "stable_chronic"; break;
    case "chestpain": status = v.acute === true ? "threat" : v.knownCad === "obstructive" ? "chronic_progression" : "undiagnosed_uncertain"; break;
    case "syncope": status = /cardiac/.test(h) ? "threat" : "undiagnosed_uncertain"; break;
    case "attr": status = /suspected|light chains|rule out|suspicion/.test(h) ? "undiagnosed_uncertain" : "chronic_progression"; break;
    case "hcm": status = /myosin|beta-blocker/.test(ap) || v.syncope === true ? "chronic_progression" : "stable_chronic"; break;
    case "ascvd": case "cac": status = /not at goal|above goal|escalat|add /i.test(ap) ? "chronic_progression" : "stable_chronic"; break;
    case "aorta": status = /refer/.test(h) ? "chronic_progression" : "stable_chronic"; break;
    case "pa": status = "undiagnosed_uncertain"; break;
    case "periop": status = "stable_chronic"; break;
  }
  // Interpretations are only suggested (asked), never pre-checked.
  const interp: string[] = [];
  if (["valve", "hcm", "hf", "aorta", "attr"].includes(moduleId)) interp.push("echo");
  if (moduleId === "cac" || moduleId === "aorta" || moduleId === "chestpain") interp.push("ct");
  if (moduleId === "af" || moduleId === "syncope") interp.push("ecg", "monitor");
  return { problems: [{ label: PROBLEM_LABEL[moduleId] ?? title.toLowerCase(), status }], risk: [...risk], interpretations: interp };
}
