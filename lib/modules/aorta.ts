import type { ClinicalModule, FieldDef, Inputs, Metric, Recommendation, RuleResult } from "../types";
import { arr, ageSex, fmt, list, num, str, yes } from "../util";
import { bsaMosteller } from "../calc/body";
import { cites } from "../citations";

const ETIOLOGY = [
  { value: "sporadic", label: "Degenerative / sporadic (TAV)" },
  { value: "bav", label: "Bicuspid aortic valve" },
  { value: "marfan", label: "Marfan" },
  { value: "lds", label: "Loeys-Dietz" },
  { value: "htad_smooth", label: "HTAD: ACTA2/MYH11/MYLK/PRKG1" },
  { value: "htad_familial", label: "Familial TAD, no known variant" },
  { value: "turner", label: "Turner syndrome" },
  { value: "veds", label: "Vascular Ehlers-Danlos" },
  { value: "aortitis", label: "Aortitis (GCA/Takayasu)" },
];

const fields: FieldDef[] = [
  { key: "age", label: "Age", type: "number", unit: "y", section: "Patient" },
  { key: "sex", label: "Sex", type: "select", section: "Patient", options: [ { value: "female", label: "Female" }, { value: "male", label: "Male" } ] },
  { key: "heightCm", label: "Height", type: "number", unit: "cm", section: "Patient", extractHint: "Convert inches to cm (x2.54); 5'10\" = 177.8 cm." },
  { key: "weightKg", label: "Weight", type: "number", unit: "kg", section: "Patient", extractHint: "Convert lb to kg (/2.205)." },
  { key: "diameter", label: "Max diameter", type: "number", unit: "cm", step: 0.1, section: "Current imaging", extractHint: "Convert mm to cm (45 mm = 4.5)." },
  {
    key: "segment", label: "Segment", type: "select", section: "Current imaging",
    options: [ { value: "root", label: "Root (sinuses)" }, { value: "ascending", label: "Tubular ascending" }, { value: "both", label: "Root + ascending" } ],
  },
  {
    key: "modality", label: "Modality", type: "select", section: "Current imaging",
    options: [ { value: "tte", label: "TTE" }, { value: "ct", label: "CT / CTA" }, { value: "mri", label: "MRI / MRA" }, { value: "tee", label: "TEE" } ],
  },
  { key: "ctGated", label: "ECG-gated CT", type: "bool", section: "Current imaging", showIf: (v) => v.modality === "ct" },
  { key: "concordant", label: "TTE matches prior CT/MRI (±2-3 mm)", type: "bool", section: "Current imaging", showIf: (v) => v.modality === "tte" },
  { key: "priorDiameter", label: "Prior diameter", type: "number", unit: "cm", step: 0.1, section: "Prior imaging" },
  { key: "priorYears", label: "Interval since prior", type: "number", unit: "y", step: 0.1, section: "Prior imaging", extractHint: "Convert months to years (6 months = 0.5)." },
  { key: "priorModality", label: "Prior modality", type: "select", section: "Prior imaging", options: [ { value: "tte", label: "TTE" }, { value: "ct", label: "CT" }, { value: "mri", label: "MRI" }, { value: "tee", label: "TEE" } ] },
  { key: "etiology", label: "Etiology", type: "select", section: "Etiology", options: ETIOLOGY },
  {
    key: "ldsGene", label: "LDS gene", type: "select", section: "Etiology", showIf: (v) => v.etiology === "lds",
    options: [ { value: "tgfbr", label: "TGFBR1/TGFBR2" }, { value: "smad3", label: "SMAD3" }, { value: "tgfb23", label: "TGFB2/TGFB3" } ],
  },
  { key: "bavRoot", label: "BAV root phenotype", type: "bool", section: "Etiology", showIf: (v) => v.etiology === "bav" },
  {
    key: "riskFeatures", label: "Risk features", type: "multi", section: "Risk features",
    options: [
      { value: "fhx_dissection", label: "FHx aortic dissection" },
      { value: "coarctation", label: "Coarctation" },
      { value: "pregnancy", label: "Planning pregnancy" },
      { value: "severe_ar", label: "Severe AR / MR" },
      { value: "htn_uncontrolled", label: "Uncontrolled HTN" },
      { value: "extra_aortic", label: "Severe extra-aortic features (LDS)" },
      { value: "fhx_taa", label: "FHx thoracic aneurysm" },
    ],
  },
  { key: "concomitantSurgery", label: "Cardiac surgery planned for another reason (e.g., AVR)", type: "bool", section: "Risk features" },
  { key: "lowSurgicalRisk", label: "Low surgical risk, experienced aortic center", type: "bool", section: "Risk features" },
  { key: "symptoms", label: "Chest/back pain suspicious for aortic origin", type: "bool", section: "Risk features" },
  { key: "geneticTested", label: "Genetic testing done", type: "bool", section: "Risk features" },
];

interface Thresholds {
  surgery: number;
  earlier?: { cm: number; when: string; cor: string };
  cor: string;
  note?: string;
}

function thresholds(v: Inputs, growthRisk: boolean): Thresholds {
  const e = str(v, "etiology") ?? "sporadic";
  const rf = arr(v, "riskFeatures");
  const fhxD = rf.includes("fhx_dissection");
  switch (e) {
    case "bav": {
      const risk = [fhxD && "FHx dissection", growthRisk && "growth ≥0.3 cm/yr", rf.includes("coarctation") && "coarctation", yes(v, "bavRoot") && "root phenotype"].filter(Boolean) as string[];
      return {
        surgery: 5.5, cor: "1",
        earlier: { cm: 5.0, when: risk.length ? `risk features present (${list(risk)})` : "risk features (FHx dissection, growth ≥0.3 cm/yr, coarctation, root phenotype) or low surgical risk at a Comprehensive Valve/Aortic Center", cor: "2a" },
      };
    }
    case "marfan":
      return {
        surgery: 5.0, cor: "1",
        earlier: { cm: 4.5, when: "FHx dissection, growth ≥0.3 cm/yr, severe AR/MR, planned pregnancy, or low surgical risk at an experienced aortic center", cor: "2a" },
        note: "Cross-sectional area/height ≥10 cm²/m is also a reasonable surgical trigger.",
      };
    case "lds": {
      const g = str(v, "ldsGene");
      if (g === "smad3") return { surgery: 4.5, cor: "2a", earlier: { cm: 4.0, when: "FHx dissection at small diameters or rapid growth", cor: "2b" } };
      if (g === "tgfb23") return { surgery: 5.0, cor: "2a", earlier: { cm: 4.5, when: "FHx dissection at small diameters or rapid growth", cor: "2b" } };
      return {
        surgery: 4.5, cor: "1",
        earlier: { cm: 4.0, when: "high-risk features (women with small body size, TGFBR2 with severe extra-aortic features, FHx dissection, growth ≥0.3 cm/yr)", cor: "2a" },
        note: g == null ? "Thresholds shown for TGFBR1/2; specify the gene for gene-specific thresholds." : undefined,
      };
    }
    case "htad_smooth":
      return { surgery: 4.5, cor: "2a", earlier: { cm: 4.2, when: "FHx dissection at small diameters or rapid growth", cor: "2b" } };
    case "htad_familial":
      return { surgery: 5.0, cor: "2a", earlier: { cm: 4.5, when: "FHx dissection at a smaller diameter", cor: "2a" } };
    case "turner":
      return { surgery: 0, cor: "2a", note: "Turner syndrome uses the aortic size index (ASI = diameter/BSA): surgery reasonable at ASI ≥2.5 cm/m² (age ≥15); ASI 2.0-2.4 with risk factors (BAV, coarctation, HTN, planned pregnancy) warrants close follow-up/consideration." };
    case "veds":
      return { surgery: 0, cor: "-", note: "vEDS: prophylactic aortic surgery is generally avoided due to tissue fragility; decisions are individualized at an experienced center. Celiprolol is reasonable." };
    case "aortitis":
      return { surgery: 5.5, cor: "1", note: "Aortitis: treat underlying inflammation (rheumatology); thresholds per sporadic disease are commonly applied once inflammation is quiescent." };
    default:
      return {
        surgery: 5.5, cor: "1",
        earlier: { cm: 5.0, when: "low surgical risk with a multidisciplinary aortic team at an experienced center", cor: "2a" },
        note: "In patients of short/tall stature, AHI ≥3.21 cm/m or CSA/height ≥10 cm²/m may be used (2b).",
      };
  }
}

export function evaluateAorta(v: Inputs): RuleResult {
  const recs: Recommendation[] = [];
  const metrics: Metric[] = [];
  const missing: string[] = [];
  const plan: string[] = [];
  const d = num(v, "diameter");
  const e = str(v, "etiology") ?? "sporadic";
  const etLabel = ETIOLOGY.find((x) => x.value === e)!.label;
  const modality = str(v, "modality");
  const segment = str(v, "segment");
  const h = num(v, "heightCm");
  const w = num(v, "weightKg");
  const age = num(v, "age");
  const rf = arr(v, "riskFeatures");

  if (d == null) return { headline: "Enter the maximal root/ascending diameter", metrics: [], recommendations: [], missing: ["Diameter"], ap: "" };
  if (d > 12 || d < 1.5) {
    return { headline: "Diameter looks out of range — enter in cm (e.g., 4.6)", metrics: [], recommendations: [], missing: ["Diameter in cm"], ap: "" };
  }
  if (str(v, "etiology") == null) missing.push("Etiology (defaulting to sporadic/degenerative)");
  if (modality == null) missing.push("Imaging modality");

  // Growth
  const pd = num(v, "priorDiameter");
  const py = num(v, "priorYears");
  let rate: number | null = null;
  if (pd != null && py != null && py > 0) {
    rate = Math.round(((d - pd) / py) * 1000) / 1000;
    metrics.push({ label: "Growth", value: `${fmt(d - pd, 1)} cm over ${fmt(py, 1)} y`, note: `${fmt(rate, 2)} cm/yr` });
    const pm = str(v, "priorModality");
    if (pm && modality && pm !== modality) {
      recs.push({ text: `Prior study was ${pm.toUpperCase()} vs current ${modality.toUpperCase()}: inter-modality differences of 2-3 mm are common; confirm growth with the same modality and measurement convention before acting on it.`, severity: "warning", cite: ["aorta2022"], ap: "" });
    }
  }
  const rapidOneYear = rate != null && Math.round((d - pd!) * 100) / 100 >= 0.5 && py! <= 1;
  const rapid = rate != null && (rate >= 0.5 || rapidOneYear);
  const growthRisk = rate != null && rate >= 0.3;

  // Indices
  let ahi: number | null = null;
  let csaH: number | null = null;
  let asi: number | null = null;
  if (h != null) {
    ahi = d / (h / 100);
    csaH = (Math.PI * Math.pow(d / 2, 2)) / (h / 100);
    const risk = ahi < 2.43 ? "~4%/yr" : ahi < 3.21 ? "~7%/yr" : ahi <= 4.1 ? "~12%/yr" : "~18%/yr";
    metrics.push({ label: "Aortic height index", value: `${fmt(ahi, 2)} cm/m`, note: `est. complication risk ${risk} (Zafar)` });
    metrics.push({ label: "CSA / height", value: `${fmt(csaH, 1)} cm²/m`, note: csaH >= 10 ? "≥10: surgical trigger in some contexts" : undefined });
  } else missing.push("Height (for aortic height index)");
  if (h != null && w != null) {
    asi = d / bsaMosteller(h, w);
    metrics.push({ label: "Aortic size index", value: `${fmt(asi, 2)} cm/m²`, note: `BSA ${fmt(bsaMosteller(h, w), 2)} m²` });
  }

  metrics.unshift({ label: "Max diameter", value: `${fmt(d, 1)} cm`, note: [segment, modality?.toUpperCase()].filter(Boolean).join(", ") });

  // Urgent symptoms
  if (yes(v, "symptoms")) {
    recs.push({ text: "Symptoms possibly attributable to the aneurysm: urgent evaluation for acute aortic syndrome (CTA) and urgent surgical consultation; symptomatic aneurysms warrant repair regardless of size (1).", severity: "urgent", cite: ["aorta2022"], cor: "1", ap: "Given symptoms possibly attributable to the aorta, will obtain urgent CTA and urgent cardiothoracic surgery evaluation" });
  }

  // Thresholds
  const t = thresholds(v, growthRisk);
  let referral = false;
  let reason = "";
  if (e === "turner") {
    if (asi == null) missing.push("Height and weight (Turner ASI)");
    else if (asi >= 2.5 && (age ?? 99) >= 15) { referral = true; reason = `ASI ${fmt(asi, 2)} cm/m² ≥2.5`; }
    else if (asi >= 2.0) recs.push({ text: `ASI ${fmt(asi, 2)} cm/m² (2.0-2.4): close surveillance; surgery may be considered with additional risk factors.`, severity: "action", cite: ["aorta2022"], ap: "" });
  } else if (e === "veds") {
    recs.push({ text: t.note!, severity: "warning", cite: ["aorta2022"], ap: "Given vascular Ehlers-Danlos syndrome, prophylactic repair decisions will be individualized with an experienced aortic center; celiprolol is reasonable" });
  } else {
    if (d >= t.surgery) { referral = true; reason = `diameter ${fmt(d, 1)} cm ≥ ${t.surgery} cm threshold for ${etLabel.toLowerCase()} (COR ${t.cor})`; }
    else if (t.earlier && d >= t.earlier.cm) {
      const etiologyRiskPresent =
        (e === "bav" && (rf.includes("fhx_dissection") || growthRisk || rf.includes("coarctation") || yes(v, "bavRoot") || yes(v, "lowSurgicalRisk"))) ||
        (e === "marfan" && (rf.includes("fhx_dissection") || growthRisk || rf.includes("severe_ar") || rf.includes("pregnancy") || yes(v, "lowSurgicalRisk"))) ||
        (e === "lds" && (rf.includes("fhx_dissection") || growthRisk || rf.includes("extra_aortic") || (str(v, "sex") === "female" && h != null && h < 160))) ||
        ((e === "htad_smooth" || e === "htad_familial") && (rf.includes("fhx_dissection") || growthRisk)) ||
        ((e === "sporadic" || e === "aortitis") && yes(v, "lowSurgicalRisk"));
      if (etiologyRiskPresent) { referral = true; reason = `diameter ${fmt(d, 1)} cm ≥ ${t.earlier.cm} cm with ${t.earlier.when} (COR ${t.earlier.cor})`; }
      else recs.push({ text: `Diameter ≥${t.earlier.cm} cm: surgery is reasonable if ${t.earlier.when} (COR ${t.earlier.cor}). Standard threshold ${t.surgery} cm.`, severity: "action", cite: ["aorta2022"], cor: t.earlier.cor, ap: "" });
    }
    if (!referral && (e === "sporadic" || e === "marfan") && csaH != null && csaH >= 10) {
      recs.push({ text: `CSA/height ${fmt(csaH, 1)} cm²/m ≥10: surgery may be reasonable, particularly in patients of short stature (${e === "marfan" ? "2a" : "2b"}).`, severity: "action", cite: ["aorta2022"], ap: `Indexed aortic size is elevated (CSA/height ${fmt(csaH, 1)} cm²/m), which may favor earlier surgical evaluation` });
    }
  }
  if (rapid) { referral = true; reason = reason || `growth ${rate != null ? fmt(rate, 2) : ""} cm/yr (≥0.5 cm/yr)`; }
  else if (growthRisk && !referral) {
    recs.push({ text: `Growth ${fmt(rate!, 2)} cm/yr (≥0.3 cm/yr): surgery is reasonable if sustained over 2 consecutive years (2a); shorten the imaging interval.`, severity: "action", cite: ["aorta2022"], cor: "2a", ap: "" });
  }
  if (yes(v, "concomitantSurgery") && d >= 4.5 && !referral) {
    recs.push({ text: "Undergoing cardiac surgery for another indication with diameter ≥4.5 cm: concomitant root/ascending replacement is reasonable (2a).", severity: "action", cite: ["aorta2022"], cor: "2a", ap: `Given planned cardiac surgery and an aortic diameter ≥4.5 cm, concomitant aortic replacement is reasonable and will be discussed with cardiac surgery` });
  }
  if (rf.includes("pregnancy") && (e === "marfan" || e === "lds" || e === "bav" || e === "turner" || e === "htad_smooth")) {
    recs.push({ text: e === "marfan" ? "Planning pregnancy with Marfan: prophylactic repair is reasonable before pregnancy if ≥4.5 cm; counsel on high dissection risk if ≥4.0 cm; preconception cardio-obstetrics and genetic counseling." : "Planning pregnancy with heritable aortopathy: preconception cardio-obstetrics and genetic counseling; consider repair before pregnancy near threshold.", severity: "action", cite: ["aorta2022"], ap: "Recommend preconception cardio-obstetrics and genetic counseling given planned pregnancy" });
  }

  if (referral) {
    recs.unshift({ text: `Meets criteria for surgical referral: ${reason}. Refer to a multidisciplinary aortic team / experienced cardiothoracic surgeon.`, severity: "urgent", cite: ["aorta2022"], cor: t.cor, ap: "" });
    plan.push(`${reason.charAt(0).toUpperCase() + reason.slice(1)}; refer to cardiothoracic surgery / multidisciplinary aortic team for evaluation of elective repair`);
  }

  // Surveillance interval
  const genetic = ["marfan", "lds", "htad_smooth", "htad_familial", "turner", "veds"].includes(e);
  const threshold = e === "turner" || e === "veds" ? 4.5 : t.earlier?.cm ?? t.surgery;
  let interval: string;
  if (referral) interval = "per surgical team (typically CT/MRI within 3-6 months if repair deferred)";
  else if (rapid || growthRisk) interval = "6 months";
  else if (genetic) {
    interval = d >= threshold - 0.5 ? "6-12 months" : pd == null ? "6 months (to establish stability), then annually" : "12 months";
  } else if (d >= 5.0) interval = "6-12 months";
  else if (d >= 4.0) interval = pd == null ? "6-12 months (to establish stability), then annually if stable" : (rate != null && rate < 0.1 && d < 4.5) ? "12-24 months (stable on serial imaging)" : "12 months";
  else if (d >= 3.5) interval = e === "bav" ? "2-3 years (BAV with mild dilation)" : "2-3 years (mild dilation, not aneurysmal)";
  else interval = "no dedicated aortic surveillance needed for this size";

  // Modality recommendation
  let mod: string;
  const young = age != null && age < 50;
  if (e === "lds" || e === "veds" || e === "htad_smooth") {
    mod = "MRA (preferred, no radiation) of the entire aorta and branch vessels head-to-pelvis, plus TTE for root";
  } else if (e === "turner") {
    mod = "cardiac MRI/MRA (preferred) with TTE";
  } else if (modality === "tte" && !yes(v, "concordant") && d >= 4.0) {
    mod = "CT angiography (ECG-gated) or MRA to confirm the TTE measurement and define the full extent of the aorta; thereafter TTE may be used if measurements are concordant";
  } else if (d >= 4.5 || referral) {
    mod = "ECG-gated CTA or MRA (more reproducible near intervention thresholds)";
  } else if (segment === "ascending" && modality === "tte") {
    mod = "TTE if the tubular ascending aorta is well visualized and concordant with prior CT/MRI; otherwise CT/MRA";
  } else {
    mod = `TTE if root/ascending are well seen and concordant with CT/MRI; otherwise ${young || genetic ? "MRA (avoids cumulative radiation in younger patients)" : "noncontrast or ECG-gated CT/MRA"}`;
  }
  metrics.push({ label: "Next imaging", value: interval.split(" (")[0], note: mod.split(";")[0] });
  if (!referral) plan.push(`repeat aortic imaging in ${interval} with ${mod}`);
  recs.push({ text: `Surveillance: ${interval}. Modality: ${mod}. Compare to prior with the same modality and convention (CT/MRI inner-edge, double-oblique perpendicular to centerline; TTE leading-edge-to-leading-edge at end-diastole).`, severity: "action", cite: ["aorta2022"], ap: "" });
  if (modality === "ct" && v.ctGated === false && (segment === "root" || segment === "both")) {
    recs.push({ text: "Non-gated CT may overestimate/blur root dimensions due to motion; ECG-gated CTA is preferred for the root.", severity: "info", cite: ["aorta2022"], ap: "" });
  }
  if (t.note && e !== "veds") recs.push({ text: t.note, severity: "info", cite: ["aorta2022"], ap: "" });

  // Medical management
  plan.push(`blood pressure goal <130/80 mmHg${e === "marfan" || e === "lds" ? " with a beta-blocker and/or ARB at maximally tolerated doses" : ""}`);
  recs.push({ text: `BP control to <130/80 mmHg${e === "marfan" ? "; beta-blocker or ARB (or both) at maximally tolerated doses in Marfan (1)" : e === "lds" ? "; beta-blocker or ARB reasonable in LDS" : e === "bav" || e === "sporadic" ? "; beta-blocker/ARB reasonable as antihypertensives" : ""}.`, severity: "action", cite: ["aorta2022"], ap: "" });
  recs.push({ text: "Avoid fluoroquinolones when alternatives exist; smoking cessation; moderate aerobic exercise encouraged; avoid heavy isometric lifting/straining (Valsalva).", severity: "info", cite: ["aorta2022"], ap: "" });
  plan.push("avoid fluoroquinolones, smoking cessation, encourage moderate aerobic exercise while avoiding heavy lifting and straining");

  // Genetics and family screening
  if (e === "bav") {
    recs.push({ text: "BAV with aortopathy: TTE screening of first-degree relatives is reasonable (2a).", severity: "action", cite: ["aorta2022", "valve2020"], ap: "Recommend screening echocardiography of first-degree relatives" });
  } else if (genetic) {
    recs.push({ text: "Heritable aortopathy: genetic counseling/testing (if not done) and cascade screening of first-degree relatives (imaging ± genetic testing).", severity: "action", cite: ["aorta2022"], cor: "1", ap: yes(v, "geneticTested") ? "Recommend cascade screening of first-degree relatives" : "Recommend genetic counseling and testing, and cascade screening of first-degree relatives" });
  } else if (e === "sporadic" && ((age != null && age < 60) || rf.includes("fhx_taa") || rf.includes("fhx_dissection")) && !yes(v, "geneticTested")) {
    recs.push({ text: "Thoracic aortic aneurysm with age <60, or family history of TAD: genetic testing is recommended (1); screen first-degree relatives with aortic imaging.", severity: "action", cite: ["aorta2022"], cor: "1", ap: "Given age and/or family history, recommend genetic testing for heritable thoracic aortic disease and aortic imaging of first-degree relatives" });
  }
  if (e === "marfan" || e === "lds" || e === "htad_smooth") {
    recs.push({ text: "Image the entire aorta at baseline (and periodically in LDS/HTAD) to detect distal aneurysms; LDS also requires head-to-pelvis arterial imaging.", severity: "info", cite: ["aorta2022"], ap: "" });
  }

  const headline = referral
    ? `Refer for surgical evaluation — ${fmt(d, 1)} cm ${etLabel.toLowerCase()}`
    : `${fmt(d, 1)} cm ${segment ?? "aortic"} — surveillance ${interval.split(" (")[0]}`;

  const apExtra = recs.filter((r) => r.ap).map((r) => r.ap!.replace(/\.$/, ""));
  const ap = [
    `${segment === "root" ? "Aortic root" : segment === "both" ? "Aortic root and ascending aortic" : "Ascending aortic"} ${d >= 4.0 ? "aneurysm" : "dilation"}: ${ageSex(v)} with ${etLabel === "Degenerative / sporadic (TAV)" ? "sporadic (tricuspid valve) disease" : etLabel}, maximal diameter ${fmt(d, 1)} cm by ${modality ? modality.toUpperCase() : "imaging"}${pd != null && py != null ? ` (previously ${fmt(pd, 1)} cm ${fmt(py, 1)} year${py === 1 ? "" : "s"} ago, ${fmt(rate!, 2)} cm/yr)` : ""}${ahi != null ? `; aortic height index ${fmt(ahi, 2)} cm/m` : ""}${e === "turner" && asi != null ? `; ASI ${fmt(asi, 2)} cm/m²` : ""}.`,
    referral
      ? `Per the 2022 ACC/AHA aortic disease guideline, this meets criteria for surgical referral.`
      : e !== "veds" && e !== "turner" ? `Per the 2022 ACC/AHA aortic disease guideline, below the surgical threshold (${t.surgery.toFixed(1)} cm${t.earlier ? `; ${t.earlier.cm.toFixed(1)} cm if ${t.earlier.when}` : ""}).` : "",
    `Plan: ${plan.join("; ")}.`,
    apExtra.length ? apExtra.join(". ") + "." : "",
  ].filter(Boolean).join(" ");

  return { headline, metrics, recommendations: recs, missing, ap };
}

export const aortaModule: ClinicalModule = {
  id: "aorta",
  title: "Ascending Aorta",
  short: "Aorta",
  icon: "🩻",
  description: "Root/ascending aneurysm: surgical thresholds by etiology, indexed size, growth, next imaging timing & modality — 2022 ACC/AHA.",
  placeholder: "e.g. 64M, TTE ascending aorta 4.7 cm (was 4.4 on CT 2 years ago), tricuspid valve, 5'9\" 185 lb, BP 138/84 on amlodipine, no family history",
  fields,
  evaluate: evaluateAorta,
  citations: cites("aorta2022", "zafar2018", "valve2020"),
};

