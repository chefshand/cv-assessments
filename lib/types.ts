// Shared types for every clinical module.
// Each module declares its inputs once as a list of FieldDefs. The same list
// drives (1) the tap/fill form, (2) the JSON schema Claude extracts free text
// into, and (3) the deterministic rule engine's input object. That is how
// free text, voice, buttons and typed fields all converge on one structured
// input and therefore one recommendation.

export type FieldValue = number | string | boolean | string[] | null;
export type Inputs = Record<string, FieldValue>;

interface BaseField {
  key: string;
  label: string;
  section?: string;
  help?: string;
  /** Extra guidance for the extraction model (units, synonyms). */
  extractHint?: string;
  /** Only show this field when the predicate is true. */
  showIf?: (v: Inputs) => boolean;
}

export interface NumberField extends BaseField {
  type: "number";
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
}

export interface BoolField extends BaseField {
  type: "bool";
}

export interface Option {
  value: string;
  label: string;
}

export interface SelectField extends BaseField {
  type: "select";
  options: Option[];
}

export interface MultiField extends BaseField {
  type: "multi";
  options: Option[];
}

export interface TextField extends BaseField {
  type: "text";
}

export type FieldDef = NumberField | BoolField | SelectField | MultiField | TextField;

export type Severity = "info" | "action" | "warning" | "urgent";

export interface Recommendation {
  text: string;
  severity?: Severity;
  /** Short citation key, resolved via the module's citation list. */
  cite?: string[];
  /** Recommendation class / level of evidence when the guideline gives one. */
  cor?: string;
  /** Phrase used in the A&P paragraph. Omit to reuse `text`; set "" to leave out. */
  ap?: string;
}

export interface Metric {
  label: string;
  value: string;
  note?: string;
}

export interface Citation {
  key: string;
  text: string;
  url: string;
}

export interface RuleResult {
  /** One-line headline for the assessment. */
  headline: string;
  metrics: Metric[];
  recommendations: Recommendation[];
  /** Missing data that would change or refine the recommendation. */
  missing: string[];
  /** Deterministic A&P paragraph built from the rule output. */
  ap: string;
}

export interface ClinicalModule {
  id: string;
  title: string;
  short: string;
  description: string;
  icon: string;
  fields: FieldDef[];
  placeholder: string;
  evaluate: (inputs: Inputs) => RuleResult;
  citations: Citation[];
}
