# Lao Kip & Gold Dashboard — Project Plan for Claude Code

> How to use: put this file in the repo root. Work ONE phase at a time.
> Start each phase in Plan Mode (`/plan`), e.g. "Read PLAN.md and plan Phase 1 only."
> Do not start the next phase until the current phase's acceptance checks pass.

---

## [ROLE]
You are a senior full-stack developer building a small, reliable, zero-cost personal dashboard.
Prefer simple, readable code over clever code. The owner is not a professional web developer.

## [CONTEXT]
- Owner: Win, Lao, works in Thailand. Checks the site daily on a phone.
- Purpose: see Lao kip exchange rates, gold prices (world / Thai / Lao) and Lao economy in ONE place,
  and get an early hint of direction before Bank of the Lao PDR (BOL) and Lao gold shops post on Facebook.
- Known facts (researched, use as design basis):
  - BOL sets a daily reference rate each morning, based on: weighted average of the previous day's
    overall rate + estimated domestic USD demand + forecast of the international USD rate (IMF 2023).
    Only the first part is observable → we can estimate DIRECTION, not the exact number.
  - Lao gold prices follow (1) the reference gold price and (2) the kip exchange rate.
    Research (Souphanouvong University) notes Lao gold price references usually come from the
    Thai gold market → primary estimate = Thai Gold Traders Association price × THB→LAK.
  - Most-trusted Lao gold shop: Phouvong Jewelry (ຮ້ານຄຳພູວົງ), Vientiane. Posts prices on Facebook only
    (no API; do NOT scrape Facebook). Secondary reference: Lao Bullion Bank (LBB PLUS app).

## [GOAL]
A static website (GitHub Pages) + scheduled data collection (GitHub Actions), fully free, bilingual Thai/Lao,
mobile-first, that shows today's numbers, history charts, an estimated Lao gold price, and a direction hint.

---

## Architecture
```
GitHub Actions (cron) ──> fetch scripts ──> data/*.json (committed to repo, with history)
                                              │
GitHub Pages (static HTML/CSS/JS + Chart.js) ─┘ reads JSON from the same repo
```
- Node.js 20 scripts in `/scripts`, zero or minimal dependencies (use global `fetch`).
- Frontend: plain HTML + vanilla JS + Chart.js (CDN). No build step.
- Timezone for all display and daily grouping: Asia/Vientiane (UTC+7). Store timestamps in ISO UTC.

## Data sources

| # | Data | Source | Frequency | Status |
|---|------|--------|-----------|--------|
| 1 | BOL official rates (USD, THB … → LAK, buy/sell) | `https://raw.githubusercontent.com/AllRates-Today/central-bank-exchange-rates/main/data/bol/latest.json` | 1×/day (check several times; BOL publishes business days) | ✅ Verified working (third-party mirror of bol.gov.la) |
| 1b | BOL history (backfill once) | Hugging Face dataset `AllRates/central-bank-exchange-rates` → `rates/bol.csv` | once | Verify file path before use |
| 2 | World gold spot XAU/USD | goldprice.dev anonymous endpoint `/v1/prices?symbol=XAU-USD-SPOT` (confirm base URL in its docs). Fallback: gold-api.com (free, no key) | every 30 min | Verify response shape |
| 3 | Thai gold (Gold Traders Association) bar & ornament buy/sell | `https://api.chnwt.dev/thai-gold-api/latest` (community API scraping goldtraders.or.th). Fallback: scrape goldtraders.or.th directly | every 30 min | Unofficial — may break; must fail gracefully |
| 4 | Market FX USD/LAK, USD/THB, THB/LAK (mid-market) | A free no-key FX API (e.g. open.er-api.com) — VERIFY that LAK is included | every 30 min | Label as "market rate", never as official |
| 5 | Lao shop gold price (Phouvong) | Manual entry: Google Form → Google Sheet published as CSV → fetched by Action | 1×/day | Owner enters by hand |
| 6 | Macro (annual) | World Bank API `https://api.worldbank.org/v2/country/LAO/indicator/{CODE}?format=json` — e.g. NY.GDP.MKTP.CD, NY.GDP.MKTP.KD.ZG, FP.CPI.TOTL.ZG, BX.KLT.DINV.CD.WD, PA.NUS.FCRF | 1×/month | Free, no key |
| 7 | Macro forecasts | IMF DataMapper `https://www.imf.org/external/datamapper/api/v1/{INDICATOR}/LAO` — e.g. NGDP_RPCH, PCPIPCH, BCA_NGDPD, GGXWDG_NGDP | 1×/month | Free, no key |
| 8 | Lao monthly CPI / inflation | Lao Statistics Bureau (laosis.lsb.gov.la) — no API | 1×/month | Manual entry (same Google Sheet, separate tab) |
| 9 | **Real Lao gold price** — Lao Bullion Bank buy/sell (LAK per gram) | `https://laobullionbank.com/api/bullionmarkets/rategold` (+ `rategoldall` history since Aug 2025) — the JSON the LBB site itself reads | every 30 min (LBB updates 2–7×/business day) | ✅ Verified 2026-09-30. Undocumented → may change. Time is Vientiane despite "UTC" label. Replaces Phouvong as the premium basis. |
| 10 | BCEL commercial bank rates USD/THB/CNY (note buy / sell) | `https://www.bcel.com.la/bcel/exchange-rate.html?lang=en` (HTML table) | every 30 min (published in daily "rounds") | ✅ Verified 2026-09-30. Label as BANK, separate from OFFICIAL (BOL) and MARKET. |

Checked and rejected (2026-09-30): LDB `kpv_gold` (Phouvong prices, API returns 401 = needs login → not allowed);
talupa / goldrate24 / goldpricez / bullion-rates / livepriceofgold (only world spot × FX, nothing new);
Trading Economics / Investing.com (terms forbid scraping).

## Key formulas
- Gold unit: 1 baht-weight = 15.244 g; 1 troy oz = 31.1035 g.
- World gold in LAK per baht-weight = XAU/USD × (15.244 / 31.1035) × USD→LAK.
- **Estimated Lao gold (primary)** = Thai association gold price (THB per baht-weight) × THB→LAK.
- Note: Thai association price is 96.5% purity; Lao shops often sell higher purity. Do NOT hard-code a purity factor —
  instead compute `shop_premium = actual_Phouvong / estimate` from manual entries and show the
  rolling 14-day average premium. Adjusted estimate = estimate × avg premium.
- **Kip direction hint (next BOL rate)** = compare latest market USD/LAK and USD/THB against yesterday's values
  → show ▲ / ▼ / ▬ with a clear "estimate only" label. Never display a predicted exact number.

---

## [STEPS] — Phases

### Phase 0 — Repo setup
- Create folder structure: `/scripts`, `/data`, `/site` (or root), `/.github/workflows`, `/i18n`.
- README (Thai) explaining what each folder does.
- Acceptance: repo runs locally with `node scripts/<name>.js` and opens `index.html` in a browser.

### Phase 1 — Data collection (most important)
- One script per source (#1–#4). Each script:
  - fetches, validates (numbers > 0, expected fields present), normalises to a common record:
    `{ source, metric, value, unit, fetched_at, source_date }`
  - writes `data/latest/<source>.json` and appends to `data/history/<source>.json` (deduplicate by source_date/time).
  - on failure: logs the error, keeps the previous data, marks `stale: true`. One failing source must NOT stop others.
- GitHub Actions workflow: cron every 30 min (note: GitHub cron can be delayed), plus manual trigger.
  Commit only when data changed.
- One-time backfill script for BOL history (#1b).
- Acceptance: after running the workflow 3 times, history files grow correctly, no duplicate rows, a broken URL only affects its own source.

### Phase 2 — Daily dashboard page
- Mobile-first cards: BOL USD & THB (buy/sell), market USD/LAK, world gold (USD/oz and LAK/baht-weight),
  Thai gold, estimated Lao gold. Each card: value, change vs yesterday (▲▼ + %), last-updated time, source name.
- Owner decision (Phase 1): BOL currencies collected = USD, THB, CNY, GBP, EUR, JPY, KRW (official BOL rates vs LAK).
  USD & THB are the main cards; CNY, GBP, EUR, JPY, KRW go in a smaller table. Do not add other currencies yet.
- Charts (Chart.js): 7 / 30 / 90 days toggle.
- Show a "stale data" badge if a source is older than expected.
- Acceptance: readable on a 380px-wide phone, light & dark mode, loads in < 2 s.

### Phase 3 — Manual Lao gold entry + premium
- Provide step-by-step (Thai) instructions for the owner to create the Google Form/Sheet and publish it as CSV.
- Action fetches the CSV daily (#5), computes shop premium and adjusted estimate.
- Dashboard shows: actual Phouvong price vs estimate, difference in LAK and %.
- Acceptance: entering a price in the form appears on the site after the next workflow run.
- Update 2026-09-30 (owner decision "all automation"): the premium is now computed from Lao Bullion Bank (#9, automatic).
  Phouvong entry stays as an OPTIONAL comparison. Lao gold is shown per Lao baht (15 g) AND per gram.

### Phase 4 — Economy page
- Monthly workflow for World Bank (#6) and IMF (#7); manual CPI from the Sheet (#8).
- Page: GDP, growth, inflation, FDI, debt, current account — history + IMF forecast shown as dashed line.
- Acceptance: each chart states source and the latest data year.

### Phase 5 — Direction hint + accuracy tracking
- Daily: store the hint (▲▼▬) made before BOL publishes; when BOL publishes, record whether it was right.
- Show accuracy % over last 30 days, for kip direction and for gold estimate error (%).
- Acceptance: accuracy numbers are computed only from stored history, never hard-coded.

---

## [FORMAT] — UI & language
- Bilingual: Thai (default) and Lao, toggle button, choice remembered in localStorage.
  All UI text in `/i18n/th.json` and `/i18n/lo.json` — no hard-coded strings in HTML/JS.
- Fonts: Noto Sans Thai + Noto Sans Lao (Google Fonts) with system fallbacks.
- Number format: thousands separators; LAK without decimals; USD/THB with 2 decimals.
- Footer disclaimer (TH/LO): data is for information only, not financial advice; estimates may be wrong.

## [CONSTRAINT]
- Zero cost: no paid APIs, no servers, no databases.
- No API keys or secrets committed. If a source later needs a key, use GitHub Actions secrets.
- Never scrape Facebook or anything behind a login.
- Always keep and show the original source + timestamp for every number.
- Clearly separate OFFICIAL (BOL) vs MARKET vs ESTIMATED values with different labels/colours.
- Verify every endpoint's real response before writing the parser; do not assume field names.
- Keep each file small and commented in simple English so the owner can follow.
- After each phase: summarise in Thai what was built, how to test it, and what is still unverified.
