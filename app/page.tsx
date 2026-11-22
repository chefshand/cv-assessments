import Link from "next/link";
import { MODULES } from "@/lib/modules";
import { PrivacyNote } from "@/components/PrivacyNote";

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-4 pb-16 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <header className="mb-5 flex items-center gap-3">
        <img src="/icons/icon.svg" alt="" className="h-10 w-10" />
        <div>
          <h1 className="text-xl font-semibold leading-tight">CV Assessments</h1>
          <p className="muted text-sm">Guideline-based recommendations → copy-ready A&amp;P</p>
        </div>
      </header>
      <Link href="/visit" className="card mb-3 flex items-start gap-3 border-2 p-4 active:scale-[0.99]" style={{ borderColor: "var(--chip-on)" }}>
        <span className="text-2xl" aria-hidden>🗂️</span>
        <span>
          <span className="block font-semibold">Whole visit (one dictation)</span>
          <span className="muted block text-sm">Dictate the full history once. Each relevant module (e.g., CAC, BP, AF) runs its guideline rules, and you get one reconciled assessment &amp; plan.</span>
        </span>
      </Link>
      <Link href="/billing" className="card mb-3 flex items-start gap-3 border-2 p-4 active:scale-[0.99]" style={{ borderColor: "var(--chip-on)" }}>
        <span className="text-2xl" aria-hidden>💵</span>
        <span>
          <span className="block font-semibold">Billing check</span>
          <span className="muted block text-sm">Paste any finished A&amp;P: E/M level by MDM or time (whichever is higher), billing statement, G2211 / B1, and documentation questions.</span>
        </span>
      </Link>
      <nav className="grid gap-3">
        {MODULES.map((m) => (
          <Link key={m.id} href={`/m/${m.id}`} className="card flex items-start gap-3 p-4 active:scale-[0.99]">
            <span className="text-2xl" aria-hidden>{m.icon}</span>
            <span>
              <span className="block font-semibold">{m.title}</span>
              <span className="muted block text-sm">{m.description}</span>
            </span>
          </Link>
        ))}
      </nav>
      <div className="mt-6">
        <PrivacyNote />
      </div>
      <p className="muted mt-4 text-center text-xs">
        <Link href="/about" className="underline">Sources, method &amp; disclaimer</Link>
      </p>
    </main>
  );
}
