// Source #29: the Bank of the Lao PDR's own policy levers (OFFICIAL), read from the bank's website once a week.
//   policy_rate  "BOL Interest Rate", column "1 Week" = the policy rate: every change with the day it started
//   reserve      reserve requirement ratio for kip and for foreign-currency deposits: every change with its day
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
//   The server does not send its intermediate certificate (Node on Linux: "unable to verify the first
//   certificate") -> scripts/lib/aia.js fetches the missing certificate the way a browser does.

const path = require("path");
const { DATA_DIR, readJson, writeIfChanged } = require("./lib/common");
const { runParts, partsText } = require("./lib/parts");
const { fetchTextAia } = require("./lib/aia");

const OUT_FILE = path.join(DATA_DIR, "bol-policy.json");
const TIMEOUT_MS = 30000;
const RATE_URL = process.env.BOL_RATE_URL || "https://www.bol.gov.la/en/interestRate";
const RESERVE_URL = process.env.BOL_RESERVE_URL || "https://www.bol.gov.la/en/reservRate";

const SOURCES = {
  bol_rate: { source_name: "Bank of the Lao PDR: BOL interest rate (policy rate, 1 week)", source_url: "https://www.bol.gov.la/en/interestRate", license: "Bank of the Lao PDR - official figures, with attribution" },
  bol_reserve: { source_name: "Bank of the Lao PDR: reserve requirement rate", source_url: "https://www.bol.gov.la/en/reservRate", license: "Bank of the Lao PDR - official figures, with attribution" },
};

// Rows read by hand on 2026-10-02. They must still be on the page: if they are not, the page has changed its
// layout and the parser must not be believed.
const KNOWN_RATE = ["2026-02-24", 8];
const KNOWN_RESERVE = ["2024-08-27", 8, 11];

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

async function main() {
  const old = readJson(OUT_FILE, {});
  const last = (p) => JSON.stringify(p.rows[p.rows.length - 1]);
  const { out, failed } = await runParts(old, [
    ["policy_rate", { source: "bol_rate", unit: "% per year", term: "1 week", rows: [] }, policyRate, (p) => `${p.rows.length} changes, in force: ${last(p)}`],
    ["reserve", { source: "bol_reserve", unit: "%", columns: ["kip", "foreign"], rows: [] }, reserve, (p) => `${p.rows.length} changes, in force: ${last(p)}`],
  ]);
  const text = partsText({ sources: SOURCES }, out);
  writeIfChanged(OUT_FILE, text);
  console.log(`\nDone: ${failed} of 2 parts failed. Wrote data/bol-policy.json (${(text.length / 1024).toFixed(1)} KB)`);
  return { ok: failed < 2 };
}

if (require.main === module) main().then((r) => (process.exitCode = r.ok ? 0 : 1));

module.exports = { main, tables, percent, isoDay, findTable };
