import type { Inputs } from "./types";

export const num = (v: Inputs, k: string): number | null => {
  const x = v[k];
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string" && x.trim() !== "" && Number.isFinite(Number(x))) return Number(x);
  return null;
};

export const bool = (v: Inputs, k: string): boolean | null => {
  const x = v[k];
  return typeof x === "boolean" ? x : null;
};

export const yes = (v: Inputs, k: string): boolean => v[k] === true;

export const str = (v: Inputs, k: string): string | null => {
  const x = v[k];
  return typeof x === "string" && x !== "" ? x : null;
};

export const arr = (v: Inputs, k: string): string[] => {
  const x = v[k];
  return Array.isArray(x) ? x : [];
};

export const has = (v: Inputs, k: string, item: string): boolean => arr(v, k).includes(item);

export const fmt = (n: number, dp = 1): string => {
  const r = Number(n.toFixed(dp));
  return r.toString();
};

export const pct = (n: number, dp = 1): string => `${fmt(n, dp)}%`;

/** Join phrases into a readable English list. */
export const list = (items: string[], conj = "and"): string => {
  const xs = items.filter(Boolean);
  if (xs.length <= 1) return xs.join("");
  if (xs.length === 2) return `${xs[0]} ${conj} ${xs[1]}`;
  return `${xs.slice(0, -1).join(", ")}, ${conj} ${xs[xs.length - 1]}`;
};

export const sexWord = (v: Inputs): string => {
  const s = str(v, "sex");
  return s === "female" ? "woman" : s === "male" ? "man" : "patient";
};

export const ageSex = (v: Inputs): string => {
  const a = num(v, "age");
  return a != null ? `${a}-year-old ${sexWord(v)}` : `Patient`;
};

export const capFirst = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

export const ordinal = (n: number): string => {
  const r = Math.round(n);
  const s = ["th", "st", "nd", "rd"];
  const v = r % 100;
  return `${r}${s[(v - 20) % 10] || s[v] || s[0]}`;
};
