// MESA 10-year hard CHD risk score, with and without CAC.
// McClelland RL et al. J Am Coll Cardiol 2015;66:1643-1653. doi:10.1016/j.jacc.2015.08.035
// Coefficients cross-checked against the CVrisk R package (mesa_coef / mesa_cac_coef).
// Valid for ages 45-85 without known CHD.

export type MesaRace = "white" | "black" | "chinese" | "hispanic";

export interface MesaInput {
  age: number;
  sex: "female" | "male";
  race: MesaRace;
  diabetes: boolean;
  smoker: boolean;
  totalChol: number;
  hdl: number;
  lipidMed: boolean;
  sbp: number;
  bpMed: boolean;
  familyHxMI: boolean;
  cac?: number | null;
}

const NO_CAC = {
  age: 0.0455, male: 0.7496, chinese: -0.5055, black: -0.2111, hispanic: -0.19,
  diabetes: 0.5168, smoker: 0.4732, tc: 0.0053, hdl: -0.014, lipidMed: 0.2473,
  sbp: 0.0085, bpMed: 0.3381, fh: 0.4522, cac: 0, s0: 0.99963,
};
const WITH_CAC = {
  age: 0.0172, male: 0.4079, chinese: -0.3475, black: 0.0353, hispanic: -0.0222,
  diabetes: 0.3892, smoker: 0.3717, tc: 0.0043, hdl: -0.0114, lipidMed: 0.1206,
  sbp: 0.0066, bpMed: 0.2278, fh: 0.3239, cac: 0.2743, s0: 0.99833,
};

export function calcMesa(i: MesaInput): { withCac: number | null; withoutCac: number; warnings: string[] } {
  const warnings: string[] = [];
  if (i.age < 45 || i.age > 85) warnings.push("MESA score is validated for ages 45-85");
  const score = (c: typeof NO_CAC, cac: number) => {
    const s =
      c.age * i.age +
      c.male * (i.sex === "male" ? 1 : 0) +
      c.chinese * (i.race === "chinese" ? 1 : 0) +
      c.black * (i.race === "black" ? 1 : 0) +
      c.hispanic * (i.race === "hispanic" ? 1 : 0) +
      c.diabetes * (i.diabetes ? 1 : 0) +
      c.smoker * (i.smoker ? 1 : 0) +
      c.tc * i.totalChol +
      c.hdl * i.hdl +
      c.lipidMed * (i.lipidMed ? 1 : 0) +
      c.sbp * i.sbp +
      c.bpMed * (i.bpMed ? 1 : 0) +
      c.fh * (i.familyHxMI ? 1 : 0) +
      c.cac * Math.log(cac + 1);
    return (1 - Math.pow(c.s0, Math.exp(s))) * 100;
  };
  return {
    withoutCac: score(NO_CAC, 0),
    withCac: i.cac != null ? score(WITH_CAC, i.cac) : null,
    warnings,
  };
}
