// On-device fallback for the whole-visit dictation box: finds which modules a
// note is about and pulls out the common facts with fixed patterns. Used when
// the AI extractor is unreachable (offline, no API key, service error). It
// misses unusual phrasing, so every value still goes through the confirm step.
import type { ClinicalModule, Inputs } from "../types";
import { MODULES } from "../modules";
import { coerce } from "../schema";

// ---------------------------------------------------------------- detection

const DETECT: Record<string, RegExp> = {
  cac: /\b(CAC|calcium score|agatston|coronary (artery )?calcium|coronary calcification)\b/i,
  htn: /\b(HTN|hypertension|hypertensive|blood pressure|BP\s*(is|of|was|=|:)?\s*\d{2,3}\s*\/)/i,
  af: /\b(AF|A-?fib|atrial fib\w*|atrial flutter|AFL|PAF)\b/i,
  hf: /\b(heart failure|HFrEF|HFpEF|HFmrEF|HFimpEF|CHF|cardiomyopathy)\b/i,
  valve: /\b(aortic stenosis|mitral (stenosis|regurgitation)|aortic regurgitation|tricuspid regurgitation|bicuspid|TAVR|SAVR|valve area|AVA|mean gradient)\b/i,
  chestpain: /\b(chest (pain|pressure|tightness|discomfort)|angina|anginal)\b/i,
  ascvd: /\b(LDL|cholesterol|lipids?|hyperlipidemia|dyslipidemia|HLD|ApoB|ASCVD)\b/i,
  hcm: /\b(HCM|hypertrophic cardiomyopathy|septal thickness|LVOT gradient|mavacamten|aficamten)\b/i,
  attr: /\b(amyloid\w*|ATTR|tafamidis|acoramidis|PYP)\b/i,
  cardioonc: /\b(anthracycline|doxorubicin|trastuzumab|HER2|checkpoint inhibitor|pembrolizumab|nivolumab|chemo\w*|cardio-?oncology|ibrutinib)\b/i,
  aorta: /\b(aortic (root|aneurysm|dilation|dilatation)|ascending aort\w*|thoracic aort\w*|TAA)\b/i,
  syncope: /\b(syncope|syncopal|passed out|fainted|fainting|loss of consciousness)\b/i,
  pa: /\b(aldosteron\w*|renin|ARR|hyperaldosteronism)\b/i,
  periop: /\b(pre-?op\w*|perioperative|surgery|surgical clearance|upcoming (procedure|operation))\b/i,
};

/** Modules whose topic the note mentions, in the app's module order. */
export function detectModulesLocal(text: string): string[] {
  const hit = new Set(MODULES.map((m) => m.id).filter((id) => DETECT[id]?.test(text)));
  // A CAC score already covers lipid goals; add ASCVD only for secondary prevention.
  if (hit.has("cac") && hit.has("ascvd") && !/\b(ASCVD|prior MI|history of MI|PCI|CABG|stent|ischemic stroke|PAD)\b/i.test(text)) hit.delete("ascvd");
  // HCM / amyloid mentions also match "cardiomyopathy"; keep HF only when HF is named.
  if ((hit.has("hcm") || hit.has("attr")) && !/\b(heart failure|HFrEF|HFpEF|HFmrEF|CHF)\b/i.test(text)) hit.delete("hf");
  return MODULES.map((m) => m.id).filter((id) => hit.has(id));
}

// ---------------------------------------------------------------- facts

type Facts = Record<string, string>;

const NUM = String.raw`(\d{1,4}(?:\.\d+)?)`;
const SEP = String.raw`\s*(?:score\s*)?(?:of|is|was|at|=|:|-)?\s*`;

function grab(text: string, label: string, unit = ""): number | null {
  const m = new RegExp(String.raw`\b(?:${label})${SEP}${NUM}\s*${unit}`, "i").exec(text);
  return m ? Number(m[1]) : null;
}

/** True/false/undefined for a condition, honoring nearby negation. */
function flag(text: string, term: RegExp): boolean | undefined {
  const re = new RegExp(term.source, "gi");
  let m: RegExpExecArray | null;
  let found: boolean | undefined;
  while ((m = re.exec(text))) {
    const before = text.slice(Math.max(0, m.index - 40), m.index);
    const clause = before.split(/[.;,\n]|\bbut\b/).pop() ?? "";
    const neg = /\b(no|denies|denied|without|negative for|not|never|absent|free of|rule out|r\/o)\b/i.test(clause);
    if (!neg) return true;
    found = false;
  }
  return found;
}

const STATIN_DOSE: [RegExp, (mg: number) => "low" | "moderate" | "high"][] = [
  [/\b(atorvastatin|lipitor)\s*(\d+)?/i, (mg) => (mg >= 40 ? "high" : mg >= 10 ? "moderate" : "low")],
  [/\b(rosuvastatin|crestor)\s*(\d+)?/i, (mg) => (mg >= 20 ? "high" : mg >= 5 ? "moderate" : "low")],
  [/\b(simvastatin|zocor)\s*(\d+)?/i, (mg) => (mg >= 20 ? "moderate" : "low")],
  [/\b(pravastatin|pravachol)\s*(\d+)?/i, (mg) => (mg >= 40 ? "moderate" : "low")],
  [/\b(lovastatin)\s*(\d+)?/i, (mg) => (mg >= 40 ? "moderate" : "low")],
  [/\b(pitavastatin|livalo)\s*(\d+)?/i, (mg) => (mg >= 2 ? "moderate" : "low")],
  [/\b(fluvastatin)\s*(\d+)?/i, (mg) => (mg >= 80 ? "moderate" : "low")],
];

const OAC: [RegExp, string][] = [
  [/\b(apixaban|eliquis)\b/i, "apixaban"], [/\b(rivaroxaban|xarelto)\b/i, "rivaroxaban"], [/\b(dabigatran|pradaxa)\b/i, "dabigatran"],
  [/\b(edoxaban|savaysa)\b/i, "edoxaban"], [/\b(warfarin|coumadin|jantoven)\b/i, "warfarin"],
];

const HTN_CLASS: [RegExp, string][] = [
  [/\b(lisinopril|enalapril|ramipril|benazepril|quinapril|captopril|perindopril|losartan|valsartan|olmesartan|irbesartan|candesartan|telmisartan|azilsartan|ACE ?i|ACE inhibitor|ARB|entresto|sacubitril)\b/i, "acei_arb"],
  [/\b(amlodipine|nifedipine|felodipine|nicardipine|isradipine)\b/i, "ccb"],
  [/\b(HCTZ|hydrochlorothiazide|chlorthalidone|indapamide|thiazide)\b/i, "thiazide"],
  [/\b(spironolactone|eplerenone|aldactone)\b/i, "mra"],
  [/\b(metoprolol|carvedilol|bisoprolol|atenolol|nebivolol|propranolol|labetalol|beta[- ]?blocker)\b/i, "bb"],
  [/\b(clonidine|hydralazine|doxazosin|terazosin|prazosin|minoxidil|methyldopa)\b/i, "other"],
];

/** Common facts as raw strings keyed by the modules' shared field keys. */
export function localFacts(raw: string): Facts {
  const text = raw.replace(/\s+/g, " ");
  const f: Facts = {};
  const put = (k: string, v: number | string | boolean | null | undefined) => {
    if (v === null || v === undefined || (typeof v === "number" && !Number.isFinite(v))) return;
    f[k] = String(v);
  };

  // Age and sex: "68-year-old man", "68 yo F", "68M", "68 y/o female"
  const as = /\b(\d{2,3})\s*(?:-|\s)?\s*(?:years?[- ]old|yo|y\/o|y\.o\.|yrs?[- ]old)?\s*(?:-|\s)?\s*(male|female|man|woman|gentleman|lady|M|F)\b/i.exec(text)
    ?? /\b(\d{2,3})\s*(?:-|\s)?\s*(?:years?[- ]old|yo|y\/o|y\.o\.|yrs?[- ]old)\b/i.exec(text);
  if (as) {
    const age = Number(as[1]);
    if (age >= 18 && age <= 110) put("age", age);
    const s = as[2]?.toLowerCase();
    if (s) put("sex", /^(f|female|woman|lady)$/.test(s) ? "female" : "male");
  }
  if (!f.sex) {
    if (/\b(woman|female|lady|she|her)\b/i.test(text)) put("sex", "female");
    else if (/\b(man|male|gentleman|he|his)\b/i.test(text)) put("sex", "male");
  }

  // Calcium score
  const cac = grab(text, String.raw`CAC|calcium score|coronary (?:artery )?calcium(?: score)?|agatston(?: score)?`);
  put("cac", cac);
  const pctile = /\b(\d{1,2})(?:st|nd|rd|th)\s*(?:percentile|%ile)/i.exec(text);
  if (pctile) put("percentile", Number(pctile[1]));

  // Blood pressure
  const bp = /\b(?:BP|blood pressure)\s*(?:is|of|was|=|:|averag\w*|today)?\s*(\d{2,3})\s*\/\s*(\d{2,3})/i.exec(text)
    ?? /\b(\d{2,3})\s*\/\s*(\d{2,3})\s*(?:mm ?Hg)?\b/i.exec(text);
  if (bp) {
    const s = Number(bp[1]), d = Number(bp[2]);
    if (s >= 70 && s <= 260 && d >= 30 && d <= 160 && s > d) { put("sbp", s); put("dbp", d); }
  }
  if (/\b(home|ambulatory) (BP|blood pressure|readings)\b/i.test(text)) put("bpSource", /ambulatory|ABPM/i.test(text) ? "abpm" : "home");
  else if (/\bABPM\b/.test(text)) put("bpSource", "abpm");

  put("hr", grab(text, String.raw`HR|heart rate|pulse|resting HR|ventricular rate`));
  const ef = /\b(?:LVEF|EF|ejection fraction)\s*(?:of|is|was|=|:)?\s*(\d{1,2})\s*(?:(?:-|to)\s*(\d{1,2}))?\s*%?/i.exec(text);
  if (ef) put("ef", ef[2] ? (Number(ef[1]) + Number(ef[2])) / 2 : Number(ef[1]));

  // Labs
  put("ldl", grab(text, String.raw`LDL(?:-C)?`));
  put("hdl", grab(text, String.raw`HDL(?:-C)?`));
  put("totalChol", grab(text, String.raw`TC|total chol(?:esterol)?`));
  put("tg", grab(text, String.raw`TG|triglycerides?`));
  const lpa = /\bLp\s*\(?a\)?\s*(?:of|is|was|=|:)?\s*(\d{1,4}(?:\.\d+)?)\s*(nmol|mg)?/i.exec(text);
  if (lpa) { put("lpa", Number(lpa[1])); if (lpa[2]) put("lpaUnit", lpa[2].toLowerCase() === "nmol" ? "nmol/L" : "mg/dL"); }
  put("egfr", grab(text, String.raw`eGFR|GFR`));
  put("creatinine", grab(text, String.raw`Cr|creatinine|creat`));
  const k = grab(text, String.raw`K\+?|potassium`);
  if (k != null && k >= 2 && k <= 7.5) put("k", k);
  put("uacr", grab(text, String.raw`UACR|urine albumin(?:[- /]to[- /]creatinine)?(?: ratio)?|microalbumin`));
  put("bmi", grab(text, "BMI"));
  put("ntprobnp", grab(text, String.raw`NT-?pro-?BNP|proBNP`));
  const wt = /\b(?:weight|weighs|wt)?\s*(\d{2,3}(?:\.\d+)?)\s*(kg|kilograms?|lbs?|pounds)\b/i.exec(text);
  if (wt) put("weightKg", Math.round((/^k/i.test(wt[2]) ? Number(wt[1]) : Number(wt[1]) / 2.205) * 10) / 10);

  // Conditions (negation-aware)
  const cond: [string, RegExp][] = [
    ["diabetes", /\b(diabetes|diabetic|T2DM|T1DM|DM2|DM|NIDDM|IDDM)\b/],
    ["htn", /\b(HTN|hypertension|hypertensive)\b/],
    ["chf", /\b(heart failure|HFrEF|HFpEF|HFmrEF|CHF)\b/],
    ["stroke", /\b(stroke|TIA|CVA|transient ischemic attack)\b/],
    ["osa", /\b(OSA|sleep apnea)\b/],
    ["cad", /\b(CAD|coronary artery disease|prior MI|history of MI|PCI|CABG|stents?)\b/],
    ["fhxPremature", /\b(family history of (premature )?(CAD|MI|heart attack|heart disease|ASCVD|coronary disease)|FHx (of )?(premature )?(CAD|MI|ASCVD))\b/],
    ["dialysis", /\b(dialysis|ESRD)\b/],
    ["bleedRisk", /\b(high bleeding risk|prior (GI |major )?bleed\w*|GI bleed\w*)\b/],
  ];
  for (const [key, re] of cond) {
    const v = flag(text, re);
    if (v !== undefined) put(key, v);
  }
  if (f.chf === "true") put("hf", true);
  if (f.cad === "true") put("vascular", true);

  // Smoking
  if (/\b(non-?smoker|never smok\w*|former smoker|ex-?smoker|quit smoking|denies (tobacco|smoking))\b/i.test(text)) put("smoker", false);
  else if (/\b(current(ly)? smok\w*|smokes|active smoker|smoker|tobacco use|\d+ (pack|ppd))\b/i.test(text)) put("smoker", true);

  // AF details
  const afType = /\b(paroxysmal|persistent|long-?standing persistent|permanent)\b/i.exec(text);
  if (afType) put("afType", /long/i.test(afType[1]) ? "longstanding" : afType[1].toLowerCase());
  else if (/\bPAF\b/.test(text)) put("afType", "paroxysmal");
  if (/\basymptomatic\b/i.test(text)) put("symptomatic", false);
  else if (/\b(palpitations|symptomatic|fatigue with AF|dyspnea with AF)\b/i.test(text)) put("symptomatic", true);
  for (const [re, drug] of OAC) {
    const m = re.exec(text);
    if (!m) continue;
    if (flag(text, re) === false) { put("oac", "none"); break; }
    put("oac", drug);
    const dose = new RegExp(re.source + String.raw`\s*(\d+(?:\.\d+)?)\s*(?:mg)?`, "i").exec(text);
    if (dose && drug !== "warfarin") put("oacDose", Number(dose[2]));
    break;
  }
  if (!f.oac && /\b(not on (an )?anticoag\w*|no anticoag\w*|off anticoag\w*)\b/i.test(text)) put("oac", "none");
  const rate: string[] = [];
  if (/\b(metoprolol|carvedilol|bisoprolol|atenolol|nebivolol|beta[- ]?blocker)\b/i.test(text)) rate.push("bb");
  if (/\b(diltiazem|verapamil|cardizem)\b/i.test(text)) rate.push("ccb");
  if (/\b(digoxin)\b/i.test(text)) rate.push("digoxin");
  if (/\b(amiodarone|flecainide|propafenone|sotalol|dofetilide|dronedarone|multaq)\b/i.test(text)) rate.push("aad");
  if (rate.length) put("rate", rate.join(","));
  if (/\b(prior|s\/p|status post|history of) (AF |PVI )?ablation\b/i.test(text)) put("ablation", true);
  if (/\b(dronedarone|verapamil|ketoconazole)\b/i.test(text)) put("pgp", true);

  // Statin and aspirin
  if (/\b(no statin|not on (a )?statin|statin[- ]naive|off statin|declined statin|statin intoleran\w*)\b/i.test(text)) put("statin", "none");
  else {
    for (const [re, intensity] of STATIN_DOSE) {
      const m = re.exec(text);
      if (m) { put("statin", m[2] ? intensity(Number(m[2])) : "moderate"); break; }
    }
  }
  const asa = flag(text, /\b(aspirin|ASA|baby aspirin)\b/);
  if (asa !== undefined) put("aspirin", asa);

  // BP medication classes
  const meds = HTN_CLASS.filter(([re]) => re.test(text)).map(([, c]) => c);
  if (meds.length) { put("meds", meds.join(",")); put("bpTx", true); }
  else if (/\b(untreated|no (BP|blood pressure|antihypertensive) med\w*|not on (any )?(BP|blood pressure|antihypertensive) med\w*)\b/i.test(text)) put("bpTx", false);

  return f;
}

/** Fit raw facts into one module's fields, dropping values the module can't take. */
export function factsForModule(m: ClinicalModule, facts: Facts): Inputs {
  const out: Inputs = {};
  for (const fd of m.fields) {
    let raw = facts[fd.key];
    if (raw === undefined) continue;
    // A module-specific "meds" list only means BP drug classes in the HTN module.
    if (fd.key === "meds" && m.id !== "htn") continue;
    if (fd.key === "statin" && fd.type === "select" && !fd.options.some((o) => o.value === raw)) raw = raw === "none" ? "none" : "moderate";
    const v = coerce(fd, raw);
    if (v !== undefined) out[fd.key] = v;
  }
  return out;
}

export function localExtract(text: string, ids: string[]): Record<string, Inputs> {
  const facts = localFacts(text);
  const out: Record<string, Inputs> = {};
  for (const id of ids) {
    const m = MODULES.find((x) => x.id === id);
    if (m) out[id] = factsForModule(m, facts);
  }
  return out;
}
