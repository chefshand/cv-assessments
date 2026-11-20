import type { ClinicalModule, FieldDef, Inputs, Metric, Recommendation, RuleResult } from "../types";
import { ageSex, arr, fmt, list, num, str, yes } from "../util";
import { cites } from "../citations";

// 2025 ACC Concise Clinical Guidance on ATTR-CM; nonbiopsy criteria (Gillmore
// 2016); NAC (Gillmore 2018) and Mayo (Grogan 2016) staging.

const FLAGS = [
  { value: "hfpef_lvh", label: "HFpEF with LV wall ≥12 mm", noun: "HFpEF with increased wall thickness" },
  { value: "carpal", label: "Bilateral carpal tunnel" },
  { value: "spinal", label: "Lumbar spinal stenosis" },
  { value: "biceps", label: "Biceps tendon rupture" },
  { value: "as", label: "Aortic stenosis (esp. low-flow, age >65)" },
  { value: "neuropathy", label: "Peripheral / autonomic neuropathy" },
  { value: "voltage", label: "Low voltage for wall thickness" },
  { value: "conduction", label: "Conduction disease / pacemaker" },
  { value: "bp_intolerance", label: "Intolerance of / falling-off antihypertensives" },
  { value: "troponin", label: "Persistently elevated troponin" },
];

const THERAPIES = [
  { value: "tafamidis", label: "Tafamidis" }, { value: "acoramidis", label: "Acoramidis" },
  { value: "vutrisiran", label: "Vutrisiran" }, { value: "patisiran", label: "Patisiran" }, { value: "eplontersen", label: "Eplontersen" },
];

const fields: FieldDef[] = [
  { key: "age", label: "Age", type: "number", unit: "y", section: "Patient" },
  { key: "sex", label: "Sex", type: "select", section: "Patient", options: [ { value: "female", label: "Female" }, { value: "male", label: "Male" } ] },
  { key: "nyha", label: "NYHA class", type: "select", section: "Patient", options: [ { value: "1", label: "I" }, { value: "2", label: "II" }, { value: "3", label: "III" }, { value: "4", label: "IV" } ] },
  { key: "flags", label: "Red flags", type: "multi", section: "Suspicion", options: FLAGS },
  { key: "wall", label: "LV wall thickness", type: "number", unit: "mm", section: "Suspicion" },
  { key: "kappa", label: "Free kappa", type: "number", unit: "mg/L", section: "Monoclonal screen", extractHint: "Convert mg/dL to mg/L (x10)." },
  { key: "lambda", label: "Free lambda", type: "number", unit: "mg/L", section: "Monoclonal screen" },
  { key: "flcRatio", label: "Kappa/lambda ratio", type: "number", step: 0.01, section: "Monoclonal screen", help: "Calculated if kappa and lambda entered." },
  { key: "ife", label: "Serum + urine immunofixation", type: "select", section: "Monoclonal screen", options: [ { value: "negative", label: "Both negative" }, { value: "positive", label: "Monoclonal protein" }, { value: "not_done", label: "Not done" } ] },
  { key: "pyp", label: "Tc-99m PYP/DPD/HMDP Perugini grade", type: "select", section: "Scintigraphy", options: [ { value: "0", label: "0" }, { value: "1", label: "1" }, { value: "2", label: "2" }, { value: "3", label: "3" }, { value: "not_done", label: "Not done" } ] },
  { key: "hcl", label: "H/CL ratio (1 h)", type: "number", step: 0.01, section: "Scintigraphy" },
  { key: "spect", label: "SPECT confirms myocardial (not blood-pool) uptake", type: "bool", section: "Scintigraphy" },
  { key: "biopsy", label: "Tissue biopsy", type: "select", section: "Scintigraphy", options: [ { value: "attr", label: "ATTR (typed)" }, { value: "al", label: "AL" }, { value: "negative", label: "Negative" }, { value: "not_done", label: "Not done" } ] },
  { key: "ttr", label: "TTR genotype", type: "select", section: "Genetics", options: [ { value: "wt", label: "Wild-type" }, { value: "v142i", label: "V142I (V122I)" }, { value: "other", label: "Other pathogenic variant" }, { value: "not_done", label: "Not done" } ] },
  { key: "ntprobnp", label: "NT-proBNP", type: "number", unit: "pg/mL", section: "Staging" },
  { key: "egfr", label: "eGFR", type: "number", unit: "mL/min/1.73m²", section: "Staging" },
  { key: "tnt", label: "Troponin T (conventional)", type: "number", unit: "ng/mL", step: 0.001, section: "Staging", extractHint: "hs-TnT in ng/L divide by 1000 to ng/mL." },
  { key: "therapy", label: "Current disease-modifying therapy", type: "multi", section: "Treatment", options: THERAPIES, extractHint: "Vyndamax/Vyndaqel → tafamidis; Attruby → acoramidis; Amvuttra → vutrisiran; Onpattro → patisiran; Wainua → eplontersen." },
  { key: "af", label: "Atrial fibrillation / flutter", type: "bool", section: "Treatment" },
  { key: "polyneuropathy", label: "ATTR polyneuropathy", type: "bool", section: "Treatment" },
];

const flagNoun = (f: string): string => {
  const x = FLAGS.find((y) => y.value === f) as { label: string; noun?: string } | undefined;
  if (!x) return f;
  if (x.noun) return x.noun;
  return x.label[0].toLowerCase() + x.label.slice(1).replace(/^aortic stenosis/, "aortic stenosis");
};

export function nacStage(ntprobnp: number, egfr: number): 1 | 2 | 3 {
  const a = ntprobnp > 3000, b = egfr < 45;
  return a && b ? 3 : a || b ? 2 : 1;
}
export function mayoStage(ntprobnp: number, tnt: number): 1 | 2 | 3 {
  return (1 + (ntprobnp > 3000 ? 1 : 0) + (tnt > 0.05 ? 1 : 0)) as 1 | 2 | 3;
}

export function evaluateAttr(v: Inputs): RuleResult {
  const recs: Recommendation[] = [];
  const metrics: Metric[] = [];
  const missing: string[] = [];
  const plan: string[] = [];
  const flags = arr(v, "flags");
  const egfr = num(v, "egfr");
  const k = num(v, "kappa"), l = num(v, "lambda");
  const ratio = num(v, "flcRatio") ?? (k != null && l != null && l > 0 ? k / l : null);
  const ckd = egfr != null && egfr < 60;
  const [lo, hi] = ckd ? [0.37, 3.1] : [0.26, 1.65];
  const ife = str(v, "ife");
  const pyp = str(v, "pyp");
  const grade = pyp && pyp !== "not_done" ? Number(pyp) : null;
  const biopsy = str(v, "biopsy");
  const ttr = str(v, "ttr");
  const therapy = arr(v, "therapy");
  const nyha = Number(str(v, "nyha") ?? "0");

  const flcAbnormal = ratio != null && (ratio < lo || ratio > hi);
  const flcDone = ratio != null;
  const monoclonal = flcAbnormal || ife === "positive";
  const monoDone = flcDone && ife != null && ife !== "not_done";
  if (ratio != null) metrics.push({ label: "κ/λ ratio", value: fmt(ratio, 2), note: `${flcAbnormal ? "abnormal" : "normal"} (${ckd ? "CKD range" : "ref"} ${lo}-${hi})` });
  if (grade != null) metrics.push({ label: "Scintigraphy", value: `Grade ${grade}`, note: num(v, "hcl") != null ? `H/CL ${fmt(num(v, "hcl")!, 2)}` : undefined });

  let dx: "attr" | "al_concern" | "pending" | "unlikely" | "biopsy_needed" = "pending";
  if (biopsy === "attr") dx = "attr";
  else if (biopsy === "al") dx = "al_concern";
  else if (monoclonal) dx = "al_concern";
  else if (monoDone && grade != null && grade >= 2 && v.spect !== false) dx = "attr";
  else if (monoDone && grade != null && grade <= 1) dx = flags.length >= 2 ? "biopsy_needed" : "unlikely";

  if (dx === "pending") {
    const order: string[] = [];
    if (!monoDone) order.push("serum free light chains with serum and urine immunofixation (always before or with scintigraphy)");
    if (grade == null) order.push("Tc-99m PYP (or DPD/HMDP) scintigraphy with SPECT");
    recs.push({ text: `${flags.length ? `Red flags (${list(flags.map(flagNoun))}). ` : ""}Diagnostic pathway: order ${list(order)}. Monoclonal testing comes first every time; scintigraphy alone can misdiagnose AL as ATTR.`, severity: "action", cite: ["attr2025", "gillmore2016"], cor: "1", ap: `Evaluate for cardiac amyloidosis with ${list(order)}` });
    plan.push(`obtain ${list(order)}`);
    if (grade != null && grade >= 2 && !monoDone) recs.push({ text: "Positive scintigraphy cannot be called ATTR-CM until a monoclonal process is excluded (FLC ratio and both immunofixations).", severity: "warning", cite: ["attr2025", "gillmore2016"], ap: "" });
  } else if (dx === "al_concern") {
    recs.push({ text: `${biopsy === "al" ? "Biopsy shows AL amyloid" : "Monoclonal protein present"}: urgent hematology referral${biopsy === "al" ? "" : "; tissue diagnosis with amyloid typing (mass spectrometry) is required, either endomyocardial biopsy or extracardiac (fat pad/bone marrow) with typing"}. Do not diagnose ATTR-CM from scintigraphy when a monoclonal protein is present (MGUS coexists in ~10-20% of older ATTR patients).`, severity: "urgent", cite: ["attr2025", "gillmore2016"], cor: "1", ap: biopsy === "al" ? "AL amyloidosis; urgent referral to hematology/amyloid program" : "Monoclonal protein detected; urgent hematology referral and tissue biopsy with amyloid typing to distinguish AL from ATTR" });
    plan.push("urgent hematology referral and tissue diagnosis");
  } else if (dx === "biopsy_needed") {
    recs.push({ text: "No monoclonal protein and grade 0-1 uptake, but suspicion remains: consider cardiac MRI (LGE, ECV) and endomyocardial biopsy; scintigraphy can be falsely negative in early disease and some TTR variants.", severity: "action", cite: ["attr2025"], ap: "Given persistent clinical suspicion despite low-grade scintigraphy, will obtain cardiac MRI and consider endomyocardial biopsy" });
    plan.push("cardiac MRI and consider endomyocardial biopsy");
  } else if (dx === "unlikely") {
    recs.push({ text: "No monoclonal protein and grade 0-1 uptake: ATTR-CM unlikely. Consider other causes of LVH/HFpEF; re-evaluate if new red flags.", severity: "info", cite: ["attr2025", "gillmore2016"], ap: "" });
    plan.push("ATTR-CM unlikely; evaluate alternative causes");
  }

  if (dx === "attr") {
    if (biopsy !== "attr") recs.push({ text: `Nonbiopsy diagnosis met: grade ${grade} myocardial uptake${v.spect === true ? " confirmed on SPECT" : " (confirm myocardial uptake on SPECT)"} with no monoclonal protein (specificity ~100%).`, severity: "info", cite: ["gillmore2016"], ap: "" });
    if (ttr == null || ttr === "not_done") {
      recs.push({ text: "TTR gene sequencing for all ATTR-CM patients regardless of age to distinguish wild-type from hereditary disease (1); genetic counseling and cascade testing of relatives if a variant is found.", severity: "action", cite: ["attr2025"], cor: "1", ap: "Send TTR genetic testing with genetic counseling" });
      plan.push("TTR genetic testing");
    } else if (ttr !== "wt") recs.push({ text: `Hereditary ATTR (${ttr === "v142i" ? "V142I" : "pathogenic variant"}): genetic counseling, cascade testing of first-degree relatives, and neurology assessment for polyneuropathy.`, severity: "action", cite: ["attr2025"], ap: "Genetic counseling with cascade testing of relatives and neurology assessment for polyneuropathy" });

    // Staging
    const nt = num(v, "ntprobnp");
    const tnt = num(v, "tnt");
    if (nt != null && egfr != null) {
      const s = nacStage(nt, egfr);
      metrics.push({ label: "NAC stage", value: ["", "I", "II", "III"][s], note: `median survival ~${["", "69", "47", "24"][s]} mo` });
    } else missing.push("NT-proBNP and eGFR (NAC stage)");
    if (nt != null && tnt != null && (ttr === "wt" || ttr == null)) {
      const s = mayoStage(nt, tnt);
      metrics.push({ label: "Mayo stage (ATTRwt)", value: ["", "I", "II", "III"][s], note: `median survival ~${["", "66", "40", "20"][s]} mo` });
    }

    // Therapy
    const stabilizer = therapy.includes("tafamidis") || therapy.includes("acoramidis");
    const silencer = therapy.some((t) => ["vutrisiran", "patisiran", "eplontersen"].includes(t));
    if (!stabilizer && !silencer) {
      const pn = yes(v, "polyneuropathy") && ttr !== "wt";
      recs.push({ text: `Start disease-modifying therapy without delay: ${pn ? "a TTR silencer is preferred given ATTRv with polyneuropathy (vutrisiran 25 mg SC every 3 months)" : "tafamidis 61 mg daily, acoramidis 712 mg BID, or vutrisiran 25 mg SC every 3 months"}; choose by access, cost, payer requirements and patient preference.${nyha === 4 ? " Trials enrolled NYHA I-III; benefit in NYHA IV is uncertain, so individualize." : ""}`, severity: "action", cite: ["attr2025"], cor: "1", ap: pn ? "Start vutrisiran given hereditary ATTR with polyneuropathy" : "Start disease-modifying therapy (tafamidis, acoramidis or vutrisiran, based on access and preference)" });
      plan.push("start disease-modifying ATTR therapy");
    } else {
      if (stabilizer && silencer) recs.push({ text: "Stabilizer plus silencer: routine combination therapy is not recommended (no trial evidence of benefit).", severity: "warning", cite: ["attr2025"], ap: "" });
      plan.push(`continue ${list(therapy)}`);
      recs.push({ text: "Monitor response clinically (symptoms, functional class, diuretic needs, NT-proBNP/troponin, echo); there are no formal response or failure criteria.", severity: "info", cite: ["attr2025"], ap: "" });
    }

    // Supportive care
    recs.push({ text: "HF care in amyloid: loop diuretics for congestion (careful titration); SGLT2i and MRA can be considered. Use beta-blockers and vasodilators cautiously (fixed stroke volume); avoid verapamil/diltiazem; digoxin only with caution.", severity: "info", cite: ["attr2025", "hf2022"], ap: "Cautious use of beta-blockers and vasodilators; avoid non-dihydropyridine calcium channel blockers" });
    if (yes(v, "af")) recs.push({ text: "AF with cardiac amyloidosis: anticoagulation is reasonable regardless of CHA₂DS₂-VASc (2a).", severity: "action", cite: ["hf2022", "attr2025"], cor: "2a", ap: "Anticoagulate for atrial fibrillation regardless of CHA2DS2-VASc" });
    if (flags.includes("conduction")) recs.push({ text: "Conduction disease is common; low threshold for ambulatory monitoring and pacing per standard indications.", severity: "info", cite: ["attr2025"], ap: "" });
    plan.push("follow-up every 3-6 months with NT-proBNP, troponin and periodic echocardiography");
  }

  const headline = dx === "attr" ? `ATTR-CM ${ttr === "wt" ? "(wild-type)" : ttr && ttr !== "not_done" ? "(hereditary)" : "confirmed"}: start/continue disease-modifying therapy`
    : dx === "al_concern" ? "Monoclonal protein: rule out AL urgently"
    : dx === "biopsy_needed" ? "Suspicion persists: CMR ± endomyocardial biopsy"
    : dx === "unlikely" ? "ATTR-CM unlikely" : "Suspected amyloid: light chains + scintigraphy";

  const apExtra = recs.filter((r) => r.ap).map((r) => r.ap!.replace(/\.$/, ""));
  const ap = [
    `${dx === "attr" ? `Transthyretin amyloid cardiomyopathy${ttr === "wt" ? " (wild-type)" : ttr === "v142i" ? " (hereditary, V142I)" : ttr === "other" ? " (hereditary)" : ""}` : dx === "unlikely" ? "Evaluation for cardiac amyloidosis" : "Suspected cardiac amyloidosis"}: ${ageSex(v)}${nyha ? `, NYHA class ${["", "I", "II", "III", "IV"][nyha]}` : ""}${flags.length ? `, with ${list(flags.map(flagNoun))}` : ""}${num(v, "wall") != null ? `, LV wall ${fmt(num(v, "wall")!, 0)} mm` : ""}${ratio != null ? `; kappa/lambda ratio ${fmt(ratio, 2)} (${flcAbnormal ? "abnormal" : "normal"})` : ""}${ife && ife !== "not_done" ? `, immunofixation ${ife}` : ""}${grade != null ? `; technetium scintigraphy grade ${grade}` : ""}.${metrics.find((m) => m.label === "NAC stage") ? ` NAC stage ${metrics.find((m) => m.label === "NAC stage")!.value}.` : ""}`,
    `Per the 2025 ACC ATTR-CM guidance, plan: ${plan.join("; ")}.`,
    apExtra.length ? apExtra.join(". ") + "." : "",
  ].filter(Boolean).join(" ");

  return { headline, metrics, recommendations: recs, missing, ap };
}

export const attrModule: ClinicalModule = {
  id: "attr",
  title: "ATTR Cardiac Amyloidosis",
  short: "ATTR-CM",
  icon: "🧬",
  description: "Diagnostic pathway (light chains first, PYP grade, genetics), NAC/Mayo staging, tafamidis/acoramidis/vutrisiran choice and supportive care — 2025 ACC guidance.",
  placeholder: "e.g. 79M HFpEF, septum 16 mm, bilateral carpal tunnel, kappa 28 lambda 19, SPEP/UPEP IFE negative, PYP grade 3 with SPECT, eGFR 52, NT-proBNP 2400, NYHA II, TTR wild-type",
  fields,
  evaluate: evaluateAttr,
  citations: cites("attr2025", "gillmore2016", "nac2018", "hf2022"),
};
