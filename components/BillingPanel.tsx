"use client";
import { useMemo, useState } from "react";
import {
  computeBilling, emptyBilling, INTERP_OPTIONS, LEVEL_NAME, PROBLEM_STATUS, RISK_ITEMS,
  type BillingHints, type BillingInputs, type ProblemStatus, type RiskItem,
} from "@/lib/billing";

// In-memory only, keyed by screen. Never persisted.
const memory = new Map<string, BillingInputs>();

export function seedFromHints(h: BillingHints, base: BillingInputs): BillingInputs {
  return { ...base, problems: h.problems.length ? h.problems : base.problems, risk: h.risk };
}

export function BillingPanel({ storeKey, hints, initial, suggestInterp = [] }: {
  storeKey: string;
  hints?: BillingHints;
  initial?: BillingInputs;
  suggestInterp?: string[];
}) {
  const [b, setB] = useState<BillingInputs>(() => memory.get(storeKey) ?? initial ?? (hints ? seedFromHints(hints, emptyBilling()) : emptyBilling()));
  const [copied, setCopied] = useState(false);
  const set = (patch: Partial<BillingInputs>) => setB((cur) => {
    const next = { ...cur, ...patch };
    memory.set(storeKey, next);
    return next;
  });
  const r = useMemo(() => computeBilling(b), [b]);
  const toggle = <T,>(arr: T[], x: T) => (arr.includes(x) ? arr.filter((y) => y !== x) : [...arr, x]);
  const interpAsk = suggestInterp.filter((x) => !b.interpretations.includes(x));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(r.statement);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  };

  return (
    <div className="space-y-4">
      {hints && (
        <button type="button" className="chip text-xs" onClick={() => set(seedFromHints(hints, b))}>↻ Re-apply suggestions from the current case</button>
      )}
      {/* Visit */}
      <div>
        <p className="mb-1.5 text-sm font-medium">Visit type <span className="text-rose-600">*</span></p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="chip" aria-pressed={b.visit === "new"} onClick={() => set({ visit: "new" })}>New patient</button>
          <button type="button" className="chip" aria-pressed={b.visit === "established"} onClick={() => set({ visit: "established" })}>Return (established)</button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Total time today <span className="text-rose-600">*</span></span>
          <span className="flex items-center gap-2">
            <input className="field-input" inputMode="numeric" type="text" placeholder="min" value={b.minutes ?? ""}
              onChange={(e) => { const s = e.target.value.replace(/\D/g, ""); set({ minutes: s ? Number(s) : null }); }} />
            <span className="muted text-sm">min</span>
          </span>
        </label>
        <div>
          <p className="mb-1.5 text-sm font-medium">Payer</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="chip" aria-pressed={b.payer === "medicare"} onClick={() => set({ payer: "medicare" })}>Medicare</button>
            <button type="button" className="chip" aria-pressed={b.payer === "other"} onClick={() => set({ payer: "other" })}>Other</button>
          </div>
        </div>
      </div>
      <p className="muted -mt-2 text-xs">All of your own time on the date of the visit: chart prep, history, exam, counseling, orders, coordination, documentation. Not staff time or separately billed tests.</p>

      {/* Problems */}
      <div>
        <p className="mb-1.5 text-sm font-medium">Problems addressed <span className="muted font-normal">· {LEVEL_NAME[r.problem]}</span></p>
        <div className="space-y-2">
          {b.problems.map((p, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input className="field-input min-w-0 flex-1" value={p.label} placeholder="problem"
                onChange={(e) => set({ problems: b.problems.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
              <select className="field-input w-full sm:w-auto" value={p.status}
                onChange={(e) => set({ problems: b.problems.map((x, j) => (j === i ? { ...x, status: e.target.value as ProblemStatus } : x)) })}>
                {PROBLEM_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              <button type="button" className="chip" aria-label="Remove problem" onClick={() => set({ problems: b.problems.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <button type="button" className="chip" onClick={() => set({ problems: [...b.problems, { label: "", status: "stable_chronic" }] })}>+ Add problem you addressed</button>
        </div>
        <p className="muted mt-1 text-xs">Only problems you actually evaluated or treated today. A chronic condition not at goal counts as not stable.</p>
      </div>

      {/* Data */}
      <div>
        <p className="mb-1.5 text-sm font-medium">Data <span className="muted font-normal">· {LEVEL_NAME[r.data]}</span></p>
        <div className="grid gap-2 sm:grid-cols-3">
          {([
            ["testsOrdered", "Unique tests ordered"],
            ["resultsReviewed", "Prior results reviewed"],
            ["externalNotes", "External notes reviewed"],
          ] as const).map(([k, label]) => (
            <div key={k} className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border)] px-3 py-2">
              <span className="text-sm">{label}</span>
              <span className="flex items-center gap-1">
                <button type="button" className="chip px-3" aria-label={`Fewer ${label}`} onClick={() => set({ [k]: Math.max(0, b[k] - 1) } as Partial<BillingInputs>)}>−</button>
                <span className="w-6 text-center tabular-nums">{b[k]}</span>
                <button type="button" className="chip px-3" aria-label={`More ${label}`} onClick={() => set({ [k]: b[k] + 1 } as Partial<BillingInputs>)}>+</button>
              </span>
            </div>
          ))}
        </div>
        <p className="mt-3 mb-1.5 text-xs font-medium">I independently interpreted (images/tracings, not billed separately by me)</p>
        <div className="flex flex-wrap gap-2">
          {INTERP_OPTIONS.map((o) => (
            <button key={o.value} type="button" className="chip" aria-pressed={b.interpretations.includes(o.value)}
              onClick={() => set({ interpretations: toggle(b.interpretations, o.value) })}>{o.label}</button>
          ))}
        </div>
        {interpAsk.length > 0 && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">Did you look at the {interpAsk.map((x) => INTERP_OPTIONS.find((o) => o.value === x)?.label.toLowerCase()).join(" or ")} yourself? Tick it only if you did.</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="chip" aria-pressed={b.discussion} onClick={() => set({ discussion: !b.discussion })}>Discussed with external physician</button>
          <button type="button" className="chip" aria-pressed={b.historian} onClick={() => set({ historian: !b.historian })}>Independent historian</button>
        </div>
      </div>

      {/* Risk */}
      <div>
        <p className="mb-1.5 text-sm font-medium">Risk of management <span className="muted font-normal">· {LEVEL_NAME[r.risk]}</span></p>
        <div className="flex flex-wrap gap-2">
          {RISK_ITEMS.filter((i) => i.value !== "otc").map((i) => (
            <button key={i.value} type="button" className="chip text-left" title={i.help} aria-pressed={b.risk.includes(i.value)}
              onClick={() => set({ risk: toggle<RiskItem>(b.risk, i.value) })}>
              {i.label} <span className="opacity-70">· {i.level === 4 ? "high" : "mod"}</span>
            </button>
          ))}
        </div>
        <details className="mt-1 text-xs">
          <summary className="muted cursor-pointer">Definitions</summary>
          <ul className="muted mt-1 list-disc space-y-1 pl-5">
            {RISK_ITEMS.filter((i) => i.help).map((i) => <li key={i.value}><b>{i.label}:</b> {i.help}</li>)}
          </ul>
        </details>
      </div>

      {/* Longitudinal */}
      <div>
        <p className="mb-1.5 text-sm font-medium">Longitudinal care add-on ({b.year >= 2027 ? "modifier B1/B2" : "G2211"})</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="chip" aria-pressed={b.longitudinal} onClick={() => set({ longitudinal: !b.longitudinal })}>I am this patient&apos;s ongoing cardiologist for this condition</button>
          <button type="button" className="chip" aria-pressed={b.mod25} onClick={() => set({ mod25: !b.mod25 })}>Same-day procedure (modifier 25)</button>
          {b.year >= 2027 && <button type="button" className="chip" aria-pressed={b.aco} onClick={() => set({ aco: !b.aco })}>MSSP / LEAD ACO participant</button>}
          {[2026, 2027].map((y) => <button key={y} type="button" className="chip" aria-pressed={b.year === y} onClick={() => set({ year: y })}>{y}</button>)}
        </div>
      </div>

      {/* Result */}
      <div className="rounded-xl border-2 border-[var(--chip-on)] p-4">
        {!r.ready ? (
          <p className="text-sm font-medium">Choose New or Return to see the supported level.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-2xl font-bold">{r.code}{r.prolonged ? ` + ${r.prolonged.code} ×${r.prolonged.units}` : ""}{r.addOn ? (r.addOn.code === "G2211" ? " + G2211" : `-${r.addOn.code.split(" ")[1]}`) : ""}</p>
              <p className="muted text-sm">by {r.basis === "time" ? "time" : "MDM"}</p>
            </div>
            <table className="mt-2 w-full text-sm">
              <tbody>
                <tr><td className="muted pr-2">MDM</td><td>{LEVEL_NAME[r.mdm]} → {r.mdmCode} <span className="muted">(problems {LEVEL_NAME[r.problem]}, data {LEVEL_NAME[r.data]}, risk {LEVEL_NAME[r.risk]}; 2 of 3 needed)</span></td></tr>
                <tr><td className="muted pr-2">Time</td><td>{b.minutes == null ? <span className="text-amber-700 dark:text-amber-400">enter total minutes</span> : r.timeCode ? `${b.minutes} min → ${r.timeCode}` : `${b.minutes} min (below the lowest time threshold)`}</td></tr>
              </tbody>
            </table>
            {r.addOn && <p className="mt-2 text-sm">➕ {r.addOn.text}</p>}
            {r.addOnNote && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{r.addOnNote}</p>}
            {r.prolonged && <p className="mt-1 text-sm">⏱ {r.prolonged.code} ×{r.prolonged.units}: prolonged service (starts at {r.prolonged.threshold} min {b.payer === "medicare" ? "for Medicare" : "under CPT"}).</p>}
            <div className="mt-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Billing statement</p>
                <button type="button" className="chip" onClick={copy}>{copied ? "Copied ✓" : "Copy"}</button>
              </div>
              <p className="mt-1 whitespace-pre-wrap rounded-lg bg-[var(--chip)] p-3 text-sm">{r.statement}</p>
            </div>
            {r.gaps.length > 0 && (
              <div className="mt-3">
                <p className="text-sm font-medium">To capture work you may have done (document only if true)</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{r.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
              </div>
            )}
            <ul className="muted mt-3 list-disc space-y-0.5 pl-5 text-xs">{r.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          </>
        )}
      </div>
      <p className="muted text-xs">Coding support only: the level comes from what you mark as done and documented. Follow your payer and compliance office.</p>
    </div>
  );
}
