import type { ClinicalModule, FieldDef, Inputs, Metric, MultiField, Recommendation, RuleResult } from "../types";
import { arr, fmt, has, list, num, pct, str, yes, ageSex } from "../util";
import { calcPrevent, preventCategory, type PreventResult } from "../calc/prevent";
import { calcMesa, type MesaRace } from "../calc/mesa";
import { GOALS, lpaElevated, lpaText, stepsToGoal, stricter, type LipidGoal, type StatinIntensity } from "../lipids";
import { cites } from "../citations";

const SEX: FieldDef = {
  key: "sex", label: "Sex", type: "select", section: "Patient",
  options: [ { value: "female", label: "Female" }, { value: "male", label: "Male" } ],
};
const AGE: FieldDef = { key: "age", label: "Age", type: "number", unit: "y", min: 18, max: 100, section: "Patient" };
const RACE: FieldDef = {
  key: "race", label: "Race/ethnicity (MESA only)", type: "select", section: "Patient",
  help: "Used only by the MESA CHD score; PREVENT is race-free.",
  options: [
    { value: "white", label: "White" }, { value: "black", label: "Black" },
    { value: "hispanic", label: "Hispanic" }, { value: "chinese", label: "Chinese" },
    { value: "other", label: "Other" },
  ],
};

export const LIPID_FIELDS: FieldDef[] = [
  { key: "ldl", label: "LDL-C (current)", type: "number", unit: "mg/dL", section: "Lipids", extractHint: "Convert mmol/L to mg/dL by x38.67." },
  { key: "baselineLdl", label: "Untreated LDL-C (if known)", type: "number", unit: "mg/dL", section: "Lipids", help: "Pre-treatment LDL; used for % reduction and LDL ≥190 checks." },
  { key: "totalChol", label: "Total cholesterol", type: "number", unit: "mg/dL", section: "Lipids" },
  { key: "hdl", label: "HDL-C", type: "number", unit: "mg/dL", section: "Lipids" },
  { key: "tg", label: "Triglycerides", type: "number", unit: "mg/dL", section: "Lipids" },
  { key: "apoB", label: "ApoB", type: "number", unit: "mg/dL", section: "Lipids" },
  { key: "lpa", label: "Lp(a)", type: "number", section: "Lipids", extractHint: "Numeric value only; put the unit in lpaUnit." },
  { key: "lpaUnit", label: "Lp(a) unit", type: "select", section: "Lipids", options: [ { value: "mg/dL", label: "mg/dL" }, { value: "nmol/L", label: "nmol/L" } ] },
];

export const THERAPY_FIELDS: FieldDef[] = [
  {
    key: "statin", label: "Current statin", type: "select", section: "Current therapy",
    extractHint: "high = atorva 40-80 or rosuva 20-40; moderate = atorva 10-20, rosuva 5-10, simva 20-40, prava 40-80; low = lower doses.",
    options: [ { value: "none", label: "None" }, { value: "low", label: "Low" }, { value: "moderate", label: "Moderate" }, { value: "high", label: "High" } ],
  },
  { key: "ezetimibe", label: "On ezetimibe", type: "bool", section: "Current therapy" },
  { key: "pcsk9", label: "On PCSK9 mAb / inclisiran", type: "bool", section: "Current therapy" },
  { key: "bempedoic", label: "On bempedoic acid", type: "bool", section: "Current therapy" },
  { key: "statinIntolerant", label: "Statin intolerant", type: "bool", section: "Current therapy" },
];

const fields: FieldDef[] = [
  AGE, SEX, RACE,
  { key: "priorAscvd", label: "Clinical ASCVD", type: "bool", section: "History", help: "MI/ACS, stable angina with CAD, revascularization, ischemic stroke/TIA, or symptomatic PAD." },
  {
    key: "ascvdEvents", label: "Major ASCVD events", type: "multi", section: "History", showIf: (v) => v.priorAscvd === true,
    options: [
      { value: "recent_acs", label: "ACS < 12 mo" }, { value: "mi", label: "Prior MI (other than above)" },
      { value: "stroke", label: "Ischemic stroke" }, { value: "pad", label: "Symptomatic PAD" },
    ],
  },
  { key: "eventCount", label: "Total # major events (if >1 of a type)", type: "number", section: "History", showIf: (v) => v.priorAscvd === true },
  { key: "priorRevasc", label: "Prior PCI/CABG", type: "bool", section: "History" },
  { key: "heartFailure", label: "Heart failure", type: "bool", section: "History" },
  { key: "diabetes", label: "Diabetes", type: "bool", section: "Risk factors" },
  { key: "smoker", label: "Current smoker", type: "bool", section: "Risk factors" },
  { key: "sbp", label: "Systolic BP", type: "number", unit: "mmHg", section: "Risk factors" },
  { key: "bpTx", label: "On BP medication", type: "bool", section: "Risk factors" },
  { key: "bmi", label: "BMI", type: "number", unit: "kg/m²", section: "Risk factors" },
  { key: "egfr", label: "eGFR", type: "number", unit: "mL/min/1.73m²", section: "Risk factors" },
  { key: "uacr", label: "UACR (optional)", type: "number", unit: "mg/g", section: "Risk factors" },
  { key: "hba1c", label: "HbA1c (optional)", type: "number", unit: "%", section: "Risk factors" },
  { key: "heFH", label: "Heterozygous FH", type: "bool", section: "Risk factors" },
  {
    key: "enhancers", label: "Risk enhancers", type: "multi", section: "Risk factors",
    options: [
      { value: "fhx_premature", label: "FHx premature ASCVD" },
      { value: "south_asian", label: "South Asian ancestry" },
      { value: "inflammatory", label: "Chronic inflammatory dz (RA, psoriasis, lupus)" },
      { value: "hiv", label: "HIV" },
      { value: "preeclampsia", label: "Preeclampsia/HDP" },
      { value: "premature_menopause", label: "Premature menopause (<40)" },
      { value: "metabolic_syndrome", label: "Metabolic syndrome" },
      { value: "cancer", label: "Cancer / cancer history" },
    ],
  },
  { key: "hscrp", label: "hs-CRP", type: "number", unit: "mg/L", section: "Risk factors" },
  ...LIPID_FIELDS,
  { key: "cac", label: "CAC score", type: "number", unit: "AU", section: "Imaging" },
  ...THERAPY_FIELDS,
];

// ---------------------------------------------------------------------------

export interface AscvdAssessment {
  category: string;
  goal: LipidGoal | null;
  statinIndicated: boolean | "consider" | "defer";
  prevent: PreventResult | null;
  veryHigh: boolean;
}

function highRiskConditions(v: Inputs): string[] {
  const out: string[] = [];
  const age = num(v, "age");
  if (age != null && age >= 65) out.push("age ≥65");
  if (yes(v, "heFH")) out.push("HeFH");
  if (yes(v, "priorRevasc")) out.push("prior PCI/CABG");
  if (yes(v, "diabetes")) out.push("diabetes");
  if (yes(v, "bpTx") || (num(v, "sbp") ?? 0) >= 130) out.push("hypertension");
  const egfr = num(v, "egfr");
  if (egfr != null && egfr >= 15 && egfr < 60) out.push("CKD (eGFR 15-59)");
  if (yes(v, "smoker")) out.push("current smoking");
  if (yes(v, "heartFailure")) out.push("heart failure");
  return out;
}

export function runPrevent(v: Inputs): { res: PreventResult | null; missing: string[] } {
  const need = ["age", "sex", "totalChol", "hdl", "sbp", "egfr", "bmi"];
  const missing = need.filter((k) => v[k] == null || v[k] === "");
  if (missing.length) return { res: null, missing };
  const sex = str(v, "sex") as "female" | "male";
  return {
    res: calcPrevent({
      age: num(v, "age")!, sex, totalChol: num(v, "totalChol")!, hdl: num(v, "hdl")!, sbp: num(v, "sbp")!,
      bpTx: yes(v, "bpTx"), statin: (str(v, "statin") ?? "none") !== "none", diabetes: yes(v, "diabetes"),
      smoker: yes(v, "smoker"), egfr: num(v, "egfr")!, bmi: num(v, "bmi")!, uacr: num(v, "uacr"), hba1c: num(v, "hba1c"),
    }),
    missing: [],
  };
}

export function runMesa(v: Inputs) {
  const need = ["age", "sex", "totalChol", "hdl", "sbp"];
  if (need.some((k) => v[k] == null)) return null;
  const race = (str(v, "race") ?? "white") as string;
  return calcMesa({
    age: num(v, "age")!, sex: str(v, "sex") as "female" | "male",
    race: (["white", "black", "chinese", "hispanic"].includes(race) ? race : "white") as MesaRace,
    diabetes: yes(v, "diabetes"), smoker: yes(v, "smoker"), totalChol: num(v, "totalChol")!, hdl: num(v, "hdl")!,
    lipidMed: (str(v, "statin") ?? "none") !== "none" || yes(v, "ezetimibe") || yes(v, "pcsk9"),
    sbp: num(v, "sbp")!, bpMed: yes(v, "bpTx"), familyHxMI: has(v, "enhancers", "fhx_premature"), cac: num(v, "cac"),
  });
}

export const cacGoal = (cac: number): LipidGoal | null =>
  cac >= 1000 ? GOALS.veryHigh : cac >= 100 ? GOALS.high : cac > 0 ? GOALS.moderate : null;

export function evaluateAscvd(v: Inputs): RuleResult {
  const recs: Recommendation[] = [];
  const metrics: Metric[] = [];
  const missing: string[] = [];
  const age = num(v, "age");
  const ldl = num(v, "ldl");
  const baseLdl = num(v, "baselineLdl");
  const tc = num(v, "totalChol");
  const hdl = num(v, "hdl");
  const tg = num(v, "tg");
  const apoB = num(v, "apoB");
  const cac = num(v, "cac");
  const lpa = num(v, "lpa");
  const lpaUnit = str(v, "lpaUnit");
  const egfr = num(v, "egfr");
  const statin = (str(v, "statin") ?? "none") as StatinIntensity;
  const onLipidTx = statin !== "none" || yes(v, "ezetimibe") || yes(v, "pcsk9") || yes(v, "bempedoic");
  const nonHdl = tc != null && hdl != null ? tc - hdl : null;
  const enh = arr(v, "enhancers");
  const lpaHigh = lpaElevated(lpa, lpaUnit);
  const crpHigh = (num(v, "hscrp") ?? 0) >= 2;
  const tgEnh = (tg ?? 0) >= 175;
  const enhOpts = (fields.find((f) => f.key === "enhancers") as MultiField).options;
  const enhancerList: string[] = [
    ...enh.map((e) => enhOpts.find((o) => o.value === e)?.label ?? e),
    ...(lpaHigh ? [`elevated Lp(a) (${lpaText(lpa!, lpaUnit)})`] : []),
    ...(crpHigh ? ["hs-CRP ≥2 mg/L"] : []),
    ...(tgEnh ? ["TG ≥175 mg/dL"] : []),
  ];

  let goal: LipidGoal | null = null;
  let category = "";
  let veryHigh = false;
  let statinPlan: "start" | "consider" | "defer" | "lifestyle" | null = null;
  let intensity: "moderate" | "high" | "moderate-to-high" = "moderate";
  const ctx: string[] = [];

  const hrc = highRiskConditions(v);

  // -------------------- Secondary prevention --------------------
  const prevent = !yes(v, "priorAscvd") ? runPrevent(v) : { res: null, missing: [] };
  if (yes(v, "priorAscvd")) {
    const events = arr(v, "ascvdEvents");
    const count = Math.max(events.length, num(v, "eventCount") ?? 0);
    veryHigh = count >= 2 || (count >= 1 && hrc.length >= 2);
    goal = veryHigh ? GOALS.veryHigh : GOALS.high;
    category = veryHigh ? "Very-high-risk clinical ASCVD" : "Clinical ASCVD (not very high risk)";
    intensity = "high";
    statinPlan = "start";
    ctx.push(
      veryHigh
        ? `very-high-risk clinical ASCVD (${count >= 2 ? `${count} major ASCVD events` : `1 major ASCVD event plus ${list(hrc)}`})`
        : "clinical ASCVD",
    );
    if (count === 0) missing.push("Which major ASCVD events (to classify very-high risk)");
    recs.push({
      text: veryHigh
        ? "Very-high-risk ASCVD: high-intensity/maximally tolerated statin with LDL-C goal <55 mg/dL and non-HDL-C <85 mg/dL; add ezetimibe and/or PCSK9 inhibitor if above goal (2a)."
        : "Clinical ASCVD: high-intensity statin to reduce LDL-C ≥50%; LDL-C goal <70 mg/dL (non-HDL-C <100), and the 2026 guideline favors <55 mg/dL for most secondary-prevention patients.",
      severity: "action", cite: ["lipid2026"], cor: veryHigh ? "1 / 2a" : "1", ap: "",
    });
  } else {
    // -------------------- Primary prevention --------------------
    const severe = (baseLdl ?? (onLipidTx ? null : ldl) ?? 0) >= 190 || yes(v, "heFH");
    if (severe) {
      goal = GOALS.moderate;
      category = yes(v, "heFH") ? "Familial hypercholesterolemia" : "Severe hypercholesterolemia (LDL-C ≥190)";
      intensity = "high";
      statinPlan = "start";
      ctx.push(yes(v, "heFH") ? "heterozygous familial hypercholesterolemia" : `severe primary hypercholesterolemia (untreated LDL-C ${baseLdl ?? ldl} mg/dL)`);
      recs.push({
        text: "LDL-C ≥190 mg/dL / FH: high-intensity statin without need for risk calculation, targeting ≥50% LDL-C reduction and LDL-C <100 mg/dL; add ezetimibe then PCSK9 inhibitor if above goal. Evaluate for FH (genetic testing) and cascade-screen first-degree relatives.",
        severity: "action", cite: ["lipid2026"], cor: "1",
        ap: "Given severe hypercholesterolemia, recommend genetic evaluation for familial hypercholesterolemia and cascade screening of first-degree relatives",
      });
    }
    // PREVENT
    if (prevent.res) {
      const p = prevent.res;
      const cat = preventCategory(p.tenYear.ascvd);
      metrics.push({ label: "PREVENT 10-yr ASCVD", value: pct(p.tenYear.ascvd), note: `${cat} risk (${p.model} model)` });
      metrics.push({ label: "PREVENT 10-yr total CVD", value: pct(p.tenYear.total_cvd) });
      metrics.push({ label: "PREVENT 10-yr HF", value: pct(p.tenYear.heart_failure) });
      if (p.thirtyYear) metrics.push({ label: "PREVENT 30-yr ASCVD", value: pct(p.thirtyYear.ascvd) });
      for (const w of p.warnings) recs.push({ text: w, severity: "warning", ap: "" });
      ctx.push(`PREVENT 10-year ASCVD risk ${pct(p.tenYear.ascvd)} (${cat})${p.thirtyYear ? `, 30-year ${pct(p.thirtyYear.ascvd)}` : ""}`);

      if (!severe) {
        category = `Primary prevention, ${cat} risk`;
        if (cat === "high") {
          goal = GOALS.high; statinPlan = "start"; intensity = "high";
          recs.push({ text: "PREVENT ≥10%: high-intensity statin to lower LDL-C ≥50% (1) with LDL-C goal <70 mg/dL (2a).", severity: "action", cite: ["lipid2026"], cor: "1 / 2a", ap: "" });
        } else if (cat === "intermediate") {
          goal = GOALS.moderate; statinPlan = "start"; intensity = "moderate-to-high";
          recs.push({ text: "PREVENT 5-<10% (intermediate): moderate- or high-intensity statin recommended after clinician-patient discussion; LDL-C goal <100 mg/dL. CAC can refine the decision if uncertain.", severity: "action", cite: ["lipid2026"], cor: "1", ap: "" });
        } else if (cat === "borderline") {
          goal = GOALS.moderate; statinPlan = enhancerList.length ? "start" : "consider"; intensity = "moderate";
          recs.push({ text: `PREVENT 3-<5% (borderline): moderate-intensity statin is reasonable (2a), particularly with risk enhancers${enhancerList.length ? ` (present: ${list(enhancerList)})` : ""}; LDL-C goal <100 mg/dL. CAC reasonable if decision uncertain.`, severity: "action", cite: ["lipid2026"], cor: "2a", ap: "" });
        } else {
          const ldlForRule = baseLdl ?? ldl;
          const thirty = p.thirtyYear?.ascvd ?? 0;
          if ((ldlForRule != null && ldlForRule >= 160) || thirty >= 10) {
            goal = GOALS.moderate; statinPlan = "consider"; intensity = "moderate";
            recs.push({ text: `PREVENT <3% but ${thirty >= 10 ? `30-year risk ${pct(thirty)} (≥10%)` : "LDL-C 160-189 mg/dL"}: moderate-intensity statin is reasonable (2a).`, severity: "action", cite: ["lipid2026"], cor: "2a", ap: "" });
          } else {
            statinPlan = "lifestyle";
            recs.push({ text: "PREVENT <3% with LDL-C <160 and 30-year risk <10%: heart-healthy lifestyle counseling; statin not routinely indicated.", severity: "info", cite: ["lipid2026"], cor: "1", ap: "" });
          }
        }
      }
    } else if (!severe) {
      missing.push(`PREVENT inputs: ${prevent.missing.join(", ")}`);
    }

    const mesa = runMesa(v);
    if (mesa) {
      metrics.push({ label: "MESA 10-yr CHD", value: pct(mesa.withCac ?? mesa.withoutCac), note: mesa.withCac != null ? `with CAC (without CAC: ${pct(mesa.withoutCac)})` : "without CAC" });
      if (mesa.withCac != null) ctx.push(`MESA 10-year CHD risk ${pct(mesa.withCac)} incorporating CAC`);
    }

    // Diabetes / CKD / special populations
    if (yes(v, "diabetes") && age != null && age >= 40 && age <= 75) {
      const dmHigh = (prevent.res && prevent.res.tenYear.ascvd >= 10) || hrc.length >= 3 || enhancerList.length > 0;
      goal = stricter(goal, dmHigh ? GOALS.high : GOALS.moderate);
      statinPlan = "start";
      if (dmHigh) intensity = "high";
      category = category || "Primary prevention with diabetes";
      recs.push({ text: `Diabetes (age 40-75): statin recommended (1)${dmHigh ? "; additional risk factors favor high-intensity statin with LDL-C <70 mg/dL" : ", moderate intensity at minimum, LDL-C <100 mg/dL"}.`, severity: "action", cite: ["lipid2026"], cor: "1", ap: "" });
    }
    if (egfr != null && egfr >= 15 && egfr < 60 && (age ?? 0) >= 40) {
      goal = stricter(goal, GOALS.veryHigh);
      statinPlan = "start";
      intensity = "high";
      recs.push({ text: "CKD stage 3-4 (not on dialysis): intensive lipid lowering with LDL-C goal <55 mg/dL (1).", severity: "action", cite: ["lipid2026"], cor: "1", ap: "" });
    }
    if (enh.includes("hiv") && age != null && age >= 40 && age <= 75) {
      statinPlan = "start";
      goal = stricter(goal, GOALS.moderate);
      recs.push({ text: "HIV on stable ART, age 40-75: statin recommended (1).", severity: "action", cite: ["lipid2026"], cor: "1", ap: "" });
    }
    if (age != null && age <= 30 && (baseLdl ?? ldl ?? 0) >= 160) {
      recs.push({ text: "Young adult with LDL-C ≥160 mg/dL: earlier statin initiation favored based on lifetime exposure.", severity: "action", cite: ["lipid2026"], ap: "" });
      statinPlan = statinPlan === "lifestyle" ? "consider" : statinPlan;
    }

    // CAC
    if (cac != null) {
      metrics.push({ label: "CAC", value: `${cac} AU` });
      ctx.push(`CAC ${cac}`);
      const g = cacGoal(cac);
      if (cac === 0) {
        const override = yes(v, "diabetes") || yes(v, "smoker") || enh.includes("fhx_premature") || severe || lpaHigh === true;
        if (!override && (statinPlan === "start" || statinPlan === "consider") && !yes(v, "diabetes") && !(egfr != null && egfr < 60)) {
          const cat = prevent.res ? preventCategory(prevent.res.tenYear.ascvd) : null;
          if (cat === "borderline" || cat === "intermediate") {
            statinPlan = "defer";
            recs.push({ text: "CAC = 0 without diabetes, smoking, FHx of premature ASCVD or elevated Lp(a): reasonable to defer statin and repeat CAC in 5-7 years (3-5 years if higher-risk features develop).", severity: "action", cite: ["lipid2026", "scct2021"], ap: "" });
          }
        } else if (override) {
          recs.push({ text: "CAC = 0 does not override statin therapy in the setting of diabetes, current smoking, FHx of premature ASCVD, LDL-C ≥190 or elevated Lp(a).", severity: "info", cite: ["lipid2026", "scct2021"], ap: "" });
        }
      } else {
        goal = stricter(goal, g);
        statinPlan = "start";
        if (cac >= 100) intensity = "high";
        recs.push({
          text: cac >= 1000
            ? "CAC ≥1000: ≥50% LDL-C reduction and LDL-C <55 mg/dL (1); treat as risk-equivalent to clinical ASCVD."
            : cac >= 100
              ? "CAC 100-999: statin therapy with LDL-C <70 mg/dL and non-HDL-C <100 mg/dL (1)."
              : "CAC 1-99: statin therapy recommended (1); LDL-C goal <100 mg/dL.",
          severity: "action", cite: ["lipid2026"], cor: "1", ap: "",
        });
      }
    } else if (prevent.res && ["borderline", "intermediate"].includes(preventCategory(prevent.res.tenYear.ascvd)) && !severe && !yes(v, "diabetes")) {
      const sexS = str(v, "sex");
      if (age != null && ((sexS === "male" && age > 40) || (sexS === "female" && age > 45))) {
        recs.push({ text: "Consider noncontrast CAC scan to guide statin decision (borderline/intermediate risk; men >40, women >45).", severity: "action", cite: ["lipid2026"], cor: "1", ap: "If the patient prefers to refine the decision before starting a statin, obtain a noncontrast coronary artery calcium score" });
      }
    }

    // Risk enhancers
    if (enhancerList.length && statinPlan !== "lifestyle") {
      recs.push({ text: `Risk enhancers present: ${list(enhancerList)}; these favor initiating/intensifying statin therapy.`, severity: "info", cite: ["lipid2026"], ap: "" });
    }
  }

  // -------------------- Lp(a) --------------------
  if (lpa == null) {
    recs.push({ text: "Lp(a) not on file: measure once in adulthood (1).", severity: "action", cite: ["lipid2026"], cor: "1", ap: "Check lipoprotein(a) once" });
  } else {
    metrics.push({ label: "Lp(a)", value: lpaText(lpa, lpaUnit), note: lpaHigh ? "elevated" : "not elevated" });
    if (lpaHigh) {
      if (goal && goal.ldl > 70 && (statinPlan === "start" || statinPlan === "consider")) goal = GOALS.high;
      recs.push({
        text: `Lp(a) ${lpaText(lpa, lpaUnit)} (≥50 mg/dL / ≥125 nmol/L): more intensive LDL-C lowering and aggressive control of other risk factors (1). Consider cascade testing of first-degree relatives.`,
        severity: "action", cite: ["lipid2026", "esc2025"], cor: "1",
        ap: `Lp(a) is elevated at ${lpaText(lpa, lpaUnit)}, which warrants more intensive LDL-C lowering and aggressive risk-factor control; recommend Lp(a) testing in first-degree relatives`,
      });
    }
  }

  // -------------------- Goals and next steps --------------------
  if (goal) {
    metrics.push({ label: "LDL-C goal", value: `<${goal.ldl} mg/dL`, note: `non-HDL-C <${goal.nonHdl}; ApoB <${goal.apoB}` });
  }
  if (ldl != null) metrics.push({ label: "LDL-C", value: `${ldl} mg/dL`, note: goal ? (ldl < goal.ldl ? "at goal" : `above goal by ${fmt(ldl - goal.ldl, 0)}`) : undefined });
  if (nonHdl != null) metrics.push({ label: "Non-HDL-C", value: `${nonHdl} mg/dL` });

  let plan: string[] = [];
  const therapy = { statin, ezetimibe: yes(v, "ezetimibe"), pcsk9: yes(v, "pcsk9"), bempedoic: yes(v, "bempedoic"), statinIntolerant: yes(v, "statinIntolerant") };

  if (statinPlan === "defer") {
    plan.push("defer statin given CAC of 0, continue heart-healthy lifestyle, and repeat CAC in 5-7 years");
  } else if (statinPlan === "lifestyle") {
    plan.push("continue heart-healthy diet, ≥150 minutes/week of moderate activity, weight and BP management; statin not indicated at this time");
  } else if (goal && ldl != null) {
    const pctRed = baseLdl != null && baseLdl > 0 ? ((baseLdl - ldl) / baseLdl) * 100 : null;
    if (pctRed != null) metrics.push({ label: "LDL-C reduction from baseline", value: pct(pctRed, 0) });
    const needPct = goal.pctReduction && pctRed != null && pctRed < goal.pctReduction;
    if (ldl < goal.ldl && !needPct) {
      plan.push(`LDL-C ${ldl} mg/dL is at goal (<${goal.ldl}); continue current lipid-lowering therapy`);
      // Residual risk: ApoB / non-HDL
      if (nonHdl != null && nonHdl >= goal.nonHdl) {
        plan.push(`non-HDL-C ${nonHdl} mg/dL remains above goal (<${goal.nonHdl}); address triglyceride-rich lipoproteins and consider further intensification`);
      }
      if (apoB == null) {
        if (yes(v, "diabetes") || (tg ?? 0) >= 150 || yes(v, "priorAscvd") || enh.includes("metabolic_syndrome")) {
          recs.push({ text: "LDL-C at goal: measure ApoB to assess residual risk (2a), particularly with elevated TG, diabetes, CKM syndrome or ASCVD.", severity: "action", cite: ["lipid2026"], cor: "2a", ap: "Check ApoB to assess residual atherogenic risk" });
        }
      } else if (apoB >= goal.apoB) {
        plan.push(`ApoB ${apoB} mg/dL remains above the corresponding target (<${goal.apoB}), indicating residual atherogenic particle burden; favor further intensification of lipid-lowering therapy`);
        recs.push({ text: `ApoB ${apoB} mg/dL above ~${goal.apoB} mg/dL (ESC/EAS equivalent of LDL-C <${goal.ldl}): consider intensifying therapy.`, severity: "action", cite: ["lipid2026", "esc2025"], ap: "" });
      }
    } else {
      const steps = stepsToGoal(ldl, goal.ldl, therapy, veryHigh || goal.ldl <= 55);
      if (statin === "none" && !therapy.statinIntolerant && intensity !== "high" && steps.length) {
        // Primary prevention moderate-intensity start
        const proj = ldl * 0.7;
        steps.splice(0, steps.length, { action: `start ${intensity === "moderate-to-high" ? "moderate- to high-intensity" : "moderate-intensity"} statin (e.g., atorvastatin 10-20 mg or rosuvastatin 5-10 mg)`, projectedLdl: proj });
        if (proj >= goal.ldl) steps.push({ action: "titrate to high-intensity statin if LDL-C remains above goal", projectedLdl: ldl * 0.5 });
      }
      if (steps.length === 0) {
        plan.push(`LDL-C ${ldl} mg/dL remains above goal despite available therapies; consider lipid specialist referral`);
      } else {
        const first = steps[0];
        plan.push(`LDL-C ${ldl} mg/dL is above goal (<${goal.ldl} mg/dL)${needPct ? ` and reduction from baseline is <${goal.pctReduction}%` : ""}; recommend ${first.action}${first.projectedLdl != null ? ` (projected LDL-C ~${fmt(first.projectedLdl, 0)} mg/dL)` : ""}`);
        if (steps.length > 1) plan.push(`if not at goal on recheck, ${list(steps.slice(1).map((s) => s.action), "then")}`);
      }
      if (therapy.statinIntolerant) {
        recs.push({ text: "Statin intolerance: rechallenge with a different statin/low or intermittent dose when possible; nonstatin options include ezetimibe, bempedoic acid, PCSK9 mAb or inclisiran.", severity: "info", cite: ["lipid2026"], ap: "" });
      }
    }
  } else if (goal && ldl == null) {
    missing.push("Current LDL-C");
    if (statinPlan === "start") plan.push(`start ${intensity === "high" ? "high" : intensity === "moderate-to-high" ? "moderate- to high" : "moderate"}-intensity statin`);
  } else if (!goal && statinPlan == null) {
    missing.push("Enough data to determine risk category");
  }

  // -------------------- Triglycerides --------------------
  if (tg != null) {
    metrics.push({ label: "Triglycerides", value: `${tg} mg/dL` });
    if (tg >= 1000) {
      recs.push({ text: "TG ≥1000 mg/dL: risk of pancreatitis; very-low-fat diet, address secondary causes, and start TG-lowering therapy (fibrate and/or omega-3).", severity: "urgent", cite: ["lipid2026"], ap: `Triglycerides ${tg} mg/dL confer pancreatitis risk; recommend very-low-fat diet, evaluation for secondary causes, and triglyceride-lowering therapy` });
    } else if (tg >= 500) {
      recs.push({ text: "TG 500-999 mg/dL: evaluate secondary causes (glycemia, alcohol, hypothyroidism, meds), lifestyle (≥5% weight loss, ≥150 min/wk exercise); consider TG-lowering therapy.", severity: "action", cite: ["lipid2026"], ap: `Triglycerides ${tg} mg/dL; evaluate secondary causes and intensify lifestyle, consider triglyceride-lowering therapy` });
    } else if (tg >= 150 && (yes(v, "priorAscvd") || yes(v, "diabetes")) && statin !== "none") {
      recs.push({ text: "TG 150-499 mg/dL on statin with ASCVD or diabetes plus risk factors: consider icosapent ethyl 2 g twice daily (REDUCE-IT).", severity: "action", cite: ["lipid2026"], ap: "Given persistent hypertriglyceridemia on statin, consider icosapent ethyl 2 g twice daily" });
    }
  }

  // -------------------- Aspirin --------------------
  if (yes(v, "priorAscvd")) {
    recs.push({ text: "Continue antiplatelet therapy per secondary-prevention indication.", severity: "info", ap: "" });
  } else if (cac != null && cac >= 100 && age != null && age >= 40 && age <= 70) {
    recs.push({ text: "Primary prevention with CAC ≥100, age 40-70: low-dose aspirin may be considered if bleeding risk is low (2b).", severity: "info", cite: ["prim2019", "scct2021"], cor: "2b", ap: "Low-dose aspirin may be considered given CAC ≥100 if bleeding risk is low" });
  }

  // Follow-up
  if (statinPlan !== "lifestyle" && statinPlan !== "defer") {
    plan.push("recheck fasting lipid panel (± ApoB) 4-12 weeks after any change, then every 3-12 months");
  }
  recs.unshift({ text: `Category: ${category || "undetermined"}${goal ? ` → LDL-C goal <${goal.ldl} mg/dL` : ""}`, severity: "info", ap: "" });

  plan = plan.filter(Boolean);
  const headline = `${category || "ASCVD risk assessment"}${goal ? ` — LDL-C goal <${goal.ldl} mg/dL` : ""}`;
  const apExtra = recs.filter((r) => r.ap).map((r) => r.ap!);
  const ap = [
    `ASCVD risk reduction: ${ageSex(v)}${ctx.length ? ` with ${list(ctx)}` : ""}.`,
    ldl != null ? `Current LDL-C ${ldl} mg/dL${nonHdl != null ? `, non-HDL-C ${nonHdl}` : ""}${apoB != null ? `, ApoB ${apoB}` : ""}${tg != null ? `, TG ${tg}` : ""} on ${statin === "none" ? "no statin" : `${statin}-intensity statin`}${therapy.ezetimibe ? " plus ezetimibe" : ""}${therapy.pcsk9 ? " plus PCSK9 inhibitor" : ""}.` : "",
    goal ? `Per the 2026 ACC/AHA dyslipidemia guideline, LDL-C goal is <${goal.ldl} mg/dL (non-HDL-C <${goal.nonHdl} mg/dL).` : "",
    plan.length ? `Plan: ${plan.map((p) => p.replace(/\.$/, "")).join("; ")}.` : "",
    apExtra.length ? apExtra.map((s) => s.replace(/\.$/, "")).join(". ") + "." : "",
    "Continue heart-healthy diet, regular physical activity, and BP/glycemic control.",
  ].filter(Boolean).join(" ");

  // Dedupe missing
  return { headline, metrics, recommendations: recs, missing: [...new Set(missing)], ap };
}

export const ascvdModule: ClinicalModule = {
  id: "ascvd",
  title: "ASCVD Risk Mitigation",
  short: "ASCVD",
  icon: "🫀",
  description: "LDL-C/ApoB goals, PREVENT & MESA, Lp(a), CAC, next lipid step — 2026 ACC/AHA dyslipidemia guideline.",
  placeholder: "e.g. 58M, no prior events, LDL 142, TC 220, HDL 42, TG 180, SBP 138 on amlodipine, eGFR 85, BMI 31, nonsmoker, no DM, Lp(a) 160 nmol/L, CAC 210, not on statin",
  fields,
  evaluate: evaluateAscvd,
  citations: cites("lipid2026", "prevent", "mesa", "esc2025", "scct2021", "prim2019"),
};

// Re-export for the CAC module
export { fields as ascvdFields, highRiskConditions, AGE, SEX, RACE };
