// Source #13: PML (Precious Metals Laos) silver bar 99.99% price, per 1 kg (MANUAL, shop price).
// Same Google Form / Sheet as the Phouvong gold prices: two questions at the end of the form
// ("เงิน ... ราคาขาย" / "เงิน ... ราคารับซื้อ"), found by header words. Entered by hand or with the
// Gold page's "read from picture" button. Until those questions exist, the source is "not set up".

const path = require("path");
const { LATEST_DIR, replaceHistory, writeIfChanged, runSource, runIfMain } = require("./lib/common");
const { manualUrl } = require("./lib/manual");
const { readShopPrices, loadSheet, findColumns } = require("./lib/manual-sheet");

const META = {
  source: "silver-lao-manual",
  source_name: "PML Precious Metals Laos - silver 1 kg (owner's form)",
  source_url: null,
  license: "Prices entered by the owner from the shop's public posts",
  kind: "shop",
};

const PRICES = {
  sell: { column: "silver_sell", label: "silver sell" },
  buy: { column: "silver_buy", label: "silver buy" },
};
// 1 kg of silver: about 50 million LAK in 2026. Wide band, only catches missing / extra digits.
const MIN_PRICE = 5000000;
const MAX_PRICE = 500000000;

function writeStatus(extra) {
  const status = { ...META, stale: false, last_success_at: null, last_error: null, records: [], ...extra };
  writeIfChanged(path.join(LATEST_DIR, `${META.source}.json`), JSON.stringify(status, null, 2) + "\n");
}

async function run() {
  const url = manualUrl("lao_gold_csv_url", "LAO_GOLD_CSV_URL");
  if (!url) {
    writeStatus({ configured: false });
    return { source: META.source, ok: true, message: "not configured" };
  }
  // No silver questions in the form yet -> "not set up" (not an error)
  try {
    const cols = findColumns((await loadSheet(url))[0] || []);
    if (cols.silver_sell < 0 && cols.silver_buy < 0) {
      writeStatus({ configured: false });
      console.log(`[SKIP] ${META.source}: no silver questions in the form yet`);
      return { source: META.source, ok: true, message: "not configured" };
    }
  } catch {
    /* download problem: runSource below records the error */
  }
  return runSource({ ...META, configured: true }, async () => {
    const check = (value) => {
      if (value < MIN_PRICE || value > MAX_PRICE) throw new Error(`looks wrong: ${value}`);
    };
    const { records, latest, skipped } = await readShopPrices(url, { source: META.source, unit: "LAK per kg (shop)", prices: PRICES, check });
    if (!records.length) throw new Error(skipped ? `No valid prices (${skipped} skipped)` : "No silver prices entered yet");
    replaceHistory(META.source, records);
    return latest;
  });
}

runIfMain(module, run);

module.exports = { run };
