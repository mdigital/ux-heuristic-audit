---
name: ux-heuristic-audit
description: Audit a website against Nielsen's 10 Usability Heuristics (https://www.nngroup.com/articles/ten-usability-heuristics/). Crawls representative pages with Playwright, runs axe-core + Lighthouse, captures desktop + mobile screenshots, then writes a single markdown report with per-heuristic scores, evidence, and recommendations. Use when the user asks for a usability audit, heuristic review, NN/g heuristics, or "UX review of <url>".
argument-hint: <url> [--max-pages 10] [--out <dir>]
---

# /ux-heuristic-audit

Produce a standalone `REPORT.md` that scores a website against Jakob Nielsen's 10 usability heuristics, grounded in screenshots and automated signals rather than vibes.

## Engine

- **Playwright** (Chromium) for rendering, screenshots, accessibility snapshots.
- **@axe-core/playwright** for per-page a11y violations.
- **Lighthouse** (one run on the homepage) for perf/best-practices signals.
- **Claude vision** for the synthesis step — deterministic tools collect evidence, Claude judges each heuristic.

All three node packages are invoked via `npx` — nothing to pre-install globally except Playwright's browser binary.

## Prerequisites

Run ONCE as a single Bash call before touching anything else:

```bash
node --version && npx --yes playwright --version && test -d ~/Library/Caches/ms-playwright/chromium-* && echo OK
```

If the `test -d` fails (first run ever), run:
```bash
npx --yes playwright install chromium
```

If `node` is missing, tell the user to `brew install node` and stop.

## Arguments

- `<url>` — required. The root URL of the site to audit (e.g. `https://example.com`).
- `--max-pages N` — optional, default 10.
- `--out <dir>` — optional, default `./ux-audit-<host>-<YYYYMMDD>/`.
- `--search-query "<term>"` — optional. Overrides the auto-derived search probe query. By default the crawler derives the term from the homepage's `<title>`, meta description, and top headings (stopword-filtered, top-2 salient nouns). The actual query used is recorded in `MANIFEST.json → searchQuery`. Override when the derived term is nonsensical or you want to test a specific user intent.

## Steps

### 1. Discover pages and capture evidence

From the skill directory, run the crawler. It handles sitemap parsing, nav fallback, page ranking, and all per-page capture (desktop + mobile screenshots, accessibility tree, DOM outline, axe violations, console errors):

```bash
cd ~/.claude/skills/ux-heuristic-audit
node scripts/crawl.mjs <url> --max-pages <N> --out <out-dir>
```

For long crawls (>5 pages) run this with `run_in_background: true` and poll for the `MANIFEST.json` file in the output dir. The crawler writes progress lines you can stream.

### 2. Run analyzers

```bash
node scripts/analyze.mjs --out <out-dir>
```

This runs Lighthouse once on the homepage and aggregates axe results. It writes `analysis-summary.json` in the output dir.

### 3. Read and synthesize

Open `MANIFEST.json` and `analysis-summary.json`. For each of the 10 heuristics, use this signal mapping:

| # | Heuristic | Primary signals |
|---|---|---|
| 1 | Visibility of system status | Lighthouse LCP/CLS, loading states visible in screenshots, form submit feedback, breadcrumbs |
| 2 | Match between system and real world | Vision: jargon, iconography, date/currency formats in DOM outline |
| 3 | User control and freedom | Vision: undo, back, cancel, modal dismissibility, breadcrumbs |
| 4 | Consistency and standards | Cross-page diff of nav, buttons, terminology via screenshots + DOM outlines |
| 5 | Error prevention | Form DOM (required fields, input types); `probes.emptyForm` screenshot — does submitting an empty required form get blocked client-side? |
| 6 | Recognition rather than recall | Vision: visible labels, autocomplete attrs in DOM, suggestions, persistent navigation |
| 7 | Flexibility and efficiency of use | `probes.keyboard` (first 10 Tab stops, `anyFocusIndicator` bool, focus screenshot); `probes.search` (does search exist and return usable results?); Lighthouse a11y score |
| 8 | Aesthetic and minimalist design | Vision over fold screenshots; text density; above-the-fold clutter |
| 9 | Help users recognize/diagnose/recover from errors | Crafted-404 screenshot; `probes.emptyForm` screenshot (is the error message specific, visible, and recoverable?); `probes.search` results page if query returned zero hits |
| 10 | Help and documentation | DOM outline: presence of `/help`, `/docs`, search; tooltips; FAQ links |

Axe accessibility violations feed #4, #5, #6, #7 as supporting evidence.

For each heuristic, **read the 2–4 most diagnostic screenshots** with the Read tool (it renders PNGs visually) before scoring. Do not score a heuristic you have not looked at.

### 4. Write the report

Copy `templates/report.md` to `<out-dir>/REPORT.md` and fill it in. Every Issue must cite a screenshot path using relative markdown image syntax, e.g. `![Contact form](screenshots/contact.desktop.png)`.

Score scale per heuristic:
- **5** — Exemplary, nothing to improve.
- **4** — Solid, minor polish.
- **3** — Acceptable, clear improvements available.
- **2** — Notable problems affecting usability.
- **1** — Severe violations, likely to block users.

### 5. Render PDF

After `REPORT.md` is complete, render a printable PDF alongside it:

```bash
node scripts/pdf.mjs --out <out-dir>
```

This writes `report.pdf` in the output directory. Screenshots are embedded (images load from relative paths inside the out-dir), A4 with appropriate print CSS. No extra dependencies — uses the same Playwright browser plus `marked` for the markdown → HTML step.

### 6. Report back

Tell the user:
- Path to `REPORT.md` **and** `report.pdf`.
- Overall score (mean of 10).
- The 3 lowest-scoring heuristics and a one-line summary each.
- Do not paste the full report into chat.

## Limitations (mention these up front if relevant)

- No authenticated flows in v1 — login-gated pages are skipped. If the user needs auth, ask them to produce a Playwright `storageState.json` and pass `--auth-storage-state <path>` (crawler accepts this).
- Single-locale — audits whatever the server serves from the crawler's IP.
- Not a WCAG audit — axe is used as evidence, not as the primary lens.

## Failure modes

- **Playwright browser not installed.** First run only — `npx playwright install chromium`.
- **Site blocks headless UA.** Crawler sets a realistic UA; if still blocked, warn the user and suggest `--auth-storage-state` with a real session.
- **sitemap.xml is huge.** Crawler caps candidates at 200 before ranking down to `--max-pages`.
- **Infinite scroll / SPA routes.** `networkidle` can time out; crawler falls back to `load` with a 3s settle.
