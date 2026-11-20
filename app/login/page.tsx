"use client";
import { useState } from "react";

export default function Login() {
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode: code }),
    });
    if (res.ok) {
      window.location.href = "/";
      return;
    }
    const data = await res.json().catch(() => ({}));
    setErr(data.error ?? "Sign-in failed");
    setBusy(false);
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <img src="/icons/icon.svg" alt="" className="mx-auto mb-4 h-16 w-16" />
      <h1 className="text-center text-xl font-semibold">CV Assessments</h1>
      <p className="muted mb-6 text-center text-sm">Enter your passcode</p>
      <form onSubmit={submit} className="space-y-3">
        <input
          className="field-input text-center tracking-widest"
          type="password"
          autoComplete="current-password"
          inputMode="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoFocus
        />
        <button
          type="submit"
          disabled={busy || !code}
          className="chip w-full font-semibold"
          style={{ background: "var(--chip-on)", color: "var(--chip-on-text)", borderColor: "var(--chip-on)" }}
        >
          {busy ? "…" : "Unlock"}
        </button>
        {err && <p className="text-center text-sm text-rose-600">{err}</p>}
      </form>
    </main>
  );
}
