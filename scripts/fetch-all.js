// Run every data source one after another. This is what GitHub Actions runs.
// Usage: node scripts/fetch-all.js
// A failing source is logged and marked stale; the other sources still run.

const SOURCES = [
  require("./fetch-bol"),
  require("./fetch-gold-world"),
  require("./fetch-gold-thai"),
  require("./fetch-fx-market"),
  require("./fetch-gold-lbb"),
  require("./fetch-bcel"),
  require("./fetch-lao-gold-manual"),
];

async function main() {
  const results = [];
  for (const src of SOURCES) {
    // runSource() already catches errors; this extra try/catch is a safety net.
    try {
      results.push(await src.run());
    } catch (err) {
      console.error(`[FAIL] unexpected error: ${err.message}`);
      results.push({ ok: false });
    }
  }

  // Rebuild the small file the web page reads
  try {
    require("./build-summary").main();
  } catch (err) {
    console.error(`[FAIL] summary: ${err.message}`);
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
