// AHA PREVENT equations (Khan SS et al. Circulation 2024;149:430-449,
// doi:10.1161/CIRCULATIONAHA.123.067626), including the 2026-10-14 HbA1c erratum.
// Coefficients exported from the open-source `preventr` R package (sysdata.rda).
// Valid for ages 30-79 without known ASCVD.
import coef from "./prevent_coef.json";

export type PreventModel = "base" | "uacr" | "hba1c";
export type PreventOutcome = "ascvd" | "total_cvd" | "heart_failure";

export interface PreventInput {
  age: number;
  sex: "female" | "male";
  totalChol: number; // mg/dL
  hdl: number; // mg/dL
  sbp: number;
  bpTx: boolean;
  statin: boolean;
  diabetes: boolean;
  smoker: boolean;
  egfr: number;
  bmi: number;
  uacr?: number | null; // mg/g
  hba1c?: number | null; // %
}

export interface PreventResult {
  model: PreventModel;
  tenYear: Record<PreventOutcome, number>; // percent
  thirtyYear: Record<PreventOutcome, number> | null; // percent, null if age > 59
  warnings: string[];
}

const MGDL_TO_MMOL = 0.02586;

type CoefTable = Record<string, number>;
type CoefJson = Record<PreventModel, Record<"10yr" | "30yr", Record<"female" | "male", Record<PreventOutcome, CoefTable>>>>;
const C = coef as unknown as CoefJson;

export function preventValidity(i: PreventInput): string[] {
  const w: string[] = [];
  if (i.age < 30 || i.age > 79) w.push("PREVENT is validated for ages 30-79");
  if (i.totalChol < 130 || i.totalChol > 320) w.push("Total cholesterol outside PREVENT range (130-320 mg/dL)");
  if (i.hdl < 20 || i.hdl > 100) w.push("HDL outside PREVENT range (20-100 mg/dL)");
  if (i.sbp < 90 || i.sbp > 180) w.push("SBP outside PREVENT range (90-180 mmHg)");
  if (i.bmi < 18.5 || i.bmi > 39.9) w.push("BMI outside PREVENT range (18.5-39.9)");
  if (i.egfr < 15 || i.egfr > 140) w.push("eGFR outside PREVENT range (15-140)");
  return w;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

function terms(i: PreventInput, model: PreventModel): Record<string, number> {
  // Clamp to the validated range so out-of-range inputs still return a bounded
  // estimate (flagged with a warning by preventValidity).
  const age = (clamp(i.age, 30, 79) - 55) / 10;
  const tc = clamp(i.totalChol, 130, 320);
  const hdlMg = clamp(i.hdl, 20, 100);
  const sbpV = clamp(i.sbp, 90, 180);
  const bmiV = clamp(i.bmi, 18.5, 39.9);
  const egfrV = clamp(i.egfr, 15, 140);
  const nonHdl = (tc - hdlMg) * MGDL_TO_MMOL - 3.5;
  const hdl = (hdlMg * MGDL_TO_MMOL - 1.3) / 0.3;
  const sbpLt = (Math.min(sbpV, 110) - 110) / 20;
  const sbpGe = (Math.max(sbpV, 110) - 130) / 20;
  const dm = i.diabetes ? 1 : 0;
  const smk = i.smoker ? 1 : 0;
  const bmiLt = (Math.min(bmiV, 30) - 25) / 5;
  const bmiGe = (Math.max(bmiV, 30) - 30) / 5;
  const egfrLt = (Math.min(egfrV, 60) - 60) / -15;
  const egfrGe = (Math.max(egfrV, 60) - 90) / -15;
  const bp = i.bpTx ? 1 : 0;
  const st = i.statin ? 1 : 0;

  const t: Record<string, number> = {
    "Age per 10 years": age,
    "Age per 10 years squared": age * age,
    "non-HDL-C per 1 mmol/L": nonHdl,
    "HDL-C per 0.3 mmol/L": hdl,
    "SBP <110 per 20 mmHg": sbpLt,
    "SBP ≥110 per 20 mmHg": sbpGe,
    Diabetes: dm,
    "Current smoking": smk,
    "BMI <30, per 5 kg/m2": bmiLt,
    "BMI 30+, per 5 kg/m2": bmiGe,
    "eGFR <60, per -15 ml": egfrLt,
    "eGFR 60+, per -15 ml": egfrGe,
    "Anti-hypertensive use": bp,
    "Statin use": st,
    "Treated SBP ≥110 mm Hg per 20 mm Hg": bp * sbpGe,
    "Treated non-HDL-C": st * nonHdl,
    "Age per 10yr * non-HDL-C per 1 mmol/L": age * nonHdl,
    "Age per 10yr * HDL-C per 0.3 mmol/L": age * hdl,
    "Age per 10yr * SBP ≥110 mm Hg per 20 mmHg": age * sbpGe,
    "Age per 10yr * diabetes": age * dm,
    "Age per 10yr * current smoking": age * smk,
    "Age per 10yr * BMI 30+ per 5 kg/m2": age * bmiGe,
    "Age per 10yr * eGFR <60, per -15 ml": age * egfrLt,
    Constant: 1,
  };
  if (model === "uacr") {
    t["ln-UACR, mg/g, per 1 ln unit"] = Math.log(Math.max(i.uacr ?? 1, 0.1));
    t["Missing UACR/PCR/Dipstick"] = 0;
  }
  if (model === "hba1c") {
    const a = i.hba1c ?? 5.3;
    t["HbA1c no DM, per 1%"] = i.diabetes ? 0 : a - 5.3;
    t["HbA1c in DM, per 1%"] = i.diabetes ? a - 5.3 : 0;
    t["Missing HbA1c"] = 0;
  }
  return t;
}

function logistic(table: CoefTable, t: Record<string, number>): number {
  let lo = 0;
  for (const [name, beta] of Object.entries(table)) {
    if (beta === 0) continue;
    const x = t[name];
    if (x === undefined) throw new Error(`PREVENT term missing: ${name}`);
    lo += beta * x;
  }
  return (Math.exp(lo) / (1 + Math.exp(lo))) * 100;
}

export function calcPrevent(i: PreventInput): PreventResult {
  // Model choice: HbA1c and UACR are both validated add-ons; the published
  // calculator uses the "full" model when both are present. We use a single
  // add-on model (UACR preferred, as it carries more information) to avoid
  // needing ZIP-code SDI data.
  const model: PreventModel = i.uacr != null && i.uacr > 0 ? "uacr" : i.hba1c != null ? "hba1c" : "base";
  const t = terms(i, model);
  const outcomes: PreventOutcome[] = ["ascvd", "total_cvd", "heart_failure"];
  const ten = {} as Record<PreventOutcome, number>;
  for (const o of outcomes) {
    const tab = { ...C[model]["10yr"][i.sex][o] };
    delete tab["Age per 10 years squared"];
    ten[o] = logistic(tab, t);
  }
  let thirty: Record<PreventOutcome, number> | null = null;
  if (i.age <= 59) {
    thirty = {} as Record<PreventOutcome, number>;
    for (const o of outcomes) thirty[o] = logistic(C[model]["30yr"][i.sex][o], t);
  }
  return { model, tenYear: ten, thirtyYear: thirty, warnings: preventValidity(i) };
}

export function preventCategory(tenYearAscvd: number): "low" | "borderline" | "intermediate" | "high" {
  if (tenYearAscvd < 3) return "low";
  if (tenYearAscvd < 5) return "borderline";
  if (tenYearAscvd < 10) return "intermediate";
  return "high";
}
