// Run every data source one after another. This is what GitHub Actions runs.
// Usage: node scripts/fetch-all.js
// A failing source is logged and marked stale; the other sources still run.

const SOURCES = [
  require("./fetch-bol"),
  require("./fetch-gold-world"),
  require("./fetch-silver-world"),
  require("./fetch-gold-thai"),
  require("./fetch-fx-market"),
  require("./fetch-fuel-thai"),
  require("./fetch-gold-lbb"),
  require("./fetch-bcel"),
  require("./fetch-bcel-deposit"),
  require("./fetch-lao-gold-manual"),
  require("./fetch-silver-manual"),
  require("./fetch-own-prices"),
];

async function main() {
  const results = [];

  // Question IDs of the owner's price form (the Gold page uses them to fill the form)
  try {
    await require("./fetch-form-entries").main();
  } catch (err) {
    console.error(`[FAIL] manual-form: ${err.message}`);
  }

  for (const src of SOURCES) {
    // runSource() already catches errors; this extra try/catch is a safety net.
    try {
      results.push(await src.run());
    } catch (err) {
      console.error(`[FAIL] unexpected error: ${err.message}`);
      results.push({ ok: false });
    }
  }

  // Daily rubber prices in the markets around Laos (its own file; asks its sources at most every 3 hours)
  try {
    await require("./fetch-rubber-daily").run();
  } catch (err) {
    console.error(`[FAIL] rubber-daily: ${err.message}`);
  }

  // Rebuild the small file the web page reads
  try {
    require("./build-summary").main();
  } catch (err) {
    console.error(`[FAIL] summary: ${err.message}`);
  }

  // Weekly long history for the "1 year" / "all" chart ranges
  try {
    require("./build-long").main();
  } catch (err) {
    console.error(`[FAIL] long: ${err.message}`);
  }

  // Kip direction hints + accuracy check (Phase 5)
  try {
    require("./update-forecast").main();
  } catch (err) {
    console.error(`[FAIL] forecast: ${err.message}`);
  }

  const okCount = results.filter((r) => r.ok).length;
  console.log(`\nDone: ${okCount} of ${results.length} sources OK`);

  // Exit with an error only if EVERY source failed (probably no internet).
  if (okCount === 0) process.exitCode = 1;
}

main();
