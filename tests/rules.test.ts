import { describe, expect, it } from "vitest";
import { evaluateAscvd } from "@/lib/modules/ascvd";
import { evaluateCac } from "@/lib/modules/cac";
import { evaluateAorta } from "@/lib/modules/aorta";
import { evaluatePa, interpretPa } from "@/lib/modules/pa";
import { evaluatePeriop, rcri } from "@/lib/modules/periop";
import { stepsToGoal } from "@/lib/lipids";
import { MODULES } from "@/lib/modules";
import { extractionSchema } from "@/lib/schema";

const joined = (r: { recommendations: { text: string }[] }) => r.recommendations.map((x) => x.text).join(" | ");

// ---------------------------------------------------------------- ASCVD
describe("ASCVD", () => {
  const primary = {
    age: 58, sex: "male", totalChol: 220, hdl: 42, sbp: 138, bpTx: true, egfr: 85, bmi: 31,
    diabetes: false, smoker: false, ldl: 142, statin: "none",
  };

  it("very-high-risk ASCVD gets LDL <55 and nonstatin escalation", () => {
    const r = evaluateAscvd({ age: 67, sex: "male", priorAscvd: true, ascvdEvents: ["mi"], diabetes: true, bpTx: true, ldl: 82, statin: "high", ezetimibe: false });
    expect(r.headline).toMatch(/Very-high-risk/);
    expect(r.headline).toMatch(/<55/);
    expect(r.ap).toMatch(/ezetimibe|PCSK9/);
  });

  it("ASCVD without enough high-risk conditions gets LDL <70", () => {
    const r = evaluateAscvd({ age: 55, sex: "male", priorAscvd: true, ascvdEvents: ["mi"], ldl: 60, statin: "high" });
    expect(r.headline).toMatch(/<70/);
    expect(r.ap).toMatch(/at goal/);
  });

  it("two major events = very high risk", () => {
    const r = evaluateAscvd({ age: 55, sex: "female", priorAscvd: true, ascvdEvents: ["mi", "stroke"], ldl: 60, statin: "high" });
    expect(r.headline).toMatch(/<55/);
  });

  it("primary prevention computes PREVENT and gives a category", () => {
    const r = evaluateAscvd(primary);
    expect(r.metrics.find((m) => m.label === "PREVENT 10-yr ASCVD")).toBeTruthy();
    expect(r.headline).toMatch(/Primary prevention/);
  });

  it("CAC ≥1000 drives LDL goal <55", () => {
    const r = evaluateAscvd({ ...primary, cac: 1200 });
    expect(r.headline).toMatch(/<55/);
  });

  it("CAC 100-999 drives LDL goal <70", () => {
    const r = evaluateAscvd({ ...primary, cac: 250 });
    expect(r.headline).toMatch(/<70/);
  });

  it("CAC 0 in intermediate risk without enhancers defers statin", () => {
    const r = evaluateAscvd({ age: 62, sex: "male", totalChol: 210, hdl: 45, sbp: 132, bpTx: true, egfr: 90, bmi: 27, ldl: 130, statin: "none", cac: 0, lpa: 20, lpaUnit: "mg/dL" });
    expect(joined(r)).toMatch(/defer statin/);
    expect(r.ap).toMatch(/defer statin/);
  });

  it("CAC 0 does not defer with diabetes", () => {
    const r = evaluateAscvd({ age: 62, sex: "male", totalChol: 210, hdl: 45, sbp: 132, bpTx: true, egfr: 90, bmi: 27, ldl: 130, statin: "none", cac: 0, diabetes: true });
    expect(r.ap).not.toMatch(/defer statin/);
  });

  it("LDL ≥190 triggers high-intensity statin and FH evaluation", () => {
    const r = evaluateAscvd({ age: 40, sex: "female", ldl: 210, statin: "none", totalChol: 290, hdl: 55, sbp: 118, egfr: 100, bmi: 24 });
    expect(r.headline).toMatch(/Severe hypercholesterolemia/);
    expect(r.ap).toMatch(/high-intensity statin/);
    expect(r.ap).toMatch(/familial hypercholesterolemia/);
  });

  it("elevated Lp(a) in nmol/L is recognized", () => {
    const r = evaluateAscvd({ ...primary, lpa: 160, lpaUnit: "nmol/L" });
    expect(joined(r)).toMatch(/Lp\(a\) 160 nmol\/L/);
  });

  it("missing Lp(a) prompts one-time measurement", () => {
    expect(evaluateAscvd(primary).ap).toMatch(/lipoprotein\(a\)/i);
  });

  it("CKD 3 gets LDL <55", () => {
    const r = evaluateAscvd({ ...primary, egfr: 45 });
    expect(r.headline).toMatch(/<55/);
  });

  it("TG ≥1000 is urgent", () => {
    const r = evaluateAscvd({ ...primary, tg: 1200 });
    expect(r.recommendations.some((x) => x.severity === "urgent")).toBe(true);
  });

  it("low PREVENT with low LDL gets lifestyle only", () => {
    const r = evaluateAscvd({ age: 35, sex: "female", totalChol: 170, hdl: 65, sbp: 112, bpTx: false, egfr: 105, bmi: 22, ldl: 90, statin: "none", lpa: 10 });
    expect(r.ap).toMatch(/statin not indicated/);
  });
});

describe("lipid escalation", () => {
  it("adds ezetimibe after high-intensity statin", () => {
    const s = stepsToGoal(80, 70, { statin: "high", ezetimibe: false, pcsk9: false, bempedoic: false, statinIntolerant: false }, false);
    expect(s[0].action).toMatch(/ezetimibe/);
    expect(s).toHaveLength(1);
  });
  it("jumps to PCSK9 for large gap in very high risk", () => {
    const s = stepsToGoal(120, 55, { statin: "high", ezetimibe: false, pcsk9: false, bempedoic: false, statinIntolerant: false }, true);
    expect(s[0].action).toMatch(/PCSK9/);
  });
  it("statin-intolerant path skips statin", () => {
    const s = stepsToGoal(160, 100, { statin: "none", ezetimibe: false, pcsk9: false, bempedoic: false, statinIntolerant: true }, false);
    expect(s[0].action).not.toMatch(/statin \(/);
  });
});

// ---------------------------------------------------------------- CAC
describe("CAC", () => {
  it("CAC 0 without risk features defers statin, repeat 5-7 y", () => {
    const r = evaluateCac({ age: 55, sex: "male", cac: 0, ldl: 130, statin: "none" });
    expect(r.ap).toMatch(/defer statin/);
    expect(r.ap).toMatch(/5-7 years/);
  });
  it("CAC 0 with diabetes shortens rescan and does not defer", () => {
    const r = evaluateCac({ age: 55, sex: "male", cac: 0, diabetes: true, ldl: 130, statin: "none" });
    expect(r.ap).not.toMatch(/defer statin therapy given/);
  });
  it("CAC 1-99 → statin, LDL <100", () => {
    const r = evaluateCac({ age: 60, sex: "female", cac: 40, ldl: 130, statin: "none" });
    expect(r.headline).toMatch(/<100/);
    expect(r.ap).toMatch(/moderate-intensity statin/);
  });
  it("CAC ≥75th percentile upgrades to LDL <70", () => {
    const r = evaluateCac({ age: 50, sex: "female", cac: 40, percentile: 90, ldl: 130, statin: "none" });
    expect(r.headline).toMatch(/<70/);
  });
  it("CAC 300 suggests aspirin consideration (age 40-70, low bleed risk)", () => {
    const r = evaluateCac({ age: 60, sex: "male", cac: 300, ldl: 100, statin: "none" });
    expect(r.ap).toMatch(/aspirin/);
    expect(r.headline).toMatch(/<70/);
  });
  it("CAC ≥1000 → LDL <55", () => {
    expect(evaluateCac({ age: 66, sex: "male", cac: 1500, ldl: 100, statin: "high" }).headline).toMatch(/<55/);
  });
  it("symptoms trigger ischemic evaluation", () => {
    const r = evaluateCac({ age: 60, sex: "male", cac: 20, symptoms: true });
    expect(r.recommendations[0].severity).toBe("urgent");
  });
  it("qualitative non-gated calcium works without a score", () => {
    const r = evaluateCac({ age: 60, sex: "male", qualitative: "moderate" });
    expect(r.headline).toMatch(/A2/);
  });
  it("computes MESA when inputs provided", () => {
    const r = evaluateCac({ age: 60, sex: "male", race: "white", cac: 150, totalChol: 200, hdl: 45, sbp: 130 });
    expect(r.metrics.find((m) => m.label === "MESA 10-yr CHD")).toBeTruthy();
  });
});

// ---------------------------------------------------------------- Aorta
describe("Aorta", () => {
  it("sporadic 5.5 cm → surgical referral", () => {
    const r = evaluateAorta({ diameter: 5.5, etiology: "sporadic", modality: "ct" });
    expect(r.headline).toMatch(/Refer/);
  });
  it("sporadic 5.2 cm without low surgical risk → no referral, 6-12 mo", () => {
    const r = evaluateAorta({ diameter: 5.2, etiology: "sporadic", modality: "ct", priorDiameter: 5.1, priorYears: 1 });
    expect(r.headline).not.toMatch(/Refer/);
    expect(r.ap).toMatch(/6-12 months/);
  });
  it("sporadic 5.0 cm with low surgical risk at experienced center → referral", () => {
    const r = evaluateAorta({ diameter: 5.0, etiology: "sporadic", lowSurgicalRisk: true });
    expect(r.headline).toMatch(/Refer/);
  });
  it("Marfan 5.0 → referral; 4.6 with FHx dissection → referral", () => {
    expect(evaluateAorta({ diameter: 5.0, etiology: "marfan" }).headline).toMatch(/Refer/);
    expect(evaluateAorta({ diameter: 4.6, etiology: "marfan", riskFeatures: ["fhx_dissection"] }).headline).toMatch(/Refer/);
    expect(evaluateAorta({ diameter: 4.6, etiology: "marfan" }).headline).not.toMatch(/Refer/);
  });
  it("LDS TGFBR2 4.5 → referral", () => {
    expect(evaluateAorta({ diameter: 4.5, etiology: "lds", ldsGene: "tgfbr" }).headline).toMatch(/Refer/);
  });
  it("BAV 5.1 with coarctation → referral; without → not", () => {
    expect(evaluateAorta({ diameter: 5.1, etiology: "bav", riskFeatures: ["coarctation"] }).headline).toMatch(/Refer/);
    expect(evaluateAorta({ diameter: 5.1, etiology: "bav" }).headline).not.toMatch(/Refer/);
  });
  it("rapid growth ≥0.5 cm/yr → referral", () => {
    const r = evaluateAorta({ diameter: 4.8, priorDiameter: 4.2, priorYears: 1, etiology: "sporadic", modality: "ct", priorModality: "ct" });
    expect(r.headline).toMatch(/Refer/);
  });
  it("growth 0.3 cm/yr → shortens interval to 6 months", () => {
    const r = evaluateAorta({ diameter: 4.6, priorDiameter: 4.3, priorYears: 1, etiology: "sporadic" });
    expect(r.ap).toMatch(/6 months/);
  });
  it("modality change is flagged", () => {
    const r = evaluateAorta({ diameter: 4.6, priorDiameter: 4.3, priorYears: 1, modality: "tte", priorModality: "ct" });
    expect(joined(r)).toMatch(/inter-modality/);
  });
  it("TTE ≥4.0 not yet confirmed → recommends CT/MRA confirmation", () => {
    const r = evaluateAorta({ diameter: 4.3, modality: "tte", etiology: "sporadic" });
    expect(r.ap).toMatch(/CT angiography|MRA/);
  });
  it("computes AHI and ASI", () => {
    const r = evaluateAorta({ diameter: 4.5, heightCm: 175, weightKg: 80 });
    const ahi = r.metrics.find((m) => m.label === "Aortic height index")!;
    expect(ahi.value).toBe("2.57 cm/m");
    expect(r.metrics.find((m) => m.label === "Aortic size index")).toBeTruthy();
  });
  it("Turner uses ASI", () => {
    const r = evaluateAorta({ diameter: 3.8, etiology: "turner", heightCm: 145, weightKg: 45, age: 25 });
    expect(r.headline).toMatch(/Refer/); // BSA ~1.35 -> ASI ~2.8
  });
  it("concomitant cardiac surgery ≥4.5 → replace", () => {
    const r = evaluateAorta({ diameter: 4.6, concomitantSurgery: true });
    expect(r.ap).toMatch(/concomitant aortic replacement/);
  });
  it("symptoms → urgent", () => {
    expect(evaluateAorta({ diameter: 4.2, symptoms: true }).recommendations.some((x) => x.severity === "urgent")).toBe(true);
  });
  it("rejects mm entered as cm", () => {
    expect(evaluateAorta({ diameter: 45 }).headline).toMatch(/out of range/);
  });
});

// ---------------------------------------------------------------- PA
describe("Primary aldosteronism", () => {
  it("LC-MS/MS positive screen", () => {
    const r = interpretPa({ aldo: 14, aldoUnit: "ng/dL", aldoAssay: "lcms", renin: 0.4, reninType: "pra" })!;
    expect(r.status).toBe("positive");
    expect(r.arr).toBeCloseTo(28, 0); // floored PRA 0.5
  });
  it("immunoassay threshold of 10 ng/dL", () => {
    expect(interpretPa({ aldo: 9, aldoAssay: "immuno", renin: 0.3, reninType: "pra" })!.status).toBe("indeterminate");
    expect(interpretPa({ aldo: 9, aldoAssay: "lcms", renin: 0.3, reninType: "pra" })!.status).toBe("positive");
  });
  it("DRC and pmol/L units", () => {
    const r = interpretPa({ aldo: 450, aldoUnit: "pmol/L", aldoAssay: "immuno", renin: 3, reninType: "drc_mu" })!;
    expect(r.status).toBe("positive");
    expect(r.arr).toBeCloseTo(150, 0);
  });
  it("renin not suppressed on ACEi/diuretic → possible false negative", () => {
    const r = evaluatePa({ aldo: 12, aldoAssay: "lcms", renin: 3.5, reninType: "pra", meds: ["acei", "diuretic"] });
    expect(r.headline).toMatch(/Indeterminate/);
    expect(r.ap).toMatch(/mask primary aldosteronism/);
  });
  it("positive on ARB strengthens the result", () => {
    const r = evaluatePa({ aldo: 16, aldoAssay: "lcms", renin: 0.3, reninType: "pra", meds: ["arb"] });
    expect(r.ap).toMatch(/strengthens/);
  });
  it("positive on beta-blocker flags possible false positive when modest", () => {
    const r = evaluatePa({ aldo: 9, aldoAssay: "lcms", renin: 0.4, reninType: "pra", meds: ["bb"], k: 4.2 });
    expect(joined(r)).toMatch(/false positive/i);
  });
  it("hypokalemia flagged", () => {
    const r = evaluatePa({ aldo: 6, aldoAssay: "lcms", renin: 0.3, reninType: "pra", k: 3.1 });
    expect(r.ap).toMatch(/replete/);
  });
  it("spontaneous hypokalemia + aldo ≥20 → skip confirmatory testing", () => {
    const r = evaluatePa({ aldo: 25, aldoAssay: "lcms", renin: 0.2, reninType: "pra", k: 3.0, clinical: ["hypok_spont"] });
    expect(r.ap).toMatch(/bypassed/);
    expect(r.ap).toMatch(/adrenal-protocol CT/);
  });
  it("negative screen without interfering meds", () => {
    const r = evaluatePa({ aldo: 8, aldoAssay: "lcms", renin: 2.5, reninType: "pra", meds: ["verapamil"] });
    expect(r.headline).toMatch(/Negative/);
  });
  it("estrogen with DRC → false-positive warning", () => {
    const r = evaluatePa({ aldo: 10, aldoAssay: "lcms", renin: 4, reninType: "drc_mu", meds: ["estrogen"] });
    expect(joined(r)).toMatch(/Estrogen/);
  });
});

// ---------------------------------------------------------------- Periop
describe("Perioperative", () => {
  it("RCRI counting", () => {
    expect(rcri({ surgeryType: "intraperitoneal", ihd: true, insulin: true, creatinine: 2.4 }).score).toBe(4);
  });
  it("low-risk surgery → proceed", () => {
    expect(evaluatePeriop({ surgeryType: "cataract", urgency: "elective", ihd: true }).headline).toMatch(/Low risk/);
  });
  it("emergency → proceed", () => {
    expect(evaluatePeriop({ surgeryType: "intraperitoneal", urgency: "emergency" }).headline).toMatch(/Emergency/);
  });
  it("active ACS → delay", () => {
    expect(evaluatePeriop({ surgeryType: "ortho_major", urgency: "elective", active: ["acs"] }).headline).toMatch(/delay/);
  });
  it("elevated risk, good functional capacity → proceed", () => {
    expect(evaluatePeriop({ surgeryType: "intraperitoneal", ihd: true, functional: "good", age: 70 }).headline).toMatch(/good functional/);
  });
  it("elevated risk, poor FC, no BNP → check BNP", () => {
    expect(evaluatePeriop({ surgeryType: "intraperitoneal", ihd: true, functional: "poor", age: 70 }).headline).toMatch(/BNP/);
  });
  it("DASI >34 counts as good functional capacity", () => {
    expect(evaluatePeriop({ surgeryType: "intraperitoneal", ihd: true, dasi: 40, age: 70 }).headline).toMatch(/good functional/);
  });
  it("elevated NT-proBNP → monitoring", () => {
    const r = evaluatePeriop({ surgeryType: "intraperitoneal", ihd: true, functional: "poor", ntprobnp: 900, age: 70 });
    expect(r.headline).toMatch(/BNP elevated/);
    expect(r.ap).toMatch(/troponin/);
  });
  it("recent DES delays elective surgery", () => {
    const r = evaluatePeriop({ surgeryType: "ortho_major", urgency: "elective", stent: "des", stentMonths: 4, functional: "good" });
    expect(r.ap).toMatch(/at least 6 months/);
  });
  it("DES for ACS requires 12 months for elective", () => {
    const r = evaluatePeriop({ surgeryType: "ortho_major", urgency: "elective", stent: "des", stentMonths: 8, stentForAcs: true });
    expect(r.ap).toMatch(/at least 12 months/);
  });
  it("time-sensitive surgery ≥3 months after DES acceptable", () => {
    const r = evaluatePeriop({ surgeryType: "intraperitoneal", urgency: "time_sensitive", stent: "des", stentMonths: 4 });
    expect(r.ap).not.toMatch(/deferring elective surgery/);
  });
  it("apixaban high bleed risk → hold 2 days", () => {
    const r = evaluatePeriop({ surgeryType: "ortho_major", anticoag: "apixaban", procBleed: "high" });
    expect(r.ap).toMatch(/hold apixaban 2 days/);
  });
  it("dabigatran CrCl <50 low bleed → hold 2 days", () => {
    const r = evaluatePeriop({ surgeryType: "ortho_major", anticoag: "dabigatran", crcl: 40, procBleed: "low" });
    expect(r.ap).toMatch(/hold dabigatran 2 days/);
  });
  it("SGLT2 hold 3 days", () => {
    expect(evaluatePeriop({ surgeryType: "ortho_major", meds: ["sglt2"] }).ap).toMatch(/SGLT2 inhibitor 3 days/);
  });
  it("symptomatic severe AS → AVR first", () => {
    const r = evaluatePeriop({ surgeryType: "ortho_major", valve: ["severe_as"], active: ["sx_valve"] });
    expect(r.ap).toMatch(/aortic valve replacement/);
  });
});

// ---------------------------------------------------------------- Schema
describe("extraction schema", () => {
  it("builds a strict JSON schema for every module", () => {
    for (const m of MODULES) {
      const s = extractionSchema(m) as { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean };
      expect(s.additionalProperties).toBe(false);
      expect(s.required.length).toBe(Object.keys(s.properties).length);
      expect(s.properties.fields).toBeTruthy();
    }
  });
  it("every module returns an A&P for empty-ish input without throwing", () => {
    for (const m of MODULES) expect(() => m.evaluate({})).not.toThrow();
  });
});
