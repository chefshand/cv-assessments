// Best-effort removal of obvious identifiers before text leaves the device.
// It cannot catch everything (e.g., names in free prose), so the UI still
// warns the user not to paste identifiers.
const RULES: [RegExp, string][] = [
  [/^\s*(patient|pt|name|patient name|dob|date of birth|mrn|csn|fin|acct|account|address|phone|pcp|referring|provider|attending)\s*[:#].*$/gim, "[removed line]"],
  [/\b(MRN|MR#|CSN|FIN|Acct|Account|SSN)\s*[:#]?\s*[A-Z0-9-]{4,}\b/gi, "[id removed]"],
  [/\b\d{3}-\d{2}-\d{4}\b/g, "[id removed]"],
  [/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email removed]"],
  [/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g, "[phone removed]"],
  [/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, "[date]"],
  [/\b(19|20)\d{2}-\d{2}-\d{2}\b/g, "[date]"],
  [/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+(19|20)\d{2}\b/gi, "[date]"],
  [/\b\d{7,}\b/g, "[number removed]"],
  [/\b(Mr|Mrs|Ms|Miss|Mx)\.?\s+[A-Z][a-zA-Z'-]+(\s+[A-Z][a-zA-Z'-]+)?/g, "[name removed]"],
];

export function scrubIdentifiers(text: string): { text: string; removed: number } {
  let removed = 0;
  let out = text;
  for (const [re, rep] of RULES) {
    out = out.replace(re, () => {
      removed++;
      return rep;
    });
  }
  return { text: out, removed };
}
