// Source #5: Phouvong gold shop prices, from the owner's Google Form (MANUAL, shop price).
// Entered by hand, or by the Gold page's "read from picture" button, which fills the same form.
// Google Form -> Google Sheet (shared "anyone with the link") -> CSV link in config/manual-sources.json.
//
// Prices (LAK per 1 Lao baht = 15 g):
//   sell / buy          = gold jewellery (ຄຳຮູບປະພັນ), Sheet columns C / D
//   bar_sell / bar_buy  = KPV gold bar (ຄຳແທ່ງ), questions added at the end of the form (found by header words)
// The Sheet is the full truth: the history is rebuilt from it every run (a fixed entry replaces the old one).
// Plausibility: a price more than 15% away from Lao Bullion Bank's price that day is skipped
// (catches typing / picture-reading mistakes and fake answers - the form link is public).

const path = require("path");
const { LATEST_DIR, replaceHistory, writeIfChanged, runSource, runIfMain } = require("./lib/common");
const { manualUrl } = require("./lib/manual");
const { readShopPrices, lbbByDay, lbbNear } = require("./lib/manual-sheet");

const META = {
  source: "gold-lao-manual",
  source_name: "Phouvong Jewelry (owner's form)",
  source_url: null,
  license: "Prices entered by the owner from the shop's public posts",
  kind: "shop",
};

const PRICES = {
  sell: { column: "sell", label: "jewellery sell" },
  buy: { column: "buy", label: "jewellery buy" },
  bar_sell: { column: "bar_sell", label: "bar sell" },
  bar_buy: { column: "bar_buy", label: "bar buy" },
};
const MIN_PRICE = 1000000; // a baht of gold is tens of millions of LAK
const MAX_PRICE = 1000000000;
const MAX_GAP = 0.15; // 15% from LBB

async function getRecords(url) {
  const lbb = lbbByDay();
  const check = (value, day) => {
    if (value < MIN_PRICE || value > MAX_PRICE) throw new Error(`looks wrong: ${value}`);
    const ref = lbbNear(lbb, day);
    if (ref && Math.abs(value / ref - 1) > MAX_GAP) {
      throw new Error(`${value} is more than ${MAX_GAP * 100}% away from Lao Bullion Bank (${Math.round(ref)})`);
    }
  };
  const { records, latest, skipped } = await readShopPrices(url, { source: META.source, unit: "LAK per baht (shop)", prices: PRICES, check });
  if (!records.length) throw new Error(skipped ? `No valid prices (${skipped} skipped)` : "The sheet has no entries yet");
  replaceHistory(META.source, records);
  return latest; // newest value of each price
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
