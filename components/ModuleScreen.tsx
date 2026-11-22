"use client";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { getModule } from "@/lib/modules";
import { CITES } from "@/lib/citations";
import type { FieldDef, FieldValue, Inputs, RuleResult, Severity } from "@/lib/types";
import { FieldControl } from "./FieldControl";
import { useDictation } from "./useDictation";
import { PrivacyNote } from "./PrivacyNote";
import { DictationGuide } from "./DictationGuide";
import { BillingPanel } from "./BillingPanel";
import { billingHints } from "@/lib/billing";

// In-memory only (survives in-app navigation, cleared on reload). Never persisted.
const memory = new Map<string, { inputs: Inputs; text: string; ai: string[] }>();

const SEV_STYLE: Record<Severity, string> = {
  urgent: "border-l-4 border-rose-500 bg-rose-500/10",
  warning: "border-l-4 border-amber-500 bg-amber-500/10",
  action: "border-l-4 border-blue-600 bg-blue-600/10",
  info: "border-l-4 border-slate-400 bg-slate-400/10",
};

type Style = "paragraph" | "bullets" | "brief";

export function ModuleScreen({ id }: { id: string }) {
  const m = getModule(id)!;
  const saved = memory.get(id);
  const [inputs, setInputs] = useState<Inputs>(saved?.inputs ?? {});
  const [text, setText] = useState(saved?.text ?? "");
  const [aiKeys, setAiKeys] = useState<string[]>(saved?.ai ?? []);
  const [unmapped, setUnmapped] = useState<string[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [polished, setPolished] = useState<{ text: string; forKey: string } | null>(null);
  const [polishing, setPolishing] = useState(false);
  const [style, setStyle] = useState<Style>("paragraph");
  const [copied, setCopied] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const apRef = useRef<HTMLDivElement>(null);

  const remember = (i: Inputs, t: string, a: string[]) => memory.set(id, { inputs: i, text: t, ai: a });

  const dict = useDictation((final) => {
    setText((t) => {
      const next = t ? `${t.trimEnd()} ${final}` : final;
      remember(inputs, next, aiKeys);
      return next;
    });
  });

  const clean = useMemo(() => {
    const o: Inputs = {};
    for (const [k, v] of Object.entries(inputs)) {
      if (v === undefined || v === null || v === "") continue;
      o[k] = typeof v === "string" && m.fields.find((f) => f.key === k)?.type === "number" ? Number(v) : v;
    }
    return o;
  }, [inputs, m.fields]);

  const result: RuleResult = useMemo(() => {
    try {
      return m.evaluate(clean);
    } catch (e) {
      return { headline: "Could not evaluate", metrics: [], recommendations: [{ text: String(e), severity: "warning" }], missing: [], ap: "" };
    }
  }, [m, clean]);

  const inputsKey = JSON.stringify(clean);
  const polishedFresh = polished && polished.forKey === inputsKey;
  const apText = polishedFresh ? polished!.text : result.ap;

  const setField = (k: string, v: FieldValue | undefined) => {
    const next = { ...inputs };
    if (v === undefined) delete next[k];
    else next[k] = v;
    const nextAi = aiKeys.filter((x) => x !== k);
    setInputs(next);
    setAiKeys(nextAi);
    remember(next, text, nextAi);
  };

  async function extract() {
    if (!text.trim()) return;
    setExtracting(true);
    setErr(null);
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module: id, text }),
      });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Extraction failed");
      const got = data.inputs as Inputs;
      const next = { ...inputs, ...got };
      const keys = [...new Set([...aiKeys, ...Object.keys(got)])];
      setInputs(next);
      setAiKeys(keys);
      setUnmapped(data.unmapped ?? []);
      remember(next, text, keys);
      // open sections that received values
      const open: Record<string, boolean> = { ...openSections };
      for (const k of Object.keys(got)) {
        const f = m.fields.find((x) => x.key === k);
        if (f?.section) open[f.section] = true;
      }
      setOpenSections(open);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setExtracting(false);
    }
  }

  async function polish() {
    setPolishing(true);
    setErr(null);
    try {
      const res = await fetch("/api/phrase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module: id, inputs: clean, style }),
      });
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

  function jumpTo(key: string) {
    const f = m.fields.find((x) => x.key === key);
    if (f?.section) setOpenSections((o) => ({ ...o, [f.section!]: true }));
    setTimeout(() => {
      const el = document.getElementById(`f-${key}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      (el?.querySelector("input,button") as HTMLElement | null)?.focus({ preventScroll: true });
    }, 60);
  }

  function reset() {
    setInputs({});
    setText("");
    setAiKeys([]);
    setUnmapped([]);
    setPolished(null);
    memory.delete(id);
  }

  // Group fields by section, honoring showIf
  const sections = useMemo(() => {
    const out: { name: string; fields: FieldDef[] }[] = [];
    for (const f of m.fields) {
      if (f.showIf && !f.showIf(clean)) continue;
      const name = f.section ?? "Inputs";
      let s = out.find((x) => x.name === name);
      if (!s) out.push((s = { name, fields: [] }));
      s.fields.push(f);
    }
    return out;
  }, [m.fields, clean]);

  return (
    <main className="mx-auto max-w-2xl px-4 pb-32 lg:max-w-5xl pt-[max(1rem,env(safe-area-inset-top))]">
      <header className="mb-4 flex items-center gap-3">
        <Link href="/" className="chip" aria-label="Back">←</Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{m.icon} {m.title}</h1>
        </div>
        <button type="button" className="chip" onClick={reset}>Clear</button>
      </header>

      {/* Free text / voice */}
      <section className="card p-3 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-5">
        <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Describe the patient</h2>
          <span className="muted text-xs">type, dictate, or skip to buttons</span>
        </div>
        <div className="lg:hidden">
          <DictationGuide id={id} inputs={clean} onJump={jumpTo} />
        </div>
        <textarea
          className="field-input min-h-28 resize-y"
          placeholder={m.placeholder}
          value={text + (dict.interim ? ` ${dict.interim}` : "")}
          onChange={(e) => {
            setText(e.target.value);
            remember(inputs, e.target.value, aiKeys);
          }}
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
            disabled={extracting || !text.trim()}
            onClick={extract}
          >
            {extracting ? "Extracting…" : "✨ Extract to form"}
          </button>
          {!dict.supported && <span className="muted text-xs">Tip: use the 🎤 on your keyboard to dictate.</span>}
        </div>
        {dict.error && <p className="mt-2 text-xs text-rose-600">{dict.error}</p>}
        {aiKeys.length > 0 && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
            AI filled {aiKeys.length} field{aiKeys.length > 1 ? "s" : ""} (outlined). Please confirm below.
          </p>
        )}
        {unmapped.length > 0 && (
          <p className="muted mt-1 text-xs">Not used by the rules: {unmapped.join("; ")}</p>
        )}
        <div className="mt-2"><PrivacyNote compact /></div>
        </div>
        <aside className="hidden border-l pl-5 lg:block" style={{ borderColor: "var(--border)" }}>
          <DictationGuide id={id} inputs={clean} onJump={jumpTo} panel />
        </aside>
      </section>

      {/* Form */}
      <section className="mt-4 space-y-2">
        {sections.map((s, i) => {
          const filled = s.fields.filter((f) => clean[f.key] !== undefined).length;
          const open = openSections[s.name] ?? i < 2;
          return (
            <div key={s.name} className="card">
              <button
                type="button"
                className="flex w-full items-center justify-between px-4 py-3 text-left"
                onClick={() => setOpenSections({ ...openSections, [s.name]: !open })}
              >
                <span className="font-medium">{s.name}</span>
                <span className="muted text-sm">{filled > 0 ? `${filled}/${s.fields.length} ` : ""}{open ? "▾" : "▸"}</span>
              </button>
              {open && (
                <div className="space-y-1 px-3 pb-3">
                  {s.fields.map((f) => (
                    <FieldControl key={f.key} f={f} value={inputs[f.key]} ai={aiKeys.includes(f.key)} onChange={(v) => setField(f.key, v)} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* Results */}
      <section className="card mt-4 p-4">
        <h2 className="text-base font-semibold">{result.headline}</h2>
        {result.metrics.length > 0 && (
          <dl className="mt-3 grid grid-cols-2 gap-2">
            {result.metrics.map((x) => (
              <div key={x.label} className="rounded-lg p-2" style={{ background: "var(--chip)" }}>
                <dt className="muted text-[11px] uppercase tracking-wide">{x.label}</dt>
                <dd className="text-sm font-semibold">{x.value}</dd>
                {x.note && <dd className="muted text-xs">{x.note}</dd>}
              </div>
            ))}
          </dl>
        )}
        {result.recommendations.length > 0 && (
          <ul className="mt-3 space-y-2">
            {result.recommendations.map((r, i) => (
              <li key={i} className={`rounded-md p-2 text-sm ${SEV_STYLE[r.severity ?? "info"]}`}>
                {r.text}
                {(r.cor || r.cite) && (
                  <span className="muted ml-1 text-xs">
                    {r.cor ? `[COR ${r.cor}] ` : ""}
                    {(r.cite ?? []).map((c) => CITES[c] && (
                      <a key={c} href={CITES[c].url} target="_blank" rel="noreferrer" className="underline">{shortCite(c)} </a>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {result.missing.length > 0 && (
          <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">Would refine: {result.missing.join("; ")}</p>
        )}
      </section>

      {/* A&P */}
      <section ref={apRef} className="card mt-4 p-4" id="ap">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Assessment &amp; Plan</h2>
          <span className="muted text-xs">{polishedFresh ? "polished by Claude" : polished ? "inputs changed, showing rule text" : "rule-generated"}</span>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{apText || "Enter inputs to generate an A&P."}</p>
        <p className="muted mt-3 text-xs">Optional: have Claude reword it (same recommendations) in your preferred style.</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {(["paragraph", "bullets", "brief"] as Style[]).map((s) => (
            <button key={s} type="button" className="chip" aria-pressed={style === s} onClick={() => setStyle(s)}>
              {s === "paragraph" ? "Paragraph" : s === "bullets" ? "Numbered plan" : "Brief"}
            </button>
          ))}
          <button type="button" className="chip" disabled={polishing || !result.ap} onClick={polish}>
            {polishing ? "Polishing…" : "✨ Polish with Claude"}
          </button>
        </div>
        {err && <p className="mt-2 text-xs text-rose-600">{err}</p>}
      </section>

      {/* Billing */}
      <section className="card mt-4 p-4" id="billing">
        <details open>
          <summary className="cursor-pointer text-base font-semibold">💵 Visit level (E/M) &amp; billing statement</summary>
          <p className="muted mt-1 text-xs">Suggestions below come from this case; untick anything you did not do today.</p>
          <div className="mt-3">
            <BillingPanel
              storeKey={`m:${id}`}
              hints={billingHints(id, m.title, clean, apText, result.headline)}
              suggestInterp={billingHints(id, m.title, clean, apText, result.headline).interpretations}
            />
          </div>
        </details>
      </section>

      {/* Sources */}
      <section className="mt-4 px-1">
        <h3 className="muted text-xs font-semibold uppercase tracking-wide">Sources</h3>
        <ol className="muted mt-1 list-decimal space-y-1 pl-5 text-xs">
          {m.citations.map((c) => (
            <li key={c.key}><a href={c.url} target="_blank" rel="noreferrer" className="underline">{c.text}</a></li>
          ))}
        </ol>
        <p className="muted mt-3 text-xs">
          Decision support only; verify against the source guideline and individual clinical judgment.
        </p>
      </section>

      {/* Sticky copy bar */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur" style={{ background: "color-mix(in srgb, var(--card) 88%, transparent)", borderColor: "var(--border)" }}>
        <div className="mx-auto flex max-w-2xl items-center gap-2 lg:max-w-5xl">
          <button type="button" className="chip flex-1" onClick={() => apRef.current?.scrollIntoView({ behavior: "smooth" })}>
            View A&amp;P
          </button>
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
    </main>
  );
}

export function shortCite(key: string): string {
  const map: Record<string, string> = {
    lipid2026: "ACC/AHA 2026", prevent: "PREVENT", mesa: "MESA", cacdrs: "CAC-DRS", scct2021: "NLA/SCCT 2021",
    prim2019: "ACC/AHA 2019", chestpain2021: "Chest pain 2021", esc2025: "ESC/EAS 2025", aorta2022: "ACC/AHA 2022",
    zafar2018: "Zafar 2018", pa2025: "Endo Soc 2025", pa2016: "Endo Soc 2016", periop2024: "ACC/AHA 2024 (reaff. 2026)",
    rcri: "RCRI", dasi: "METS/DASI", pause: "PAUSE", glp1_2024: "GLP-1 2024", valve2020: "ACC/AHA VHD 2020",
    htn2025: "ACC/AHA BP 2025", hf2022: "AHA/ACC/HFSA 2022", hfref2024: "ACC HFrEF 2024", hfpef2026: "ACC HFpEF 2026",
    hcm2024: "AHA/ACC HCM 2024", hcmriskscd: "HCM Risk-SCD", attr2025: "ACC ATTR-CM 2025", gillmore2016: "Gillmore 2016",
    nac2018: "NAC stage", escvhd2025: "ESC VHD 2025", af2023: "ACC/AHA AF 2023", syncope2017: "Syncope 2017", ccd2023: "CCD 2023", esco2022: "ESC Cardio-Onc 2022", accco2025: "ACC 2025", asco2017: "ASCO 2017",
  };
  return map[key] ?? key;
}
