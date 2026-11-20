import Link from "next/link";
import { MODULES } from "@/lib/modules";
import { PrivacyNote } from "@/components/PrivacyNote";

export default function About() {
  return (
    <main className="mx-auto max-w-2xl px-4 pb-16 pt-[max(1rem,env(safe-area-inset-top))]">
      <header className="mb-4 flex items-center gap-3">
        <Link href="/" className="chip" aria-label="Back">←</Link>
        <h1 className="text-lg font-semibold">Sources &amp; method</h1>
      </header>

      <section className="card space-y-2 p-4 text-sm">
        <p className="font-medium">How it works</p>
        <p className="muted">
          Free text, dictation, buttons and typed fields all fill the same structured inputs. Recommendations come from
          deterministic, guideline-based rules that run on your device (the same input always gives the same answer).
          Claude (Anthropic API) is used only to (1) extract structured inputs from free text, which you confirm, and
          (2) optionally reword the rule-generated A&amp;P without adding recommendations.
        </p>
        <p className="muted">
          Calculators: AHA PREVENT 10- and 30-year (base, UACR or HbA1c model, with the 2026 HbA1c erratum), MESA 10-year
          CHD with/without CAC, RCRI, DASI, aortic height/size index and CSA/height.
        </p>
        <p className="muted">
          Decision support only. Guidelines are summarized and simplified; verify with the source document and clinical
          judgment. Not a substitute for specialist consultation.
        </p>
      </section>

      <div className="mt-4"><PrivacyNote /></div>

      {MODULES.map((m) => (
        <section key={m.id} className="mt-4">
          <h2 className="font-semibold">{m.icon} {m.title}</h2>
          <ol className="muted mt-1 list-decimal space-y-1 pl-5 text-xs">
            {m.citations.map((c) => (
              <li key={c.key}><a href={c.url} target="_blank" rel="noreferrer" className="underline">{c.text}</a></li>
            ))}
          </ol>
        </section>
      ))}
      <section className="mt-4">
        <h2 className="font-semibold">💵 Billing (E/M)</h2>
        <ul className="muted mt-1 list-disc space-y-1 pl-5 text-xs">
          <li>AMA CPT office/outpatient E/M guidelines (2021 framework, current in 2026): level by MDM (2 of 3: problems, data, risk) or by total time on the date of service, never combined. Time thresholds: new 15/30/45/60 min (99202-99205), established 10/20/30/40 min (99212-99215).</li>
          <li>Prolonged services: CPT 99417 (from 75 min new / 55 min established); Medicare G2212 (from 89 min new / 69 min established).</li>
          <li>G2211 (CY2024-2026 Medicare PFS): office E/M add-on for longitudinal care of a serious or complex condition; not with modifier 25 except preventive services, AWV and vaccines.</li>
          <li><a className="underline" href="https://www.cms.gov/newsroom/fact-sheets/calendar-year-cy-2027-medicare-physician-fee-schedule-final-rule" target="_blank" rel="noreferrer">CY2027 Medicare PFS final rule (CMS fact sheet, Nov 2026)</a>: G2211 becomes modifier B1 (+16% of the E/M payment) or B2 (+32%, Shared Savings Program / LEAD ACO participants) from Jan 1, 2027.</li>
        </ul>
      </section>
      <p className="mt-8 text-center">
        <a href="/logout" className="muted text-xs underline">Sign out</a>
      </p>
    </main>
  );
}
