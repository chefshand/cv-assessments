"use client";
import { CUES, cueDone } from "@/lib/cues";
import type { Inputs } from "@/lib/types";

/** Chips listing what to say; green when captured, amber when a key item is still missing. */
export function DictationGuide({ id, inputs, onJump, panel = false }: { id: string; inputs: Inputs; onJump: (key: string) => void; panel?: boolean }) {
  const cues = CUES[id] ?? [];
  if (!cues.length) return null;
  const done = cues.filter((c) => cueDone(c, inputs)).length;
  const coreLeft = cues.filter((c) => c.core && !cueDone(c, inputs)).length;
  return (
    <div className={panel ? "" : "mb-2"}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold">{panel ? "Say these" : "Include:"}</span>
        <span className="muted text-[11px]">
          {done}/{cues.length} captured{coreLeft ? ` · ${coreLeft} key item${coreLeft > 1 ? "s" : ""} missing` : " · key items ✓"}
        </span>
      </div>
      <div className={`flex flex-wrap gap-1.5 ${panel ? "" : "max-h-24 overflow-y-auto"}`}>
        {cues.map((c) => {
          const ok = cueDone(c, inputs);
          const cls = ok
            ? "border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
            : c.core
              ? "border-amber-500 bg-amber-500/10"
              : "muted border-[var(--border)]";
          return (
            <button
              key={c.label}
              type="button"
              onClick={() => onJump(c.keys[0])}
              className={`rounded-full border px-2 py-0.5 text-[12px] leading-5 ${cls}`}
              title={ok ? "Captured" : c.core ? "Key input missing" : "Optional"}
            >
              {ok ? "✓ " : ""}
              {c.label}
            </button>
          );
        })}
      </div>
      {panel && (
        <p className="muted mt-2 text-[11px]">Amber = needed for the recommendation. Grey = optional refinements. Tap a chip to jump to that field.</p>
      )}
    </div>
  );
}
