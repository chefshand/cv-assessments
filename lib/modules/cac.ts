import type { ClinicalModule, FieldDef, Inputs, Metric, Recommendation, RuleResult } from "../types";
import { ageSex, list, num, ordinal, pct, str, yes } from "../util";
import { AGE, SEX, RACE, cacGoal, runMesa, runPrevent } from "./ascvd";
import { preventCategory } from "../calc/prevent";
import { GOALS, lpaElevated, lpaText } from "../lipids";
import { cites } from "../citations";

const fields: FieldDef[] = [
  AGE, SEX, RACE,
  { key: "cac", label: "CAC score (Agatston)", type: "number", unit: "AU", section: "Calcium scan" },
  {
    key: "qualitative", label: "Non-gated CT (no score)", type: "select", section: "Calcium scan",
    help: "Use for incidental coronary calcification on chest CT when no Agatston score is reported.",
    options: [ { value: "none", label: "None" }, { value: "mild", label: "Mild" }, { value: "moderate", label: "Moderate" }, { value: "severe", label: "Severe" } ],
  },
  { key: "percentile", label: "MESA percentile (age/sex/race)", type: "number", unit: "%ile", section: "Calcium scan" },
  { key: "vessels", label: "# vessels with CAC", type: "number", min: 0, max: 4, section: "Calcium scan", help: "LM, LAD, LCx, RCA (CAC-DRS N)" },
  { key: "leftMain", label: "Left main calcium", type: "bool", section: "Calcium scan" },
  { key: "priorCac", label: "Prior CAC score", type: "number", unit: "AU", section: "Calcium scan" },
  { key: "priorCacYears", label: "Years since prior CAC", type: "number", unit: "y", section: "Calcium scan" },
  { key: "symptoms", label: "Anginal symptoms / chest pain", type: "bool", section: "Clinical" },
  { key: "priorAscvd", label: "Known ASCVD", type: "bool", section: "Clinical" },
  { key: "diabetes", label: "Diabetes", type: "bool", section: "Clinical" },
  { key: "smoker", label: "Current smoker", type: "bool", section: "Clinical" },
  { key: "fhxPremature", label: "FHx premature ASCVD", type: "bool", section: "Clinical" },
  { key: "bleedRisk", label: "High bleeding risk", type: "bool", section: "Clinical" },
  { key: "ldl", label: "LDL-C", type: "number", unit: "mg/dL", section: "Labs" },
  { key: "totalChol", label: "Total cholesterol", type: "number", unit: "mg/dL", section: "Labs" },
  { key: "hdl", label: "HDL-C", type: "number", unit: "mg/dL", section: "Labs" },
  { key: "lpa", label: "Lp(a)", type: "number", section: "Labs" },
  { key: "lpaUnit", label: "Lp(a) unit", type: "select", section: "Labs", options: [ { value: "mg/dL", label: "mg/dL" }, { value: "nmol/L", label: "nmol/L" } ] },
  { key: "sbp", label: "Systolic BP", type: "number", unit: "mmHg", section: "Labs" },
  { key: "bpTx", label: "On BP medication", type: "bool", section: "Labs" },
  { key: "egfr", label: "eGFR", type: "number", section: "Labs" },
  { key: "bmi", label: "BMI", type: "number", section: "Labs" },
  {
    key: "statin", label: "Current statin", type: "select", section: "Therapy",
    options: [ { value: "none", label: "None" }, { value: "low", label: "Low" }, { value: "moderate", label: "Moderate" }, { value: "high", label: "High" } ],
  },
  { key: "aspirin", label: "On aspirin", type: "bool", section: "Therapy" },
];

const QUAL_TO_SCORE: Record<string, number> = { none: 0, mild: 50, moderate: 200, severe: 400 };

export function evaluateCac(v: Inputs): RuleResult {
  const recs: Recommendation[] = [];
  const metrics: Metric[] = [];
  const missing: string[] = [];
  const plan: string[] = [];
  const age = num(v, "age");
  const qual = str(v, "qualitative");
  let cac = num(v, "cac");
  const estimated = cac == null && qual != null;
  if (cac == null && qual != null) cac = QUAL_TO_SCORE[qual];
  const pctile = num(v, "percentile");
  const vessels = num(v, "vessels");
  const ldl = num(v, "ldl");
  const statin = str(v, "statin") ?? "none";
  const lpa = num(v, "lpa");
  const lpaHigh = lpaElevated(lpa, str(v, "lpaUnit"));

  if (cac == null) {
    return {
      headline: "Enter a CAC score (or qualitative calcium on non-gated CT)",
      metrics: [], recommendations: [], missing: ["CAC score"], ap: "",
    };
  }

  // CAC-DRS
  const drsA = cac === 0 ? "A0" : cac < 100 ? "A1" : cac < 300 ? "A2" : "A3";
  const drsN = vessels != null ? `/N${Math.min(4, Math.max(0, vessels))}` : "";
  const scoreText = estimated ? `${qual} coronary calcification on non-gated CT` : `CAC ${cac} AU`;
  metrics.push({ label: "CAC", value: estimated ? `${qual} (non-gated)` : `${cac} AU`, note: `CAC-DRS ${drsA}${drsN}` });
  if (pctile != null) metrics.push({ label: "Percentile", value: ordinal(pctile), note: pctile >= 75 ? "≥75th: high for age/sex/race" : undefined });

  const mesa = runMesa({ ...v, enhancers: yes(v, "fhxPremature") ? ["fhx_premature"] : [], cac: estimated ? null : cac });
  if (mesa) {
    metrics.push({ label: "MESA 10-yr CHD", value: pct(mesa.withCac ?? mesa.withoutCac), note: mesa.withCac != null ? `with CAC; without CAC ${pct(mesa.withoutCac)}` : "without CAC" });
  } else missing.push("Total cholesterol, HDL, SBP for MESA risk");
  const prev = runPrevent({ ...v, enhancers: [] });
  if (prev.res) metrics.push({ label: "PREVENT 10-yr ASCVD", value: pct(prev.res.tenYear.ascvd), note: preventCategory(prev.res.tenYear.ascvd) });

  const ctx: string[] = [scoreText];
  if (!estimated) ctx.push(`CAC-DRS ${drsA}${drsN}`);
  if (pctile != null) ctx.push(`${ordinal(pctile)} percentile for age, sex and race`);
  if (yes(v, "leftMain")) ctx.push("left main involvement");
  if (mesa?.withCac != null) ctx.push(`MESA 10-year CHD risk ${pct(mesa.withCac)}`);

  // Symptoms
  if (yes(v, "symptoms")) {
    recs.push({
      text: "Symptomatic patient: CAC does not exclude obstructive CAD. Evaluate per the 2021 chest pain guideline (CCTA or stress testing based on pretest probability).",
      severity: "urgent", cite: ["chestpain2021"], cor: "1",
      ap: "Given anginal symptoms, CAC alone does not exclude obstructive disease; will pursue ischemic evaluation (coronary CTA or stress testing) per the 2021 chest pain guideline",
    });
  }
  if (yes(v, "priorAscvd")) {
    recs.push({ text: "Known ASCVD: manage as secondary prevention (see ASCVD module); CAC does not change the indication.", severity: "warning", ap: "" });
  }

  const goal = cac === 0 ? null : cacGoal(cac);
  const highFeatures = (pctile != null && pctile >= 75) || yes(v, "leftMain") || (vessels != null && vessels >= 3) || (age != null && age < 45 && cac > 0);

  if (cac === 0) {
    const overrides = [
      yes(v, "diabetes") && "diabetes",
      yes(v, "smoker") && "current smoking",
      yes(v, "fhxPremature") && "family history of premature ASCVD",
      lpaHigh && "elevated Lp(a)",
      (ldl ?? 0) >= 190 && "LDL-C ≥190",
    ].filter(Boolean) as string[];
    if (overrides.length) {
      recs.push({ text: `CAC 0 but ${list(overrides)}: CAC 0 does not exclude risk here; statin remains reasonable per risk category.`, severity: "action", cite: ["lipid2026", "scct2021"], ap: "" });
      plan.push(`despite CAC of 0, ${list(overrides)} support continuing/starting statin therapy per overall risk`);
      plan.push("repeat CAC in 3-5 years if it would change management");
    } else {
      recs.push({ text: "CAC 0 (A0): very low 10-year event risk; reasonable to defer/withhold statin in borderline-intermediate risk adults (1).", severity: "action", cite: ["lipid2026", "scct2021"], cor: "1", ap: "" });
      plan.push(statin !== "none" ? "CAC of 0 supports a shared decision about de-escalating statin therapy if it was started for borderline/intermediate risk" : "defer statin therapy given CAC of 0 and absence of high-risk features");
      plan.push(`repeat CAC in ${yes(v, "diabetes") ? "3-5" : "5-7"} years`);
    }
    recs.push({ text: "Aspirin not recommended for primary prevention with CAC 0.", severity: "info", cite: ["prim2019", "scct2021"], ap: "" });
  } else {
    // Statin and goal
    const intensity = cac >= 100 || highFeatures ? "high" : "moderate";
    const g = highFeatures && goal && goal.ldl > 70 ? GOALS.high : goal!;
    metrics.push({ label: "LDL-C goal", value: `<${g.ldl} mg/dL`, note: `non-HDL <${g.nonHdl}` });
    recs.push({
      text: cac >= 1000
        ? "CAC ≥1000: ≥50% LDL-C reduction and LDL-C <55 mg/dL (1) — risk comparable to secondary prevention; high-intensity statin plus nonstatin therapy as needed."
        : cac >= 100
          ? "CAC 100-999: statin with LDL-C <70 mg/dL and non-HDL-C <100 mg/dL (1)."
          : "CAC 1-99: statin therapy recommended (1), LDL-C <100 mg/dL.",
      severity: "action", cite: ["lipid2026"], cor: "1", ap: "",
    });
    if (highFeatures) {
      recs.push({ text: `High-risk CAC features (${list([pctile != null && pctile >= 75 ? "≥75th percentile" : "", yes(v, "leftMain") ? "left main" : "", vessels != null && vessels >= 3 ? `${vessels}-vessel` : "", age != null && age < 45 ? "CAC at age <45" : ""].filter(Boolean))}): favor high-intensity statin and LDL-C <70 mg/dL.`, severity: "action", cite: ["cacdrs", "scct2021"], ap: "" });
    }
    if (ldl != null) {
      if (ldl < g.ldl && (statin === "high" || intensity === "moderate" || statin !== "none")) {
        plan.push(`LDL-C ${ldl} mg/dL is at goal (<${g.ldl}); continue current statin`);
      } else if (statin === "none") {
        plan.push(`start ${intensity}-intensity statin (${intensity === "high" ? "atorvastatin 40-80 mg or rosuvastatin 20-40 mg" : "atorvastatin 10-20 mg or rosuvastatin 5-10 mg"}) targeting LDL-C <${g.ldl} mg/dL (current ${ldl}; projected ~${Math.round(ldl * (intensity === "high" ? 0.5 : 0.7))})`);
      } else if (statin !== "high") {
        plan.push(`LDL-C ${ldl} mg/dL is above goal (<${g.ldl}); intensify to high-intensity statin, then add ezetimibe if still above goal`);
      } else {
        plan.push(`LDL-C ${ldl} mg/dL is above goal (<${g.ldl}) on high-intensity statin; add ezetimibe${cac >= 1000 ? ", then PCSK9 inhibitor if needed" : ""}`);
      }
    } else {
      plan.push(`${statin === "none" ? "start" : "continue"} ${intensity}-intensity statin targeting LDL-C <${g.ldl} mg/dL`);
      missing.push("LDL-C");
    }
    // Aspirin
    if (cac >= 100 && age != null && age >= 40 && age <= 70 && !yes(v, "bleedRisk")) {
      recs.push({ text: "CAC ≥100, age 40-70, not high bleeding risk: low-dose aspirin 81 mg may be considered (2b); stronger rationale with CAC ≥300.", severity: "action", cite: ["prim2019", "scct2021", "cacdrs"], cor: "2b", ap: "" });
      if (!yes(v, "aspirin")) plan.push(`consider aspirin 81 mg daily after shared decision-making given CAC ${cac >= 300 ? "≥300" : "≥100"} and low bleeding risk`);
    } else if (cac >= 100 && yes(v, "bleedRisk")) {
      recs.push({ text: "High bleeding risk: aspirin for primary prevention not recommended.", severity: "info", cite: ["prim2019"], ap: "" });
    } else if (cac < 100) {
      recs.push({ text: "CAC 1-99: aspirin not routinely recommended.", severity: "info", cite: ["scct2021"], ap: "" });
    }
    // Rescan
    plan.push(statin !== "none" ? "repeat CAC is not routinely needed while on statin (statins increase calcium density)" : "if statin is declined, repeat CAC in 3-5 years");
    if (!yes(v, "symptoms") && cac >= 400) {
      recs.push({ text: "Asymptomatic with high CAC: routine stress testing is not recommended; reserve for symptoms or high-risk occupations. Ensure aggressive risk-factor control.", severity: "info", cite: ["chestpain2021", "scct2021"], ap: "" });
    }
  }

  // Progression
  const priorCac = num(v, "priorCac");
  const yrs = num(v, "priorCacYears");
  if (priorCac != null && !estimated) {
    const delta = cac - priorCac;
    const rapid = (priorCac === 0 && cac > 0) || (priorCac > 0 && (Math.sqrt(cac) - Math.sqrt(priorCac)) > 2.5) || (yrs != null && yrs > 0 && delta / yrs >= 100);
    metrics.push({ label: "Change from prior", value: `${delta >= 0 ? "+" : ""}${delta} AU${yrs ? ` over ${yrs} y` : ""}`, note: rapid ? "significant progression" : undefined });
    if (rapid) {
      recs.push({ text: "Significant CAC progression (incident CAC or √CAC change >2.5): associated with higher event risk; intensify risk-factor control.", severity: "action", cite: ["scct2021"], ap: `CAC has progressed from ${priorCac} to ${cac}, favoring intensified preventive therapy` });
    }
  }

  if (lpa == null) recs.push({ text: "Check Lp(a) once if not previously measured.", severity: "action", cite: ["lipid2026"], ap: "Check lipoprotein(a) once" });
  else if (lpaHigh) recs.push({ text: `Elevated Lp(a) ${lpaText(lpa, str(v, "lpaUnit"))}: favors more intensive LDL-C lowering.`, severity: "action", cite: ["lipid2026"], ap: `Lp(a) is elevated at ${lpaText(lpa, str(v, "lpaUnit"))}, favoring more intensive LDL-C lowering` });

  const headline = cac === 0 ? "CAC 0 — very low near-term risk" : `${drsA}: ${cac >= 1000 ? "very high" : cac >= 300 ? "high" : cac >= 100 ? "moderately high" : "mild"} plaque burden${goal ? ` — LDL-C goal <${(highFeatures && goal.ldl > 70 ? GOALS.high : goal).ldl}` : ""}`;
  const apExtra = recs.filter((r) => r.ap).map((r) => r.ap!.replace(/\.$/, ""));
  const ap = [
    `Coronary artery calcium: ${ageSex(v)} with ${list(ctx)}.`,
    plan.length ? `Per the 2026 ACC/AHA dyslipidemia guideline and SCCT/NLA CAC guidance: ${plan.join("; ")}.` : "",
    apExtra.length ? apExtra.join(". ") + "." : "",
    "Continue heart-healthy diet, exercise, and blood pressure/glycemic control.",
  ].filter(Boolean).join(" ");

  return { headline, metrics, recommendations: recs, missing, ap };
}

export const cacModule: ClinicalModule = {
  id: "cac",
  title: "Coronary Calcium Score",
  short: "CAC",
  icon: "🦴",
  description: "Interpret CAC (CAC-DRS, percentile, MESA), statin/aspirin decision, LDL goal, rescan timing.",
  placeholder: "e.g. 52F, asymptomatic, CAC 86 (82nd percentile), 2 vessels, LDL 138, TC 215, HDL 55, SBP 128, no statin, nonsmoker, mother had MI at 58",
  fields,
  evaluate: evaluateCac,
  citations: cites("lipid2026", "scct2021", "cacdrs", "mesa", "prim2019", "chestpain2021"),
};
