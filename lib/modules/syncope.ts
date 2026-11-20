import type { ClinicalModule, FieldDef, Inputs, Metric, Recommendation, RuleResult } from "../types";
import { ageSex, arr, fmt, list, num, str, yes } from "../util";
import { cites } from "../citations";

// 2017 ACC/AHA/HRS syncope guideline (still the current US guideline).

const REFLEX = [
  { value: "prodrome", label: "Prodrome (warmth, nausea, diaphoresis)" },
  { value: "standing", label: "Prolonged standing / heat" },
  { value: "emotional", label: "Pain, fear, blood/needle" },
  { value: "situational", label: "Cough, micturition, defecation, swallow" },
  { value: "postural", label: "Shortly after standing up" },
  { value: "young_recurrent", label: "Recurrent since youth, benign course" },
];
const CARDIAC = [
  { value: "exertional", label: "During exertion" },
  { value: "supine", label: "While supine / seated" },
  { value: "palpitations", label: "Palpitations just before" },
  { value: "no_prodrome", label: "Abrupt, no prodrome" },
  { value: "injury", label: "Significant injury" },
  { value: "chest_pain", label: "Chest pain / dyspnea" },
];
const ECG = [
  { value: "mobitz2", label: "Mobitz II / complete heart block" },
  { value: "bifascicular", label: "Bifascicular block / QRS ≥120" },
  { value: "pause", label: "Sinus pauses ≥3 s / sinus brady <40" },
  { value: "long_qt", label: "Long QT (QTc >470/480)" },
  { value: "brugada", label: "Brugada pattern" },
  { value: "preexcitation", label: "Pre-excitation (WPW)" },
  { value: "nsvt", label: "NSVT / frequent ectopy" },
  { value: "q_lvh", label: "Q waves / LVH / epsilon wave" },
];

const fields: FieldDef[] = [
  { key: "age", label: "Age", type: "number", unit: "y", section: "Patient" },
  { key: "sex", label: "Sex", type: "select", section: "Patient", options: [ { value: "female", label: "Female" }, { value: "male", label: "Male" } ] },
  { key: "episodes", label: "Number of episodes (lifetime)", type: "number", section: "History" },
  { key: "lastEpisodeDays", label: "Days since last episode", type: "number", unit: "d", section: "History" },
  { key: "reflex", label: "Reflex features", type: "multi", section: "History", options: REFLEX },
  { key: "cardiac", label: "Cardiac red flags", type: "multi", section: "History", options: CARDIAC },
  { key: "shd", label: "Known structural heart disease / HF / CAD", type: "bool", section: "History" },
  { key: "ef", label: "LVEF", type: "number", unit: "%", section: "History" },
  { key: "fhxScd", label: "FHx sudden death <50 y / inherited arrhythmia", type: "bool", section: "History" },
  { key: "ecg", label: "ECG findings", type: "multi", section: "ECG", options: ECG },
  { key: "ecgNormal", label: "ECG normal", type: "bool", section: "ECG" },
  { key: "supSbp", label: "Supine SBP", type: "number", unit: "mmHg", section: "Orthostatics" },
  { key: "stdSbp", label: "Standing SBP (≤3 min)", type: "number", unit: "mmHg", section: "Orthostatics" },
  { key: "supDbp", label: "Supine DBP", type: "number", unit: "mmHg", section: "Orthostatics" },
  { key: "stdDbp", label: "Standing DBP", type: "number", unit: "mmHg", section: "Orthostatics" },
  { key: "supHr", label: "Supine HR", type: "number", unit: "bpm", section: "Orthostatics" },
  { key: "stdHr", label: "Standing HR", type: "number", unit: "bpm", section: "Orthostatics" },
  { key: "culpritMeds", label: "On vasodilators / diuretics / alpha-blockers", type: "bool", section: "Orthostatics" },
  { key: "htn", label: "Hypertension", type: "bool", section: "Orthostatics" },
  { key: "neuroDz", label: "Parkinson's / autonomic neuropathy / diabetes neuropathy", type: "bool", section: "Orthostatics" },
  { key: "tteDone", label: "Echo done", type: "bool", section: "Testing" },
  { key: "monitorDone", label: "Ambulatory monitor done (non-diagnostic)", type: "bool", section: "Testing" },
  { key: "commercialDriver", label: "Commercial driver / pilot", type: "bool", section: "Testing" },
];

export function evaluateSyncope(v: Inputs): RuleResult {
  const recs: Recommendation[] = [];
  const metrics: Metric[] = [];
  const missing: string[] = [];
  const plan: string[] = [];
  const age = num(v, "age");
  const reflex = arr(v, "reflex");
  const cardiac = arr(v, "cardiac");
  const ecg = arr(v, "ecg");
  const ef = num(v, "ef");
  const shd = yes(v, "shd") || (ef != null && ef < 50);
  const episodes = num(v, "episodes");

  // Orthostatics
  const sS = num(v, "supSbp"), stS = num(v, "stdSbp"), sD = num(v, "supDbp"), stD = num(v, "stdDbp"), sH = num(v, "supHr"), stH = num(v, "stdHr");
  let oh = false, pots = false;
  if (sS != null && stS != null) {
    const dS = sS - stS, dD = sD != null && stD != null ? sD - stD : 0;
    oh = dS >= 20 || dD >= 10;
    const dH = sH != null && stH != null ? stH - sH : null;
    pots = !oh && dH != null && dH >= ((age ?? 30) < 20 ? 40 : 30);
    metrics.push({ label: "Orthostatic change", value: `${dS >= 0 ? "-" : "+"}${fmt(Math.abs(dS), 0)}${sD != null && stD != null ? `/${dD >= 0 ? "-" : "+"}${fmt(Math.abs(dD), 0)}` : ""} mmHg${dH != null ? `, HR +${fmt(dH, 0)}` : ""}`, note: oh ? `orthostatic hypotension${dH != null && dH < 15 ? " (blunted HR rise: neurogenic?)" : ""}` : pots ? "HR rise meets POTS threshold" : "negative" });
  } else missing.push("Orthostatic vitals (supine and standing BP/HR)");

  const highRisk = [
    str(v, "sex") === "male" && "male sex",
    age != null && age > 60 && "age >60",
    ...cardiac.map((c) => CARDIAC.find((x) => x.value === c)!.label.toLowerCase()),
    shd && "structural heart disease",
    yes(v, "fhxScd") && "family history of sudden death",
    ...ecg.map((e) => ECG.find((x) => x.value === e)!.label),
  ].filter(Boolean) as string[];
  const majorRisk = cardiac.length > 0 || shd || ecg.length > 0 || yes(v, "fhxScd");
  if (v.ecgNormal == null && !ecg.length) missing.push("12-lead ECG findings");

  let mechanism: string;
  if (majorRisk) mechanism = "possible cardiac (arrhythmic/structural) syncope";
  else if (oh) mechanism = "orthostatic hypotension";
  else if (reflex.length) mechanism = "reflex (vasovagal/situational) syncope";
  else mechanism = "unexplained syncope";
  metrics.unshift({ label: "Likely mechanism", value: mechanism.split(" (")[0], note: highRisk.length ? `${highRisk.length} high-risk feature${highRisk.length > 1 ? "s" : ""}` : "low-risk features" });

  if (majorRisk) {
    recs.push({ text: `High-risk features (${list(highRisk)}): prioritize cardiac evaluation; if a serious arrhythmic or structural cause is suspected and not yet excluded, expedited (or inpatient) evaluation is warranted.`, severity: "urgent", cite: ["syncope2017"], ap: "" });
    const tests: string[] = [];
    if (!yes(v, "tteDone")) tests.push("transthoracic echocardiogram (2a)");
    if (cardiac.includes("exertional")) tests.push("exercise stress test (2a)");
    if (ecg.includes("mobitz2")) recs.push({ text: "Mobitz II or complete heart block with syncope: permanent pacemaker indicated (1); urgent EP/pacing evaluation.", severity: "urgent", cite: ["syncope2017"], cor: "1", ap: "Advanced AV block with syncope; urgent referral for permanent pacemaker" });
    if (ef != null && ef <= 35) recs.push({ text: `LVEF ${fmt(ef, 0)}% with syncope: arrhythmic cause presumed until proven otherwise; ICD evaluation per guideline (1).`, severity: "urgent", cite: ["syncope2017", "hf2022"], cor: "1", ap: "Syncope with severely reduced LVEF; refer to electrophysiology for ICD evaluation" });
    if (ecg.some((e) => ["long_qt", "brugada", "preexcitation"].includes(e)) || yes(v, "fhxScd")) recs.push({ text: "Suspected inherited arrhythmia or pre-excitation: electrophysiology referral; genetic evaluation as indicated.", severity: "action", cite: ["syncope2017"], ap: "Refer to electrophysiology for suspected inherited arrhythmia syndrome" });
    if ((shd || ecg.includes("bifascicular")) && ef != null && ef > 35) tests.push("electrophysiology study if noninvasive testing nondiagnostic (2a)");
    if (yes(v, "shd") && ef == null) tests.push("cardiac MRI or CT if infiltrative/structural disease suspected (2b)");
    const monitor = !yes(v, "monitorDone") ? monitorChoice(v) : "implantable cardiac monitor (2a), since prior monitoring was nondiagnostic";
    tests.push(monitor);
    recs.push({ text: `Cardiac workup: ${tests.join("; ")}.`, severity: "action", cite: ["syncope2017"], ap: "" });
    plan.push(`cardiac evaluation with ${tests.map((t) => t.replace(/ \((1|2a|2b)\)/, "").replace(/, since.*/, "")).join(", ")}`);
  } else if (oh) {
    const neuro = yes(v, "neuroDz");
    recs.push({ text: `Orthostatic hypotension${neuro ? " (likely neurogenic)" : ""}: ${yes(v, "culpritMeds") ? "reduce or stop culprit vasodilators/diuretics (2a); " : ""}hydration, acute water bolus for symptoms, compression garments (2a), slow positional changes; if persistent, midodrine (2a)${neuro ? ", droxidopa (2a)" : ""} or fludrocortisone (2b). Watch for supine hypertension.`, severity: "action", cite: ["syncope2017"], cor: "2a", ap: "" });
    plan.push(`${yes(v, "culpritMeds") ? "reduce culprit antihypertensives/diuretics, " : ""}hydration, compression garments and counterpressure maneuvers for orthostatic hypotension${neuro ? "; consider midodrine or droxidopa" : ""}`);
  } else if (reflex.length) {
    const recurrent = episodes != null && episodes >= 3;
    recs.push({ text: "Reflex syncope: education on triggers and reassurance (1); physical counterpressure maneuvers (2a); liberal fluid/salt if no hypertension, HF or CKD (2b). No routine imaging, carotid ultrasound, EEG or broad lab panels (3: no benefit).", severity: "action", cite: ["syncope2017"], cor: "1", ap: "" });
    plan.push("education on reflex syncope triggers and physical counterpressure maneuvers");
    if (!yes(v, "htn")) plan.push("liberalize fluid and salt intake");
    if (recurrent) {
      recs.push({ text: `Recurrent reflex syncope (${fmt(episodes!, 0)} episodes): ${yes(v, "htn") ? "" : "midodrine is reasonable if no hypertension/HF/urinary retention (2a); fludrocortisone may be considered (2b); "}beta-blockers may be considered age ≥42 (2b); tilt testing if diagnosis uncertain (2a). Dual-chamber pacing may be considered age ≥40 with documented spontaneous asystolic pauses (2b).`, severity: "action", cite: ["syncope2017"], cor: "2a", ap: "" });
    }
    if (v.ecgNormal !== true) recs.push({ text: "Obtain a 12-lead ECG if not done (1).", severity: "action", cite: ["syncope2017"], cor: "1", ap: "" });
  } else {
    recs.push({ text: `Unexplained syncope without high-risk features: ECG (1); ${monitorChoice(v)}; tilt table testing if reflex syncope suspected but uncertain (2a); echo if structural disease suspected.`, severity: "action", cite: ["syncope2017"], ap: "" });
    plan.push(`ECG and ${monitorChoice(v).replace(/ \(2a\)/, "")}`);
  }
  if (pots) recs.push({ text: "Sustained HR rise ≥30 bpm without orthostatic hypotension: consistent with postural orthostatic tachycardia; confirm with symptoms ≥3 months and consider tilt testing. Fluids, salt, compression and graded recumbent exercise are first-line.", severity: "info", cite: ["syncope2017"], ap: "" });

  recs.push({ text: `Driving: counsel per state law and the guideline's restrictions (stricter for ${yes(v, "commercialDriver") ? "commercial drivers, which applies here" : "commercial drivers"}); avoid driving until the cause is identified and treated if arrhythmic/unexplained.`, severity: "info", cite: ["syncope2017"], ap: majorRisk || mechanism === "unexplained syncope" ? "Counseled to avoid driving until evaluation is complete" : "" });

  const headline = `${mechanism[0].toUpperCase() + mechanism.slice(1)}${majorRisk ? ": expedite cardiac workup" : ""}`;
  const apExtra = recs.filter((r) => r.ap).map((r) => r.ap!.replace(/\.$/, ""));
  const ap = [
    `Syncope${episodes != null ? ` (${fmt(episodes, 0)} episode${episodes === 1 ? "" : "s"})` : ""}: ${ageSex(v)}${reflex.length ? ` with ${list(reflex.map((r) => REFLEX.find((x) => x.value === r)!.label.toLowerCase()))}` : ""}${cardiac.length ? `; red flags: ${list(cardiac.map((c) => CARDIAC.find((x) => x.value === c)!.label.toLowerCase()))}` : ""}${shd ? "; structural heart disease" : ""}${ef != null ? `, LVEF ${fmt(ef, 0)}%` : ""}${ecg.length ? `; ECG with ${list(ecg.map((e) => ECG.find((x) => x.value === e)!.label))}` : yes(v, "ecgNormal") ? "; ECG normal" : ""}${oh ? "; orthostatic hypotension on exam" : sS != null ? "; orthostatics negative" : ""}. Most consistent with ${mechanism}.`,
    `Per the 2017 ACC/AHA/HRS syncope guideline, plan: ${plan.join("; ")}.`,
    apExtra.length ? apExtra.join(". ") + "." : "",
  ].filter(Boolean).join(" ");

  return { headline, metrics, recommendations: recs, missing, ap };
}

function monitorChoice(v: Inputs): string {
  const days = num(v, "lastEpisodeDays");
  const n = num(v, "episodes");
  if (n != null && n >= 2 && days != null && days <= 3) return "Holter monitor 24-72 h (2a)";
  if (n != null && n >= 2 && days != null && days <= 30) return "2-6 week patch or external loop recorder (2a)";
  if (n != null && n >= 2) return "implantable cardiac monitor for infrequent episodes (2a)";
  return "ambulatory ECG monitor chosen by symptom frequency (patch 2-4 weeks; implantable monitor if infrequent) (2a)";
}

export const syncopeModule: ClinicalModule = {
  id: "syncope",
  title: "Syncope",
  short: "Syncope",
  icon: "😵",
  description: "Reflex vs orthostatic vs cardiac syncope, high-risk features, orthostatics, monitor choice by frequency, tilt/EP/echo, treatment and driving — 2017 ACC/AHA/HRS.",
  placeholder: "e.g. 24F 3 episodes of syncope standing in line, warmth and nausea beforehand, normal ECG, orthostatics 118/76 HR 72 → 112/72 HR 88, no heart disease, no FHx",
  fields,
  evaluate: evaluateSyncope,
  citations: cites("syncope2017", "hf2022"),
};
