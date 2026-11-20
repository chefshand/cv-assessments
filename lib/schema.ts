import type { ClinicalModule, FieldDef, FieldValue, Inputs } from "./types";

/**
 * JSON schema for Claude's structured output. To stay well inside structured-
 * output limits on optional/union parameters, extraction returns a list of
 * {key, value} pairs (value always a string) that we coerce with the field
 * definitions. Only facts that were actually stated should be returned.
 */
export function extractionSchema(m: ClinicalModule): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      fields: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string", enum: m.fields.map((f) => f.key) },
            value: { type: "string" },
          },
          required: ["key", "value"],
          additionalProperties: false,
        },
      },
      unmapped: { type: "array", items: { type: "string" } },
    },
    required: ["fields", "unmapped"],
    additionalProperties: false,
  };
}

export function describeFields(m: ClinicalModule): string {
  return m.fields
    .map((f) => {
      let t = `- ${f.key}: ${f.label}`;
      if (f.type === "number") t += ` — number${f.unit ? ` in ${f.unit}` : ""}`;
      if (f.type === "bool") t += ` — "true" or "false" (only if stated or clearly implied)`;
      if (f.type === "select") t += ` — one of: ${f.options.map((o) => `"${o.value}" (${o.label})`).join(", ")}`;
      if (f.type === "multi") t += ` — comma-separated subset of: ${f.options.map((o) => `"${o.value}" (${o.label})`).join(", ")}`;
      if (f.type === "text") t += " — short free text";
      if (f.extractHint) t += `. ${f.extractHint}`;
      if (f.help) t += ` (${f.help})`;
      return t;
    })
    .join("\n");
}

export function coerce(f: FieldDef, raw: string): FieldValue | undefined {
  const s = raw.trim();
  if (s === "" || /^(null|unknown|n\/a)$/i.test(s)) return undefined;
  switch (f.type) {
    case "number": {
      const n = Number(s.replace(/[^0-9.\-]/g, ""));
      return Number.isFinite(n) && s.match(/\d/) ? n : undefined;
    }
    case "bool":
      if (/^(true|yes|y|1)$/i.test(s)) return true;
      if (/^(false|no|n|0)$/i.test(s)) return false;
      return undefined;
    case "select":
      return f.options.some((o) => o.value === s) ? s : undefined;
    case "multi": {
      const vals = s.split(/[,;]/).map((x) => x.trim()).filter((x) => f.options.some((o) => o.value === x));
      return vals.length ? vals : undefined;
    }
    case "text":
      return s.slice(0, 120);
  }
}

export function coerceAll(m: ClinicalModule, pairs: { key: string; value: string }[]): Inputs {
  const out: Inputs = {};
  for (const p of pairs) {
    const f = m.fields.find((x) => x.key === p.key);
    if (!f) continue;
    const v = coerce(f, p.value);
    if (v === undefined) continue;
    if (f.type === "multi" && Array.isArray(out[f.key])) {
      out[f.key] = [...new Set([...(out[f.key] as string[]), ...(v as string[])])];
    } else out[f.key] = v;
  }
  return out;
}
