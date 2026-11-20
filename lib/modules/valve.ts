import type { ClinicalModule, FieldDef, Inputs, Metric, Recommendation, RuleResult } from "../types";
import { ageSex, fmt, list, num, str, yes } from "../util";
import { bsaMosteller } from "../calc/body";
import { cites } from "../citations";

// 2020 ACC/AHA VHD guideline (still the current full US guideline) with
// 2025 ESC/EACTS notes where newer trial evidence changed practice.

type Sev = 0 | 1 | 2 | 3; // none/mild/moderate/severe
const SEV = ["none/trace", "mild", "moderate", "severe"];
const LESIONS = [
  { value: "as", label: "Aortic stenosis" }, { value: "ar", label: "Aortic regurgitation" },
  { value: "mr", label: "Mitral regurgitation" }, { value: "ms", label: "Mitral stenosis" },
];

const fields: FieldDef[] = [
  { key: "lesion", label: "Valve lesion", type: "select", section: "Lesion", options: LESIONS },
  { key: "reported", label: "Reported severity (overrides calculation)", type: "select", section: "Lesion", options: [ { value: "1", label: "Mild" }, { value: "2", label: "Moderate" }, { value: "3", label: "Severe" } ], extractHint: "Only if the echo report states a grade. 'moderate-severe' → '3' only if called severe, otherwise '2'." },
  { key: "mrType", label: "MR mechanism", type: "select", section: "Lesion", showIf: (v) => v.lesion === "mr", options: [ { value: "primary", label: "Primary (degenerative/prolapse)" }, { value: "secondary", label: "Secondary (ventricular/atrial)" } ] },
  { key: "age", label: "Age", type: "number", unit: "y", section: "Patient" },
  { key: "sex", label: "Sex", type: "select", section: "Patient", options: [ { value: "female", label: "Female" }, { value: "male", label: "Male" } ] },
  { key: "heightCm", label: "Height", type: "number", unit: "cm", section: "Patient", extractHint: "Inches x2.54." },
  { key: "weightKg", label: "Weight", type: "number", unit: "kg", section: "Patient", extractHint: "lb / 2.205." },
  { key: "symptoms", label: "Symptoms attributable to valve (dyspnea, angina, syncope, HF)", type: "bool", section: "Patient" },
  { key: "surgRisk", label: "Surgical risk", type: "select", section: "Patient", options: [ { value: "low", label: "Low" }, { value: "intermediate", label: "Intermediate" }, { value: "high", label: "High" }, { value: "prohibitive", label: "Prohibitive" } ] },
  { key: "otherSurgery", label: "Other cardiac surgery planned", type: "bool", section: "Patient" },
  { key: "af", label: "Atrial fibrillation", type: "bool", section: "Patient" },
  { key: "bicuspid", label: "Bicuspid aortic valve", type: "bool", section: "Patient", showIf: (v) => v.lesion === "as" || v.lesion === "ar" },
  // AS
  { key: "vmax", label: "Peak velocity (Vmax)", type: "number", unit: "m/s", step: 0.1, section: "Aortic stenosis", showIf: (v) => v.lesion === "as" },
  { key: "mg", label: "Mean gradient", type: "number", unit: "mmHg", section: "Aortic stenosis", showIf: (v) => v.lesion === "as" },
  { key: "ava", label: "Aortic valve area", type: "number", unit: "cm²", step: 0.01, section: "Aortic stenosis", showIf: (v) => v.lesion === "as" },
  { key: "svi", label: "Stroke volume index", type: "number", unit: "mL/m²", section: "Aortic stenosis", showIf: (v) => v.lesion === "as" },
  { key: "cacAv", label: "CT aortic valve calcium", type: "number", unit: "AU", section: "Aortic stenosis", showIf: (v) => v.lesion === "as" },
  { key: "priorVmax", label: "Prior Vmax", type: "number", unit: "m/s", step: 0.1, section: "Aortic stenosis", showIf: (v) => v.lesion === "as" },
  { key: "priorYears", label: "Years since prior echo", type: "number", unit: "y", step: 0.1, section: "Aortic stenosis", showIf: (v) => v.lesion === "as" },
  { key: "bnpHigh", label: "BNP >3x normal for age/sex", type: "bool", section: "Aortic stenosis", showIf: (v) => v.lesion === "as" },
  { key: "exAbnormal", label: "Exercise test: symptoms or BP fall", type: "bool", section: "Aortic stenosis", showIf: (v) => v.lesion === "as" },
  // Regurgitation
  { key: "eroa", label: "EROA", type: "number", unit: "cm²", step: 0.01, section: "Regurgitation", showIf: (v) => v.lesion === "mr" || v.lesion === "ar" },
  { key: "rvol", label: "Regurgitant volume", type: "number", unit: "mL", section: "Regurgitation", showIf: (v) => v.lesion === "mr" || v.lesion === "ar" },
  { key: "rf", label: "Regurgitant fraction", type: "number", unit: "%", section: "Regurgitation", showIf: (v) => v.lesion === "mr" || v.lesion === "ar" },
  { key: "vc", label: "Vena contracta", type: "number", unit: "cm", step: 0.01, section: "Regurgitation", showIf: (v) => v.lesion === "mr" || v.lesion === "ar", extractHint: "mm → cm (/10)." },
  { key: "pasp", label: "PA systolic pressure", type: "number", unit: "mmHg", section: "Regurgitation", showIf: (v) => v.lesion === "mr" || v.lesion === "ms" },
  // MS
  { key: "mva", label: "Mitral valve area", type: "number", unit: "cm²", step: 0.1, section: "Mitral stenosis", showIf: (v) => v.lesion === "ms" },
  { key: "msGradient", label: "Mitral mean gradient", type: "number", unit: "mmHg", section: "Mitral stenosis", showIf: (v) => v.lesion === "ms" },
  { key: "msFavorable", label: "Favorable morphology for balloon commissurotomy", type: "bool", section: "Mitral stenosis", showIf: (v) => v.lesion === "ms" },
  { key: "rheumatic", label: "Rheumatic (vs calcific/MAC)", type: "bool", section: "Mitral stenosis", showIf: (v) => v.lesion === "ms" },
  // LV
  { key: "ef", label: "LVEF", type: "number", unit: "%", section: "LV" },
  { key: "lvesd", label: "LVESD", type: "number", unit: "mm", section: "LV", extractHint: "cm → mm (x10)." },
  { key: "lvedd", label: "LVEDD", type: "number", unit: "mm", section: "LV" },
];

function median(xs: Sev[]): Sev {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}
const grade = (x: number | null, mild: number, mod: number, sev: number): Sev | null =>
  x == null ? null : x >= sev ? 3 : x >= mod ? 2 : x >= mild ? 1 : 0;

export function regurgSeverity(v: Inputs, lesion: "mr" | "ar"): { sev: Sev | null; discordant: boolean } {
  const g = (lesion === "mr"
    ? [grade(num(v, "eroa"), 0.01, 0.2, 0.4), grade(num(v, "rvol"), 1, 30, 60), grade(num(v, "rf"), 1, 30, 50), grade(num(v, "vc"), 0.01, 0.3, 0.7)]
    : [grade(num(v, "eroa"), 0.01, 0.1, 0.3), grade(num(v, "rvol"), 1, 30, 60), grade(num(v, "rf"), 1, 30, 50), grade(num(v, "vc"), 0.01, 0.3, 0.6)]
  ).filter((x): x is Sev => x != null);
  if (!g.length) return { sev: null, discordant: false };
  return { sev: median(g), discordant: Math.max(...g) - Math.min(...g) >= 2 || (g.length >= 2 && new Set(g).size > 1) };
}

export function asSeverity(v: Inputs): { sev: Sev | null; veryRaw: boolean; lflg: "classic" | "paradoxical" | null } {
  const vmax = num(v, "vmax"), mg = num(v, "mg"), ava = num(v, "ava");
  const byVel = vmax != null ? (vmax >= 4 ? 3 : vmax >= 3 ? 2 : vmax >= 2 ? 1 : 0) : null;
  const byMg = mg != null ? (mg >= 40 ? 3 : mg >= 20 ? 2 : mg > 0 ? 1 : 0) : null;
  const high = Math.max(byVel ?? -1, byMg ?? -1);
  const very = (vmax != null && vmax >= 5) || (mg != null && mg >= 60);
  let lflg: "classic" | "paradoxical" | null = null;
  if (high < 3 && ava != null && ava <= 1.0) {
    const ef = num(v, "ef");
    if (ef != null && ef < 50) lflg = "classic";
    else if (num(v, "svi") != null && num(v, "svi")! < 35) lflg = "paradoxical";
  }
  return { sev: high >= 0 ? (high as Sev) : ava != null ? (ava <= 1.0 ? 3 : ava <= 1.5 ? 2 : 1) : null, veryRaw: very, lflg };
}

export function evaluateValve(v: Inputs): RuleResult {
  const recs: Recommendation[] = [];
  const metrics: Metric[] = [];
  const missing: string[] = [];
  const plan: string[] = [];
  const lesion = str(v, "lesion");
  if (!lesion) return { headline: "Choose the valve lesion", metrics: [], recommendations: [], missing: ["Valve lesion"], ap: "" };
  const name = LESIONS.find((l) => l.value === lesion)!.label;
  const sym = yes(v, "symptoms");
  const ef = num(v, "ef");
  const lvesd = num(v, "lvesd");
  const lvedd = num(v, "lvedd");
  const age = num(v, "age");
  const risk = str(v, "surgRisk");
  const h = num(v, "heightCm"), w = num(v, "weightKg");
  const bsa = h != null && w != null ? bsaMosteller(h, w) : null;
  const reported = str(v, "reported");
  let sev: Sev | null = null;
  let intervene: { why: string; cor: string } | null = null;
  const consider: string[] = [];
  let interval = "";
  let detail = "";

  if (lesion === "as") {
    const a = asSeverity(v);
    sev = reported ? (Number(reported) as Sev) : a.sev;
    const vmax = num(v, "vmax"), mg = num(v, "mg"), ava = num(v, "ava");
    detail = [vmax != null && `Vmax ${fmt(vmax, 1)} m/s`, mg != null && `mean gradient ${fmt(mg, 0)} mmHg`, ava != null && `AVA ${fmt(ava, 2)} cm²`].filter(Boolean).join(", ");
    if (vmax == null && mg == null) missing.push("Vmax / mean gradient");
    if (a.lflg === "classic") recs.push({ text: "Low-flow, low-gradient AS with reduced LVEF (AVA ≤1.0): low-dose dobutamine stress echo to distinguish true-severe from pseudo-severe AS and assess flow reserve (2a).", severity: "action", cite: ["valve2020"], cor: "2a", ap: "Obtain low-dose dobutamine stress echocardiogram to assess for true severe low-flow low-gradient aortic stenosis" });
    if (a.lflg === "paradoxical") {
      const ca = num(v, "cacAv");
      const thr = str(v, "sex") === "female" ? 1300 : 2000;
      if (ca == null) recs.push({ text: "Paradoxical low-flow, low-gradient AS (AVA ≤1.0, SVi <35, LVEF ≥50%): CT aortic valve calcium score to confirm severity (severe likely if ≥1,300 AU women / ≥2,000 AU men) (2a).", severity: "action", cite: ["valve2020"], cor: "2a", ap: "Obtain CT aortic valve calcium score to adjudicate aortic stenosis severity" });
      else if (ca >= thr) { sev = 3; recs.push({ text: `Valve calcium ${fmt(ca, 0)} AU ≥${thr}: supports severe AS (stage D3).`, severity: "info", cite: ["valve2020"], ap: "" }); }
    }
    const pv = num(v, "priorVmax"), py = num(v, "priorYears");
    const rate = pv != null && vmax != null && py != null && py > 0 ? (vmax - pv) / py : null;
    if (rate != null) metrics.push({ label: "Progression", value: `${fmt(rate, 2)} m/s/yr`, note: rate >= 0.3 ? "rapid (≥0.3)" : undefined });
    if (sev === 3 || a.lflg) {
      const severe = sev === 3;
      if (severe && sym) intervene = { why: "symptomatic severe AS", cor: "1" };
      else if (severe && ef != null && ef < 50) intervene = { why: `asymptomatic severe AS with LVEF ${fmt(ef, 0)}% (<50%)`, cor: "1" };
      else if (severe && yes(v, "otherSurgery")) intervene = { why: "severe AS with other cardiac surgery planned", cor: "1" };
      else if (severe) {
        if (a.veryRaw && risk !== "high" && risk !== "prohibitive") consider.push("very severe AS (Vmax ≥5 m/s or MG ≥60) at low procedural risk (2a)");
        if (yes(v, "exAbnormal")) consider.push("abnormal exercise test (2a)");
        if (yes(v, "bnpHigh")) consider.push("BNP >3x normal (2a)");
        if (rate != null && rate >= 0.3) consider.push("rapid progression ≥0.3 m/s/yr (2a)");
        if (ef != null && ef < 60) consider.push("LVEF <60% if progressively declining on ≥3 studies (2b)");
        if (consider.length) intervene = { why: `asymptomatic severe AS with ${list(consider.map((c) => c.replace(/ \((2[ab])\)/, "")))}`, cor: consider[0].match(/\((2[ab])\)/)?.[1] ?? "2a" };
        else recs.push({ text: "Asymptomatic severe AS, LVEF ≥50%, no high-risk features: watchful waiting is acceptable per ACC/AHA 2020, but early AVR is now Class IIa in the 2025 ESC/EACTS guideline for low-risk patients (EARLY TAVR, AVATAR, RECOVERY: fewer HF admissions, no clear mortality difference yet). Consider exercise testing to unmask symptoms and discuss early intervention with the Heart Team.", severity: "action", cite: ["valve2020", "escvhd2025"], cor: "2a (ESC)", ap: "Asymptomatic severe aortic stenosis; discussed watchful waiting versus early valve replacement and will obtain exercise testing to confirm asymptomatic status" });
      }
    }
    interval = sev === 3 ? "6-12 months" : sev === 2 ? "1-2 years" : sev === 1 ? "3-5 years" : "per clinical change";
    if (intervene) {
      const mode = age == null ? "TAVR vs SAVR by Heart Team" : age < 65 ? "SAVR favored (age <65 or life expectancy >20 y)" : age > 80 ? "TAVR favored (age >80 or life expectancy <10 y)" : "TAVR or SAVR (age 65-80): shared decision with Heart Team (ESC 2025 favors TAVI ≥70 with tricuspid anatomy)";
      recs.push({ text: `Mode: ${mode}${yes(v, "bicuspid") ? "; bicuspid anatomy generally favors SAVR in younger/lower-risk patients" : ""}${risk === "high" || risk === "prohibitive" ? "; high/prohibitive surgical risk favors TAVR" : ""}. Pre-TAVR: CT angiography; coronary evaluation.`, severity: "info", cite: ["valve2020", "escvhd2025"], ap: "" });
    }
  } else if (lesion === "mr" || lesion === "ar") {
    const r = regurgSeverity(v, lesion);
    sev = reported ? (Number(reported) as Sev) : r.sev;
    detail = [num(v, "eroa") != null && `EROA ${fmt(num(v, "eroa")!, 2)} cm²`, num(v, "rvol") != null && `RVol ${fmt(num(v, "rvol")!, 0)} mL`, num(v, "rf") != null && `RF ${fmt(num(v, "rf")!, 0)}%`, num(v, "vc") != null && `vena contracta ${fmt(num(v, "vc")!, 2)} cm`].filter(Boolean).join(", ");
    if (!reported && r.sev == null) missing.push("Quantitative parameters (EROA, RVol, RF, VC) or reported severity");
    if (!reported && r.discordant) recs.push({ text: "Quantitative parameters are discordant; integrate qualitative signs (jet, flow reversal, chamber size) and consider TEE or CMR for adjudication.", severity: "warning", cite: ["valve2020"], ap: "" });
    interval = sev === 3 ? "6-12 months (sooner if LV dilating)" : sev === 2 ? "1-2 years" : sev === 1 ? "3-5 years" : "per clinical change";
    if (lesion === "mr") {
      const type = str(v, "mrType") ?? "primary";
      if (str(v, "mrType") == null) missing.push("MR mechanism (defaulting to primary)");
      if (type === "primary" && sev === 3) {
        if (sym) intervene = { why: "symptomatic severe primary MR", cor: "1" };
        else if ((ef != null && ef <= 60) || (lvesd != null && lvesd >= 40)) intervene = { why: `asymptomatic severe primary MR with LV dysfunction (${[ef != null && ef <= 60 && `LVEF ${fmt(ef, 0)}% ≤60%`, lvesd != null && lvesd >= 40 && `LVESD ${fmt(lvesd, 0)} mm ≥40`].filter(Boolean).join(", ")})`, cor: "1" };
        else if (yes(v, "otherSurgery")) intervene = { why: "severe MR with other cardiac surgery planned", cor: "1" };
        else {
          recs.push({ text: "Asymptomatic severe primary MR with preserved LV: mitral repair is reasonable at a Comprehensive Valve Center if durable repair likelihood >95% and mortality <1% (2a); also reasonable with progressive LV dilation or EF decline on serial imaging (2b). New AF or PASP >50 mmHg favor earlier surgery (ESC 2025).", severity: "action", cite: ["valve2020", "escvhd2025"], cor: "2a", ap: "Asymptomatic severe primary mitral regurgitation; will refer to a Comprehensive Valve Center to discuss early repair" });
        }
        if (intervene && (risk === "high" || risk === "prohibitive")) recs.push({ text: "High/prohibitive surgical risk with favorable anatomy: transcatheter edge-to-edge repair (TEER) is reasonable (2a).", severity: "info", cite: ["valve2020"], cor: "2a", ap: "" });
      } else if (type === "secondary") {
        recs.push({ text: "Secondary MR: optimize GDMT (and CRT if indicated) first and reassess MR on therapy.", severity: "action", cite: ["valve2020", "hf2022"], cor: "1", ap: "Optimize guideline-directed medical therapy for secondary mitral regurgitation and reassess" });
        if (sev === 3 && sym && ef != null && ef >= 20 && ef <= 50 && (lvesd == null || lvesd <= 70) && (num(v, "pasp") == null || num(v, "pasp")! <= 70))
          intervene = { why: "severe secondary MR with persistent NYHA II-IV symptoms on GDMT, LVEF 20-50%, LVESD ≤70 mm, PASP ≤70 mmHg (COAPT-like): TEER", cor: "2a" };
      }
    } else {
      const lvesdi = lvesd != null && bsa != null ? lvesd / 10 / bsa * 10 : null;
      if (lvesdi != null) metrics.push({ label: "LVESDi", value: `${fmt(lvesdi, 1)} mm/m²` });
      if (sev === 3) {
        if (sym) intervene = { why: "symptomatic severe AR", cor: "1" };
        else if (ef != null && ef <= 55) intervene = { why: `asymptomatic severe AR with LVEF ${fmt(ef, 0)}% ≤55%`, cor: "1" };
        else if (yes(v, "otherSurgery")) intervene = { why: "severe AR with other cardiac surgery planned", cor: "1" };
        else if ((lvesd != null && lvesd > 50) || (lvesdi != null && lvesdi > 25)) intervene = { why: `asymptomatic severe AR with LVESD ${lvesd != null ? `${fmt(lvesd, 0)} mm` : ""}${lvesdi != null ? ` (LVESDi ${fmt(lvesdi, 1)} mm/m²)` : ""}`, cor: "2a" };
        else if (risk === "low" && lvedd != null && lvedd > 65) intervene = { why: `asymptomatic severe AR with LVEDD ${fmt(lvedd, 0)} mm >65 at low surgical risk`, cor: "2b" };
        else if (lvesd != null && lvesd > 45) recs.push({ text: "LVESD approaching threshold: shorten imaging interval to 3-6 months.", severity: "action", cite: ["valve2020"], ap: "" });
      }
      if (sev != null && sev >= 2) recs.push({ text: "Treat hypertension (SBP goal <130) with a dihydropyridine CCB, ACEi/ARB; avoid bradycardic agents in significant AR. Evaluate aortic root/ascending aorta (bicuspid aortopathy).", severity: "info", cite: ["valve2020"], ap: "" });
    }
  } else if (lesion === "ms") {
    const mva = num(v, "mva");
    sev = reported ? (Number(reported) as Sev) : mva == null ? null : mva <= 1.5 ? 3 : mva <= 2.0 ? 2 : 1;
    detail = [mva != null && `MVA ${fmt(mva, 1)} cm²`, num(v, "msGradient") != null && `mean gradient ${fmt(num(v, "msGradient")!, 0)} mmHg`, num(v, "pasp") != null && `PASP ${fmt(num(v, "pasp")!, 0)} mmHg`].filter(Boolean).join(", ");
    if (mva == null) missing.push("Mitral valve area");
    interval = mva == null ? "" : mva > 1.5 ? "3-5 years" : mva > 1.0 ? "1-2 years" : "1 year";
    const rheum = v.rheumatic !== false;
    if (sev === 3 && rheum) {
      const fav = yes(v, "msFavorable");
      if (sym) intervene = { why: `symptomatic severe rheumatic MS${fav ? " with favorable morphology: percutaneous balloon commissurotomy (no LA thrombus, ≤ moderate MR)" : ": surgery if morphology unfavorable for balloon commissurotomy"}`, cor: "1" };
      else if (mva != null && mva <= 1.0 && fav) intervene = { why: "asymptomatic very severe MS (MVA ≤1.0) with favorable morphology: balloon commissurotomy", cor: "2a" };
      else if (yes(v, "af") && fav) intervene = { why: "asymptomatic severe MS with new AF and favorable morphology: balloon commissurotomy may be considered", cor: "2b" };
    } else if (sev === 3 && !rheum) {
      recs.push({ text: "Calcific (MAC-related) MS: intervention is high risk and reserved for severe symptoms; manage with diuretics and rate control. Transcatheter options only in selected patients at experienced centers.", severity: "info", cite: ["valve2020", "escvhd2025"], ap: "" });
    }
    if (yes(v, "af") && (sev ?? 0) >= 2 && rheum) recs.push({ text: "AF with rheumatic MS (moderate or severe; ESC 2025: MVA ≤2.0 cm²): warfarin is required; DOACs are not recommended (INVICTUS) (1).", severity: "urgent", cite: ["valve2020", "escvhd2025"], cor: "1", ap: "Anticoagulate with warfarin (not a DOAC) given atrial fibrillation with rheumatic mitral stenosis" });
    if (rheum) recs.push({ text: "Rheumatic heart disease: secondary prophylaxis against rheumatic fever per age/time since last episode; heart rate control to prolong diastolic filling.", severity: "info", cite: ["valve2020"], ap: "" });
  }

  if (sev != null) metrics.unshift({ label: name, value: SEV[sev], note: detail || undefined });
  if (ef != null) metrics.push({ label: "LVEF", value: `${fmt(ef, 0)}%` });
  if (lvesd != null) metrics.push({ label: "LVESD", value: `${fmt(lvesd, 0)} mm` });

  if (intervene) {
    recs.unshift({ text: `Intervention indicated: ${intervene.why} (${intervene.cor}). Refer to a multidisciplinary Heart Valve Team.`, severity: "urgent", cite: ["valve2020"], cor: intervene.cor, ap: "" });
    plan.push(`refer to the Heart Valve Team for ${lesion === "as" ? "aortic valve replacement" : lesion === "ar" ? "aortic valve surgery" : lesion === "ms" ? "mitral intervention" : "mitral valve intervention"} given ${intervene.why} (COR ${intervene.cor})`);
  } else if (interval) {
    plan.push(`repeat TTE in ${interval}, sooner with new symptoms`);
    if (sev != null && sev >= 2) recs.push({ text: `Surveillance TTE every ${interval}${sev === 3 ? "; educate on symptoms to report promptly" : ""}.`, severity: "action", cite: ["valve2020"], ap: "" });
  }
  if (sev != null && sev >= 2) plan.push("dental hygiene with regular dental care; report exertional dyspnea, chest pain, presyncope or syncope promptly");
  if (ef == null && sev != null && sev >= 2) missing.push("LVEF");
  if ((lesion === "mr" || lesion === "ar") && lvesd == null && sev === 3) missing.push("LVESD");
  if (sym && sev != null && sev < 3) recs.push({ text: `Symptoms with ${SEV[sev]} ${name.toLowerCase()}: look for another cause or underestimated severity (TEE, CMR, exercise hemodynamics, CT calcium for AS).`, severity: "action", cite: ["valve2020"], ap: "" });

  const headline = intervene ? `${capSev(sev)} ${name.toLowerCase()}: refer for intervention (${intervene.cor})` : sev != null ? `${capSev(sev)} ${name.toLowerCase()}${interval ? `: echo every ${interval.split(" (")[0]}` : ""}` : `${name}: enter severity measures`;
  const apExtra = recs.filter((r) => r.ap).map((r) => r.ap!.replace(/\.$/, ""));
  const ap = [
    `${sev != null ? capSev(sev) : ""} ${lesion === "mr" ? `${str(v, "mrType") === "secondary" ? "secondary " : str(v, "mrType") === "primary" ? "primary " : ""}mitral regurgitation` : name.toLowerCase()}${yes(v, "bicuspid") ? " (bicuspid valve)" : ""}: ${ageSex(v)}, ${sym ? "symptomatic" : "asymptomatic"}${detail ? `, ${detail}` : ""}${ef != null ? `, LVEF ${fmt(ef, 0)}%` : ""}${lvesd != null ? `, LVESD ${fmt(lvesd, 0)} mm` : ""}.`.trim(),
    `Per the 2020 ACC/AHA valvular heart disease guideline, plan: ${plan.join("; ")}.`,
    apExtra.length ? apExtra.join(". ") + "." : "",
  ].filter(Boolean).join(" ");

  return { headline, metrics, recommendations: recs, missing, ap };
}

const capSev = (s: Sev | null) => (s == null ? "" : s === 0 ? "Trace" : SEV[s][0].toUpperCase() + SEV[s].slice(1));

export const valveModule: ClinicalModule = {
  id: "valve",
  title: "Valvular Heart Disease",
  short: "Valve",
  icon: "🚪",
  description: "AS, AR, MR, MS: severity from echo criteria, surveillance interval, TAVR/surgery/TEER triggers, low-flow AS workup — 2020 ACC/AHA with 2025 ESC updates.",
  placeholder: "e.g. 76F aortic stenosis, Vmax 4.3 m/s, MG 44, AVA 0.8, EF 62%, asymptomatic, walks 2 miles, prior Vmax 3.9 one year ago, low surgical risk",
  fields,
  evaluate: evaluateValve,
  citations: cites("valve2020", "escvhd2025", "hf2022"),
};
