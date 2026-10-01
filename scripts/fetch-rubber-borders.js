// Source #26: where Lao rubber goes and at what price, and farm-gate / customs prices of the neighbours.
// Weekly. All free, no key.
//   buyers       UN Comtrade: every country's imports of natural rubber (HS 4001) FROM Laos, per year since 2015 -
//                what the BUYER's customs recorded (weight and value at their border, transport included)
//   declared     UN Comtrade: what Laos itself reported as exports, per partner and year (value at the Lao border)
//   forms        UN Comtrade: the kinds of rubber China and Viet Nam import from Laos (latex 400110, smoked sheet
//                400121, block rubber 400122, other forms 400129 = raw cup lump, unsmoked sheet ...)
//   vietnam      Viet Nam Customs, monthly PDF tables: "5N" (imports by country and main commodity) -> rubber
//                imported from Laos, month and year so far; "2X" (exports by commodity) -> Viet Nam's own rubber
//                exports. Viet Nam has not reported 2024-2025 to Comtrade, so this is the only fresh number.
//                "Cao su" in these tables = rubber of every kind (natural rubber and mixtures), so tonnes are a
//                little above the HS 4001 numbers of Comtrade.
//   philippines  Philippine Statistics Authority (OpenSTAT): farm-gate price of rubber cup lump, monthly
// Writes data/rubber-borders.json (loaded only on the Economy > Rubber tab).
// Usage: node scripts/fetch-rubber-borders.js          (weekly run: new months only)
//        node scripts/fetch-rubber-borders.js all      (first fill: every month since 2024-01)
//
// Real answers (checked 2026-10-01 / 02):
//   Comtrade  GET https://comtradeapi.un.org/public/v1/preview/C/A/HS?period=2023&partnerCode=418&flowCode=M&cmdCode=4001&includeDesc=true
//             (no reporterCode = every reporter; ONE period per request) -> data: [ { reporterISO: "CHN",
//             netWgt: 181244300 (kg, can be null), primaryValue: 243657000 (USD), partner2Code: 0, customsCode: "C00",
//             motCode: 0 }, ... ]. With reporterCode=418&flowCode=X the rows are per partner (partnerISO; "W00" = world).
//   Viet Nam Customs  the listing page is protected (captcha), the files are public:
//             https://files.customs.gov.vn/CustomsCMS/TONG_CUC/2026/9/10/2026-t8-5n(vn-sb).pdf
//             folder = the day of publication (between the 4th and the 12th of the next month), name in lower case
//             since 2024-12 (before: 2023-T12-5N(VN-SB).pdf). The day is found by trying the days of the next month.
//             PDF made by Crystal Reports, read with scripts/lib/pdf-text.js. Rows of table 5N under the country
//             "LÀO": "Cao su | Tấn | 6.106 | 10.825.018 | 75.346 | 128.604.728" = month tonnes, month USD,
//             year-so-far tonnes, year-so-far USD (dots = thousands). Table 2X row: "24 | Cao su | Tấn | 156.845 |
//             332.130.790 | 3,1 | 2,4 | 944.891 | 1.880.308.468 | -15,4 | -5,1".
//   PSA       POST https://openstat.psa.gov.ph/PXWeb/api/v1/en/DB/2M/NFG/0032M4AFN08.px  (query: Geolocation
//             000000000 = Philippines, Commodity 30 = Rubber Cuplump, Year codes) -> { data: [ { key: [geo, year,
//             period, commodity], values: ["41.88"] } ] }; period 0-11 = January-December, 12 = annual; ".." = no value.
//             Pesos per kilogram.

const path = require("path");
const { DATA_DIR, fetchJson, readJson, writeIfChanged } = require("./lib/common");
const { runParts, partsText } = require("./lib/parts");
const { readPdf } = require("./lib/pdf-text");

const OUT_FILE = path.join(DATA_DIR, "rubber-borders.json");
const TIMEOUT_MS = 60000;
const FIRST_YEAR = 2015; // Comtrade history
const VN_FIRST_MONTH = "2024-01"; // Viet Nam Customs history
const VN_NEW_MONTHS = 4; // weekly run: at most this many new months are looked for (the first fill uses "all")
const LAO = 418;

const SOURCES = {
  comtrade: { source_name: "UN Comtrade: trade in natural rubber (HS 4001)", source_url: "https://comtradeplus.un.org/", license: "UN Comtrade - free public data, with attribution" },
  vn_customs: { source_name: "Viet Nam Customs: monthly statistics (tables 5N imports by country, 2X exports by commodity)", source_url: "https://www.customs.gov.vn/index.jsp?pageId=5002", license: "General Department of Viet Nam Customs - official statistics, with attribution" },
  psa: { source_name: "Philippine Statistics Authority (OpenSTAT): farm-gate prices of commercial crops", source_url: "https://openstat.psa.gov.ph/PXWeb/pxweb/en/DB/DB__2M__NFG/0032M4AFN08.px/", license: "PSA OpenSTAT - open data, with attribution" },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, "0");

// ---------- UN Comtrade ----------
const COMTRADE = "https://comtradeapi.un.org/public/v1/preview/C/A/HS";
async function comtrade(query) {
  const url = `${COMTRADE}?${new URLSearchParams({ includeDesc: "true", ...query })}`;
  const data = await fetchJson(url, {}, TIMEOUT_MS);
  await sleep(2200); // the free endpoint is rate limited
  if (!data || !Array.isArray(data.data)) throw new Error(`Unexpected Comtrade answer: ${JSON.stringify(data).slice(0, 120)}`);
  if (data.data.length >= 500) throw new Error("Comtrade answer is cut off at 500 rows");
  return data.data.filter((r) => r.partner2Code === 0 && r.customsCode === "C00" && r.motCode === 0);
}
// [who, tonnes | null, thousand USD]
const tradeRow = (who, r) => [who, r.netWgt > 0 ? Math.round(r.netWgt / 100) / 10 : null, Math.round(r.primaryValue / 1000)];
const closedYear = (year) => year < new Date().getUTCFullYear() - 2; // old enough: no late reports any more
const yearsToAsk = () => {
  const out = [];
  for (let y = FIRST_YEAR; y < new Date().getUTCFullYear(); y++) out.push(y);
  return out;
};

// Every country's imports from Laos, per year (newest years are asked again every week: late reporters)
async function buyers(old) {
  const years = { ...((old && old.years) || {}) };
  for (const year of yearsToAsk()) {
    if (closedYear(year) && years[year] && years[year].rows.length) continue;
    const rows = (await comtrade({ period: year, partnerCode: LAO, flowCode: "M", cmdCode: "4001" })).map((r) => tradeRow(r.reporterISO, r)).sort((a, b) => b[2] - a[2]);
    if (rows.length || !years[year]) years[year] = { rows };
  }
  if (!Object.values(years).some((y) => y.rows.length)) throw new Error("Comtrade: no buyer of Lao rubber in any year");
  return { source: "comtrade", unit: ["tonnes", "USD thousand"], years };
}

// What Laos itself reported: exports per partner ("W00" = total)
async function declared(old) {
  const years = { ...((old && old.years) || {}) };
  for (const year of yearsToAsk()) {
    if (closedYear(year) && years[year] && years[year].rows.length) continue;
    const rows = (await comtrade({ period: year, reporterCode: LAO, flowCode: "X", cmdCode: "4001" })).map((r) => tradeRow(String(r.partnerISO || r.partnerCode).trim(), r)).sort((a, b) => b[2] - a[2]);
    if (rows.length || !years[year]) years[year] = { rows };
  }
  if (!Object.values(years).some((y) => y.rows.length)) throw new Error("Comtrade: Laos has reported no rubber exports in any year");
  return { source: "comtrade", unit: ["tonnes", "USD thousand"], years };
}

// The kinds of rubber the two big buyers import from Laos (last 4 years that they reported)
const FORM_CODES = ["400110", "400121", "400122", "400129"];
const FORM_BUYERS = { CHN: 156, VNM: 704 };
async function forms(old) {
  const out = {};
  for (const [iso, code] of Object.entries(FORM_BUYERS)) {
    const years = { ...((old && old.buyers && old.buyers[iso]) || {}) };
    for (const year of yearsToAsk().slice(-5)) {
      if (closedYear(year) && years[year]) continue;
      const rows = await comtrade({ period: year, reporterCode: code, partnerCode: LAO, flowCode: "M", cmdCode: FORM_CODES.join(",") });
      if (!rows.length) continue;
      years[year] = Object.fromEntries(rows.map((r) => [r.cmdCode, tradeRow(r.cmdCode, r).slice(1)]));
    }
    out[iso] = Object.fromEntries(Object.entries(years).sort().slice(-4));
  }
  if (!Object.values(out).some((y) => Object.keys(y).length)) throw new Error("Comtrade: no rubber imports from Laos by kind");
  return { source: "comtrade", unit: ["tonnes", "USD thousand"], codes: FORM_CODES, buyers: out };
}

// ---------- Viet Nam Customs ----------
const VN_FILES = "https://files.customs.gov.vn/CustomsCMS/TONG_CUC";
const VN_DAYS = [10, 7, 6, 11, 8, 9, 12, 5, 4, 13, 14, 15, 3, 16, 17, 18, 2, 1, 19, 20, 21, 22, 23, 24, 25]; // most likely first
async function urlExists(url) {
  const res = await fetch(url, { method: "HEAD", headers: { "User-Agent": "lao-kip-gold-dashboard (personal, non-commercial)" }, signal: AbortSignal.timeout(30000) });
  return res.status === 200;
}
// The file of one table for one month: the folder is the day of publication in the following month
async function findVnFile(table, month) {
  const [y, m] = month.split("-").map(Number);
  const next = new Date(Date.UTC(y, m, 1));
  const folder = `${VN_FILES}/${next.getUTCFullYear()}/${next.getUTCMonth() + 1}`;
  // the name changed over the years: 2026-t8-5n(vn-sb) · 2023-T12-5N(VN-SB) · 2022-T02T-5N(VN-SB)
  const T = table.toUpperCase();
  const names = [`${y}-t${m}-${table}(vn-sb).pdf`, `${y}-T${m}-${T}(VN-SB).pdf`];
  if (m < 10) names.push(`${y}-t${pad(m)}-${table}(vn-sb).pdf`, `${y}-T${pad(m)}-${T}(VN-SB).pdf`);
  names.push(`${y}-T${pad(m)}T-${T}(VN-SB).pdf`);
  for (const day of VN_DAYS) {
    for (const name of names) {
      const url = `${folder}/${day}/${name}`;
      if (await urlExists(url)) return url;
      await sleep(120);
    }
  }
  return null;
}
async function fetchPdf(url) {
  const res = await fetch(url, { headers: { "User-Agent": "lao-kip-gold-dashboard (personal, non-commercial)" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

const vnNumber = (s) => {
  const t = String(s).trim();
  return /^\d{1,3}(\.\d{3})*$/.test(t) ? Number(t.replace(/\./g, "")) : null; // "10.825.018" (dots = thousands)
};
// Column borders of the two tables, in page points (the same in every file seen, 2023-12 ... 2026-08, made by two
// different programs). 5N: name | unit | month tonnes | month USD | year-so-far tonnes | year-so-far USD.
// 2X: no. | name | unit | month tonnes | month USD | % | % | year-so-far tonnes | year-so-far USD | % | %.
const COLS_5N = [57, 275, 311, 365, 437, 495, 575];
const COLS_2X = [59, 89, 333, 368, 427, 505, 545, 584, 645, 730, 770, 809];

// Text pieces of one page grouped into table rows, top row first; pieces sorted left to right
function pageRows(page) {
  const rows = [];
  for (const t of page.texts) {
    let row = rows.find((r) => Math.abs(r.y - t.y) < 2);
    if (!row) rows.push((row = { y: t.y, cells: [] }));
    row.cells.push(t);
  }
  rows.sort((p, q) => q.y - p.y); // y counts from the bottom of the page
  for (const r of rows) r.cells.sort((p, q) => p.x - q.x);
  return rows;
}
// The text of one table cell. Some files draw a word in several pieces ("L" "À" "O"): they are joined.
const cellText = (row, cols, i) => row.cells.filter((c) => c.x >= cols[i] - 1 && c.x < cols[i + 1] - 1).map((c) => c.text).join("").replace(/\s+/g, " ").trim().normalize("NFC");
function checkMonth(pages, month, what) {
  const [y, m] = month.split("-").map(Number);
  const title = pages[0].texts.map((t) => t.text).join("").normalize("NFC").replace(/\s+/g, "");
  if (!new RegExp(`Tháng0?${m}năm${y}`).test(title)) throw new Error(`${what} ${month}: the file is not about this month`);
}
function checkPrice(tonnes, usd, what) {
  const price = usd / tonnes / 1000;
  if (!(tonnes > 0) || !(price > 0.3 && price < 10)) throw new Error(`${what}: ${tonnes} t and ${usd} USD give ${price.toFixed(2)} USD per kg - not plausible`);
}

// Table 5N -> rubber imported from Laos: { month: [tonnes, usd] | null, ytd: [tonnes, usd] } (null: no rubber row)
// A country row has a name in capitals and no unit; the rows of its goods follow, each with a unit (USD or Tấn).
function readVn5n(buf, month) {
  const pages = readPdf(buf);
  checkMonth(pages, month, "5N");
  let countries = 0;
  let inLaos = false;
  for (const page of pages) {
    for (const row of pageRows(page)) {
      const name = cellText(row, COLS_5N, 0);
      const unit = cellText(row, COLS_5N, 1);
      const n = (i) => vnNumber(cellText(row, COLS_5N, i));
      if (!name || (n(3) === null && n(5) === null)) continue; // page header, page number ...
      if (!unit) {
        if (name !== name.toUpperCase() || !/\p{Lu}{2}/u.test(name)) continue;
        if (inLaos) return null; // the next country: Laos has no rubber row this year
        countries++;
        inLaos = name === "LÀO";
        continue;
      }
      if (!inLaos || name !== "Cao su") continue;
      if (unit !== "Tấn") throw new Error(`5N ${month}: the rubber row is not in tonnes`);
      const [mq, mv, cq, cv] = [n(2), n(3), n(4), n(5)];
      if (cq === null || cv === null) throw new Error(`5N ${month}: the rubber row has no year-so-far numbers`);
      checkPrice(cq, cv, `5N ${month} year so far`);
      if (mq !== null && mv !== null) checkPrice(mq, mv, `5N ${month}`);
      return { month: mq !== null && mv !== null ? [mq, mv] : null, ytd: [cq, cv] };
    }
  }
  throw new Error(`5N ${month}: the country LÀO was not found (${countries} countries read)`);
}

// Table 2X -> Viet Nam's own rubber exports: { month: [tonnes, usd], ytd: [tonnes, usd] }
function readVn2x(buf, month) {
  const pages = readPdf(buf);
  checkMonth(pages, month, "2X");
  for (const page of pages) {
    for (const row of pageRows(page)) {
      if (cellText(row, COLS_2X, 1) !== "Cao su") continue;
      if (cellText(row, COLS_2X, 2) !== "Tấn") throw new Error(`2X ${month}: the rubber row is not in tonnes`);
      const n = (i) => vnNumber(cellText(row, COLS_2X, i));
      const [mq, mv, cq, cv] = [n(3), n(4), n(7), n(8)];
      if ([mq, mv, cq, cv].some((v) => v === null)) throw new Error(`2X ${month}: the rubber row is not complete`);
      checkPrice(mq, mv, `2X ${month}`);
      checkPrice(cq, cv, `2X ${month} year so far`);
      return { month: [mq, mv], ytd: [cq, cv] };
    }
  }
  throw new Error(`2X ${month}: the rubber row was not found`);
}

// Months from VN_FIRST_MONTH up to the last month whose table can be out (published early in the next month)
function vnMonths() {
  const out = [];
  const now = new Date();
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (now.getUTCDate() >= 4 ? 1 : 2), 1));
  for (let d = new Date(VN_FIRST_MONTH + "-01T00:00:00Z"); d <= last; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) out.push(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`);
  return out;
}

// One table for every month that is not stored yet. rows: { "2026-08": { url, month: [t, usd] | null, ytd: [t, usd] } }
// A file that exists but cannot be read is stored as { url, unreadable: "why" } and not downloaded again; an old
// month without any file is stored as { missing: true } (run with "all" to try both kinds again).
async function vnTable(table, read, oldRows, limit, retry) {
  const rows = { ...(oldRows || {}) };
  if (retry) for (const [m, v] of Object.entries(rows)) if (v.unreadable || v.missing) delete rows[m];
  let found = 0;
  let missing = 0;
  const months = vnMonths().reverse();
  const old = months[3]; // a month this old that has no file will not get one: remembered, not looked for every week
  for (const month of months) {
    if (rows[month]) continue;
    if (found + missing >= limit) break;
    const url = await findVnFile(table, month);
    if (!url) {
      missing++;
      const gone = old && month <= old;
      console.warn(`[WARN] Viet Nam Customs ${table.toUpperCase()} ${month}: file not found (${gone ? "an old month: not looked for again" : "not published yet?"})`);
      if (gone) rows[month] = { missing: true };
      continue;
    }
    found++;
    try {
      const parsed = read(await fetchPdf(url), month);
      if (parsed) rows[month] = { url, ...parsed };
    } catch (err) {
      // one month that cannot be read must not stop the others; it is tried again next week
      console.warn(`[WARN] Viet Nam Customs ${table.toUpperCase()} ${month}: ${err.message} (${url})`);
      rows[month] = { url, unreadable: err.message };
    }
  }
  return Object.fromEntries(Object.entries(rows).sort());
}
async function vietnam(old, all) {
  const limit = all ? 1000 : VN_NEW_MONTHS;
  const imports = await vnTable("5n", readVn5n, old && old.imports_lao, limit, all);
  const exports = await vnTable("2x", readVn2x, old && old.exports, limit, all);
  if (!Object.values(imports).some((v) => v.ytd)) throw new Error("Viet Nam Customs: no month could be read");
  return { source: "vn_customs", unit: ["tonnes", "USD"], imports_lao: imports, exports };
}

// ---------- Philippines: farm-gate price of cup lump ----------
const PSA_URL = "https://openstat.psa.gov.ph/PXWeb/api/v1/en/DB/2M/NFG/0032M4AFN08.px";
async function philippines() {
  const meta = await fetchJson(PSA_URL, {}, TIMEOUT_MS);
  const find = (code) => (meta.variables || []).find((v) => v.code === code);
  const [geo, year, period, crop] = ["Geolocation", "Year", "Period", "Commodity"].map(find);
  if (!geo || !year || !period || !crop) throw new Error("PSA: the table has other variables than expected");
  const cropCode = crop.values[crop.valueTexts.findIndex((t) => /^rubber cup\s?lump$/i.test(t.trim()))];
  const geoCode = geo.values[geo.valueTexts.findIndex((t) => t.trim().toUpperCase() === "PHILIPPINES")];
  if (cropCode === undefined || geoCode === undefined) throw new Error("PSA: rubber cup lump or the national row is missing");
  const body = {
    query: [
      { code: "Geolocation", selection: { filter: "item", values: [geoCode] } },
      { code: "Commodity", selection: { filter: "item", values: [cropCode] } },
      { code: "Year", selection: { filter: "item", values: year.values.slice(-6) } },
    ],
    response: { format: "json" },
  };
  const res = await fetch(PSA_URL, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "lao-kip-gold-dashboard (personal, non-commercial)" }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`PSA: HTTP ${res.status}`);
  const data = JSON.parse((await res.text()).replace(/^﻿/, ""));
  const cols = data.columns.map((c) => c.code);
  const [yi, pi] = [cols.indexOf("Year"), cols.indexOf("Period")];
  const months = [];
  for (const row of data.data || []) {
    const y = year.valueTexts[year.values.indexOf(row.key[yi])];
    const p = period.values.indexOf(row.key[pi]);
    const v = Number(row.values[0]);
    if (!/^\d{4}$/.test(y) || p < 0 || p > 11 || !(v > 0)) continue; // 12 = annual average; ".." = no value yet
    if (v < 3 || v > 500) throw new Error(`PSA: ${v} pesos per kg in ${y}-${pad(p + 1)} is not plausible`);
    months.push([`${y}-${pad(p + 1)}`, v]);
  }
  months.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (months.length < 6) throw new Error(`PSA: only ${months.length} months returned`);
  return { source: "psa", unit: "PHP per kg", item: "cup lump, farm gate", months };
}

async function main(args = process.argv.slice(2)) {
  const all = args.includes("all");
  const old = readJson(OUT_FILE, {});
  const lastOf = (obj) => Object.keys(obj).sort().pop();
  const { out, failed } = await runParts(old, [
    ["buyers", { source: "comtrade", unit: ["tonnes", "USD thousand"], years: {} }, buyers, (p) => `${Object.keys(p.years).length} years, ${lastOf(p.years)}: ${JSON.stringify(p.years[lastOf(p.years)].rows.slice(0, 2))}`],
    ["declared", { source: "comtrade", unit: ["tonnes", "USD thousand"], years: {} }, declared, (p) => `${Object.values(p.years).filter((y) => y.rows.length).length} years reported by Laos`],
    ["forms", { source: "comtrade", unit: ["tonnes", "USD thousand"], codes: FORM_CODES, buyers: {} }, forms, (p) => Object.entries(p.buyers).map(([iso, y]) => `${iso} ${Object.keys(y).join(",")}`).join(" | ")],
    ["vietnam", { source: "vn_customs", unit: ["tonnes", "USD"], imports_lao: {}, exports: {} }, (o) => vietnam(o, all), (p) => `imports from Laos ${Object.values(p.imports_lao).filter((v) => v.ytd).length} months (to ${lastOf(p.imports_lao)}: ${JSON.stringify(p.imports_lao[lastOf(p.imports_lao)].month)}), exports ${Object.values(p.exports).filter((v) => v.ytd).length} months, unreadable ${[...Object.values(p.imports_lao), ...Object.values(p.exports)].filter((v) => v.unreadable).length}`],
    ["philippines", { source: "psa", unit: "PHP per kg", item: "cup lump, farm gate", months: [] }, philippines, (p) => `${p.months.length} months, latest ${JSON.stringify(p.months[p.months.length - 1])}`],
  ]);
  const text = partsText({ sources: SOURCES }, out);
  writeIfChanged(OUT_FILE, text);
  console.log(`\nDone: ${failed} of 5 parts failed. Wrote data/rubber-borders.json (${(text.length / 1024).toFixed(0)} KB)`);
  if (failed === 5) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { main, readVn5n, readVn2x, findVnFile, philippines };
