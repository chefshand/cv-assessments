# CV Assessments

Phone-first PWA for cardiology clinic decision support. For five common clinic questions, free text, dictation, tap buttons, or typed fields all fill **one structured input**. A **deterministic, guideline-based rule engine** turns that input into recommendations and a patient-specific **Assessment & Plan** you can copy straight into the note.

| Module | Guideline / tools |
|---|---|
| Coronary calcium score | 2026 ACC/AHA dyslipidemia, NLA/SCCT 2021, CAC-DRS, MESA CHD (with CAC), 2019 ACC/AHA aspirin |
| Ascending aorta | 2022 ACC/AHA aortic disease (thresholds by etiology/gene, growth, indexed size AHI/ASI/CSA-height, imaging interval + modality) |
| ASCVD risk mitigation | 2026 ACC/AHA dyslipidemia, PREVENT 10/30-yr (base/UACR/HbA1c, 2026 erratum), MESA, Lp(a), ApoB, CAC, stepwise nonstatin escalation |
| Primary aldosteronism | 2025 Endocrine Society (screen all HTN, assay-specific ARR/aldo cutoffs, medication & K+ interference, next steps) |
| Preoperative risk | 2024 ACC/AHA perioperative, RCRI, DASI, BNP/NT-proBNP, stents/DAPT timing, valves, PAUSE DOAC holds, SGLT2/GLP-1/RAASi |

## Whole visit (one dictation)
`/visit` takes one dictated history covering several problems (e.g., CAC score, BP and AF in the same patient).
1. `POST /api/visit` has Claude pick the relevant modules, then extracts each module's fields in parallel (Claude only parses).
2. A confirm screen shows what was heard. Shared facts (age, sex, SBP, diabetes…) are entered once for every module; a few cross-module inputs are auto-filled and labeled (e.g., AF's CHA₂DS₂-VASc hypertension point from the BP module) and can be overridden.
3. Each module's rules run unchanged; `lib/visit/plan.ts` numbers the problems into one A&P and reconciles overlaps (primary-prevention aspirin vs anticoagulation, two LDL-C goals → the stricter, AF rate control also lowering BP, SBP >160 as a bleeding risk on anticoagulation).
4. Offline, without an API key, or with "On-device only", `lib/visit/local.ts` detects modules and reads common facts with fixed patterns, and the screen says so.

## How Claude is used
* `POST /api/extract` turns free text into the module's fields (structured outputs). Extracted fields are outlined in amber for the clinician to confirm.
* `POST /api/phrase` optionally rewrites the rule-generated A&P (paragraph / numbered / brief). The rules are recomputed server-side and Claude is told not to add recommendations.
* Model: `claude-opus-5-5` (override with `CLAUDE_MODEL`), low effort for speed, server-side refusal fallback enabled.

All recommendations come from `lib/modules/*.ts`, which run on the device and also work offline.

## Privacy
No database and no logging of request bodies. Form state lives in memory only (cleared on reload). The service worker never caches `/api`. The UI tells users not to enter identifiers.

## Access
Everything except `/login` is behind a passcode (`APP_PASSCODE`). The cookie is an HMAC of the passcode, so changing the passcode signs everyone out. In production the API fails closed if `APP_PASSCODE` is unset.

## Develop
```bash
npm install
cp .env.example .env.local   # set ANTHROPIC_API_KEY and APP_PASSCODE
npm run dev
npm test                     # rule-engine + calculator tests
```

## Deploy (Vercel)
1. Import the GitHub repo in Vercel (framework: Next.js).
2. Environment variables: `ANTHROPIC_API_KEY`, `APP_PASSCODE` (optional `AUTH_SECRET`).
3. Domains → add `cv.kiaafshar.org`, then add the CNAME `cv → cname.vercel-dns.com` at your DNS provider.
4. On iPhone: open the site in Safari → Share → Add to Home Screen.

Decision support only. Verify against the source guideline and clinical judgment.
