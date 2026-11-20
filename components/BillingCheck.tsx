"use client";
import Link from "next/link";
import { useState } from "react";
import { emptyBilling, INTERP_OPTIONS, PROBLEM_STATUS, RISK_ITEMS, type BillingInputs, type ProblemStatus, type RiskItem } from "@/lib/billing";
import { scrubIdentifiers } from "@/lib/scrub";
import { BillingPanel } from "./BillingPanel";

interface Mapping {
  visitTypeStated: "new" | "established" | "unknown";
  minutesDocumented: string;
  problems: { label: string; status: ProblemStatus; evidence: string }[];
  testsOrdered: string[];
  resultsReviewed: string[];
  externalNotes: string[];
  independentHistorian: boolean;
  interpretations: string[];
  externalDiscussion: boolean;
  risk: { item: RiskItem; evidence: string }[];
  longitudinal: boolean;
  questions: string[];
}

const okStatus = new Set(PROBLEM_STATUS.map((p) => p.value));
const okRisk = new Set(RISK_ITEMS.map((r) => r.value));
const okInterp = new Set(INTERP_OPTIONS.map((o) => o.value));

function toInputs(m: Mapping, visit: BillingInputs["visit"], minutes: number | null): BillingInputs {
  const docMin = Number(String(m.minutesDocumented ?? "").replace(/\D/g, "")) || null;
  return {
    ...emptyBilling(),
    visit: visit ?? (m.visitTypeStated === "unknown" ? null : m.visitTypeStated),
    minutes: minutes ?? docMin,
    problems: (m.problems ?? []).filter((p) => okStatus.has(p.status)).map((p) => ({ label: p.label, status: p.status })),
    testsOrdered: (m.testsOrdered ?? []).length,
    resultsReviewed: (m.resultsReviewed ?? []).length,
    externalNotes: (m.externalNotes ?? []).length,
    historian: !!m.independentHistorian,
    interpretations: (m.interpretations ?? []).filter((x) => okInterp.has(x)),
    discussion: !!m.externalDiscussion,
    risk: [...new Set((m.risk ?? []).map((r) => r.item).filter((x) => okRisk.has(x)))],
    longitudinal: !!m.longitudinal,
  };
}

export function BillingCheck() {
  const [text, setText] = useState("");
  const [visit, setVisit] = useState<BillingInputs["visit"]>(null);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [scrubbed, setScrubbed] = useState(0);
  const [run, setRun] = useState(0);

  const analyze = async () => {
    setErr(null);
    const s = scrubIdentifiers(text);
    setScrubbed(s.removed);
    if (s.removed) setText(s.text);
    setBusy(true);
    try {
      const res = await fetch("/api/billing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: s.text }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Request failed");
      setMapping(j.mapping);
      setRun((n) => n + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-2xl px-4 pb-16 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <header className="mb-4 flex items-center gap-3">
        <Link href="/" className="chip" aria-label="Back">←</Link>
        <div>
          <h1 className="text-xl font-semibold leading-tight">💵 Billing check</h1>
          <p className="muted text-sm">Paste a finished A&amp;P to see the E/M level it supports</p>
        </div>
      </header>

      <section className="card p-4">
        <div className="mb-3 rounded-lg border border-amber-500 bg-amber-500/10 p-3 text-sm">
          <b>Remove identifiers first.</b> No names, MRN, DOB, dates, addresses or phone numbers. Obvious ones are stripped on your phone before sending, but names inside sentences can slip through. The text is sent to the Anthropic API to map it to MDM elements; nothing is stored.
        </div>
        <p className="mb-1.5 text-sm font-medium">Visit type <span className="text-rose-600">*</span></p>
        <div className="mb-3 flex flex-wrap gap-2">
          <button type="button" className="chip" aria-pressed={visit === "new"} onClick={() => setVisit("new")}>New patient</button>
          <button type="button" className="chip" aria-pressed={visit === "established"} onClick={() => setVisit("established")}>Return (established)</button>
        </div>
        <label className="mb-3 block">
          <span className="mb-1.5 block text-sm font-medium">Total time today <span className="text-rose-600">*</span></span>
          <span className="flex items-center gap-2">
            <input className="field-input w-28" inputMode="numeric" value={minutes ?? ""} placeholder="min" onChange={(e) => { const s = e.target.value.replace(/\D/g, ""); setMinutes(s ? Number(s) : null); }} />
            <span className="muted text-sm">minutes, all of your same-day work</span>
          </span>
        </label>
        <textarea className="field-input min-h-48 w-full" placeholder="Paste the Assessment & Plan (and data reviewed, if it's in the note)…" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="mt-2 flex items-center gap-2">
          <button type="button" className="chip font-semibold" style={{ background: "var(--chip-on)", color: "white" }} disabled={!text.trim() || busy} onClick={analyze}>
            {busy ? "Analyzing…" : "✨ Check billing level"}
          </button>
          {scrubbed > 0 && <span className="muted text-xs">Removed {scrubbed} identifier{scrubbed > 1 ? "s" : ""} before sending.</span>}
        </div>
        {err && <p className="mt-2 text-xs text-rose-600">{err}</p>}
      </section>

      {mapping && (
        <>
          <section className="card mt-4 p-4">
            <h2 className="text-base font-semibold">What the note documents</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {mapping.problems.map((p, i) => (
                <li key={i}>• <b>{p.label}</b>: {PROBLEM_STATUS.find((s) => s.value === p.status)?.label.toLowerCase()} <span className="muted">“{p.evidence}”</span></li>
              ))}
              {mapping.testsOrdered.length > 0 && <li>• Ordered: {mapping.testsOrdered.join(", ")}</li>}
              {mapping.resultsReviewed.length > 0 && <li>• Reviewed: {mapping.resultsReviewed.join(", ")}</li>}
              {mapping.externalNotes.length > 0 && <li>• External records: {mapping.externalNotes.join(", ")}</li>}
              {mapping.interpretations.length > 0 && <li>• Independent interpretation: {mapping.interpretations.join(", ")}</li>}
              {mapping.externalDiscussion && <li>• Discussion with external physician</li>}
              {mapping.risk.map((r, i) => (
                <li key={`r${i}`}>• {RISK_ITEMS.find((x) => x.value === r.item)?.label}: <span className="muted">“{r.evidence}”</span></li>
              ))}
            </ul>
            {mapping.questions.length > 0 && (
              <>
                <p className="mt-3 text-sm font-medium">Questions about your documentation (add only what you actually did)</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{mapping.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
              </>
            )}
          </section>
          <section className="card mt-4 p-4">
            <h2 className="mb-1 text-base font-semibold">Level</h2>
            <p className="muted mb-3 text-xs">Pre-filled from the note. Adjust anything that is wrong, then copy the statement.</p>
            <BillingPanel key={run} storeKey={`check:${run}`} initial={toInputs(mapping, visit, minutes)} />
          </section>
        </>
      )}
    </main>
  );
}
