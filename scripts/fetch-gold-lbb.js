// Source #9: Lao Bullion Bank (LBB) gold bar price in Laos (BANK).
// Real Lao price, automatic. Uses the JSON link that the LBB website itself reads
// (not a documented public API - it may change; then old values are kept and marked stale).
//
// Real response (checked 2026-09-30):
//   { "success": true, "data": { "date": "Sep 30, 2026, 01:23 PM", "currency": "LBI",
//     "buy_rate": "LBI 3,060,600.00", "sell_rate": "LBI 3,087,200.00", "mid_rate": "LBI 3,060,600.00" } }
// Notes: prices are LAK per 1 GRAM ("LBI" is only LBB's label). LBB sells 1 / 7.5 / 15 / 30 g bars.
//        TIME ZONE TRAP: the time is VIENTIANE time (UTC+7) even though LBB's own "timestamp" field
//        calls it UTC - their updates fall at 07:00-15:00 Mon-Fri, and the newest one was "in the future"
//        when read as UTC. So we read it as +07:00.

const { fetchJson, parseNumber, makeRecord, runSource, runIfMain } = require("./lib/common");

const URL = process.env.GOLD_LBB_URL || "https://laobullionbank.com/api/bullionmarkets/rategold";

const META = {
  source: "gold-lbb",
  source_name: "Lao Bullion Bank (LBB)",
  source_url: "https://www.laobullionbank.com/gold-market",
  license: "Public price shown on the LBB website",
  kind: "bank",
};

// A sane range for LAK per gram - catches a wrong unit or a broken value
const MIN_PER_GRAM = 500000;
const MAX_PER_GRAM = 50000000;

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

// "Sep 30, 2026, 01:23 PM" (Vientiane time) -> "2026-09-30T06:23:00.000Z"
function lbbDateToIso(text) {
  const m = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4}), (\d{1,2}):(\d{2}) (AM|PM)$/.exec(String(text || "").trim());
  if (!m || !MONTHS[m[1]]) throw new Error(`Cannot read LBB date: "${text}"`);
  let hour = Number(m[4]) % 12;
  if (m[6] === "PM") hour += 12;
  const ms = Date.UTC(Number(m[3]), MONTHS[m[1]] - 1, Number(m[2]), hour - 7, Number(m[5]));

  // Sanity check: not in the future and not older than 30 days
  const ageDays = (Date.now() - ms) / 86400000;
  if (Number.isNaN(ms) || ageDays < -0.1 || ageDays > 30) throw new Error(`LBB date looks wrong: "${text}"`);
  return new Date(ms).toISOString();
}

// "LBI 3,087,200.00" or 3087200 -> 3087200, checked against the sane range
function readPerGram(raw, label) {
  const value = parseNumber(String(raw ?? "").replace(/^[A-Z]+\s*/, ""), label);
  if (value < MIN_PER_GRAM || value > MAX_PER_GRAM) throw new Error(`LBB ${label} out of range: ${value}`);
  return value;
}

// Turn buy/sell per gram into the two stored records (used by this script and the backfill)
function toRecords(buyRaw, sellRaw, sourceDate, fetchedAt) {
  const buy = readPerGram(buyRaw, "buy");
  const sell = readPerGram(sellRaw, "sell");
  if (sell < buy) throw new Error(`LBB sell (${sell}) is below buy (${buy})`);
  return [
    ["buy_g", buy],
    ["sell_g", sell],
  ].map(([metric, value]) =>
    makeRecord({ source: "gold-lbb", metric, value, unit: "LAK per gram", fetched_at: fetchedAt, source_date: sourceDate })
  );
}

async function getRecords(fetchedAt) {
  const res = await fetchJson(URL);
  if (res.success !== true || !res.data) throw new Error(`LBB answered success=${res.success}`);
  return toRecords(res.data.buy_rate, res.data.sell_rate, lbbDateToIso(res.data.date), fetchedAt);
}

const run = () => runSource(META, getRecords);
runIfMain(module, run);

module.exports = { run, toRecords, META };
