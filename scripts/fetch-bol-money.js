// Money and banks of Laos, from the Bank of the Lao PDR's own statistics files - the primary source (audit
// 2026-10-02, P1-7: "missing: money supply, credit, foreign-currency deposits, lending rates, bank soundness").
// Three parts, each with its own workbook; a part that fails keeps its last numbers and is marked "stale".
//   node scripts/fetch-bol-money.js   -> data/bol-money.json   (weekly; the bank adds a month or a quarter at a time)
//
// Real answers (read 2026-10-05):
//   GET https://www.bol.gov.la/en/Money_and_Banking   links <a href="/statistics/<name>.xlsx" download>, among them
//     "Depository Coporation Survey_Lao PDR.xlsx" (the bank's own spelling), "Interest rate_Lao PDR.xlsx" and
//     "Financial Soundness Indicators_Lao PDR.xlsx"
//   Every workbook: a head of "DATA_DOMAIN | DCS" lines, then the row
//     "Country code | Descriptor | ALT_Descriptor | INDICATOR | [UNIT_MULT |] 2015-01 | 2015-02 ..." and one row per
//     series with its code in column A (scripts/lib/xlsx.js periodTable). "Published and Reported to IMF".
//   Depository Corporations Survey (sheet "DCS", monthly from 2000-01, billions of kip at the end of the month):
//     LAO_FMA_XDC broad money (M2) 383,213.8 in 2026-07 · LAO_FMBDDF_XDC foreign currency deposits 260,477.7 ·
//     LAO_FMBDDT_XDC time and savings deposits (kip) · LAO_FMNCD_XDC currency outside banks · LAO_FDSBT_XDC demand
//     deposits · LAO_FDSAOP_XDC credit to private sector 235,661.1 · LAO_FDSAON_XDC credit to state enterprises ·
//     LAO_FDSDG_XDC net claims on government · LAO_FDSF_XDC net foreign assets
//   Interest rate (sheet 1 "Commercial Bank Rates", monthly from 2005-01, % per year, average of the commercial
//     banks; a 0 means "no such account then"): LAO_FISR_<NC|THB|USD>_PA savings · ..._12M_PA 12-month deposit ·
//     LAO_FILR_<NC|THB|USD>_1Y_A_PA loan up to one year to a customer of the best class ("Type of Customers: A")
//   Financial Soundness Indicators (sheet "Dataset", quarterly from 2015-Q1, as a share of 1): FSKRC_PT capital to
//     risk-weighted assets · FSANL_PT non-performing loans to all loans · FSERA_PT / FSERE_PT return on assets /
//     equity · loans by sector (LAO_FSASD..._PT; "Handicrafts" has no code) · rows without a code, found by their
//     name: "Gross Loans to Deposits", "Liquid Assets to Total Assets"
//   The server sends no intermediate certificate: scripts/lib/aia.js completes the chain (never switched off).
const path = require("path");
const { DATA_DIR, readJson, writeIfChanged } = require("./lib/common");
const { runParts, partsText, stampedSources } = require("./lib/parts");
const { fetchTextAia, fetchBufferAia } = require("./lib/aia");
const { workbook, periodTable } = require("./lib/xlsx");

const OUT_FILE = path.join(DATA_DIR, "bol-money.json");
const PAGE_URL = process.env.BOL_MONEY_URL || "https://www.bol.gov.la/en/Money_and_Banking";
const TIMEOUT_MS = 60000;
const FROM_MONTH = "2015-01";
const LICENSE = "Bank of the Lao PDR - official figures (also reported to the IMF), with attribution";
const SOURCES = {
  bol_dcs: { source_name: "Bank of the Lao PDR: Depository Corporations Survey (money supply, deposits, credit)", source_url: "https://www.bol.gov.la/en/Money_and_Banking", license: LICENSE },
  bol_rates: { source_name: "Bank of the Lao PDR: interest rates of commercial banks (average)", source_url: "https://www.bol.gov.la/en/Money_and_Banking", license: LICENSE },
  bol_fsi: { source_name: "Bank of the Lao PDR: Financial Soundness Indicators of the banks", source_url: "https://www.bol.gov.la/en/Money_and_Banking", license: LICENSE },
};

// id in our file -> code in the workbook. Billions of kip.
const MONEY = {
  m2: "LAO_FMA_XDC",
  fx_deposits: "LAO_FMBDDF_XDC",
  kip_deposits: "LAO_FMBDDT_XDC",
  cash: "LAO_FMNCD_XDC",
  demand: "LAO_FDSBT_XDC",
  credit_private: "LAO_FDSAOP_XDC",
  credit_soe: "LAO_FDSAON_XDC",
  gov_net: "LAO_FDSDG_XDC",
  nfa: "LAO_FDSF_XDC",
};
const CAN_BE_NEGATIVE = new Set(["gov_net", "nfa"]);
// % per year
const RATES = {
  save_lak: "LAO_FISR_NC_PA",
  save_thb: "LAO_FISR_THB_PA",
  save_usd: "LAO_FISR_USD_PA",
  dep12_lak: "LAO_FISR_NC_12M_PA",
  dep12_thb: "LAO_FISR_THB_12M_PA",
  dep12_usd: "LAO_FISR_USD_12M_PA",
  loan_lak: "LAO_FILR_NC_1Y_A_PA",
  loan_thb: "LAO_FILR_THB_1Y_A_PA",
  loan_usd: "LAO_FILR_USD_1Y_A_PA",
};
// % (the workbook holds shares of 1). code, or the row's English name where the bank gives no code
const SOUND = {
  capital: "FSKRC_PT",
  npl: "FSANL_PT",
  roa: "FSERA_PT",
  roe: "FSERE_PT",
  loans_to_deposits: "name:Gross Loans to Deposits",
  liquid: "name:Liquid Assets to Total Assets",
};
const SECTORS = {
  industry: "LAO_FSASDIH_PT",
  construction: "LAO_FSASDC_PT",
  materials: "LAO_FSASDRMTS_PT",
  agriculture: "LAO_FSASDRA_PT",
  commerce: "LAO_FSASDRCM_PT",
  transport: "LAO_FSASDRT_PT",
  services: "LAO_FSASDRS_PT",
  handicrafts: "name:Handicrafts",
  other: "LAO_FSASDROS_PT",
};

// Values read by hand on 2026-10-05. They must still be in the file (2% of slack: the bank revises its months):
// if they are not, the file has changed its layout or its units and the parser must not be believed.
const KNOWN = { money: ["m2", "2026-04", 382368.9], rates: ["dep12_lak", "2026-04", 6.85], soundness: ["npl", "2025-Q4", 1.15] };

const nextMonth = () => new Date(Date.now() + 31 * 86400000).toISOString().slice(0, 7);
const round = (v, digits) => Math.round(v * 10 ** digits) / 10 ** digits;

let pageText = null; // the statistics page, read once for the three parts
async function book(namePattern, what) {
  if (pageText === null) {
    const { text, repaired } = await fetchTextAia(PAGE_URL, {}, TIMEOUT_MS);
    if (repaired) console.log(`       (certificate chain completed with ${repaired})`);
    pageText = text;
  }
  const link = [...pageText.matchAll(/href="([^"]+\.xlsx)"/gi)].map((m) => m[1]).find((href) => namePattern.test(decodeURIComponent(href)));
  if (!link) throw new Error(`${what}: the workbook is no longer linked on ${PAGE_URL}`);
  const { buffer } = await fetchBufferAia(new URL(link.replace(/ /g, "%20"), PAGE_URL).href, {}, TIMEOUT_MS);
  return workbook(buffer);
}

// One series of a period table -> [[period, value], ...] sorted, from `from` on
function series(table, key, { from, scale = 1, digits, zeroIsMissing = false, min, max, what }) {
  const values = key.startsWith("name:") ? table.byName.get(key.slice(5)) : table.byCode.get(key);
  if (!values) throw new Error(`${what}: the row ${key} was not found`);
  const out = [];
  for (const [period, raw] of values) {
    if (period < from || (zeroIsMissing && raw === 0)) continue;
    const v = round(raw * scale, digits);
    if (v < min || v > max) throw new Error(`${what}: ${v} in ${period} (${key}) is not possible`);
    out.push([period, v]);
  }
  out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return out;
}
function checkKnown(part, rows, what) {
  const [id, period, value] = KNOWN[part];
  const found = (rows[id] || []).find((r) => r[0] === period);
  if (!found || Math.abs(found[1] / value - 1) > 0.02) throw new Error(`${what}: the known value of ${period} (${id} = ${value}) is ${found ? found[1] : "missing"} - has the file changed?`);
}
function checkNewest(rows, id, least, what, limit) {
  const list = rows[id];
  if (list.length < least) throw new Error(`${what}: only ${list.length} periods of ${id} could be read`);
  if (list[list.length - 1][0] > limit) throw new Error(`${what}: a period in the future (${list[list.length - 1][0]})`);
}

async function money() {
  const what = "BOL money survey";
  const table = periodTable((await book(/Depository Co\w*poration Survey/i, what)).rows(1), /^\d{4}-\d{2}$/, what);
  const rows = {};
  for (const [id, code] of Object.entries(MONEY)) rows[id] = series(table, code, { from: FROM_MONTH, digits: 1, min: CAN_BE_NEGATIVE.has(id) ? -1e7 : 0.1, max: 1e7, what });
  checkNewest(rows, "m2", 120, what, nextMonth());
  checkKnown("money", rows, what);
  // the parts of broad money must add up to it (cash + demand + kip time and savings + foreign currency)
  const last = rows.m2[rows.m2.length - 1];
  const at = (id) => (rows[id].find((r) => r[0] === last[0]) || [])[1];
  const sum = at("cash") + at("demand") + at("kip_deposits") + at("fx_deposits");
  if (!(Math.abs(sum / last[1] - 1) < 0.01)) throw new Error(`${what}: the parts of broad money add up to ${round(sum, 1)} in ${last[0]}, the total is ${last[1]}`);
  return { source: "bol_dcs", unit: "LAK billion", at: "end of month", rows };
}

async function rates() {
  const what = "BOL commercial bank rates";
  const book1 = await book(/Interest rate/i, what);
  if (!/commercial/i.test(book1.names[0] || "")) throw new Error(`${what}: the first sheet is "${book1.names[0]}", not the commercial banks' rates`);
  const table = periodTable(book1.rows(1), /^\d{4}-\d{2}$/, what);
  const rows = {};
  for (const [id, code] of Object.entries(RATES)) rows[id] = series(table, code, { from: FROM_MONTH, digits: 2, zeroIsMissing: true, min: 0.01, max: 60, what });
  checkNewest(rows, "dep12_lak", 120, what, nextMonth());
  checkKnown("rates", rows, what);
  return { source: "bol_rates", unit: "% per year", kind: "average of the commercial banks", loan: "up to 1 year, customers of class A", rows };
}

async function soundness() {
  const what = "BOL financial soundness";
  const table = periodTable((await book(/Financial Soundness/i, what)).rows(1), /^\d{4}-Q[1-4]$/, what);
  const opts = { from: "2015-Q1", scale: 100, digits: 2, what };
  const rows = {};
  for (const [id, key] of Object.entries(SOUND)) rows[id] = series(table, key, { ...opts, min: id === "roa" || id === "roe" ? -100 : 0, max: 200 });
  const now = new Date(Date.now() + 31 * 86400000);
  checkNewest(rows, "npl", 20, what, `${now.getUTCFullYear()}-Q${Math.floor(now.getUTCMonth() / 3) + 1}`);
  checkKnown("soundness", rows, what);
  // loans by sector in the newest quarter that has every sector; the shares must be the whole (100%)
  const sectors = {};
  for (const [id, key] of Object.entries(SECTORS)) sectors[id] = series(table, key, { ...opts, min: 0, max: 100 });
  const quarters = sectors.industry.map((r) => r[0]).reverse();
  const quarter = quarters.find((q) => Object.values(sectors).every((list) => list.some((r) => r[0] === q)));
  if (!quarter) throw new Error(`${what}: no quarter has the loans of every sector`);
  const shares = Object.fromEntries(Object.entries(sectors).map(([id, list]) => [id, list.find((r) => r[0] === quarter)[1]]));
  const total = Object.values(shares).reduce((a, b) => a + b, 0);
  if (Math.abs(total - 100) > 1) throw new Error(`${what}: the loans by sector of ${quarter} add up to ${round(total, 1)}%, not 100%`);
  return { source: "bol_fsi", unit: "%", rows, sectors: { quarter, shares } };
}

async function main() {
  const old = readJson(OUT_FILE, {});
  const newest = (p, id) => JSON.stringify(p.rows[id][p.rows[id].length - 1]);
  const { out, failed } = await runParts(old, [
    ["money", { source: "bol_dcs", unit: "LAK billion", at: "end of month", rows: {} }, money, (p) => `${Object.keys(p.rows).length} series, ${p.rows.m2.length} months, M2 newest: ${newest(p, "m2")}`],
    ["rates", { source: "bol_rates", unit: "% per year", kind: "average of the commercial banks", loan: "up to 1 year, customers of class A", rows: {} }, rates, (p) => `${Object.keys(p.rows).length} series, 12-month kip deposit newest: ${newest(p, "dep12_lak")}`],
    ["soundness", { source: "bol_fsi", unit: "%", rows: {}, sectors: null }, soundness, (p) => `${Object.keys(p.rows).length} series, bad loans newest: ${newest(p, "npl")}, sectors of ${p.sectors.quarter}`],
  ]);
  const text = partsText({ sources: stampedSources(SOURCES, old.sources, out) }, out);
  writeIfChanged(OUT_FILE, text);
  console.log(`\nDone: ${failed} of 3 parts failed. Wrote data/bol-money.json (${(text.length / 1024).toFixed(1)} KB)`);
  return { ok: failed < 3 };
}

if (require.main === module) main().then((r) => (process.exitCode = r.ok ? 0 : 1));

module.exports = { main, MONEY, RATES, SOUND, SECTORS };
