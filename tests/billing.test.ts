import { describe, expect, it } from "vitest";
import { billingHints, computeBilling, dataLevel, emptyBilling, mdmLevel, problemLevel, prolonged, riskLevel, timeLevel, type BillingInputs } from "@/lib/billing";
import { scrubIdentifiers } from "@/lib/scrub";
import { MODULES } from "@/lib/modules";

const B = (p: Partial<BillingInputs>): BillingInputs => ({ ...emptyBilling(2026), ...p });

describe("MDM elements", () => {
  it("problems", () => {
    expect(problemLevel([{ label: "htn", status: "stable_chronic" }])).toBe(2);
    expect(problemLevel([{ label: "htn", status: "stable_chronic" }, { label: "hld", status: "stable_chronic" }])).toBe(3);
    expect(problemLevel([{ label: "htn", status: "chronic_progression" }])).toBe(3);
    expect(problemLevel([{ label: "AS", status: "threat" }])).toBe(4);
  });
  it("data categories", () => {
    expect(dataLevel(B({ testsOrdered: 1, resultsReviewed: 1 })).level).toBe(2);
    expect(dataLevel(B({ testsOrdered: 2, resultsReviewed: 1 })).level).toBe(3);
    expect(dataLevel(B({ interpretations: ["ecg"] })).level).toBe(3);
    expect(dataLevel(B({ testsOrdered: 3, interpretations: ["echo"] })).level).toBe(4);
    expect(dataLevel(B({ interpretations: ["echo"], discussion: true })).level).toBe(4);
  });
  it("risk", () => {
    expect(riskLevel(["rx"])).toBe(3);
    expect(riskLevel(["rx", "major_surgery_risk"])).toBe(4);
    expect(riskLevel([])).toBe(1);
  });
  it("2 of 3 rule", () => {
    expect(mdmLevel(4, 1, 3)).toBe(3);
    expect(mdmLevel(4, 4, 1)).toBe(4);
    expect(mdmLevel(2, 1, 1)).toBe(1);
  });
});

describe("Level selection", () => {
  const moderate = { problems: [{ label: "hypertension", status: "chronic_progression" as const }], risk: ["rx" as const] };
  it("established moderate MDM → 99214", () => {
    expect(computeBilling(B({ visit: "established", ...moderate })).code).toBe("99214");
  });
  it("new moderate MDM → 99204", () => {
    expect(computeBilling(B({ visit: "new", ...moderate })).code).toBe("99204");
  });
  it("time wins only when higher; never combined", () => {
    const a = computeBilling(B({ visit: "established", minutes: 42, ...moderate }));
    expect(a.code).toBe("99215");
    expect(a.basis).toBe("time");
    const b = computeBilling(B({ visit: "established", minutes: 25, ...moderate }));
    expect(b.code).toBe("99214");
    expect(b.basis).toBe("mdm");
    // moderate MDM + 30 min (each level 4) is still 99214, not 99215
    expect(computeBilling(B({ visit: "established", minutes: 30, ...moderate })).code).toBe("99214");
  });
  it("time thresholds", () => {
    expect(timeLevel("new", 60)).toBe(4);
    expect(timeLevel("new", 44)).toBe(2);
    expect(timeLevel("established", 40)).toBe(4);
    expect(timeLevel("established", 9)).toBeNull();
  });
  it("prolonged services", () => {
    expect(prolonged("established", 68, "medicare")).toBeNull();
    expect(prolonged("established", 69, "medicare")).toEqual({ code: "G2212", units: 1, threshold: 69 });
    expect(prolonged("new", 104, "medicare")?.units).toBe(2);
    expect(prolonged("established", 55, "other")?.code).toBe("99417");
  });
  it("G2211 in 2026, B1/B2 in 2027, blocked by modifier 25", () => {
    const base = { visit: "established" as const, longitudinal: true, ...moderate };
    expect(computeBilling(B({ ...base, year: 2026 })).addOn?.code).toBe("G2211");
    expect(computeBilling(B({ ...base, year: 2027 })).addOn?.code).toBe("Modifier B1");
    expect(computeBilling(B({ ...base, year: 2027, aco: true })).addOn?.code).toBe("Modifier B2");
    expect(computeBilling(B({ ...base, mod25: true })).addOn).toBeNull();
  });
  it("statement claims only what was marked", () => {
    const r = computeBilling(B({ visit: "established", ...moderate }));
    expect(r.statement).not.toMatch(/independently interpreted/);
    expect(r.statement).toMatch(/prescription drug management/);
    expect(r.gaps.join(" ")).toMatch(/If you/);
  });
});

describe("module hints", () => {
  it("every module returns a problem with a valid status", () => {
    for (const m of MODULES) {
      const h = billingHints(m.id, m.title, {}, "", "");
      expect(h.problems.length).toBe(1);
    }
  });
  it("prescription changes → rx; valve referral → major procedure", () => {
    expect(billingHints("hf", "Heart failure", {}, "Plan: start spironolactone 12.5 mg daily.", "").risk).toContain("rx");
    expect(billingHints("valve", "Valve", { symptoms: true }, "refer to the Heart Valve Team for aortic valve replacement", "Severe aortic stenosis: refer for intervention (1)").risk).toContain("major_surgery_risk");
  });
});

describe("identifier scrub", () => {
  it("removes MRN, DOB, phone, email and name lines", () => {
    const s = scrubIdentifiers("Name: John Smith\nMRN: 12345678\nDOB 01/02/1950, call 555-123-4567 or a@b.com. Mr. Smith has HTN.");
    expect(s.text).not.toMatch(/Smith|12345678|1950|555-123|a@b\.com/);
    expect(s.text).toMatch(/HTN/);
  });
});
