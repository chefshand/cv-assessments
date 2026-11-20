// "What to dictate" checklist shown next to the free-text/voice box.
// A cue is satisfied when any of its keys has a value (or all of them when
// `all` is set). `core` cues drive the recommendation; the rest refine it.

export interface Cue {
  label: string;
  keys: string[];
  all?: boolean;
  core?: boolean;
}

export const CUES: Record<string, Cue[]> = {
  cac: [
    { label: "Age", keys: ["age"], core: true },
    { label: "Sex", keys: ["sex"], core: true },
    { label: "CAC score", keys: ["cac", "qualitative"], core: true },
    { label: "Percentile", keys: ["percentile"] },
    { label: "# vessels / LM", keys: ["vessels", "leftMain"] },
    { label: "Symptoms?", keys: ["symptoms"], core: true },
    { label: "LDL", keys: ["ldl"], core: true },
    { label: "Total chol", keys: ["totalChol"] },
    { label: "HDL", keys: ["hdl"] },
    { label: "SBP", keys: ["sbp"] },
    { label: "BP meds", keys: ["bpTx"] },
    { label: "Statin", keys: ["statin"], core: true },
    { label: "Diabetes", keys: ["diabetes"], core: true },
    { label: "Smoker", keys: ["smoker"], core: true },
    { label: "FHx premature ASCVD", keys: ["fhxPremature"], core: true },
    { label: "Lp(a)", keys: ["lpa"] },
    { label: "Race (MESA)", keys: ["race"] },
    { label: "Bleeding risk / aspirin", keys: ["bleedRisk", "aspirin"] },
    { label: "Prior CAC + years", keys: ["priorCac", "priorCacYears"], all: true },
  ],
  aorta: [
    { label: "Age", keys: ["age"], core: true },
    { label: "Sex", keys: ["sex"] },
    { label: "Max diameter", keys: ["diameter"], core: true },
    { label: "Root vs ascending", keys: ["segment"], core: true },
    { label: "Modality (TTE/CT/MRI)", keys: ["modality"], core: true },
    { label: "Height", keys: ["heightCm"], core: true },
    { label: "Weight", keys: ["weightKg"] },
    { label: "Prior size + when", keys: ["priorDiameter", "priorYears"], all: true, core: true },
    { label: "Prior modality", keys: ["priorModality"] },
    { label: "Etiology / valve (TAV, BAV, Marfan…)", keys: ["etiology"], core: true },
    { label: "FHx dissection / risk features", keys: ["riskFeatures"] },
    { label: "Other cardiac surgery planned", keys: ["concomitantSurgery"] },
    { label: "Symptoms", keys: ["symptoms"] },
    { label: "Genetic testing", keys: ["geneticTested"] },
  ],
  ascvd: [
    { label: "Age", keys: ["age"], core: true },
    { label: "Sex", keys: ["sex"], core: true },
    { label: "Prior ASCVD / events", keys: ["priorAscvd"], core: true },
    { label: "LDL", keys: ["ldl"], core: true },
    { label: "Total chol", keys: ["totalChol"], core: true },
    { label: "HDL", keys: ["hdl"], core: true },
    { label: "TG", keys: ["tg"] },
    { label: "SBP", keys: ["sbp"], core: true },
    { label: "BP meds", keys: ["bpTx"], core: true },
    { label: "Diabetes", keys: ["diabetes"], core: true },
    { label: "Smoker", keys: ["smoker"], core: true },
    { label: "eGFR", keys: ["egfr"], core: true },
    { label: "BMI", keys: ["bmi"], core: true },
    { label: "Current statin", keys: ["statin"], core: true },
    { label: "Ezetimibe / PCSK9", keys: ["ezetimibe", "pcsk9"] },
    { label: "Lp(a)", keys: ["lpa"] },
    { label: "ApoB", keys: ["apoB"] },
    { label: "CAC", keys: ["cac"] },
    { label: "FHx / risk enhancers", keys: ["enhancers"] },
    { label: "Untreated LDL", keys: ["baselineLdl"] },
    { label: "UACR / A1c", keys: ["uacr", "hba1c"] },
  ],
  pa: [
    { label: "Age", keys: ["age"] },
    { label: "Sex", keys: ["sex"] },
    { label: "Aldosterone (+unit)", keys: ["aldo"], core: true },
    { label: "Assay (LC-MS/MS?)", keys: ["aldoAssay"], core: true },
    { label: "Renin (PRA or DRC)", keys: ["renin"], core: true },
    { label: "Renin type", keys: ["reninType"], core: true },
    { label: "Potassium", keys: ["k"], core: true },
    { label: "Meds at time of draw", keys: ["meds"], core: true },
    { label: "Why tested (resistant HTN, low K…)", keys: ["clinical"] },
    { label: "eGFR", keys: ["egfr"] },
    { label: "Confirmatory test / CT", keys: ["confirmed", "ct"] },
    { label: "Surgery candidate", keys: ["surgeryCandidate"] },
  ],
  periop: [
    { label: "Age", keys: ["age"], core: true },
    { label: "Procedure", keys: ["surgeryType", "surgeryName"], core: true },
    { label: "Elective / urgent", keys: ["urgency"], core: true },
    { label: "Active symptoms (ACS, HF…)", keys: ["active"] },
    { label: "Functional capacity / stairs", keys: ["functional", "dasi"], core: true },
    { label: "CAD / IHD", keys: ["ihd"], core: true },
    { label: "Heart failure", keys: ["hf"], core: true },
    { label: "Stroke / TIA", keys: ["cvd"], core: true },
    { label: "Insulin", keys: ["insulin"], core: true },
    { label: "Creatinine", keys: ["creatinine"], core: true },
    { label: "BNP / NT-proBNP", keys: ["bnp", "ntprobnp"] },
    { label: "LVEF", keys: ["ef"] },
    { label: "Valve disease", keys: ["valve"] },
    { label: "Stent type + when", keys: ["stent"] },
    { label: "Antiplatelet", keys: ["p2y12"] },
    { label: "Anticoagulant", keys: ["anticoag"] },
    { label: "Bleeding risk of procedure", keys: ["procBleed"] },
    { label: "BB / statin / ACEi / SGLT2 / GLP-1", keys: ["meds"] },
    { label: "Pacemaker / ICD", keys: ["cied"] },
  ],
};

export function cueDone(c: Cue, inputs: Record<string, unknown>): boolean {
  const has = (k: string) => {
    const v = inputs[k];
    return v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);
  };
  return c.all ? c.keys.every(has) : c.keys.some(has);
}
