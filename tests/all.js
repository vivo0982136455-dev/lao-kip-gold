// Run every local test, one after the other (about 25 minutes). Usage: node tests/all.js [quick]
// quick = the short screen check (23 screens) instead of all 184.
// First the tests without a browser (a few seconds): the rules and formulas (calc.js), the checks on answers of
// the price form, run on a sample sheet (own-prices.js), the two routes of the official exchange rate, run on
// saved pages (bol-route.js), and the data checker, run on a copy of the data that is damaged on purpose
// (data-check.js), and the download helper against a server that never finishes its error page (download.js).
// Then the browser tests.
// Every test has a time limit: a browser that hangs (seen once, 2026-10-02) fails the test instead of blocking the
// run for ever.
const { spawnSync } = require("child_process");
const path = require("path");

const quick = process.argv.includes("quick");
// [file, arguments, limit in minutes]
const TESTS = [["calc.js", [], 2], ["own-prices.js", [], 2], ["bol-route.js", [], 3], ["data-check.js", [], 3], ["download.js", [], 2], ["screens.js", quick ? ["quick"] : [], quick ? 8 : 40], ["states.js", [], 30], ["menu.js", [], 6], ["install.js", [], 10], ["offline-label.js", [], 8]];
const failed = [];
for (const [file, args, minutes] of TESTS) {
  console.log("\n=== " + file + " " + args.join(" ") + " ===");
  const r = spawnSync(process.execPath, [path.join(__dirname, file), ...args], { stdio: "inherit", timeout: minutes * 60000 });
  if (r.error && r.error.code === "ETIMEDOUT") console.log(`\nSTOPPED: ${file} did not finish in ${minutes} minutes (a hanging browser?) - run it again on its own`);
  if (r.status !== 0) failed.push(file);
}
console.log(failed.length ? "\nFAILED: " + failed.join(", ") : "\nAll tests passed.");
process.exit(failed.length ? 1 : 0);
