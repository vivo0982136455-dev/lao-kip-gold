// ONE-TIME download of old Lao Bullion Bank gold prices (since Aug 2025) into data/history/gold-lbb.json.
// Safe to run again: rows that already exist are skipped.
// Usage: node scripts/backfill-lbb.js
//
// Real response (checked 2026-09-30), about 600 KB:
//   { "success": true, "data": { "total_records": 1563, "prices": [
//     { "date": "Sep 30, 2026, 01:23 PM", "timestamp": 1790774607000, "buy_rate": 3060600, "sell_rate": 3087200, ... } ] } }
// The "timestamp" is Vientiane wall-clock time written as if it were UTC (see fetch-gold-lbb.js),
// so 7 hours are subtracted to get real UTC.

const { fetchJson, appendHistory } = require("./lib/common");
const { toRecords } = require("./fetch-gold-lbb");

const URL = process.env.LBB_BACKFILL_URL || "https://laobullionbank.com/api/bullionmarkets/rategoldall";
const SEVEN_HOURS_MS = 7 * 3600000;

async function main() {
  console.log("Downloading LBB price history (about 600 KB)...");
  const res = await fetchJson(URL);
  const prices = res && res.data && res.data.prices;
  if (res.success !== true || !Array.isArray(prices)) throw new Error("Unexpected LBB history response");

  const fetchedAt = new Date().toISOString();
  const records = [];
  let skipped = 0;
  for (const p of prices) {
    try {
      if (!Number.isFinite(p.timestamp)) throw new Error("no timestamp");
      // Drop the seconds: the live price (fetch-gold-lbb.js) only has minutes,
      // so both must give the same time or the same update would be stored twice
      const ms = p.timestamp - SEVEN_HOURS_MS;
      const sourceDate = new Date(ms - (ms % 60000)).toISOString();
      records.push(...toRecords(p.buy_rate, p.sell_rate, sourceDate, fetchedAt));
    } catch (err) {
      skipped++;
      console.warn(`  skipped ${p.date}: ${err.message}`);
    }
  }

  const added = appendHistory("gold-lbb", records);
  console.log(`Read ${prices.length} prices (${records.length} values), skipped ${skipped} bad ones.`);
  console.log(`Added ${added} new rows to data/history/gold-lbb.json (duplicates skipped).`);
}

main().catch((err) => {
  console.error(`Backfill failed: ${err.message}`);
  process.exitCode = 1;
});
