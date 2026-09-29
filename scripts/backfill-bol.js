// Source #1b: ONE-TIME download of old BOL rates (since 2021) into data/history/bol.json.
// Safe to run again: rows that already exist are skipped.
// Usage: node scripts/backfill-bol.js
//
// Real file (checked 2026-09-29), CSV from Hugging Face dataset AllRates/central-bank-exchange-rates:
//   date,base,quote,type,value
//   2021-01-04,AUD,LAK,buy,7020

const { fetchText, makeRecord, appendHistory } = require("./lib/common");
const { CURRENCIES, TYPES } = require("./fetch-bol");

const URL =
  process.env.BOL_BACKFILL_URL ||
  "https://huggingface.co/datasets/AllRates/central-bank-exchange-rates/resolve/main/rates/bol.csv";

async function main() {
  console.log("Downloading BOL history CSV (about 1.3 MB)...");
  const text = await fetchText(URL); // fetch() follows the Hugging Face redirect by itself
  const lines = text.trim().split(/\r?\n/);

  if (lines[0].trim() !== "date,base,quote,type,value") {
    throw new Error(`Unexpected CSV header: "${lines[0]}"`);
  }

  const fetchedAt = new Date().toISOString();
  const records = [];
  let skipped = 0;

  for (const line of lines.slice(1)) {
    const [date, base, quote, type, value] = line.split(",");
    if (quote !== "LAK" || !CURRENCIES.includes(base) || !TYPES.includes(type)) continue;
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`bad date ${date}`);
      records.push(
        makeRecord({
          source: "bol",
          metric: `${base}_LAK_${type}`,
          value: Number(value),
          unit: `LAK per ${base}`,
          fetched_at: fetchedAt,
          source_date: date,
        })
      );
    } catch (err) {
      skipped++;
      console.warn(`  skipped row "${line}": ${err.message}`);
    }
  }

  const added = appendHistory("bol", records);
  console.log(`Read ${records.length} valid rows, skipped ${skipped} bad rows.`);
  console.log(`Added ${added} new rows to data/history/bol.json (duplicates skipped).`);
}

main().catch((err) => {
  console.error(`Backfill failed: ${err.message}`);
  process.exitCode = 1;
});
