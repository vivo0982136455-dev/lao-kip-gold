// Source #5: Phouvong gold shop price, typed in by the owner (MANUAL, shop price).
// Google Form -> Google Sheet -> "Publish to web" as CSV -> this script.
// The link is set in config/manual-sources.json ("lao_gold_csv_url").
//
// Expected CSV columns (in this order, the header text does not matter):
//   0 Timestamp | 1 Date | 2 Sell price (LAK per baht) | 3 Buy price (LAK per baht, optional) | 4 Note
// The Sheet is the full truth: if you fix an entry, the history is rebuilt from the Sheet.
// Several entries on the same day -> the LAST one counts.

const path = require("path");
const {
  LATEST_DIR,
  fetchText,
  parseCsv,
  parseNumber,
  makeRecord,
  replaceHistory,
  writeIfChanged,
  runSource,
  runIfMain,
} = require("./lib/common");
const { manualUrl, parseSheetDate, parseSheetTimestamp } = require("./lib/manual");

const META = {
  source: "gold-lao-manual",
  source_name: "Phouvong Jewelry (manual entry)",
  source_url: null,
  license: "Prices typed in by the owner from the shop's public posts",
  kind: "shop",
};

// A Lao gold price per baht is tens of millions of LAK. Values far outside this are typing mistakes.
const MIN_PRICE = 1000000;
const MAX_PRICE = 1000000000;

function readPrice(raw, label) {
  const value = parseNumber(raw, label);
  if (value < MIN_PRICE || value > MAX_PRICE) throw new Error(`${label} looks wrong: ${raw}`);
  return value;
}

async function getRecords(url) {
  const rows = parseCsv(await fetchText(url));
  if (rows.length < 2) throw new Error("The sheet has no entries yet");

  const byDay = new Map(); // day -> records (last entry of the day wins)
  let skipped = 0;
  for (const [i, row] of rows.slice(1).entries()) {
    try {
      const day = parseSheetDate(row[1]) || parseSheetDate(row[0]);
      if (!day) throw new Error(`cannot read date "${row[1]}"`);
      const enteredAt = parseSheetTimestamp(row[0]) || new Date(`${day}T00:00:00+07:00`).toISOString();
      const base = { source: META.source, unit: "LAK per baht (shop)", fetched_at: enteredAt, source_date: day };
      const records = [makeRecord({ ...base, metric: "sell", value: readPrice(row[2], "sell price") })];
      if (String(row[3] || "").trim() !== "") {
        records.push(makeRecord({ ...base, metric: "buy", value: readPrice(row[3], "buy price") }));
      }
      byDay.set(day, records);
    } catch (err) {
      skipped++;
      console.warn(`       gold-lao-manual: skipped row ${i + 2}: ${err.message}`);
    }
  }
  if (byDay.size === 0) throw new Error(`No valid rows (${skipped} skipped)`);

  replaceHistory(META.source, [...byDay.values()].flat());
  const newestDay = [...byDay.keys()].sort().pop();
  return byDay.get(newestDay); // "latest" = the newest day
}

async function run() {
  const url = manualUrl("lao_gold_csv_url", "LAO_GOLD_CSV_URL");
  if (!url) {
    // Not set up yet: this is not an error. Write a small status file for the Settings page.
    const status = { ...META, configured: false, stale: false, last_success_at: null, last_error: null, records: [] };
    writeIfChanged(path.join(LATEST_DIR, `${META.source}.json`), JSON.stringify(status, null, 2) + "\n");
    console.log(`[SKIP] ${META.source}: no CSV link set in config/manual-sources.json`);
    return { source: META.source, ok: true, message: "not configured" };
  }
  return runSource({ ...META, configured: true }, () => getRecords(url));
}

runIfMain(module, run);

module.exports = { run };
