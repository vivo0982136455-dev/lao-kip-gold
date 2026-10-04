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
| 1 | BOL official rates (USD, THB … → LAK, buy/sell) | **Since 2026-10-04 (audit P1-5): the bank's own page** `https://www.bol.gov.la/en/ExchangRate` (GET = today; the page's own search form, POST `date=dd-mm-yyyy`, gives an earlier day - weekends and holidays show no rates). Numbers are written the Lao way: `22.361` = 22,361 kip, `674,70` = 674.7. The server omits its intermediate certificate: `scripts/lib/aia.js`. **Backup + cross-check:** the mirror `https://raw.githubusercontent.com/AllRates-Today/central-bank-exchange-rates/main/data/bol/latest.json` (CC BY 4.0) | 1×/day (asked every 30 min; one request on a quiet day) | ✅ Verified 2026-10-03: all 14 values of 1 and 2 Oct equal on both routes. `data/latest/bol.json` says which route gave the numbers (`route`, `route_note`, `cross_check`); a value written another way or more than 20% away from the stored one is refused. Tests: `tests/bol-route.js` |
| 1b | BOL history (backfill once) | Hugging Face dataset `AllRates/central-bank-exchange-rates` → `rates/bol.csv` | once | Verify file path before use |
| 2 | World gold spot XAU/USD | goldprice.dev anonymous endpoint `/v1/prices?symbol=XAU-USD-SPOT` (confirm base URL in its docs). Fallback: gold-api.com (free, no key) | every 30 min | Verify response shape |
| 3 | Thai gold (Gold Traders Association) bar & ornament buy/sell | Since 2026-10-02: the association's own price service `https://www.goldtraders.or.th/api/GoldPrices/Latest?readjson=false` (the JSON its new website reads). Backup: `https://api.chnwt.dev/thai-gold-api/latest` (community API that copied the OLD website; HTTP 500 since the website changed on 2026-10-01) | every 30 min | ✅ Verified 2026-10-02: numbers and time identical to the old source's last answer. Undocumented → may change; fails gracefully. Site terms: personal, non-commercial use. |
| 4 | Reference mid rates USD/LAK, USD/THB, THB/LAK from a general FX API | open.er-api.com (free, no key) | every 30 min (the API updates once a day) | Called "reference mid rate (API)" on the site since 2026-10-04 (audit P1-5): it is not official and not a rate anybody in Laos trades at (on 2026-10-02 it was below the central bank's own buying rate). Source id `fx-market`, metric ids and `kind: market` are kept for the history files and for older copies of the app; `shown_as: reference` gives the label. |
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
| 28 | Hand-checked POLICY facts (7 areas: money & kip, taxes & budget, fuel, wages, debt, trade & outside rules, land rules) + dates to watch + World Bank outlook table + World Bank reform priorities; population facts no API has (state of the 2025 census, the labour-market findings) | `data/invest-static.json` → `policy`, `population`. Read in: World Bank Lao Economic Monitor June 2026 and Dec 2025, KPL (minimum wage 2024 and the March 2026 review), Land Law 2019 (Art. 3, 110, 117, 120, 123, 132), EU EUDR page, sdg.gov.la (LDC graduation), Lao Statistics Bureau census page, Forest Trends 2020 | by hand, when a new report appears (World Bank: about June and December) | ✅ Read 2026-10-01 / 02; re-checked against the primary sources on 2026-10-02 (Phase 10: the fuel excise rates now come from the ministry's notice No. 458, `policy.checked` holds the date). Numbers and dates in the data file, sentences in i18n (`pol_<area>_<id>`). Never advice; the World Bank's proposals are shown apart and labelled as proposals. |
| 29 | The central bank's policy rate (1 week) and reserve requirement (kip / foreign currencies): every change with its date | Bank of the Lao PDR `https://www.bol.gov.la/en/interestRate` and `/en/reservRate` (one HTML table each; decimal comma; dates dd/mm/yyyy and dd-mm-yyyy). The server does not send its intermediate certificate → `scripts/lib/aia.js` completes the chain like a browser (never switches verification off). | weekly (`fetch-bol-policy.js`) | ✅ Verified 2026-10-02: 24 rate changes since 2008 (7% since 25 Aug 2026), 7 reserve changes. The parser refuses the page when two rows read by hand are missing. Hand-checked fallback in #28. Lesson: the June 2026 World Bank report still said 8% - a policy number is taken from the primary source, a report only explains it. Since 2026-10-02 the same script also reads the bank's **foreign-exchange reserves by month** (workbook `Official_Reserves_Lao PDR.xlsx` linked on `/en/External_Sectors`, row `RAXGFX_USD`, US$ million; the bank notes that the numbers include the swap with the People's Bank of China since July 2020; known value 2026-04 = 4303.5 must be there) and **this year's inflation month by month** (`/en/inflation`, one table, decimal comma) - often one month ahead of the IMF series, used on the Policy tab only. |
| 30 | **Official retail fuel prices in Laos**: Vientiane Capital (premium, regular, diesel; kip per litre) from the ministry's notices, every province from the state fuel company | Ministry of Industry and Commerce, Department of Internal Trade `https://dit.moic.gov.la/public/oil` (HTML list of notices: number, Lao date, PDF) + the PDFs themselves (scans with a text layer made by the scanner; read with `scripts/lib/pdf-text.js`) · Lao State Fuel Company `https://laostatefuel.com/en/gas-price.html` (ticker with all 18 provinces; `?province=1&page=N` = history of the capital; robots.txt allows all) | inside the 30-minute job, asked at most every 6 hours (`fetch-fuel-lao.js`) | ✅ Verified 2026-10-02. A number read from a scan is used only when TWO readings of it are clean and equal (new column of page 1, old + printed change, row 1 and row 10 of the province table, three other provinces minus their transport cost, the old column of the next notice, the fuel company's row): 27 of the 85 notices of 2024 - Sept 2026 can be confirmed (all from Oct 2025 on; older scans have no text layer), and every pair of neighbouring confirmed notices agrees (26 of 26). A notice that cannot be confirmed is listed with its link and the page says that a newer notice exists. The fuel company types its list by hand (about monthly, with mistakes: "369,330", one row with a wrong date): its rows are marked in the file and a confirmed notice always wins. No notices on the ministry's page between 8 April and 22 July 2026. |
| 31 | Is there a newer edition of the report the hand-read facts come from? (World Bank "Lao PDR Economic Monitor") | World Bank Documents & Reports search `https://search.worldbank.org/api/v3/wds?format=json&qterm=Lao PDR Economic Monitor&count_exact=Lao People's Democratic Republic&fl=docdt,display_title,url,docty&rows=40&srt=docdt&order=desc` (keep `docty` = Report with "Economic Monitor" in the title) | weekly (`fetch-report-watch.js`) | ✅ Verified 2026-10-02: newest = June 2026 (docdt 2026-06-30) = the edition in `policy.read`. Never changes a fact by itself: the Policy tab only shows a warning with the link when a newer edition exists. |
| 32 | Wages: (a) the statutory minimum wage in force today in Laos + 16 countries (ASEAN's 11 members, China, Japan, South Korea, Australia, USA, Israel) and Thailand's rates by province; (b) the ILO's yearly minimum-wage series (USD, PPP, own currency) and average monthly earnings; (c) market exchange rates of 14 currencies | (a) by hand in `data/invest-static.json` → `wages`, one official source per country (Thai Ministry of Labour Notification No. 14, Viet Nam Decree 293/2025, Malaysia P.U.(A) 376, NWPC Philippines, MOM Singapore, MHLW Japan, Minimum Wage Commission Korea, Fair Work Ombudsman, US DOL, Israel NII, AKP Cambodia, KPL Laos …) · (b) ILOSTAT `https://rplumber.ilo.org/data/indicator/?id=EAR_INEE_CUR_NB_A&ref_area=LAO+THA+…&timefrom=2012&format=.csv` and `id=EAR_EMTA_SEX_CUR_NB_A&sex=SEX_T` (CSV, no key) · (c) `https://open.er-api.com/v6/latest/USD` | (a) by hand, with `checked`; a rise that is already decided is entered as a dated step and switches on by itself · (b) + (c) weekly (`fetch-wages.js`) | ✅ Read / verified 2026-10-02. No API gives today's minimum wages of all 17 countries (ILO is 1-2 years behind). ILO quirks: Cambodia's dollars are in the "LCU" column and its USD column is wrong; no minimum-wage rows for Singapore and Brunei; `EAR_4MMN_CUR_NB_A` is deprecated. Myanmar is converted at the official rate, which is far from the market rate - the row says so. |
| 33 | Direct investment in Laos, ALL investor countries together: stock at the end of each year and the yearly inflow, US$ million (2010 →) - the total to put next to the table by country (#17, IMF DIP), which holds only what six investor countries report | UNCTADstat bulk download `https://unctadstat-api.unctad.org/bulkdownload/US.FdiFlowsStock/US_FdiFlowsStock` (a .7z archive, LZMA2, with one CSV: Year, Economy 418 = Lao PDR, Flow Label Stock / Flow, Direction Label Inward, "Millions of US$ at current prices"; no key) - unpacked by `scripts/lib/sevenzip.js`, which checks the CRC of what it unpacks | weekly, inside `fetch-invest.js` (part `fdi_total`) | ✅ Read / verified 2026-10-02 (file of 2026-08-10; Laos 2024 = 15,392.6, 2025 = 16,797.4). For Laos the stock is the running total of the inflows (2010-2021 and 2025: stock change = inflow exactly; 2022-2024 use an earlier edition of the flows). It is SMALLER than the six reporters' own total (17,333.8 in 2024): the two sources do not count alike, and the page says so. `unctad.org` itself answers scripts with a browser check (not used, never bypassed); the UNCTADstat user API needs a registered key (not used). |
| 34 | **Laos next to its five neighbours** (Thailand, Viet Nam, Cambodia, Myanmar, China): GDP, GDP per person (current and PPP), growth, inflation, external debt, reserves in months of imports, FDI (share of GDP and US$), merchandise exports, urban share - the same indicator code for all six, the last 10 years of each; public debt from the IMF | World Bank API, one request per indicator: `https://api.worldbank.org/v2/country/LAO;THA;VNM;KHM;MMR;CHN/indicator/{CODE}?format=json&per_page=100&date=2016:2026`; IMF SDMX, one request for six countries: `https://api.imf.org/external/sdmx/2.1/data/IMF.RES,WEO/LAO+THA+VNM+KHM+MMR+CHN.GGXWDG_NGDP.A` (finished years only: the IMF's past years are its own estimates) | weekly (`fetch-compare.js` → `data/compare.json`) | ✅ Verified 2026-10-03. Newest year differs by country (inflation: Myanmar 2019; reserves: Laos 2024, Myanmar 2019) - the page takes Laos' newest year for the whole card and marks a number of another year. Exports = the WTO's merchandise exports (TX.VAL.MRCH.CD.WT, 2025 for all six): the national-accounts series for Laos stops in 2016. |
| 35 | Average household size in Laos (hand-read fact for the Population tab) | United Nations, Population Division: Database on Household Size and Composition 2022 `https://www.un.org/development/desa/pd/data/household-size-and-composition` (workbook `undesa_pd_2022_hh-size-composition.xlsx`, rows "Lao People's Dem. Republic") | when a new edition appears | ✅ Read 2026-10-03: 4.7 people (MICS / Lao Social Indicator Survey II, 2017), 5.3 (census 2015). The World Bank API has no household size; household consumption (NE.CON.PRVT.CD) stops in 2016 and is shown as old. |

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
- Page `#/economy` rebuilt as 8 tabs (10 since Phase 9, 11 since Phase 10): overview (key numbers + computed facts + what to watch per situation: savings / rubber farm / land & business),
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

### Phase 10 — Hand-read facts re-checked, official fuel prices, wages, filters above their charts (2026-10-02, owner request)
- Owner: "please check" the hand-read policy facts; "is the wage already in our web? ASEAN + China, Japan, Korea,
  Australia, USA, Israel"; "the filter must be above the chart" (screenshot of the rates page).
- CHECK against the primary sources (2026-10-02). Changed: (1) the fuel excise cut of March 2026 - the ministry's
  own notice No. 458 says regular petrol 25% → 15% and diesel 10% → 0%, premium taxed and sold like regular (the
  World Bank report says 30% → 15% and premium 40% → 15%): the page now quotes the notice and says that the report
  differs; (2) the tax partly returned on 25 June 2026 (regular 25%, diesel 5%) - added; (3) foreign-exchange
  reserves fell from US$4.30 bn (April) to 3.77 bn (July) - now read from the central bank every week; (4) fuel
  prices rose again after June - now read from the ministry's notices. Unchanged: VAT, FATF list, EUDR dates, LDC
  graduation, minimum wage (no new rate announced), Land Law, the newest World Bank edition (June 2026).
- What can update itself does (sources #29 extended, #30, #31); what cannot is labelled: the Policy tab has a card
  "what updates itself, what is read by hand", every self-updating sentence carries a small label, and the tab warns
  by itself when the World Bank publishes a newer edition than the one that was read.
- Cost-of-living page: the official Lao pump prices (three fuels, the notice with its link, change against the
  price before, against Bangkok), every province in a fold-out table, and the official prices since 2024 as a chart
  on a day-by-day axis (a touch snaps to the nearest real price; stretches of more than 45 days without a price are
  dotted). Facts box and monthly budget use the official price; without the file the page falls back to the WFP
  monthly estimate as before.
- WAGES tab (11th tab, after Population): the legal minimum wage of 17 countries turned into a month, US dollars and
  kip (highest first, "x Laos"), each row saying what it is (whole country / highest region / sector only /
  average / none) and what is already decided for the future; Thailand by province (industrial provinces, the
  provinces along the Lao border, the lowest); what the Lao minimum wage still buys since it was last raised
  (price index); litres of petrol a month of minimum wage buys in Laos and Bangkok; the ILO's yearly series for
  Laos and its neighbours; the ILO's average monthly earnings. Source #32.
- Filters: on the rates, gold and cost-of-living pages (and above the daily chart of the border-market card) the
  range / period buttons sit directly above the chart they control; a period that controls several charts is
  repeated above each of them.
- Acceptance: `node tests/all.js` (22 screens x Thai / Lao x dark / light x 380 / 1440 px = 176 - 23 screens = 184 since the Compare tab of 2026-10-04; states.js opens the
  wages tab with all 17 rows, without exchange rates and "100 days later" when the decided rises are in force, the
  fuel card in three states, the policy tab with the live files, with a newer report and without the files).
- Tests made stricter the same day: a tile or card whose content is wider than the box itself is reported (a
  range with its unit overflowed a tile while staying inside the screen - the old check only looked at the screen
  edge); every test of `tests/all.js` has a time limit and every browser command 90 seconds, so a hanging
  browser fails the run instead of blocking it; the menu test waits for the menu to arrive instead of pausing.
- Idea not built: read the scanned notices with a real OCR program (Tesseract) on GitHub's servers, which would
  confirm almost every notice instead of about one in two. It needs a system package in the workflow and cannot be
  tested on the owner's PC - only worth it if the "newer notice not read" warning shows too often.

### Audit 2026-10-02 — an outside review of the whole app (owner: "please check and improve")
The audit lists findings in four groups. Rule of the audit: P0 first, show the result, wait for the owner before P1.
Every finding was first checked against the code and the primary source; two were found to need a different fix
from the one the audit proposed (marked "checked:" below).

**P0 - critical (done 2026-10-02, except the part of P0-3 that needs the owner's choice)**
- P0-1 Plan tab and overview judged 2026-2030 targets with numbers of 2025, 2024 and 2022 ("far from target 8").
  Now: only a number from inside the plan's years gets met / near / far; an earlier one is the "baseline", one
  that is too old is not compared; GDP per person (target for 2030) is judged by the IMF forecast for 2030 and
  the badge says so. The number compared is the newest one the app has: state revenue 21.2% (2025, World Bank
  report) instead of 13.9% (2022, yearly series); reserves 3.8 months (World Bank) and 5.3 months (Bank of the
  Lao PDR's own count) for April 2026 instead of 2.4 months (2024), each with its own result, plus the central
  bank's newest monthly reserves under the target's name. Summary today: met 0, near 1 (forecast), far 1
  (inflation), depends on the way of counting 1, baseline 7, no data 4 = 14.
  checked: the plan's source (KPL) does not say which way of counting the "5 months" target means - so the row
  shows both results instead of picking one.
- P0-2 "93% of foreign investment comes from China and Thailand" divided by the total of the six countries that
  report to the IMF. Now: the column is "% of the reported amounts", the overview sentence says "of the amounts
  reported" next to the World Bank's "China about 38% of the 2025 inflow", and UNCTAD's total for all investors
  is fetched (source #33) and shown.
  checked: UNCTAD's total for 2024 (US$15.39 bn) is SMALLER than what the six countries report themselves
  (US$17.33 bn): the "coverage" the audit asked for is 113%. For Laos UNCTAD's stock is the running total of the
  yearly inflows recorded on the Lao side (2010-2021 and 2025: stock change = inflow, to the last digit), the
  investor countries count more. The page shows the 113% and says that the two sources do not count alike, so no
  share "of all investment" can be given.
- P0-3 Anyone can send answers to the public price form. Done now: every answer is checked hard before it may
  appear (rubber inside a band around that day's Thai price in kip, land inside a band around the official
  assessed prices, no date in the future - also for shop gold and silver, where a future date used to slip past
  the Lao Bullion Bank check -, text without links / e-mail / phone numbers and at most 40 characters); the page
  uses the bot's own limits. `tests/own-prices.js` sends 9 kinds of fake answers at a sample sheet: none gets
  through (against the old checks 13 of its 14 checks fail). Existing real rows are unchanged.
  STILL OPEN - the owner must choose how only he can write (the form itself is still public):
  (a) private sheet + sign-in form + a service-account key in GitHub Secrets, or (b, recommended) an Apps Script
  endpoint on the sheet that accepts a secret typed once per device; then the form is closed and the sheet private.
- P0-4 Debt service "(domestic and external) about US$1.5 bn a year" next to "13% of GDP".
  checked: the World Bank report says it both ways - its debt chapter "external debt service ... excluding
  deferrals", its outlook "on external and domestic debt". The debt chapter's wording is used (it fits the
  report's other numbers), the 13% of GDP for 2026 is a fact of its own, and the page has two sentences. The
  Ministry of Finance's own debt figure (84% of GDP, end of 2025) is shown next to the World Bank's 87.1% and
  the IMF's 80.6%, each with what it counts.
- New tests: `tests/calc.js` (rules and formulas with fixed numbers, 24 checks), `tests/own-prices.js` (14
  checks), and in `tests/states.js` the plan tab (no status from a number before the plan, the summary adds up,
  revenue 21.2%), the fall-back without the hand-read facts, the reported-share wording and the entry forms
  refusing a far price.

**P1 - important (done 2026-10-04, after the owner's "go"; P1-7 is a report, P1-10's registry a proposal)**
- P1-1 Same indicator, different numbers. Now: one answer per indicator in `js/pages/eco-latest.js`
  (`latestInflation`, `latestReserves`, `publicDebt`, `growthNow`, `debtServiceNow`), used by the overview, plan,
  debt, inflation and policy tabs and by the cost-of-living page. Where sources disagree for the same year the tile
  shows the range and names how many sources (growth 2025: 4.5-4.8%, public debt 2025: 80.6-87.1%), and a
  "why the numbers differ" card says what each source counts. Source values are untouched. A test stops any
  other page from reading `cpi_yoy` or `FI.RES.TOTL.MO` itself.
- P1-2 Forecast line spliced across two sources. Now `buildSeries()` carries the last real value forward with the
  IMF's own path: forecast = last actual x IMF(year) / IMF(last actual year); the subtitle says so. Rates (%) are
  joined as they are. Unit test with the audit's numbers: 18.303, 17.822, 18.959 -> 19.47.
- P1-3 Nominal and real. The GDP tab names "current prices" / "constant prices" on tiles and chart, shows GDP at
  constant 2015 dollars next to current dollars with a note computed from the series (2022: dollars -18%,
  production +2.7%, kip 9,698 -> 14,035 per dollar) and a tile for GDP per person at purchasing power (new World
  Bank indicators NY.GDP.MKTP.KD, NY.GDP.PCAP.PP.CD; existing ids unchanged).
- P1-4 Freshness. `freshness()` gives the "latest" tick only to a number that is not late (yearly: at most 12
  months behind, monthly: 3); otherwise it says "N months behind" (reserves 2024, FDI 2024: no tick). An IMF value
  before the forecast years is drawn as "IMF estimate". The fetchers store what a source says about itself -
  IMF: edition (2026-04) and update day, World Bank: last update, plus the day we read it - and the card footers
  show it (economy.json, invest.json, population.json, compare.json).
- P1-5 Official rate from a mirror; "market" rate from a generic API. `fetch-bol.js` now reads the central bank's
  own page (source #1), keeps the mirror as backup and cross-check, and the Settings page names the route.
  The API rate is called "reference mid rate (API)" in 22 texts, has its own label ("reference", same orange) and
  its source name says so.
  checked: on a weekend the bank's page is empty, so the fetcher asks the page's own date form for the working
  day before; the page refuses clients that call themselves "curl" but serves the project's named reader.
- P1-6 Compare tab (12th tab of the economy page): 11 cards for Laos and five neighbours, same code, same source,
  same year; every row names its year, a number of another year is marked and left out of the rank (source #34).
  The neighbours card of the Population tab is unchanged; its World Bank reader is reused.
- P1-7 Missing indicators: report only, as the audit asks ("first report to the owner"):
  `docs/audit-p1-7-missing-indicators-th.md`. Found: the Bank of the Lao PDR publishes workbooks it reports to the
  IMF - money and credit (monthly to July 2026), bank interest rates (monthly), bank soundness (quarterly), the
  balance of payments, and FDI net flows by sector AND by country (yearly to 2025; China 38% of the 2025 inflow -
  the number the World Bank quotes). Trade by partner and product: UN Comtrade (Laos' own reports stop in 2023 and
  leave out most electricity; partners' reports reach 2025). Not found as open, traceable data: mining output,
  monthly tourist arrivals, the currency of the debt (PDF only). Nothing of this is built yet.
- P1-8 "Domestic market 7.87 million people" is now "population ..., and a head count does not tell spending
  power". New section "what people can spend": GNI per person at PPP (2025), household consumption (2016 - the
  newest the World Bank has, marked as old), poverty rate at the national line and at $3.00 a day (2024), average
  household size (source #35, marked as old).
- P1-9 Kip signal accuracy from two cases. Below 20 checked hints the page writes "not enough cases" (how many of
  20) and no percentage anywhere; the window is 90 days instead of 30 (30 days can never hold much more than 20
  working days); next to a percentage stands the naive guess "the same direction every day". The hint file is
  unchanged.
- P1-10 Validation and tests now; registry proposed only (`docs/proposal-data-registry-th.md`, three steps).
  `scripts/check-data.js` checks the economy files too: years and months in order and possible, values inside
  what their unit allows, sources that exist, the 14 indicators kept in two files equal in both, every hand-read
  fact with a source and every section with the day it was checked. It runs in both workflows.
  `tests/data-check.js` damages a copy of the data in 29 ways: all caught. `tests/calc.js`: 42 checks (target
  status, forecast line, resolvers, real rate, unit conversions, the Compare tab's year rule, hint accuracy).
  Formulas that were written twice now live in `js/calc.js` and `scripts/lib/units.js` (output byte-identical).
- Tests: `node tests/all.js` = calc 42, own-prices 14, bol-route 22, data-check 31, 184 screens, 238+ page
  states, menu 16, install 37, offline label; `tests/live.js` has 9 more checks for this group.
- Found on GitHub's servers right after the push (2026-10-03 evening, the World Bank's API answered "502"): the
  investor-data step had written its file and was still stopped by its 10-minute limit. Cause: an error page
  that is never read keeps its connection - and the program - open until the request's time limit (Node 20).
  `fetchText()` now lets the page go before it reports the error (`tests/download.js`: the program ends 0.1 s
  after its work instead of lingering); the step's limit is 15 minutes. The failed series keep last week's
  values and are marked, as designed.

**P2 - valuable (done 2026-10-04, after the owner's "Go")** - every finding was checked against the code first;
all eleven were right, two had to be done differently from the way the audit proposed (P2-6 b, P2-9 Tesseract).
- P2-1 Gold premium. `scripts/lib/units.js` `fineGoldPremium()`: fine gold in an LBB bar (99.99% - LBB's own
  rate panel is headed "LBB Gold Bar 99.99% International Standard", read 2026-10-04) against fine gold in a Thai
  bar (96.5%, 15.244 g), gram for gram. The two purities are hand-read facts: `data/invest-static.json` "gold",
  with their sources and the day they were checked; `build-summary.js` reads them there. `build-summary.js` writes `gold_premium.fine_avg_14d` (+ `window_days`,
  `basis`) next to the unchanged `avg_14d`. Like for like LBB is 3.1% dearer; the plain ratio 1.051 - which the
  page called "+5.1% premium" - is now shown as what it is, the multiplier of the estimate (it also holds the unit
  gap 15 / 15.244 g and the purity gap: together about 2%). The adjusted estimate itself is unchanged. The two rows
  moved from the Phouvong card to the estimate card: they compare LBB with the estimate, not with the shop.
- P2-2 Kip line. `js/calc.js` `dearer()` and `kipChange()`. The chart line keeps its series and is now called
  "dollar dearer (in kip)"; the subtitle names the line's own highest month in both measures (October 2022: dollar
  +66% = kip -40%). The "kip (BOL)" tiles of the overview and the inflation tab show the kip's own change
  (before / now - 1): -3.5% where "+3.6%" stood under the word "kip".
- P2-3 Wage multiples. `fetch-wages.js` keeps every year of the ILO's average earnings (`ilo_avg.series`). The
  column "x Laos" is worked out from the value of Laos' own year (2022) only: Thailand 2.6x (467 USD in 2022), not
  2.9x from its 2025 number; a country without a 2022 value shows a dash. The year of every bar is still named.
- P2-4 Numbers in sentences. 33 texts held a typed year (the audit counted 28) and 7 more another hand-read
  number; all 40 now name them with placeholders, filled from `data/invest-static.json` (new fields: plan number,
  budget surplus, census number and year, the `edition` of a report, the months a sentence speaks of ...) through
  `planYears()` and `sourceWords()` in `eco-common.js`. Only the changed part of each sentence was patched, so the
  wording stayed. `tests/words.js`: same keys and same placeholders in Thai and Lao, no year 2015-2035 typed in
  any text (the allow-list is empty), and every text the page code names exists.
- P2-5 Chart read-outs. `charts.js`: `nowLabel` (at rest a line that runs into the future shows the value of now:
  `restPoint()`), `peak` (one more row), and no "% since the first point" for a line that starts below 5% of its
  largest value or below zero (`sinceMakesSense()`). Used by every yearly chart with a forecast, the GDP size
  chart, the population projection and the repayment schedule (now: 2026 = 1,845 m USD, peak 2025 = 2,342 m USD -
  no longer "latest: 2032"). The table twins are unchanged.
- P2-6 Three charts. (a) Fuel: Lao diesel a second time in dollars (kip price / BOL's monthly average), all three
  lines = 100 in the same month. (b) Yearly exchange rate: NOT extended by gluing - the World Bank's official
  yearly average and our average of BOL's buying and selling rate are 7.1% apart in 2024, so a glued line would
  show a 2025 fall of the kip that never happened. Two lines side by side, the gap named under the chart; a
  dollar / baht / yuan choice sits above the chart; baht and yuan before 2021 are worked out through the dollar
  from the World Bank's series of Thailand and China (two new indicators, and BOL's monthly yuan average).
  (c) Public debt: the World Bank's count as a second line (2022-2028, hand-read from its two reports:
  `facts.debt_wb`; `check-data.js` compares it with the three other places that quote these numbers).
- P2-7 Unsupported sentences. Three sentences of the watch cards now say "general reasoning" (and that this site
  has not tested it / has no data for Laos); the land card says the same in its title and in a note. i18n only
  (plus one line that shows the note); the no-advice notes are kept.
- P2-8 Sources and method. Settings lists every source of every data file - 39 automatic sources in 14 files, read
  from each file's own `sources` block (`js/pages/sources.js`): edition, the day the source changed its data, the
  day it was read, licence, and the state of the parts that name it - and the 45 hand-read sources with their
  publication date and the range of days the facts were checked. The fetchers of the part-based files now stamp
  `retrieved` per source (`lib/parts.js stampedSources`). The daily list is kept. New page `#/method` (11
  sections): every limit a sentence names is filled from the constant the code really uses.
- P2-9 Security. A Content-Security-Policy meta tag (no inline script, no eval; scripts from this site and the two
  CDNs only; data goes to this site, Google Forms / Sheets and jsDelivr only); the inline script and the inline
  handler of index.html became `js/chart-backup.js`; an integrity hash on Chart.js for both CDNs (their files are
  identical: the hash is the one cdnjs publishes, confirmed on the jsDelivr and unpkg copies); Tesseract's entry
  file is checked by hash before it runs (`ocr.js importChecked`); both workflows pin the two actions to commits;
  an address from a data file becomes a link only when it is https (`ui.js safeUrl / outLink`), and
  `check-data.js` refuses any other address in a data file. `tests/security.js` (18 checks): the policy refuses
  nothing on 19 screens, charts from the second CDN when the first is blocked, a wrong hash is refused, the
  picture reader reads a test picture under the policy, no connection at all.
  NOT possible: the browser offers no integrity check for the worker script, the engine and the language file that
  Tesseract loads by itself inside its worker. They are pinned to exact versions and the policy limits where
  scripts may come from. (Owner's choice, not taken: host those files on the site itself, about 15 MB.)
- P2-10 Notes. Rubber, view "Laos": why more is recorded as sold than as produced (2024: China and Viet Nam
  bought 403 thousand tonnes, the FAO gives 350 as production; customs weigh the goods as shipped - 99% of what
  China buys is raw "other forms" - while the FAO counts dried rubber, and its Lao figure is not an official one;
  source: FAO's handbook, `rubber.production_basis`). Neighbours' table of the Population tab: the year stands
  under every number, and another year than Laos' is marked.
- P2-11 Risk card on the overview: debt that falls due this year, the reserves (and how many times that debt they
  are), the share of the debt that is foreign with the dollar's change in 12 months, and oil imports (the World
  Bank's 6-8% of GDP for the group of net importers that includes Laos) with the Brent price. Numbers only.
- Tests: see README "ทดสอบ" for the counts of this state.

**P3 - nice to have: DONE 2026-10-04 (the owner said "Go" after P2).** Every finding was checked against the code
first: all eight were right; two were larger than the audit said (P3-6: seven unused series, not four; P3-8: the
date is right, but the file did not hold its evidence).
- P3-1 Text and contrast (`css/style.css`). Notes, sources and dates - 25 rules - are `var(--fs-sm)` = 0.8rem; only
  16 kinds of short label stay smaller (pills, chips, table heads, units: the list is `SMALL_OK` in
  `scripts/lint.js`). Light theme `--muted` #7a7873 -> #6b6964 (page 4.08 -> 5.07:1, card 4.30 -> 5.34:1), `--flat`
  with it (3.83 -> 4.69:1 on its tint); dark theme `--flat` and `--ok` were just under (4.46, 4.38 -> 4.86, 4.82);
  a selected table row switches its small text to `--text-2`. Lowest pair of the site now 4.53:1; the lint keeps
  it there. Measured on a phone before and after (48 screens): pages 3.9% longer; one table ("newest rubber
  prices in every country") became 11 px too wide - its local price now wraps between the number and its unit,
  each in one piece (`.nobr`).
- P3-2 Index and search (`js/pages/economy.js`, new `js/pages/eco-index.js`). Above the tab bar: a search box and
  a button "all topics (12)". The index lists every tab with what it holds (the rubber tab: its six views). The
  search finds tabs, cards, sections and tiles by the words of their titles (every word typed must be there);
  a result opens its tab - and its view -, scrolls to the heading and marks the card for a moment. The index is
  a list of text keys per tab (180 headings), collected from the real page in both languages; `tests/states.js`
  fails when a tab shows a heading the index does not list, `tests/words.js` when a listed key has no text or the
  code of its tab does not name it any more. Lao texts: one word for the foreign-exchange reserves
  ("ຄັງສຳຮອງ", the word of Decree 140/GOV of 2021; 15 texts said "ທຶນສຳຮອງ").
- P3-3 `tests/screens.js`: 380 / 768 / 1440 px (288 screens; a language, a theme or a width can be named). The
  first run at 768 px: 96 screens, no problem.
- P3-4 `targetStatus`: a target of 0 (the budget not in deficit) is compared in points - near = not more than
  `NEAR_POINTS` (0.5) away; before, 0.1 / 0 = Infinity made every miss "far". The two sentences that explain the
  rule (plan tab, method page) name the limit from the code.
- P3-5 The policy tab's "rate against inflation" uses `realRate()` of `js/calc.js` like the deposit cards (7%
  against 7.8% = -0.7%, not -0.8 points); the method page said so already.
- P3-6 Series nobody reads are no longer fetched: `dependency`, `unemployment`, `density` (population),
  manufacturing growth, the yearly government debt stock and the population in millions (invest), the IMF's
  yearly inflation of Thailand (economy). `scripts/lint.js` checks that a page names every series a fetcher
  stores. Same number in two files: 13 indicators (was 14).
- P3-7 Texts in two files per language: `i18n/<lang>/app.json` (560 texts, first screen) and
  `i18n/<lang>/economy.json` (849 texts that only the economy page names; loaded by `js/pages/economy.js` when the
  page is opened; `js/app.js` also asks for it in the background once the first screen is drawn, so that the
  service worker has a copy for a time without a connection). The first screen waits for a third of the texts it
  loaded before (76 KB instead of 232 KB, before compression). `tests/words.js` keeps the two files apart
  (a text another page can reach must be in app.json; a text in app.json must be used outside the economy page).
  New `scripts/lint.js` (no packages, first step of `tests/all.js`): syntax of every script, imports (file and
  name exist, none unused), names used without a declaration, dead top-level code and unused exports, style
  tokens, text sizes, contrast, fetched series, preload list, workflow scripts - with its own tokenizer and 18
  pieces of code with a known answer. It found: two unused imports, two unused helpers, three unused style
  tokens, two texts nothing names (`menu_open`, `eco_gdp`) - all removed.
- P3-8 Singapore's Local Qualifying Salary: 1 July 2026 IS the day in force (the ministry's factsheet of
  3 March 2026: "From 1 July 2026, the Government will raise the LQS from $1,600 to $1,800"); the ministry's page
  carries the same day as its "Last Updated" line. `data/invest-static.json` now holds both: the page's own day
  as the source's `published`, and the factsheet as a second source of the entry.
- Found on the way, fixed and tested: (1) `fetch-thai-prices.js` ends by itself after 11 minutes (a hanging API
  had the workflow step killed at 15; oldest prices are asked first; `tests/thai-prices.js`). (2) `js/app.js`: a
  page chosen before the texts had arrived threw an exception (`tests/menu.js`). (3) Two tests of the Settings
  source list assumed that no source is down in the real data; they now ask the page's own module which files
  must be marked (`tests/states.js`, `tests/live.js`). (4) `tests/offline-label.js` waits for the page to be
  drawn instead of a fixed pause, and fails on an exception.
- Still the owner's to decide: P0-3 a / b, which P1-7 indicators to build, the data registry a / b / c, hosting
  the OCR files on the site or not.

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
  All UI text in `/i18n/th/*.json` and `/i18n/lo/*.json` — no hard-coded strings in HTML/JS.
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
