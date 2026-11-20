import { describe, expect, it } from "vitest";
import { calcPrevent, preventCategory } from "@/lib/calc/prevent";
import { calcMesa } from "@/lib/calc/mesa";

describe("PREVENT", () => {
  // Reference values from the preventr R package README (base model).
  const ref = {
    age: 50, sex: "female" as const, sbp: 160, bpTx: true, totalChol: 200, hdl: 45,
    statin: false, diabetes: true, smoker: false, egfr: 90, bmi: 35,
  };
  it("matches published reference (10-year)", () => {
    const r = calcPrevent(ref);
    expect(r.model).toBe("base");
    expect(r.tenYear.ascvd).toBeCloseTo(9.2, 1);
    expect(r.tenYear.total_cvd).toBeCloseTo(14.7, 1);
    expect(r.tenYear.heart_failure).toBeCloseTo(8.1, 1);
  });
  it("matches published reference (30-year)", () => {
    const r = calcPrevent(ref);
    expect(r.thirtyYear!.ascvd).toBeCloseTo(35.4, 1);
    expect(r.thirtyYear!.total_cvd).toBeCloseTo(53.0, 1);
  });
  it("omits 30-year risk after age 59", () => {
    expect(calcPrevent({ ...ref, age: 65 }).thirtyYear).toBeNull();
  });
  it("uses UACR model when UACR provided", () => {
    expect(calcPrevent({ ...ref, uacr: 40 }).model).toBe("uacr");
  });
  it("categorizes per 2026 ACC/AHA thresholds", () => {
    expect(preventCategory(2.9)).toBe("low");
    expect(preventCategory(3)).toBe("borderline");
    expect(preventCategory(5)).toBe("intermediate");
    expect(preventCategory(10)).toBe("high");
  });
});

describe("MESA", () => {
  const base = {
    age: 55, sex: "male" as const, race: "black" as const, totalChol: 213, hdl: 50, sbp: 140,
    lipidMed: false, bpMed: true, smoker: false, diabetes: false, familyHxMI: false,
  };
  it("CAC 0 lowers risk vs no-CAC estimate and CAC 400 raises it", () => {
    const zero = calcMesa({ ...base, cac: 0 });
    const high = calcMesa({ ...base, cac: 400 });
    expect(zero.withCac!).toBeLessThan(zero.withoutCac);
    expect(high.withCac!).toBeGreaterThan(zero.withCac!);
  });
  it("gives plausible magnitude", () => {
    const r = calcMesa({ ...base, cac: 0 });
    expect(r.withoutCac).toBeGreaterThan(2);
    expect(r.withoutCac).toBeLessThan(15);
  });
});
