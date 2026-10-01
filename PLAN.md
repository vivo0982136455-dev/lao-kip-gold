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
| 7 | Macro forecasts | IMF DataMapper `https://www.imf.org/external/datamapper/api/v1/{INDICATOR}/LAO` — e.g. NGDP_RPCH, PCPIPCH, BCA_NGDPD, GGXWDG_NGDP | 1×/month | Free, no key. **Answers HTTP 403 to GitHub's runners** (found 2026-10-02 on the first weekly run) → since then the same WEO numbers are read from IMF SDMX first (`https://api.imf.org/external/sdmx/2.1/data/IMF.RES,WEO/LAO.NGDP_RPCH.A?startPeriod=2000`; world = `G001`; NGDPD in USD), DataMapper only as the backup. |
| 8 | Lao monthly CPI / inflation (all items + 12 COICOP categories, index) + monthly world gold | IMF SDMX `https://api.imf.org/external/sdmx/2.1/data/IMF.STA,CPI/LAO.CPI..YOY_PCH_PA_PT.M` (send `Accept: application/json`), gold `IMF.RES,PCPS/G001.PGOLD.USD.M` | weekly | ✅ Verified 2026-09-30 (to Aug 2026). Replaced the manual CPI entry. |
| 9 | **Real Lao gold price** — Lao Bullion Bank buy/sell (LAK per gram) | `https://laobullionbank.com/api/bullionmarkets/rategold` (+ `rategoldall` history since Aug 2025) — the JSON the LBB site itself reads | every 30 min (LBB updates 2–7×/business day) | ✅ Verified 2026-09-30. Undocumented → may change. Time is Vientiane despite "UTC" label. Replaces Phouvong as the premium basis. |
| 10 | BCEL commercial bank rates USD/THB/CNY (note buy / sell) | `https://www.bcel.com.la/bcel/exchange-rate.html?lang=en` (HTML table) | every 30 min (published in daily "rounds") | ✅ Verified 2026-09-30. Label as BANK, separate from OFFICIAL (BOL) and MARKET. |
| 11 | BCEL deposit interest rates (saving + fixed 3–60 months, LAK/USD/THB/CNY) | box on `https://www.bcel.com.la/bcel/home.html?lang=en` | daily | ✅ Verified 2026-09-30 |
| 12 | Everyday prices: WFP market prices (12 items × 17 provinces, monthly) + WFP real-time national fuel estimate | HDX packages `wfp-food-prices-for-lao-people-s-democratic-republic`, `lao-people-s-democratic-republic-real-time-prices` (links looked up via CKAN `package_show`) | weekly | ✅ Verified 2026-09-30. Market data ~2–3 months late; some provinces carry old numbers forward. |
| 13 | PML (Precious Metals Laos) silver bar price per 1 kg — shop price | Same Google Form/Sheet as #5 (2 optional silver questions); picture upload on the gold page | when entered | Manual, optional. Activates when the silver questions exist in the form. |
| 14 | World silver spot XAG/USD | gold-api.com `/price/XAG` (goldprice.dev silver = 403 plan_gated) | every 30 min | ✅ Verified 2026-09-30 |
| 15 | Thai retail fuel prices, Bangkok (diesel, gasohol 95 / 91), THB per litre, + tomorrow's price when announced | Bangchak `https://oil-price.bangchak.co.th/ApiOilPrice2/th` (the JSON the Bangchak site reads; Buddhist-era date). Backup: `https://api.chnwt.dev/thai-oil-api/latest` (PTT) | every 30 min | ✅ Verified 2026-09-30. MARKET. |
| 16 | Thai retail food prices, Bangkok (9 items matching the WFP Lao items) + Thai rubber (cup lump 100%, fresh latex, unsmoked sheet), daily min/max | Thai Ministry of Commerce open data `https://dataapi.moc.go.th/gis-product-prices?product_id=..&from_date=..&to_date=..` (plural path; the documented singular one answers 404) | weekly | ✅ Verified 2026-09-30. Very slow (10 days ≈ 15 s, 14 months ≈ time-out) and sometimes HTTP 500 → 3-week windows, one item at a time, second try at the end. No sugar in the retail list. |
| 17 | Investor data: World Bank indicators (GDP structure, trade, external debt, reserves), IMF (GDP per person, budget balance), World Bank IDS (government external debt by creditor + repayment schedule to 2032), IMF DIP (direct investment positions in Laos by investor country, mirror data), IMF PCPS rubber (RSS3 monthly) | `api.worldbank.org/v2/sources/6/...` (IDS), `api.imf.org/external/sdmx/2.1/data/IMF.STA,DIP/LAO..INWD_D_NETLA_FALL_ALL..A`, `IMF.RES,PCPS/G001.PRUBB.USD.M` | weekly | ✅ Verified 2026-10-01. DIP misses countries that do not report (e.g. Viet Nam) — said on the page. |
| 18 | Hand-checked facts: NSEDP 2026–2030 targets (KPL, 26 Feb + 24 Mar 2026), World Bank Lao Economic Monitor (Dec 2025), IMF 2025 Article IV (Feb 2026) | `data/invest-static.json` (links + publish dates + `checked`) | when a new plan/report appears | Update by hand; never invent numbers |
| 19 | Official land price decisions per province (ASSESSED prices for land tax, not market prices): which province has one, its date, link to the scanned PDF | Lao Official Gazette `https://laoofficialgazette.gov.la/index.php?r=site/listlegistioncp&agencies_id={34..51}&old=0` (HTML table, 10 rows per page, `&Document_page=N`); Vientiane Capital's table: ThaiPublica Thai translation (static link) | weekly | ✅ Verified 2026-10-01 (11 provinces; prices inside the scans cannot be read by a script) |
| 20 | Lao rubber at the Chinese border, yearly: China's imports of HS 4001 from Laos, value / weight | UN Comtrade free preview `https://comtradeapi.un.org/public/v1/preview/C/A/HS?reporterCode=156&partnerCode=418&cmdCode=4001&flowCode=M&period={YEAR}` (no key, ONE period per request) | weekly (inside `fetch-invest.js`) | ✅ Verified 2026-10-01 |
| 21 | Hand-checked Lao rubber prices: official national yearly average 2019–2023 (MOIC Department of Internal Trade PDF, item 204, kip per tonne) + three prices quoted in news (Bokeo, Oudomxay) | `data/invest-static.json` → `rubber` (links + dates) | by hand | ✅ Read 2026-10-01 |
| 22 | The owner's OWN prices: rubber price he was paid (LAK per kg, kind, province) and land prices he sees (total, area, province) | The same Google Form/Sheet as #5 (6 optional questions, found by the words ยาง / ที่ดิน in their titles); entered on the site (Economy > Rubber > "my prices", Economy > Land) | every data run (`fetch-own-prices.js`) | ✅ Questions verified in the real form 2026-10-01. Label OWN ("บันทึกเอง"); the site and the data file are public → no names / phone numbers / exact addresses. |
| 23 | World natural rubber: every country's exports + imports (HS 4001 and the forms 400110 latex, 400121 smoked sheets, 400122 block rubber, 400129 other = raw cup lump / unsmoked sheet), last 3 years; production, tapped area, producer price by country; world prices TSR20 + RSS3 monthly | UN Comtrade free preview (`.../preview/C/A/HS?period=Y&partnerCode=0&flowCode=X\|M&cmdCode=...`, no reporterCode = all reporters, ONE period per call, ≤ 500 rows) · FAOSTAT bulk zips listed in `https://bulks-faostat.fao.org/production/datasets_E.json` (QCL, PP; the API itself now answers 401) · World Bank Pink Sheet xlsx (link read from the commodity-markets page) | weekly (`fetch-rubber-world.js`) | ✅ Verified 2026-10-01. A country that has not reported a year is estimated from its partners' reports ("≈", can be too low). |
| 24 | Hand-checked tables: rubber area by Lao province (planted / tapped, 2018; Forest Trends 2020, Table 1, NAFRI data) · Vientiane Capital official assessed land prices summarised per district and road class (Decision 142 of 26 Feb 2024, ThaiPublica Thai translation, 481 villages) | `data/invest-static.json` → `rubber.provinces`, `land.vientiane` | by hand | ✅ Read 2026-10-01 (province rows sum to 257,887 ha, the printed total is 258,446) |
| 25 | Daily rubber prices around Laos: Thai central markets Nong Khai + Chiang Rai + closing price of all 8 markets (cup lump 100%, fresh latex, unsmoked sheet, RSS3, and the EUDR price); Malaysia SMR 20 + latex in bulk; Shanghai futures RU + NR (most traded contract); market FX | Rubber Authority of Thailand `https://misdata.rubberthaiecon.com/report/repprices.php?selectrubber={1..5}&selectmm=M&selectyy=YYYY` (HTML table, Buddhist-era dates, since 2021-05) · LGM `https://www.lgm.gov.my/webv2api/api/rubberprice/month=M&year=YYYY` · SHFE `https://www.shfe.com.cn/data/tradedata/future/dailydata/kxYYYYMMDD.dat` · `open.er-api.com` | with the 30-minute job, but its sources are asked at most every 3 hours (`fetch-rubber-daily.js`) | ✅ Verified 2026-10-01. Thailand buys almost no Lao rubber → these are REFERENCE prices and the page says so. SHFE data © SHFE: shown with the source, personal non-commercial use. |
| 26 | Who buys Lao rubber, at what border price: every reporter's imports of HS 4001 from Laos per year (2015 →), Laos' own declared exports by partner, the forms China / Viet Nam record; **rubber imported from Laos by MONTH** and Viet Nam's own rubber exports; Philippine farm-gate cup lump | UN Comtrade free preview (`partnerCode=418&flowCode=M`, `reporterCode=418&flowCode=X`, forms `cmdCode=400110,400121,400122,400129`) · Viet Nam Customs public PDFs `https://files.customs.gov.vn/CustomsCMS/TONG_CUC/{YYYY}/{M}/{D}/{yyyy}-t{m}-5n(vn-sb).pdf` and `-2x(vn-sb).pdf` (folder = day of publication in the following month: found by HEAD requests; read with `scripts/lib/pdf-text.js`) · PSA OpenSTAT PXWeb `.../DB/2M/NFG/0032M4AFN08.px` | weekly (`fetch-rubber-borders.js`; first fill: `all`) | ✅ Verified 2026-10-02: 31 of 32 months since 2024-01 (April 2024 has no file). The customs site's document LIST is behind a captcha → not used, only the public PDF files. Row "Cao su" = all rubber (slightly more than natural rubber). |
| 27 | Population: 21 yearly indicators (people, age groups, urban, fertility, life expectancy, labour force, employment by sector, wage workers, remittances …), projections to 2050, newest values of the neighbours; people by province × sex × age group | World Bank API (`country/LAO/indicator/{CODE}`, projections `source=40`, neighbours `mrnev=1`; use `per_page=100&date=2000:2040`, 3 tries - long ranges answer 502) · HDX COD-PS `package_show?id=cod-ps-lao` → `lao_admpop_adm1_2024.csv` (Lao Statistics Bureau / UNFPA projection, CC BY-IGO) | weekly (`fetch-population.js`) | ✅ Verified 2026-10-02. Two counts of the same people (World Bank 7.87 m in 2025, LSB/UNFPA 7.63 m in 2024) - both shown with their source. `laosis.lsb.gov.la` cannot be opened from Node (old TLS key). |
| 28 | Hand-checked POLICY facts (7 areas: money & kip, taxes & budget, fuel, wages, debt, trade & outside rules, land rules) + dates to watch + World Bank outlook table + World Bank reform priorities; population facts no API has (state of the 2025 census, the labour-market findings) | `data/invest-static.json` → `policy`, `population`. Read in: World Bank Lao Economic Monitor June 2026 and Dec 2025, KPL (minimum wage 2024 and the March 2026 review), Land Law 2019 (Art. 3, 110, 117, 120, 123, 132), EU EUDR page, sdg.gov.la (LDC graduation), Lao Statistics Bureau census page, Forest Trends 2020 | by hand, when a new report appears (World Bank: about June and December) | ✅ Read 2026-10-01 / 02. Numbers and dates in the data file, sentences in i18n (`pol_<area>_<id>`). Never advice; the World Bank's proposals are shown apart and labelled as proposals. |
| 29 | The central bank's policy rate (1 week) and reserve requirement (kip / foreign currencies): every change with its date | Bank of the Lao PDR `https://www.bol.gov.la/en/interestRate` and `/en/reservRate` (one HTML table each; decimal comma; dates dd/mm/yyyy and dd-mm-yyyy). The server does not send its intermediate certificate → `scripts/lib/aia.js` completes the chain like a browser (never switches verification off). | weekly (`fetch-bol-policy.js`) | ✅ Verified 2026-10-02: 24 rate changes since 2008 (7% since 25 Aug 2026), 7 reserve changes. The parser refuses the page when two rows read by hand are missing. Hand-checked fallback in #28. Lesson: the June 2026 World Bank report still said 8% - a policy number is taken from the primary source, a report only explains it. |

Checked and rejected (2026-10-01, Lao rubber and land prices): Facebook / TikTok / WhatsApp (no free read API, and forbidden
by [CONSTRAINT]); Selina Wamucii "Natural Rubber Price in Lao" (a January 2023 export unit value under a current-month title);
MOIC Laotradestat (login); chnrubber.org Lao purchase prices (yuan, irregular, server refuses connections); listing sites
RentsBuy / FazWaz-AsiaVillas / Yula / 4321property (terms forbid automated access, asking prices only, mostly stale).

Checked and rejected (2026-10-02, rubber prices by country): SGX rubber futures (terms of use of the data not clear);
Bappebti Indonesia (the date of the price could not be verified); Cambodia (prices only inside news articles); the
Viet Nam Customs document-list API (captcha - never bypassed; the monthly PDF files themselves are public).
Indonesia, Cambodia and Myanmar therefore show their yearly average EXPORT price (UN Comtrade), and the page says so.

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

### Phase 7 — Economy for investors (added 2026-10-01, owner request "think like an investor")
- Page `#/economy` rebuilt as 8 tabs (10 since Phase 9): overview (key numbers + computed facts + what to watch per situation: savings / rubber farm / land & business),
  GDP & structure, government plan 2026–2030 (targets vs latest actual + IMF forecast, status computed), foreign investment (yearly + by country),
  public debt (by creditor, repayment schedule, why / effects / plan / can it work — quoted from World Bank + IMF with links),
  inflation & kip, rubber (world + Thai prices in kip, yearly averages), land (no open data → said honestly, only listing links).
- Rules: every number shows its source link, its year/month and a latest / old / failed label; report sentences carry the report's link + date;
  Lao provincial rubber prices and land prices are NOT published online (checked 2026-10-01) → not invented. Past data + forecasts only, never advice.

### Phase 7b — Lao rubber and land prices re-checked (2026-10-01, owner request "check again first")
- Every public channel was searched again (official sites, news, Facebook/TikTok/messaging, international
  datasets, listing sites). Result: no daily or provincial Lao rubber price and no real land sale prices exist as
  open data; Facebook/TikTok cannot be read by a script for free and are forbidden by [CONSTRAINT].
- Added what does exist: official yearly Lao rubber price 2019-2023 (ministry PDF, hand-checked), yearly price of
  Lao rubber at the Chinese border (UN Comtrade, automatic), three prices quoted in news; official ASSESSED land
  prices per province = decision date + link from the Lao Official Gazette (automatic, weekly).
- Done 2026-10-02 (Phase 7d): daily Thai border-market prices (Nong Khai, Chiang Rai), Chinese rubber futures,
  Malaysian LGM prices, and the monthly price of Lao rubber at the Vietnamese border (Viet Nam Customs table 5N).

### Phase 7c — Rubber by province / ASEAN / world, land for every province, own prices (2026-10-01, owner request)
- Owner: "rubber: each province in Laos, then the 10 ASEAN countries + China, ending with the world; top 10
  countries that sell and buy, with prices; cup lump / latex / sheet" and "land: every province, Vientiane and
  Luang Prabang first".
- Rubber tab = 5 views (buttons, remembered): market prices · Laos by province · ASEAN + China · world + top 10 ·
  my own prices. Sources #22-#24. What does NOT exist is said on the page: prices by Lao province; complete trade
  numbers for the newest years (late reporters are shown as "≈" from their partners' reports, and the year shown
  first is the newest one in which the six big ASEAN / China traders have all reported).
- Kinds of rubber: Thai daily prices exist for exactly cup lump / fresh latex / unsmoked sheet; in trade data cup
  lump has no code of its own (it is inside 400129 "other forms"; block rubber 400122 is made from it).
- Land tab (new file): the two focus provinces first (Vientiane Capital: official assessed prices per district
  and road class; Luang Prabang: no official table online → said honestly), then every province with its
  decision date + link, then the owner's own prices, then "no open data on real sale prices".
- Own prices (#22): entered on the site, saved into the owner's form, read back from the sheet to confirm.
- Acceptance: all 18 screens x Thai / Lao x dark / light x 380 / 1440 px without sideways scroll, "undefined" or
  unfilled {placeholders} (`node tests/screens.js`), and every year x kind of rubber x seller/buyer choice, every
  road class and both entry forms opened and filled in but never saved (`node tests/states.js`).
- Not wanted (owner, 2026-10-01): messages to Lark - Lark is the company's work app.

### Phase 7d — Who buys Lao rubber, border markets, a price for every country (2026-10-02, owner request)
- Owner: "I don't know which province border has sale in Thailand, please find it and show me; show which country
  Laos sells rubber to and what is the price; also the price in each country: ASEAN + China + world."
- Finding (said plainly on the page): the buyers' customs record Lao rubber going almost entirely to CHINA and
  VIET NAM; THAILAND buys almost none (a few hundred tonnes in a few years). So no Thai border province "buys Lao
  rubber": Nong Khai and Chiang Rai are the nearest open, published markets and are shown as REFERENCE prices.
- Rubber tab = 6 views. New view "who buys" (second button): tiles, the table year by year (tonnes + USD per kg
  per buyer), Lao rubber at the Vietnamese border by month next to Viet Nam's own export price and the world
  price, which forms the buyers record, what Laos declared next to what the buyers recorded, and the two Thai
  border markets day by day for four kinds of rubber. The "ASEAN + China" view starts with one table: the newest
  price in every country, each row saying WHICH price it is (border, central market, export average, farm gate,
  futures) and its date. Sources #25, #26.
- Own prices are now compared with the central market nearest to the province of the entry (Chiang Rai for
  Bokeo, Luang Namtha, Oudomxay, Phongsaly, Xayaboury, Luang Prabang; Nong Khai for the others).
- Acceptance: `node tests/states.js` opens the view for every kind of rubber in Thai and Lao.

### Phase 9 — Population and Policy tabs (2026-10-02, owner request "policy also has effect the economy")
- Economy page = 10 tabs, in the order of an investor's questions: overview · POPULATION (who lives and works
  here) · GDP · plan (what the State wants) · POLICY (which rules it has set) · foreign investment · debt ·
  inflation & kip · rubber · land.
- Population tab: 8 key numbers; "what these numbers say" (sentences COMPUTED from the data); people so far and
  projected to 2050; age groups past / now / projected (peak of the working-age share); age pyramid; Laos next to
  its neighbours; every province (the two focus provinces in bold); work by sector and money sent home; the state
  of the 2025 census. Sources #27 + #28. A projection is always marked (dashed line, "*").
- Policy tab, read in three layers - what the State decided (with date / notice number) → which numbers it moves
  → where on this site the effect can be watched (a button per area): 8 tiles (the levers and where they stand),
  "how to read a policy" (4 questions), one policy and its effect in one chart (the central bank's policy rate as a
  STEPPED line next to monthly inflation, source #29), 7 areas, a calendar of dated events, the World Bank's forecast next to
  the plan's targets, and the World Bank's reform priorities (labelled as proposals, not decisions). Source #28.
- Rules: a fact without a source and a date does not go on the tab; a rule is labelled with the day it was last
  checked, a measured value with its month (so it turns into "old data" by itself when no newer report was read);
  never advice.
- Acceptance: both tabs in `node tests/screens.js` (21 screens x Thai / Lao x dark / light x 380 / 1440 px);
  every "see the effect" button of the policy tab opens the tab it names (`node tests/states.js`).
- Also 2026-10-02: one menu button on phones (the "more" button of the bottom bar; the ☰ in the top bar was a
  duplicate - owner's screenshot), a ✕ inside the menu; the weekly workflow also runs when one of its scripts is
  pushed, so a new fetcher is proven on GitHub's servers the same day.

### Phase 8 — Install as an app (2026-10-01, owner agreed)
- `manifest.webmanifest` (name, colours, icons 192 / 512 / maskable 512, 4 shortcuts) + `icons/` drawn by
  `scripts/make-icons.js` (no image tool) + `sw.js` + `js/pwa.js` + an install card on the Settings page.
- Service worker rules: files of this site = NETWORK FIRST (a number must never be older than it has to be); the
  saved copy only when the network fails, gives a 5xx, or needs more than 4 s (then saved copies straight away for
  30 s). Fonts + chart library = saved copy first. Google Form / Sheet and the OCR files are never touched.
  A saved copy of a data file carries the header X-Offline-Copy → the top bar says "offline".
- An app left open reads the data again when it comes back to the front after 10 minutes, and every minute while
  it is offline; it redraws only when something changed and never while a form is open.
- Acceptance (run in a real Edge, headless: `node tests/install.js`, `node tests/offline-label.js`, and
  `node tests/live.js` after a push): registered, manifest without errors, installable, first visit saves every
  loaded file, offline pages open with the label, label goes away when the connection is back, a slow network
  shows the saved copy within ~5 s.
- `index.html` preloads every module (`scripts/update-preload.js`), because the worker asks the server about every
  file on each cold start: one round trip for all modules instead of one per import level.

### Phase 6 — Cost of living & savings page (added 2026-09-30, owner request)
- Page `#/living`: monthly inflation (all + categories, ranked), everyday prices by province vs national average (+ fuel estimate),
  "1,000,000 kip kept as kip / USD / THB / gold" before and after inflation (1 / 3 / 5 years), BCEL deposit rates vs inflation (real rate).
- Rules: everything computed from stored data; labelled as PAST results, never a forecast or investment advice.
- v2 (2026-10-01, owner request "compare Laos with Thailand / world; fuel is the key; how much do I need to live in Laos"):
  - "What you should know now" box: short sentences COMPUTED from the data (fuel Laos vs Thailand, inflation Laos vs Thailand,
    same basket Laos vs Bangkok, fastest-rising category, real deposit rate, Brent year-on-year). Never typed in.
  - Fuel section first: Lao diesel/petrol (WFP estimate, with its month) vs Thai pump prices today (#15, in kip),
    tomorrow's Thai price when announced, and Lao diesel vs Brent on one index (start = 100).
  - Inflation Laos vs Thailand (IMF monthly) + world (IMF yearly, labelled estimate).
  - Monthly budget: the same basket in Laos (WFP) and Bangkok (#16 × market THB→LAK); quantities, people, other costs and
    salary are editable and remembered on that device only; "total" compares only items priced in both places.

---

## [FORMAT] — UI & language
- Bilingual: Thai (default) and Lao, toggle button, choice remembered in localStorage.
  All UI text in `/i18n/th.json` and `/i18n/lo.json` — no hard-coded strings in HTML/JS.
- Fonts: Noto Sans Thai + Noto Sans Lao (Google Fonts) with system fallbacks.
- Number format: thousands separators; LAK without decimals; USD/THB with 2 decimals.
- Footer disclaimer (TH/LO): data is for information only, not financial advice; estimates may be wrong.
- Installed app / offline (2026-10-01): when the numbers on screen are the copy saved on the device, the top bar
  shows an "offline" label next to the time of the data. Never show saved numbers without that label.
- Charts (2026-10-01, owner request): the values of a touched point are shown in a read-out ABOVE the plot
  (latest values when nothing is touched), never in a box on top of the lines. Every "show as table" twin
  names what the numbers are and their unit in its header. Lines are smooth but honest (monotone curve,
  no invented peaks); dots only on the latest point, or on every point of a sparse hand-entered line.

## [CONSTRAINT]
- Zero cost: no paid APIs, no servers, no databases.
- No API keys or secrets committed. If a source later needs a key, use GitHub Actions secrets.
- Never scrape Facebook or anything behind a login.
- Always keep and show the original source + timestamp for every number.
- Clearly separate OFFICIAL (BOL) vs MARKET vs ESTIMATED values with different labels/colours.
- Verify every endpoint's real response before writing the parser; do not assume field names.
- Keep each file small and commented in simple English so the owner can follow.
- After each phase: summarise in Thai what was built, how to test it, and what is still unverified.
- Before a push that changes pages: `node tests/all.js` must pass; after the push: `node tests/live.js`.
