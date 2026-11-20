import { describe, expect, it } from "vitest";
import { bpCategory, evaluateHtn } from "@/lib/modules/htn";
import { evaluateHf, hfType } from "@/lib/modules/hf";
import { evaluateHcm, hcmRiskScd } from "@/lib/modules/hcm";
import { evaluateAttr, mayoStage, nacStage } from "@/lib/modules/attr";
import { asSeverity, evaluateValve, regurgSeverity } from "@/lib/modules/valve";
import { chadsVasc, crCl, doacDose, evaluateAf } from "@/lib/modules/af";
import { evaluateSyncope } from "@/lib/modules/syncope";
import { evaluateChestPain, pretestProbability } from "@/lib/modules/chestpain";

const joined = (r: { recommendations: { text: string }[] }) => r.recommendations.map((x) => x.text).join(" | ");

describe("Hypertension", () => {
  it("categories", () => {
    expect(bpCategory(118, 78).key).toBe("normal");
    expect(bpCategory(125, 78).key).toBe("elevated");
    expect(bpCategory(128, 82).key).toBe("stage1");
    expect(bpCategory(142, 70).key).toBe("stage2");
  });
  it("untreated stage 2 → two-drug single-pill combination", () => {
    const r = evaluateHtn({ sbp: 152, dbp: 94, age: 50, sex: "male" });
    expect(joined(r)).toMatch(/single-pill/);
  });
  it("stage 1 low PREVENT → lifestyle 3-6 months; diabetes → meds", () => {
    const base = { age: 55, sex: "male", sbp: 136, dbp: 84, totalChol: 210, hdl: 45, egfr: 90, bmi: 28, smoker: false, statin: "none" };
    expect(evaluateHtn({ ...base, diabetes: false }).headline).toMatch(/lifestyle/);
    expect(evaluateHtn({ ...base, diabetes: true }).headline).toMatch(/start medication/);
  });
  it("uncontrolled on 3 first-line classes → resistant: spironolactone + PA screen", () => {
    const r = evaluateHtn({ sbp: 148, dbp: 88, meds: ["ccb", "acei_arb", "thiazide"], k: 4.0, egfr: 70 });
    expect(r.headline).toMatch(/resistant/i);
    expect(joined(r)).toMatch(/spironolactone/);
    expect(joined(r)).toMatch(/primary aldosteronism/);
  });
  it("pregnancy flags ACEi/ARB contraindication", () => {
    expect(joined(evaluateHtn({ sbp: 150, dbp: 95, sex: "female", pregnancy: true }))).toMatch(/labetalol/);
  });
});

describe("Heart failure", () => {
  it("classifies EF", () => {
    expect(hfType(30, null).key).toBe("hfref");
    expect(hfType(45, null).key).toBe("hfmref");
    expect(hfType(45, 30).key).toBe("hfimpef");
    expect(hfType(60, null).key).toBe("hfpef");
  });
  it("HFrEF on ACEi + BB → ARNI switch, MRA, SGLT2i; ICD and CRT", () => {
    const r = evaluateHf({ ef: 30, monthsGdmt: 4, nyha: "2", sbp: 112, hr: 74, k: 4.4, egfr: 58, raas: "acei", bb: "ebb", mra: "none", sglt2: false, qrs: 156, lbbb: true });
    expect(r.ap).toMatch(/sacubitril\/valsartan/);
    expect(r.ap).toMatch(/spironolactone/);
    expect(r.ap).toMatch(/dapagliflozin/);
    expect(joined(r)).toMatch(/ICD recommended/);
    expect(joined(r)).toMatch(/CRT indicated/);
  });
  it("withholds MRA when K ≥5.0", () => {
    const r = evaluateHf({ ef: 30, nyha: "2", sbp: 110, k: 5.3, egfr: 60, raas: "arni", bb: "ebb", mra: "none", sglt2: true });
    expect(joined(r)).toMatch(/MRA withheld/);
  });
  it("HFpEF → SGLT2i + finerenone, incretin if obese", () => {
    const r = evaluateHf({ ef: 60, nyha: "2", sbp: 138, k: 4.2, egfr: 55, bmi: 36, mra: "none", sglt2: false });
    expect(r.ap).toMatch(/finerenone 10 mg/);
    expect(joined(r)).toMatch(/semaglutide|tirzepatide/);
  });
});

describe("HCM", () => {
  it("HCM Risk-SCD matches the published calculator example", () => {
    // 45 y, MWT 22, LA 44, LVOT 85, no FHx/NSVT/syncope ≈ 3.2%
    expect(hcmRiskScd({ age: 45, maxWall: 22, la: 44, lvot: 85, fhxScd: false, nsvt: false, syncope: false })).toBeCloseTo(3.2, 1);
  });
  it("major risk marker → ICD 2a", () => {
    const r = evaluateHcm({ age: 30, maxWall: 31, la: 40, lvotRest: 10, ef: 65 });
    expect(joined(r)).toMatch(/massive LVH/);
    expect(r.headline).toMatch(/ICD reasonable/);
  });
  it("symptomatic oHCM on BB → myosin inhibitor; EF <50 on CMI → hold", () => {
    expect(evaluateHcm({ age: 50, maxWall: 20, la: 42, lvotProvoked: 80, ef: 68, nyha: "2", meds: ["bb"] }).ap).toMatch(/myosin inhibitor/);
    expect(joined(evaluateHcm({ age: 50, maxWall: 20, la: 42, lvotRest: 40, ef: 45, nyha: "2", meds: ["bb", "mavacamten"] }))).toMatch(/interrupt/);
  });
});

describe("ATTR-CM", () => {
  it("staging", () => {
    expect(nacStage(2000, 60)).toBe(1);
    expect(nacStage(4000, 60)).toBe(2);
    expect(nacStage(4000, 40)).toBe(3);
    expect(mayoStage(4000, 0.06)).toBe(3);
  });
  it("monoclonal protein blocks a scintigraphy diagnosis", () => {
    const r = evaluateAttr({ kappa: 120, lambda: 10, ife: "positive", pyp: "3", spect: true, egfr: 70 });
    expect(r.headline).toMatch(/AL/);
  });
  it("grade 3 + no monoclonal protein → ATTR, genetic testing, therapy", () => {
    const r = evaluateAttr({ kappa: 28, lambda: 19, ife: "negative", pyp: "3", spect: true, egfr: 52, ntprobnp: 2400 });
    expect(r.headline).toMatch(/ATTR-CM/);
    expect(joined(r)).toMatch(/TTR gene sequencing/);
    expect(joined(r)).toMatch(/tafamidis/);
  });
  it("CKD widens the FLC reference range", () => {
    const r = evaluateAttr({ flcRatio: 2.0, ife: "negative", pyp: "3", spect: true, egfr: 40 });
    expect(r.headline).not.toMatch(/AL/);
  });
});

describe("Valve", () => {
  it("AS severity and very severe", () => {
    expect(asSeverity({ vmax: 4.2 }).sev).toBe(3);
    expect(asSeverity({ vmax: 3.4, mg: 25 }).sev).toBe(2);
    expect(asSeverity({ vmax: 5.1 }).veryRaw).toBe(true);
  });
  it("symptomatic severe AS → AVR class 1", () => {
    expect(evaluateValve({ lesion: "as", vmax: 4.5, symptoms: true, age: 82 }).headline).toMatch(/\(1\)/);
  });
  it("moderate AS → echo every 1-2 years", () => {
    expect(evaluateValve({ lesion: "as", vmax: 3.4, mg: 26, ef: 60 }).headline).toMatch(/1-2 years/);
  });
  it("MR severity by median of parameters", () => {
    expect(regurgSeverity({ eroa: 0.45, rvol: 70, rf: 55 }, "mr").sev).toBe(3);
    expect(regurgSeverity({ eroa: 0.25, rvol: 40 }, "mr").sev).toBe(2);
  });
  it("asymptomatic severe AR with LVESD >50 → 2a", () => {
    expect(evaluateValve({ lesion: "ar", reported: "3", ef: 60, lvesd: 52 }).headline).toMatch(/2a/);
  });
  it("AF with rheumatic MS → warfarin not DOAC", () => {
    expect(joined(evaluateValve({ lesion: "ms", mva: 1.2, af: true }))).toMatch(/warfarin/);
  });
});

describe("Atrial fibrillation", () => {
  it("CHA2DS2-VASc", () => {
    expect(chadsVasc({ age: 81, sex: "female", htn: true, diabetes: true })).toBe(5);
    expect(chadsVasc({ age: 50, sex: "male" })).toBe(0);
  });
  it("apixaban dose reduction needs 2 of 3 criteria", () => {
    expect(doacDose("apixaban", { age: 81, kg: 58, cr: 1.0, crcl: 40, dialysis: false, pgp: false }).mg).toBe(2.5);
    expect(doacDose("apixaban", { age: 81, kg: 70, cr: 1.0, crcl: 50, dialysis: false, pgp: false }).mg).toBe(5);
  });
  it("rivaroxaban / dabigatran / edoxaban renal dosing", () => {
    expect(doacDose("rivaroxaban", { age: 70, kg: 70, cr: 1.5, crcl: 40, dialysis: false, pgp: false }).mg).toBe(15);
    expect(doacDose("dabigatran", { age: 70, kg: 70, cr: 2, crcl: 25, dialysis: false, pgp: false }).mg).toBe(75);
    expect(doacDose("edoxaban", { age: 40, kg: 90, cr: 0.7, crcl: 140, dialysis: false, pgp: false }).mg).toBeNull();
  });
  it("Cockcroft-Gault", () => {
    expect(crCl(80, 60, 1, true)).toBeCloseTo(42.5, 1);
  });
  it("flags underdosed apixaban", () => {
    const r = evaluateAf({ age: 70, sex: "male", htn: true, diabetes: true, weightKg: 85, creatinine: 1.0, oac: "apixaban", oacDose: 2.5 });
    expect(joined(r)).toMatch(/underdosing/);
  });
  it("low score → no anticoagulation; mechanical valve → warfarin", () => {
    expect(evaluateAf({ age: 50, sex: "male" }).headline).toMatch(/no anticoagulation/);
    expect(joined(evaluateAf({ age: 50, sex: "male", mechValve: true, oac: "apixaban" }))).toMatch(/warfarin required/);
  });
});

describe("Syncope", () => {
  it("reflex picture stays low risk", () => {
    const r = evaluateSyncope({ age: 24, sex: "female", reflex: ["standing", "prodrome"], ecgNormal: true, supSbp: 118, stdSbp: 112 });
    expect(r.headline).toMatch(/Reflex/);
  });
  it("exertional syncope → cardiac workup with echo and exercise test", () => {
    const r = evaluateSyncope({ age: 30, sex: "male", cardiac: ["exertional"] });
    expect(r.headline).toMatch(/cardiac/);
    expect(joined(r)).toMatch(/exercise stress test/);
  });
  it("orthostatic hypotension detected", () => {
    expect(evaluateSyncope({ age: 78, supSbp: 140, stdSbp: 112, supHr: 70, stdHr: 74 }).headline).toMatch(/Orthostatic/);
  });
  it("Mobitz II → pacemaker", () => {
    expect(joined(evaluateSyncope({ age: 75, ecg: ["mobitz2"] }))).toMatch(/pacemaker/);
  });
});

describe("Chest pain", () => {
  it("pretest probability table", () => {
    expect(pretestProbability(56, "male", 3, false)).toBe(32);
    expect(pretestProbability(45, "female", 1, false)).toBe(2);
  });
  it("acute features → ED", () => {
    expect(evaluateChestPain({ acute: true }).headline).toMatch(/ED/);
  });
  it("intermediate risk <65 → CCTA; ≥65 → stress imaging", () => {
    expect(evaluateChestPain({ age: 56, sex: "male", features: ["constrictive", "exertional", "relieved"] }).headline).toMatch(/CCTA/);
    expect(evaluateChestPain({ age: 72, sex: "male", features: ["constrictive", "exertional", "relieved"] }).headline).toMatch(/stress imaging/);
  });
  it("low risk → defer", () => {
    expect(evaluateChestPain({ age: 42, sex: "female", features: ["constrictive"] }).headline).toMatch(/deferred/);
  });
  it("high-risk anatomy → ICA", () => {
    expect(evaluateChestPain({ age: 60, sex: "male", result: "high_risk_anatomy" }).headline).toMatch(/invasive/);
  });
});

import { ctrcd, doxEquivalent, evaluateCardioOnc, hfaIcos } from "@/lib/modules/cardioonc";

describe("Cardio-oncology", () => {
  it("HFA-ICOS", () => {
    expect(hfaIcos({ hfCm: true }).risk).toBe("very high");
    expect(hfaIcos({ age: 50, cad: true }).risk).toBe("high");
    expect(hfaIcos({ age: 70, riskFactors: ["htn"] }).risk).toBe("moderate");
    expect(hfaIcos({ age: 45 }).risk).toBe("low");
  });
  it("doxorubicin equivalents", () => {
    expect(doxEquivalent("epirubicin", 400)).toBe(320);
    expect(doxEquivalent("doxorubicin", 240)).toBe(240);
  });
  it("CTRCD grading", () => {
    expect(ctrcd({ ef: 38 }).grade).toBe("severe");
    expect(ctrcd({ ef: 45, baselineEf: 60 }).grade).toBe("moderate");
    expect(ctrcd({ ef: 55, baselineEf: 62, glsDrop: 17 }).grade).toBe("mild");
    expect(ctrcd({ ef: 58, baselineEf: 62, glsDrop: 8 }).grade).toBe("none");
  });
  it("HER2 surveillance every 3 months at low risk", () => {
    const r = evaluateCardioOnc({ age: 45, sex: "female", phase: "on", therapies: ["her2"], baselineEf: 62 });
    expect(r.recommendations.map((x) => x.text).join(" ")).toMatch(/every 3 months/);
  });
  it("ICI myocarditis → steroids and admission", () => {
    expect(evaluateCardioOnc({ therapies: ["ici"], iciMyocarditis: true }).headline).toMatch(/myocarditis/);
  });
  it("high-risk survivor → echo at 1, 3, 5 years", () => {
    const r = evaluateCardioOnc({ phase: "survivor", therapies: ["anthracycline"], anthraAgent: "doxorubicin", anthraDose: 300 });
    expect(r.ap).toMatch(/1, 3 and 5 years/);
  });
});
