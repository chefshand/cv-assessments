"use client";
import type { FieldDef, FieldValue } from "@/lib/types";

export function FieldControl({
  f, value, onChange, ai,
}: { f: FieldDef; value: FieldValue | undefined; onChange: (v: FieldValue | undefined) => void; ai: boolean }) {
  const wrap = `py-2 px-1 ${ai ? "ai-filled px-2" : ""}`;
  const label = (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <span className="text-sm font-medium">{f.label}</span>
      {ai && <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-600">AI</span>}
    </div>
  );
  const help = f.help ? <p className="muted mt-1 text-xs">{f.help}</p> : null;

  if (f.type === "number" || f.type === "text") {
    return (
      <div className={wrap}>
        {label}
        <div className="flex items-center gap-2">
          <input
            className="field-input"
            inputMode={f.type === "number" ? "decimal" : "text"}
            type="text"
            value={value == null ? "" : String(value)}
            placeholder={f.type === "number" ? (f.unit ?? "") : ""}
            onChange={(e) => {
              const s = e.target.value;
              if (s === "") return onChange(undefined);
              if (f.type === "text") return onChange(s);
              // keep partial input like "4." while typing
              if (/^-?\d*\.?\d*$/.test(s)) onChange(s.endsWith(".") || s === "-" ? (s as unknown as number) : Number(s));
            }}
          />
          {f.type === "number" && f.unit && <span className="muted shrink-0 text-sm">{f.unit}</span>}
        </div>
        {help}
      </div>
    );
  }

  if (f.type === "bool") {
    const opts: [string, boolean][] = [["Yes", true], ["No", false]];
    return (
      <div className={wrap}>
        {label}
        <div className="flex gap-2">
          {opts.map(([l, b]) => (
            <button key={l} type="button" className="chip min-w-16" aria-pressed={value === b} onClick={() => onChange(value === b ? undefined : b)}>
              {l}
            </button>
          ))}
        </div>
        {help}
      </div>
    );
  }

  if (f.type === "select") {
    return (
      <div className={wrap}>
        {label}
        <div className="flex flex-wrap gap-2">
          {f.options.map((o) => (
            <button key={o.value} type="button" className="chip" aria-pressed={value === o.value} onClick={() => onChange(value === o.value ? undefined : o.value)}>
              {o.label}
            </button>
          ))}
        </div>
        {help}
      </div>
    );
  }

  const cur = Array.isArray(value) ? value : [];
  return (
    <div className={wrap}>
      {label}
      <div className="flex flex-wrap gap-2">
        {f.options.map((o) => {
          const on = cur.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              className="chip"
              aria-pressed={on}
              onClick={() => {
                const next = on ? cur.filter((x) => x !== o.value) : [...cur, o.value];
                onChange(next.length ? next : undefined);
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {help}
    </div>
  );
}
