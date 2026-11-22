"use client";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { MODULES, getModule } from "@/lib/modules";
import { CITES } from "@/lib/citations";
import { CUES } from "@/lib/cues";
import type { FieldDef, FieldValue, Inputs, Severity } from "@/lib/types";
import { runVisit, sharedFields, unifyShared, visitBillingHints } from "@/lib/visit/plan";
import { detectModulesLocal, localExtract } from "@/lib/visit/local";
import { FieldControl } from "./FieldControl";
import { useDictation } from "./useDictation";
import { PrivacyNote } from "./PrivacyNote";
import { BillingPanel } from "./BillingPanel";
import { shortCite } from "./ModuleScreen";

// In-memory only (survives in-app navigation, cleared on reload). Never persisted.
interface Saved { text: string; ids: string[]; inputs: Record<string, Inputs>; ai: string[]; conflicts: string[]; source: Source | null }
let memory: Saved | null = null;

type Source = "ai" | "local";
type Style = "bullets" | "paragraph" | "brief";

const SEV_STYLE: Record<Severity, string> = {
  urgent: "border-l-4 border-rose-500 bg-rose-500/10",
  warning: "border-l-4 border-amber-500 bg-amber-500/10",
  action: "border-l-4 border-blue-600 bg-blue-600/10",
  info: "border-l-4 border-slate-400 bg-slate-400/10",
};

const PLACEHOLDER = "e.g. 68-year-old man, CAC 340, 82nd percentile, LDL 128 not on a statin, takes aspirin 81. BP 150/92 on lisinopril 20. Paroxysmal AF on apixaban 5 mg BID, 82 kg, Cr 1.0, HR 72, EF 60%, occasional palpitations. Nonsmoker, no diabetes.";

const has = (v: FieldValue | undefined) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);

function numberize(m: string, v: Inputs): Inputs {
  const fields = getModule(m)?.fields ?? [];
  const o: Inputs = {};
  for (const [k, x] of Object.entries(v)) {
    if (!has(x)) continue;
    o[k] = typeof x === "string" && fields.find((f) => f.key === k)?.type === "number" ? Number(x) : x;
  }
  return o;
}

export function VisitScreen() {
  const [text, setText] = useState(memory?.text ?? "");
  const [ids, setIds] = useState<string[]>(memory?.ids ?? []);
  const [inputs, setInputs] = useState<Record<string, Inputs>>(memory?.inputs ?? {});
  const [ai, setAi] = useState<string[]>(memory?.ai ?? []); // "module.key"
  const [conflicts, setConflicts] = useState<string[]>(memory?.conflicts ?? []);
  const [source, setSource] = useState<Source | null>(memory?.source ?? null);
  const [localOnly, setLocalOnly] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fallbackWhy, setFallbackWhy] = useState<string | null>(null);
  const [allOpen, setAllOpen] = useState<Record<string, boolean>>({});
  const [polished, setPolished] = useState<{ text: string; forKey: string } | null>(null);
  const [polishing, setPolishing] = useState(false);
  const [style, setStyle] = useState<Style>("bullets");
  const [copied, setCopied] = useState(false);
  const apRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);

  const save = (patch: Partial<Saved>) => {
    memory = { text, ids, inputs, ai, conflicts, source, ...memory, ...patch } as Saved;
  };

  const dict = useDictation((final) => {
    setText((t) => {
      const next = t ? `${t.trimEnd()} ${final}` : final;
      save({ text: next });
      return next;
    });
  });

  const clean = useMemo(() => {
    const o: Record<string, Inputs> = {};
    for (const id of ids) o[id] = numberize(id, inputs[id] ?? {});
    return o;
  }, [ids, inputs]);
  const plan = useMemo(() => (ids.length ? runVisit(clean, ids) : null), [clean, ids]);
  const shared = useMemo(() => sharedFields(ids), [ids]);
  const sharedKeys = new Set(shared.map((s) => s.key));
  const hints = useMemo(() => (plan ? visitBillingHints(plan) : undefined), [plan]);

  const inputsKey = JSON.stringify(clean);
  const polishedFresh = polished && polished.forKey === inputsKey;
  const apText = polishedFresh ? polished!.text : plan?.ap ?? "";

  function apply(nextIds: string[], got: Record<string, Inputs>, src: Source, keepExisting: boolean) {
    const base: Record<string, Inputs> = keepExisting ? { ...inputs } : {};
    for (const id of nextIds) base[id] = { ...(got[id] ?? {}), ...(keepExisting ? base[id] ?? {} : {}) };
    const u = unifyShared(base, nextIds);
    const aiKeys = new Set(keepExisting ? ai : []);
    for (const id of nextIds) for (const k of Object.keys(u.inputs[id])) if (!keepExisting || !has(inputs[id]?.[k])) aiKeys.add(`${id}.${k}`);
    setIds(nextIds);
    setInputs(u.inputs);
    setAi([...aiKeys]);
    setConflicts(u.conflicts);
    setSource(src);
    setPolished(null);
    memory = { text, ids: nextIds, inputs: u.inputs, ai: [...aiKeys], conflicts: u.conflicts, source: src };
  }

  async function callAi(body: { text: string; modules?: string[] }): Promise<{ modules: string[]; inputs: Record<string, Inputs> }> {
    const res = await fetch("/api/visit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.status === 401) {
      window.location.href = "/login";
      throw new Error("Signed out");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `AI extraction failed (${res.status})`);
    return data;
  }

  async function build() {
    if (!text.trim()) return;
    setBusy("Reading the dictation…");
    setErr(null);
    setFallbackWhy(null);
    try {
      if (localOnly || (typeof navigator !== "undefined" && navigator.onLine === false)) {
        if (!localOnly) setFallbackWhy("You're offline.");
        throw new Error("local");
      }
      const preset = source === null && ids.length ? ids : undefined;
      const data = await callAi(preset ? { text, modules: preset } : { text });
      if (!data.modules.length) {
        setErr("No module matched this dictation. Pick the problems below and tap Build again.");
        setIds([]);
        return;
      }
      apply(data.modules, data.inputs, "ai", false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "Signed out") return;
      if (msg !== "local") setFallbackWhy(msg);
      const found = ids.length && source === null ? ids : detectModulesLocal(text);
      if (!found.length) {
        setErr("No module matched this dictation. Pick the problems below.");
      } else apply(found, localExtract(text, found), "local", false);
    } finally {
      setBusy(null);
      setTimeout(() => confirmRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    }
  }

  async function toggleModule(id: string) {
    if (ids.includes(id)) {
      const next = ids.filter((x) => x !== id);
      setIds(next);
      setPolished(null);
      save({ ids: next });
      return;
    }
    const next = MODULES.map((m) => m.id).filter((x) => x === id || ids.includes(x));
    if (!text.trim() || source === null) {
      setIds(next);
      save({ ids: next });
      return;
    }
    setBusy(`Reading ${getModule(id)!.short} facts…`);
    try {
      if (source === "local" || localOnly) throw new Error("local");
      const data = await callAi({ text, modules: [id] });
      apply(next, data.inputs, "ai", true);
    } catch {
      apply(next, localExtract(text, [id]), source ?? "local", true);
    } finally {
      setBusy(null);
    }
  }

  function setField(id: string, key: string, v: FieldValue | undefined) {
    const targets = sharedKeys.has(key) ? shared.find((s) => s.key === key)!.modules : [id];
    const next = { ...inputs };
    for (const t of targets) {
      const row = { ...(next[t] ?? {}) };
      if (v === undefined) delete row[key];
      else row[key] = v;
      next[t] = row;
    }
    const nextAi = ai.filter((x) => !targets.some((t) => x === `${t}.${key}`));
    setInputs(next);
    setAi(nextAi);
    setConflicts(conflicts.filter((c) => c !== key));
    save({ inputs: next, ai: nextAi });
  }

  async function polish() {
    setPolishing(true);
    setErr(null);
    try {
      const res = await fetch("/api/visit/phrase", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ inputs: clean, style }) });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Polish failed");
      setPolished({ text: data.text, forKey: inputsKey });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPolishing(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(apText);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = apText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function reset() {
    setText(""); setIds([]); setInputs({}); setAi([]); setConflicts([]); setSource(null); setPolished(null); setErr(null); setFallbackWhy(null);
    memory = null;
  }

  // Fields to show for a module on the confirm screen: filled, derived, or key cues still missing.
  function confirmFields(id: string, all: boolean): FieldDef[] {
    const m = getModule(id)!;
    const eff = plan?.effective[id] ?? {};
    const core = new Set((CUES[id] ?? []).filter((c) => c.core).flatMap((c) => c.keys));
    return m.fields.filter((f) => {
      if (sharedKeys.has(f.key)) return false;
      if (f.showIf && !f.showIf(eff)) return false;
      if (all) return true;
      return has(inputs[id]?.[f.key]) || !!plan?.derived[id]?.[f.key] || core.has(f.key);
    });
  }

  const sharedShown = shared.filter((s) => {
    const core = s.modules.some((id) => (CUES[id] ?? []).some((c) => c.core && c.keys.includes(s.key)));
    return core || s.modules.some((id) => has(inputs[id]?.[s.key]));
  });

  return (
    <main className="mx-auto max-w-2xl px-4 pb-32 pt-[max(1rem,env(safe-area-inset-top))] lg:max-w-5xl">
      <header className="mb-4 flex items-center gap-3">
        <Link href="/" className="chip" aria-label="Back">←</Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">🗂️ Whole visit</h1>
        </div>
        <button type="button" className="chip" onClick={reset}>Clear</button>
      </header>

      {/* 1. Dictation */}
      <section className="card p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">1 · Dictate the whole history</h2>
          <span className="muted text-xs">all problems in one go</span>
        </div>
        <textarea
          className="field-input min-h-40 resize-y"
          placeholder={PLACEHOLDER}
          value={text + (dict.interim ? ` ${dict.interim}` : "")}
          onChange={(e) => { setText(e.target.value); save({ text: e.target.value }); }}
          maxLength={6000}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {dict.supported && (
            <button type="button" className="chip" aria-pressed={dict.listening} onClick={dict.toggle}>
              {dict.listening ? "■ Stop" : "🎤 Dictate"}
            </button>
          )}
          <button
            type="button"
            className="chip font-semibold"
            style={{ background: "var(--chip-on)", color: "var(--chip-on-text)", borderColor: "var(--chip-on)" }}
            disabled={!!busy || !text.trim()}
            onClick={build}
          >
            {busy ?? (source ? "↻ Re-read dictation" : "✨ Build assessment & plan")}
          </button>
          <button type="button" className="chip text-xs" aria-pressed={localOnly} onClick={() => setLocalOnly(!localOnly)} title="Parse on this phone only; nothing is sent to the AI">
            {localOnly ? "✓ " : ""}On-device only
          </button>
          {!dict.supported && <span className="muted text-xs">Tip: use the 🎤 on your keyboard to dictate.</span>}
        </div>
        {dict.error && <p className="mt-2 text-xs text-rose-600">{dict.error}</p>}
        {source === "local" && (
          <p className="mt-2 rounded-md border-l-4 border-amber-500 bg-amber-500/10 p-2 text-xs">
            {fallbackWhy ? `AI reader unavailable (${fallbackWhy}) ` : ""}Read on this phone with fixed patterns, which miss unusual phrasing. Check every field below.
          </p>
        )}
        {err && <p className="mt-2 text-xs text-rose-600">{err}</p>}
        <div className="mt-3">
          <p className="mb-1.5 text-xs font-semibold">Problems to assess {source ? <span className="muted font-normal">· picked from the dictation, tap to change</span> : <span className="muted font-normal">· picked automatically, or choose</span>}</p>
          <div className="flex flex-wrap gap-1.5">
            {MODULES.map((m) => (
              <button key={m.id} type="button" className="chip text-xs" aria-pressed={ids.includes(m.id)} disabled={!!busy} onClick={() => toggleModule(m.id)}>
                {m.icon} {m.short}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-2"><PrivacyNote compact /></div>
      </section>

      {/* 2. Confirm */}
      {ids.length > 0 && plan && (
        <section ref={confirmRef} className="mt-4 scroll-mt-4 space-y-2">
          <div className="px-1">
            <h2 className="text-sm font-semibold">2 · Confirm what was heard</h2>
            <p className="muted text-xs">
              {ai.length ? "Amber = read from the dictation. " : ""}Fix anything misheard; the plan below updates as you edit. Shared facts are entered once for every problem.
            </p>
            {conflicts.length > 0 && (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">Problems disagreed on: {conflicts.join(", ")}. The first value was used; please check.</p>
            )}
          </div>

          {sharedShown.length > 0 && (
            <div className="card px-3 pb-3 pt-2">
              <p className="px-1 py-1 font-medium">Shared facts</p>
              {sharedShown.map((s) => {
                const id = s.modules[0];
                return (
                  <div key={s.key}>
                    <FieldControl f={s.field} value={inputs[id]?.[s.key]} ai={s.modules.some((m) => ai.includes(`${m}.${s.key}`))} onChange={(v) => setField(id, s.key, v)} />
                    <p className="muted -mt-1 px-1 pb-1 text-[11px]">Used by {s.modules.map((m) => getModule(m)!.short).join(", ")}</p>
                  </div>
                );
              })}
            </div>
          )}

          {plan.runs.map((r) => {
            const open = allOpen[r.id] ?? false;
            const fs = confirmFields(r.id, open);
            return (
              <div key={r.id} className="card px-3 pb-3 pt-2">
                <div className="flex items-start justify-between gap-2 px-1 py-1">
                  <div className="min-w-0">
                    <p className="font-medium">{r.icon} {r.title}</p>
                    <p className="muted text-xs">{r.result.headline}</p>
                  </div>
                  <Link href={`/m/${r.id}`} className="muted shrink-0 text-xs underline">module ↗</Link>
                </div>
                {fs.map((f) => {
                  const why = plan.derived[r.id]?.[f.key];
                  const effV = plan.effective[r.id]?.[f.key];
                  return (
                    <div key={f.key}>
                      <FieldControl f={f} value={inputs[r.id]?.[f.key]} ai={ai.includes(`${r.id}.${f.key}`)} onChange={(v) => setField(r.id, f.key, v)} />
                      {why && !has(inputs[r.id]?.[f.key]) && (
                        <p className="-mt-1 px-1 pb-1 text-[11px] text-sky-700 dark:text-sky-400">
                          Auto: {Array.isArray(effV) ? effV.join(", ") : effV === true ? "Yes" : effV === false ? "No" : String(effV)} ({why}). Tap a choice to override.
                        </p>
                      )}
                    </div>
                  );
                })}
                <button type="button" className="chip mt-1 text-xs" onClick={() => setAllOpen({ ...allOpen, [r.id]: !open })}>
                  {open ? "Show fewer fields" : `All ${r.result.missing.length ? "fields · " + r.result.missing.length + " would refine" : "fields"}`}
                </button>
              </div>
            );
          })}
        </section>
      )}

      {/* 3. Plan */}
      {plan && (
        <section ref={apRef} className="card mt-4 p-4" id="ap">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">3 · Assessment &amp; Plan</h2>
            <span className="muted text-xs">{polishedFresh ? "polished by Claude" : polished ? "inputs changed, showing rule text" : "rule-generated"}</span>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{apText || "Enter the key inputs above to generate a plan."}</p>

          {plan.notes.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold">Reconciled across problems</p>
              <ul className="mt-1 space-y-2">
                {plan.notes.map((n, i) => (
                  <li key={i} className={`rounded-md p-2 text-sm ${SEV_STYLE[n.severity]}`}>
                    {n.text}
                    {n.cite && <span className="muted ml-1 text-xs">{n.cite.map((c) => CITES[c] && <a key={c} href={CITES[c].url} target="_blank" rel="noreferrer" className="underline">{shortCite(c)} </a>)}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="muted mt-3 text-xs">Optional: have Claude merge it into one concise note (same recommendations, shared items said once).</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {(["bullets", "paragraph", "brief"] as Style[]).map((s) => (
              <button key={s} type="button" className="chip" aria-pressed={style === s} onClick={() => setStyle(s)}>
                {s === "bullets" ? "By problem" : s === "paragraph" ? "Paragraphs" : "Brief"}
              </button>
            ))}
            <button type="button" className="chip" disabled={polishing || !plan.ap || localOnly} onClick={polish}>
              {polishing ? "Polishing…" : "✨ Polish with Claude"}
            </button>
          </div>
        </section>
      )}

      {/* Per-problem detail */}
      {plan && plan.runs.length > 0 && (
        <section className="mt-4 space-y-2">
          {plan.runs.map((r) => (
            <details key={r.id} className="card p-3">
              <summary className="cursor-pointer text-sm font-semibold">{r.icon} {r.title}: guideline detail</summary>
              {r.result.metrics.length > 0 && (
                <dl className="mt-3 grid grid-cols-2 gap-2">
                  {r.result.metrics.map((x) => (
                    <div key={x.label} className="rounded-lg p-2" style={{ background: "var(--chip)" }}>
                      <dt className="muted text-[11px] uppercase tracking-wide">{x.label}</dt>
                      <dd className="text-sm font-semibold">{x.value}</dd>
                      {x.note && <dd className="muted text-xs">{x.note}</dd>}
                    </div>
                  ))}
                </dl>
              )}
              <ul className="mt-3 space-y-2">
                {r.result.recommendations.map((x, i) => (
                  <li key={i} className={`rounded-md p-2 text-sm ${SEV_STYLE[x.severity ?? "info"]} ${r.superseded.includes(i) ? "line-through opacity-60" : ""}`}>
                    {x.text}
                    {x.cor && <span className="muted ml-1 text-xs">[COR {x.cor}]</span>}
                    {r.superseded.includes(i) && <span className="ml-1 text-xs no-underline">(superseded: see reconciled notes)</span>}
                  </li>
                ))}
              </ul>
              {r.result.missing.length > 0 && <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">Would refine: {r.result.missing.join("; ")}</p>}
            </details>
          ))}
        </section>
      )}

      {/* Billing */}
      {plan && hints && (
        <section className="card mt-4 p-4" id="billing">
          <details open>
            <summary className="cursor-pointer text-base font-semibold">💵 Visit level (E/M) &amp; billing statement</summary>
            <p className="muted mt-1 text-xs">One problem per module from this visit; untick anything you did not do today.</p>
            <div className="mt-3">
              <BillingPanel key={ids.join(",")} storeKey={`visit:${ids.join(",")}`} hints={hints} suggestInterp={hints.interpretations} />
            </div>
          </details>
        </section>
      )}

      <p className="muted mt-4 px-1 text-xs">Each problem runs its module&apos;s guideline rules unchanged; sources are listed on each module page. Decision support only; verify against the source guideline and clinical judgment.</p>

      {/* Sticky copy bar */}
      {plan && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur" style={{ background: "color-mix(in srgb, var(--card) 88%, transparent)", borderColor: "var(--border)" }}>
          <div className="mx-auto flex max-w-2xl items-center gap-2 lg:max-w-5xl">
            <button type="button" className="chip flex-1" onClick={() => apRef.current?.scrollIntoView({ behavior: "smooth" })}>View A&amp;P</button>
            <button
              type="button"
              className="chip flex-[2] font-semibold"
              style={{ background: copied ? "#16a34a" : "var(--accent, #e11d48)", color: "white", borderColor: "transparent" }}
              disabled={!apText}
              onClick={copy}
            >
              {copied ? "✓ Copied" : "Copy A&P"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
