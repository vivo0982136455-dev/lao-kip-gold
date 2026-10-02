// Source #29: the Bank of the Lao PDR's own policy levers (OFFICIAL), read from the bank's website once a week.
//   policy_rate  "BOL Interest Rate", column "1 Week" = the policy rate: every change with the day it started
//   reserve      reserve requirement ratio for kip and for foreign-currency deposits: every change with its day
//   reserves     official foreign-exchange reserves, US$ million, every month (the bank's own workbook)
//   inflation    inflation rate of this year, month by month (often one month ahead of the IMF series)
// Writes data/bol-policy.json (loaded only on the Economy > Policy tab). A part that fails keeps its old rows
// and is marked stale; the page then falls back to the hand-checked values in data/invest-static.json.
// Usage: node scripts/fetch-bol-policy.js
//
// Real answers (checked 2026-10-02):
//   GET https://www.bol.gov.la/en/interestRate   one HTML table
//       <th>Years</th><th>Less than 3 Months</th><th>1 Week</th><th>More than 1 Week</th><th>2 weeks - 1 year</th>
//       <td> 25/08/2026 </td><td>--</td><td>7 %</td><td>--</td><td>--</td>         decimal comma: "8,50 %"
//       Older rows have only a year ("2007") or no 1-week rate ("--"): they are skipped.
//   GET https://www.bol.gov.la/en/reservRate     one HTML table
//       <th>Years</th><th>KIP</th><th>Foreign Currencies</th>
//       <td>27-08-2024</td><td>8 %</td><td>11 %</td>
//   GET https://www.bol.gov.la/en/External_Sectors   links <a href="/statistics/Official_Reserves_Lao PDR.xlsx" download>
//       one sheet, the layout the IMF asks for: row 11 = "Country code | Descriptor | ALT_Descriptor | INDICATOR |
//       2000-01 | 2000-02 | ..."; the row whose first cell is RAXGFX_USD = "Foreign Exchange, millions of US Dollars"
//       (2026-04 = 4303.5, 2026-07 = 3772.6). Note in the file: since July 2020 the numbers include the currency
//       swap with the People's Bank of China.
//   GET https://www.bol.gov.la/en/inflation      one HTML table of the current year
//       <th>Year: 2026</th><th>January</th> ... <th>December</th><th>C.Y.Ave.</th>
//       row "CPI": 256,80 ...   row "Inflation Rate (%)": 5,10 | 6,20 | 9,70 | 10,20 | 9 | ...
//       (decimal comma; the months that have not happened yet are empty)
//   The server does not send its intermediate certificate (Node on Linux: "unable to verify the first
//   certificate") -> scripts/lib/aia.js fetches the missing certificate the way a browser does.

const path = require("path");
const { DATA_DIR, readJson, writeIfChanged } = require("./lib/common");
const { runParts, partsText } = require("./lib/parts");
const { fetchTextAia, fetchBufferAia } = require("./lib/aia");
const { unpack } = require("./lib/zip");

const OUT_FILE = path.join(DATA_DIR, "bol-policy.json");
const TIMEOUT_MS = 30000;
const RATE_URL = process.env.BOL_RATE_URL || "https://www.bol.gov.la/en/interestRate";
const RESERVE_URL = process.env.BOL_RESERVE_URL || "https://www.bol.gov.la/en/reservRate";
const EXTERNAL_URL = process.env.BOL_EXTERNAL_URL || "https://www.bol.gov.la/en/External_Sectors";
const INFLATION_URL = process.env.BOL_INFLATION_URL || "https://www.bol.gov.la/en/inflation";
const RESERVES_FROM = "2015-01"; // months kept

const SOURCES = {
  bol_rate: { source_name: "Bank of the Lao PDR: BOL interest rate (policy rate, 1 week)", source_url: "https://www.bol.gov.la/en/interestRate", license: "Bank of the Lao PDR - official figures, with attribution" },
  bol_reserve: { source_name: "Bank of the Lao PDR: reserve requirement rate", source_url: "https://www.bol.gov.la/en/reservRate", license: "Bank of the Lao PDR - official figures, with attribution" },
  bol_reserves: { source_name: "Bank of the Lao PDR: official reserve assets (foreign exchange)", source_url: "https://www.bol.gov.la/en/External_Sectors", license: "Bank of the Lao PDR - official figures, with attribution" },
  bol_inflation: { source_name: "Bank of the Lao PDR: inflation rate", source_url: "https://www.bol.gov.la/en/inflation", license: "Bank of the Lao PDR - official figures (index compiled by the Lao Statistics Bureau), with attribution" },
};

// Rows read by hand on 2026-10-02. They must still be on the page: if they are not, the page has changed its
// layout and the parser must not be believed.
const KNOWN_RATE = ["2026-02-24", 8];
const KNOWN_RESERVE = ["2024-08-27", 8, 11];
const KNOWN_RESERVES = ["2026-04", 4303.5]; // US$ million

const cellText = (html) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
// Every table of the page as rows of cell texts (empty rows left out)
function tables(html) {
  return [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map((table) =>
    [...table[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((tr) => [...tr[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => cellText(c[1]))).filter((r) => r.length)
  );
}
// "8,50 %" -> 8.5 ; "7 %" -> 7 ; "--" -> null
const percent = (s) => {
  const m = /^(\d{1,2}(?:[.,]\d{1,2})?)\s*%$/.exec(String(s).trim());
  return m ? Number(m[1].replace(",", ".")) : null;
};
// "25/08/2026" or "27-08-2024" -> "2026-08-25" ; anything else (a bare year) -> null
const isoDay = (s) => {
  const m = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(String(s).trim());
  if (!m) return null;
  const day = `${m[3]}-${m[2]}-${m[1]}`;
  return Number.isNaN(Date.parse(day + "T00:00:00Z")) ? null : day;
};
const tomorrow = () => new Date(Date.now() + 86400000 + 7 * 3600000).toISOString().slice(0, 10); // Vientiane, +1 day

async function page(url) {
  const { text, repaired } = await fetchTextAia(url, {}, TIMEOUT_MS);
  if (repaired) console.log(`       (certificate chain completed with ${repaired})`);
  return text;
}

// The table whose heading row has all the wanted column names -> { rows, cols: [index of each name] }
function findTable(html, names, what) {
  for (const rows of tables(html)) {
    const head = rows[0] || [];
    const cols = names.map((n) => head.findIndex((h) => h.toLowerCase() === n.toLowerCase()));
    if (cols.every((c) => c >= 0)) return { rows: rows.slice(1), cols };
  }
  throw new Error(`${what}: no table with the columns ${names.join(" / ")}`);
}

async function policyRate() {
  const { rows, cols } = findTable(await page(RATE_URL), ["Years", "1 Week"], "BOL interest rate");
  const out = [];
  for (const r of rows) {
    const day = isoDay(r[cols[0]]);
    const rate = percent(r[cols[1]]);
    if (!day || rate === null) continue; // a bare year, or no 1-week rate
    if (rate <= 0 || rate > 40) throw new Error(`BOL interest rate: ${rate}% on ${day} is not a possible policy rate`);
    if (day > tomorrow()) throw new Error(`BOL interest rate: a row is dated ${day} (in the future)`);
    out.push([day, rate]);
  }
  out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (out.length < 8) throw new Error(`BOL interest rate: only ${out.length} rows could be read`);
  if (!out.some((r) => r[0] === KNOWN_RATE[0] && r[1] === KNOWN_RATE[1])) throw new Error(`BOL interest rate: the known row ${KNOWN_RATE.join(" = ")}% is missing - has the page changed?`);
  return { source: "bol_rate", unit: "% per year", term: "1 week", rows: out };
}

async function reserve() {
  const { rows, cols } = findTable(await page(RESERVE_URL), ["Years", "KIP", "Foreign Currencies"], "BOL reserve requirement");
  const out = [];
  for (const r of rows) {
    const day = isoDay(r[cols[0]]);
    const kip = percent(r[cols[1]]);
    const foreign = percent(r[cols[2]]);
    if (!day || kip === null || foreign === null) continue;
    if (kip > 40 || foreign > 40) throw new Error(`BOL reserve requirement: ${kip}% / ${foreign}% on ${day} is not possible`);
    if (day > tomorrow()) throw new Error(`BOL reserve requirement: a row is dated ${day} (in the future)`);
    out.push([day, kip, foreign]);
  }
  out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (out.length < 4) throw new Error(`BOL reserve requirement: only ${out.length} rows could be read`);
  if (!out.some((r) => r[0] === KNOWN_RESERVE[0] && r[1] === KNOWN_RESERVE[1] && r[2] === KNOWN_RESERVE[2])) throw new Error("BOL reserve requirement: the known row of 2024-08-27 (8% / 11%) is missing - has the page changed?");
  return { source: "bol_reserve", unit: "%", columns: ["kip", "foreign"], rows: out };
}

// Foreign-exchange reserves by month, from the workbook linked on the "External Sectors" page
async function reserves() {
  const link = /href="([^"]*Official_Reserves[^"]*\.xlsx)"/i.exec(await page(EXTERNAL_URL));
  if (!link) throw new Error("BOL reserves: the workbook is no longer linked on the External Sectors page");
  const { buffer } = await fetchBufferAia(new URL(link[1].replace(/ /g, "%20"), EXTERNAL_URL).href, {}, TIMEOUT_MS);
  const xml = (name) => unpack(buffer, (n) => n === name).toString("utf8");
  const strings = [...xml("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(""));
  const cellsOf = (rowXml) => {
    const out = new Map(); // column letters -> text
    for (const m of rowXml.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const v = /<v>([\s\S]*?)<\/v>/.exec(m[3] || "");
      if (v) out.set(m[1], /t="s"/.test(m[2]) ? strings[Number(v[1])] : v[1]);
    }
    return out;
  };
  let months = null; // column letters -> "2026-07"
  let values = null;
  for (const m of xml("xl/worksheets/sheet1.xml").matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = cellsOf(m[1]);
    if (!months && [...cells.values()].includes("INDICATOR")) months = new Map([...cells].filter(([, text]) => /^\d{4}-\d{2}$/.test(String(text))));
    else if (months && String(cells.get("A") || "").trim() === "RAXGFX_USD") values = cells;
  }
  if (!months || !values) throw new Error("BOL reserves: the row RAXGFX_USD (foreign exchange, US$ million) was not found");
  const rows = [];
  for (const [col, month] of months) {
    if (!values.has(col)) continue;
    const v = Number(values.get(col));
    if (!Number.isFinite(v) || v <= 0 || v > 100000) throw new Error(`BOL reserves: ${values.get(col)} million US$ in ${month} is not possible`);
    if (month >= RESERVES_FROM) rows.push([month, Math.round(v * 10) / 10]);
  }
  rows.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (rows.length < 60) throw new Error(`BOL reserves: only ${rows.length} months could be read`);
  if (rows[rows.length - 1][0] > tomorrow().slice(0, 7)) throw new Error(`BOL reserves: a month in the future (${rows[rows.length - 1][0]})`);
  if (!rows.some((r) => r[0] === KNOWN_RESERVES[0] && Math.abs(r[1] - KNOWN_RESERVES[1]) < 1)) throw new Error(`BOL reserves: the known value of ${KNOWN_RESERVES[0]} (${KNOWN_RESERVES[1]}) is missing - has the file changed?`);
  return { source: "bol_reserves", unit: "USD million", includes_swap_since: "2020-07", rows };
}

// Inflation of the current year, month by month
async function inflation() {
  const table = tables(await page(INFLATION_URL)).find((rows) => rows[0] && /^Year:\s*\d{4}$/.test(rows[0][0]) && rows[0][1] === "January");
  const line = table && table.find((r) => /^Inflation Rate/i.test(r[0]));
  if (!line) throw new Error('BOL inflation: no table with the months of a year and the row "Inflation Rate"');
  const year = /\d{4}/.exec(table[0][0])[0];
  const rows = [];
  for (let m = 1; m <= 12; m++) {
    const text = String(line[m] || "").trim();
    if (!text) continue;
    const v = Number(text.replace(",", "."));
    if (!/^-?\d{1,3}(?:[.,]\d{1,2})?$/.test(text) || v < -20 || v > 100) throw new Error(`BOL inflation: "${text}" in month ${m} of ${year} is not a possible rate`);
    rows.push([`${year}-${String(m).padStart(2, "0")}`, v]);
  }
  if (!rows.length) throw new Error(`BOL inflation: no month of ${year} has a value yet`);
  if (rows[rows.length - 1][0] > tomorrow().slice(0, 7)) throw new Error(`BOL inflation: a month in the future (${rows[rows.length - 1][0]})`);
  // no hole allowed: January up to the newest month
  if (rows.some((r, i) => Number(r[0].slice(5)) !== i + 1)) throw new Error(`BOL inflation: months of ${year} are missing in the table`);
  return { source: "bol_inflation", unit: "% vs a year earlier", year: Number(year), rows };
}

async function main() {
  const old = readJson(OUT_FILE, {});
  const last = (p) => JSON.stringify(p.rows[p.rows.length - 1]);
  const { out, failed } = await runParts(old, [
    ["policy_rate", { source: "bol_rate", unit: "% per year", term: "1 week", rows: [] }, policyRate, (p) => `${p.rows.length} changes, in force: ${last(p)}`],
    ["reserve", { source: "bol_reserve", unit: "%", columns: ["kip", "foreign"], rows: [] }, reserve, (p) => `${p.rows.length} changes, in force: ${last(p)}`],
    ["reserves", { source: "bol_reserves", unit: "USD million", includes_swap_since: "2020-07", rows: [] }, reserves, (p) => `${p.rows.length} months, newest: ${last(p)}`],
    ["inflation", { source: "bol_inflation", unit: "% vs a year earlier", year: null, rows: [] }, inflation, (p) => `${p.rows.length} months of ${p.year}, newest: ${last(p)}`],
  ]);
  const text = partsText({ sources: SOURCES }, out);
  writeIfChanged(OUT_FILE, text);
  console.log(`\nDone: ${failed} of 4 parts failed. Wrote data/bol-policy.json (${(text.length / 1024).toFixed(1)} KB)`);
  return { ok: failed < 4 };
}

if (require.main === module) main().then((r) => (process.exitCode = r.ok ? 0 : 1));

module.exports = { main, tables, percent, isoDay, findTable };
