import { describe, expect, it } from "vitest";
import { detectModulesLocal, localExtract, localFacts } from "@/lib/visit/local";
import { deriveInputs, runVisit, sharedFields, unifyShared, visitBillingHints } from "@/lib/visit/plan";

const NOTE = "68-year-old man, CAC 340, 82nd percentile, BP 150/92 on lisinopril 20, paroxysmal AF on apixaban 5 mg BID, weight 82 kg, Cr 1.0, HR 72, EF 60%, palpitations, LDL 128, total cholesterol 205, HDL 44, not on a statin, takes aspirin 81, nonsmoker, no diabetes.";

describe("whole-visit local fallback", () => {
  it("detects CAC, HTN and AF (and not ASCVD when a CAC score is given)", () => {
    expect(detectModulesLocal(NOTE)).toEqual(["htn", "af", "cac"]);
  });
  it("pulls the common facts", () => {
    const f = localFacts(NOTE);
    expect(f).toMatchObject({ age: "68", sex: "male", cac: "340", percentile: "82", sbp: "150", dbp: "92", hr: "72", ef: "60", ldl: "128", totalChol: "205", hdl: "44",
      statin: "none", aspirin: "true", smoker: "false", diabetes: "false", afType: "paroxysmal", oac: "apixaban", oacDose: "5", weightKg: "82", creatinine: "1", meds: "acei_arb", symptomatic: "true" });
  });
  it("negation and sex forms", () => {
    expect(localFacts("72F, denies diabetes, no HTN, former smoker").diabetes).toBe("false");
    expect(localFacts("72F, denies diabetes, no HTN, former smoker")).toMatchObject({ age: "72", sex: "female", htn: "false", smoker: "false" });
    expect(localFacts("55 yo woman with T2DM").diabetes).toBe("true");
    expect(localFacts("on atorvastatin 40").statin).toBe("high");
  });
  it("fits facts per module (HTN statin is yes/no)", () => {
    const x = localExtract(NOTE + " atorvastatin 80", ["htn", "cac"]);
    expect(x.htn.meds).toEqual(["acei_arb"]);
    expect(x.cac.meds).toBeUndefined();
  });
});

describe("whole-visit merge", () => {
  const ids = ["cac", "htn", "af"];
  const inputs = unifyShared(localExtract(NOTE, ids), ids).inputs;

  it("shares age/sex/sbp but not module-specific keys", () => {
    const keys = sharedFields(ids).map((s) => s.key);
    expect(keys).toEqual(expect.arrayContaining(["age", "sex", "sbp", "diabetes"]));
    expect(keys).not.toContain("statin");
    expect(keys).not.toContain("symptoms");
  });

  it("derives the CHA2DS2-VASc HTN point and bpTx from the HTN module", () => {
    const { effective, derived } = deriveInputs(inputs, ids);
    expect(effective.af.htn).toBe(true);
    expect(derived.af.htn).toMatch(/BP medication/);
    expect(effective.cac.bpTx).toBe(true);
    expect(effective.htn.statin).toBe("none");
  });

  it("does not override what the clinician set", () => {
    const { effective, derived } = deriveInputs({ ...inputs, af: { ...inputs.af, htn: false } }, ids);
    expect(effective.af.htn).toBe(false);
    expect(derived.af.htn).toBeUndefined();
  });

  it("one numbered A&P; aspirin reconciled against anticoagulation", () => {
    const p = runVisit(inputs, ids);
    expect(p.runs.map((r) => r.id)).toEqual(["htn", "af", "cac"]);
    expect(p.ap).toMatch(/^1\. Hypertension/);
    expect(p.ap).toMatch(/\n\n2\. Paroxysmal AF/);
    expect(p.ap).toMatch(/\n\n3\. Coronary artery calcium/);
    expect(p.ap).not.toMatch(/consider aspirin 81 mg/);
    expect(p.ap).toMatch(/Across problems: Aspirin: the patient is anticoagulated for AF/);
    expect(p.ap).toMatch(/Stop current aspirin/);
    const cac = p.runs.find((r) => r.id === "cac")!;
    expect(cac.superseded.length).toBe(1);
    expect(p.runs.find((r) => r.id === "af")!.result.metrics[0].value).toBe("2"); // HTN + age 65-74
  });

  it("no aspirin note without AF", () => {
    const noAsa = { ...inputs, cac: { ...inputs.cac, aspirin: false } };
    const p = runVisit(noAsa, ["cac", "htn"]);
    expect(p.notes.length).toBe(0);
    expect(p.ap).toMatch(/aspirin 81 mg/);
  });

  it("not on aspirin: primary-prevention aspirin is removed, no stop advice", () => {
    const p = runVisit({ ...inputs, cac: { ...inputs.cac, aspirin: false } }, ids);
    expect(p.ap).not.toMatch(/aspirin 81 mg/);
    expect(p.notes[0].text).toMatch(/not added despite the calcium score/);
    expect(p.notes[0].text).not.toMatch(/Stop current aspirin/);
  });

  it("CAD with AF: anticoagulant monotherapy note", () => {
    const p = runVisit({ ...inputs, af: { ...inputs.af, cad: true } }, ids);
    expect(p.notes[0].text).toMatch(/anticoagulant monotherapy/);
  });

  it("billing seeds one problem per module", () => {
    const h = visitBillingHints(runVisit(inputs, ids));
    expect(h.problems.map((x) => x.label)).toEqual(["hypertension", "atrial fibrillation", "coronary artery calcification"]);
    expect(h.risk).toContain("rx");
  });
});
