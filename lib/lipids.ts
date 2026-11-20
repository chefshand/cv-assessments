// Shared lipid-goal logic used by both the ASCVD and CAC modules.
// Source: 2026 ACC/AHA/Multisociety Dyslipidemia Guideline; ApoB equivalents
// from 2019/2025 ESC/EAS (the ACC/AHA guideline recommends ApoB for residual
// risk but does not publish numeric ApoB targets).

export interface LipidGoal {
  ldl: number;
  nonHdl: number;
  apoB: number;
  pctReduction?: number; // minimum % LDL-C reduction from baseline
  label: string;
}

export const GOALS = {
  veryHigh: { ldl: 55, nonHdl: 85, apoB: 65, pctReduction: 50, label: "very high risk" },
  high: { ldl: 70, nonHdl: 100, apoB: 80, pctReduction: 50, label: "high risk" },
  moderate: { ldl: 100, nonHdl: 130, apoB: 100, label: "borderline/intermediate risk" },
} satisfies Record<string, LipidGoal>;

export const stricter = (a: LipidGoal | null, b: LipidGoal | null): LipidGoal | null => {
  if (!a) return b;
  if (!b) return a;
  return a.ldl <= b.ldl ? a : b;
};

export type StatinIntensity = "none" | "low" | "moderate" | "high";

/** Approximate LDL-C lowering used for projections (class averages). */
export const EFFECT = {
  moderateStatin: 0.3,
  highStatin: 0.5,
  ezetimibe: 0.22,
  pcsk9mab: 0.6,
  inclisiran: 0.5,
  bempedoic: 0.18,
};

export interface Therapy {
  statin: StatinIntensity;
  ezetimibe: boolean;
  pcsk9: boolean;
  bempedoic: boolean;
  statinIntolerant: boolean;
}

export interface NextStep {
  /** Plain-language action. */
  action: string;
  /** Projected LDL-C after the action, if computable. */
  projectedLdl: number | null;
}

/**
 * Walk the guideline sequence (maximize statin -> ezetimibe -> PCSK9 mAb or
 * inclisiran; bempedoic acid when statin-intolerant) until the projected LDL-C
 * reaches the goal. Returns the ordered list of steps needed.
 */
export function stepsToGoal(currentLdl: number, goalLdl: number, t: Therapy, veryHigh: boolean): NextStep[] {
  const steps: NextStep[] = [];
  let ldl = currentLdl;
  const atGoal = () => ldl < goalLdl;
  if (atGoal()) return steps;

  // 1. Statin
  if (!t.statinIntolerant && t.statin !== "high") {
    if (t.statin === "none") {
      ldl = ldl * (1 - EFFECT.highStatin);
      steps.push({ action: "start high-intensity statin (atorvastatin 40-80 mg or rosuvastatin 20-40 mg)", projectedLdl: ldl });
    } else {
      // moderate/low -> high: roughly an additional 20-30% from the treated value
      ldl = ldl * (1 - 0.25);
      steps.push({ action: "intensify to high-intensity statin (atorvastatin 40-80 mg or rosuvastatin 20-40 mg)", projectedLdl: ldl });
    }
    if (atGoal()) return steps;
  }
  // 2. Ezetimibe (first add-on), unless a big gap in very-high-risk favors PCSK9 directly
  const gapPct = (ldl - goalLdl) / ldl;
  if (!t.ezetimibe && !(veryHigh && gapPct > 0.25 && !t.pcsk9)) {
    ldl = ldl * (1 - EFFECT.ezetimibe);
    steps.push({ action: "add ezetimibe 10 mg daily", projectedLdl: ldl });
    if (atGoal()) return steps;
  }
  // 3. PCSK9 mAb / inclisiran
  if (!t.pcsk9) {
    ldl = ldl * (1 - EFFECT.pcsk9mab);
    steps.push({
      action: "add a PCSK9 monoclonal antibody (evolocumab or alirocumab); inclisiran is a reasonable alternative if a PCSK9 mAb is not tolerated/obtainable or less frequent dosing is preferred",
      projectedLdl: ldl,
    });
    if (atGoal()) return steps;
  }
  if (!t.ezetimibe) {
    ldl = ldl * (1 - EFFECT.ezetimibe);
    steps.push({ action: "add ezetimibe 10 mg daily", projectedLdl: ldl });
    if (atGoal()) return steps;
  }
  // 4. Bempedoic acid
  if (!t.bempedoic) {
    ldl = ldl * (1 - EFFECT.bempedoic);
    steps.push({ action: "add bempedoic acid 180 mg daily", projectedLdl: ldl });
  }
  return steps;
}

export function lpaElevated(value: number | null, unit: string | null): boolean | null {
  if (value == null) return null;
  if (unit === "nmol/L") return value >= 125;
  return value >= 50; // mg/dL default
}

export const lpaText = (value: number, unit: string | null) => `${value} ${unit === "nmol/L" ? "nmol/L" : "mg/dL"}`;
