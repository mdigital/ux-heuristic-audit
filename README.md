# ux-heuristic-audit

A [Claude Code](https://claude.com/claude-code) skill that audits a website against [Jakob Nielsen's 10 Usability Heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) and produces a single markdown report with per-heuristic scores, embedded screenshot evidence, and recommendations.

## For designers — running a UX audit

You don't need to code. This skill runs inside Claude Desktop and produces a single `REPORT.md` + `report.pdf` with scored heuristics and screenshots.

> **Heads-up:** You'll use the **Code** tab in Claude Desktop. *Code tab ≠ coding* — it's just Claude with permission to read/write files on your Mac, which this skill needs so it can run its browser scripts and save screenshots to a folder.

### One-time setup (~5 min)

1. Install [Claude Desktop](https://claude.com/download) and sign in (Pro plan or above).
2. Install Node.js — open **Terminal** and run:
   ```bash
   brew install node
   ```
   (If you don't have Homebrew, get it at [brew.sh](https://brew.sh) first.)
3. Install the skill — paste this into Terminal. It clones the repo, runs the installer, and tells you about any issues:
   ```bash
   git clone https://github.com/mdigital/ux-heuristic-audit.git ~/.claude/skills/ux-heuristic-audit && bash ~/.claude/skills/ux-heuristic-audit/install-on-macos.sh
   ```
4. Restart Claude Desktop.

### Running an audit

1. Open Claude Desktop and click the **Code** tab.
2. When prompted, pick a working folder (your Desktop or Documents is fine — this is where the report will be saved).
3. Type:
   ```
   /ux-heuristic-audit https://yoursite.com
   ```
4. Leave the app open — the crawl takes a few minutes.
5. When done, Claude will tell you where to find `REPORT.md` and `report.pdf`.

### Useful options

- Limit pages audited: `--max-pages 5`
- Specify a search term to test: `--search-query "apply for a permit"`

Example:
```
/ux-heuristic-audit https://yoursite.com --max-pages 5 --search-query "apply for a permit"
```

## What it does

1. **Discovers pages** — parses `sitemap.xml` (falls back to homepage nav) and picks up to N representative pages: homepage, listing, detail, form, search, about, help, pricing, plus a crafted 404.
2. **Captures evidence** per page, at desktop (1440×900) and mobile (390×844):
   - Full-page + above-the-fold screenshots
   - Accessibility tree (`page.accessibility.snapshot()`)
   - DOM outline (landmarks, headings, forms, buttons, links)
   - `@axe-core/playwright` violations
   - Console errors + failed requests
3. **Runs interactive probes** (desktop):
   - **Search probe** — auto-derives a search query from the site's `<title>` / meta / headings (or pass `--search-query "…"` to override), types it into the first search input, submits, screenshots the results page.
   - **Empty-form probe** — finds the first non-search form with required fields, clicks submit without filling anything, screenshots the error state.
   - **Keyboard focus trace** — presses Tab 10 times, records each focused element and whether a visible focus ring appears.
4. **Runs Lighthouse** once on the homepage for Core Web Vitals + a11y/best-practices/SEO scores.
5. **Synthesises** — Claude reads the screenshots + accessibility trees + axe violations + probe results and scores each of the 10 heuristics /5 with "what works", "issues" (citing screenshots), and "recommendations".
6. **Writes `REPORT.md`** in the output directory — self-contained, renders standalone with embedded images.
7. **Renders `report.pdf`** — A4 print-styled PDF with embedded screenshots, generated via Playwright (no extra browser dependencies).

## Installation

### Prerequisites

- macOS / Linux
- [Claude Code](https://claude.com/claude-code) installed
- Node.js ≥ 18 (`brew install node`)
- [GitHub CLI](https://cli.github.com/) or plain `git` to clone

### Install the skill

```bash
# Clone into your Claude Code skills directory
git clone https://github.com/mdigital/ux-heuristic-audit.git ~/.claude/skills/ux-heuristic-audit

# Install Node deps + the matching Playwright browser (one-time, ~130 MB)
cd ~/.claude/skills/ux-heuristic-audit
npm install
npx playwright install chromium
```

Restart Claude Code (or start a new session). The skill will be discoverable as `/ux-heuristic-audit`.

## Usage

In any Claude Code session:

```
/ux-heuristic-audit https://example.com
```

### Arguments

| Flag | Default | Description |
|---|---|---|
| `<url>` | — (required) | Root URL of the site to audit. |
| `--max-pages N` | `10` | Max pages to audit (including a crafted 404). |
| `--out <dir>` | `./ux-audit-<host>-<YYYYMMDD>/` | Output directory. |
| `--search-query "<term>"` | auto-derived | Overrides the search probe query. By default it's derived from the homepage's title/meta/headings (top-2 salient nouns after stopword filtering). |
| `--auth-storage-state <path>` | — | Playwright `storageState.json` for auditing login-gated pages. |

### Example

```
/ux-heuristic-audit https://codehub.building.govt.nz/ --max-pages 8
```

Output:

```
ux-audit-codehub.building.govt.nz-20260415/
├── REPORT.md                     ← open this (or report.pdf for print/share)
├── report.pdf                    ← A4 PDF with embedded screenshots
├── MANIFEST.json                 ← crawl manifest (pages, probes, derived search query)
├── analysis-summary.json         ← Lighthouse scores + aggregated axe violations
├── lighthouse.json               ← full Lighthouse result
├── screenshots/
│   ├── index.desktop.png
│   ├── index.desktop.fold.png
│   ├── index.desktop.search.png  ← result of the auto-derived search probe
│   ├── index.desktop.emptyform.png
│   ├── index.desktop.focus.png
│   ├── index.mobile.png
│   └── ...
└── data/
    └── <slug>.<viewport>.json    ← per-page DOM outline, a11y tree, axe violations
```

## How the scoring works

Each heuristic gets:

- **Score /5** — `5` exemplary · `4` solid, minor polish · `3` acceptable, improvements available · `2` notable problems · `1` severe violations.
- **What works** — positive observations with screenshot refs.
- **Issues** — each cited to a specific page + screenshot.
- **Recommendations** — concrete, actionable fixes.

Signal → heuristic mapping is documented in `SKILL.md`. Deterministic tools (Lighthouse, axe, DOM inspection, Playwright probes) gather evidence; Claude does the synthesis.

## Limitations

- **No authenticated flows** by default — pass `--auth-storage-state` with a Playwright session file to audit login-gated pages.
- **Single locale** — audits whatever the server serves from the crawler's IP.
- **Not a WCAG audit** — axe violations are used as evidence, not as the primary lens. Use a dedicated a11y tool for compliance work.
- **Interactive probes are best-effort** — heavily JS-driven or captcha-protected flows can break the empty-form and search probes; they're logged with an error and the rest of the audit continues.

## Troubleshooting

**"Executable doesn't exist at …/chrome-headless-shell"**
The Playwright npm package was updated but the browser binary wasn't. Run:
```bash
cd ~/.claude/skills/ux-heuristic-audit && npx playwright install chromium
```

**Site blocks the headless crawler**
The crawler sets a realistic desktop Chrome user-agent, but some sites still block. Provide a real session:
```bash
# In a one-off Node script, use Playwright to log in manually and save state:
await context.storageState({ path: 'state.json' })
```
Then `/ux-heuristic-audit <url> --auth-storage-state ./state.json`.

**Lighthouse fails**
The audit continues without it — `analysis-summary.json → lighthouse.error` records why. Usually: missing Chrome binary on `PATH`, or the site blocks the Lighthouse UA. You can install globally: `npm i -g lighthouse`.

## Repo layout

```
ux-heuristic-audit/
├── SKILL.md              # instructions Claude follows — heuristic→signal mapping, scoring rubric
├── package.json          # pinned deps: playwright, @axe-core/playwright, fast-xml-parser
├── scripts/
│   ├── crawl.mjs         # Playwright discovery + capture + probes
│   ├── analyze.mjs       # axe aggregation + Lighthouse
│   └── pdf.mjs           # REPORT.md → report.pdf (A4, embedded screenshots)
└── templates/
    └── report.md         # skeleton Claude fills in
```

## License

MIT
