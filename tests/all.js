// Run every local browser test, one after the other (about 25 minutes). Usage: node tests/all.js [quick]
// quick = the short screen check (22 screens) instead of all 176.
// Every test has a time limit: a browser that hangs (seen once, 2026-10-02) fails the test instead of blocking the
// run for ever.
const { spawnSync } = require("child_process");
const path = require("path");

const quick = process.argv.includes("quick");
// [file, arguments, limit in minutes]
const TESTS = [["screens.js", quick ? ["quick"] : [], quick ? 8 : 40], ["states.js", [], 30], ["menu.js", [], 6], ["install.js", [], 10], ["offline-label.js", [], 8]];
const failed = [];
for (const [file, args, minutes] of TESTS) {
  console.log("\n=== " + file + " " + args.join(" ") + " ===");
  const r = spawnSync(process.execPath, [path.join(__dirname, file), ...args], { stdio: "inherit", timeout: minutes * 60000 });
  if (r.error && r.error.code === "ETIMEDOUT") console.log(`\nSTOPPED: ${file} did not finish in ${minutes} minutes (a hanging browser?) - run it again on its own`);
  if (r.status !== 0) failed.push(file);
}
console.log(failed.length ? "\nFAILED: " + failed.join(", ") : "\nAll browser tests passed.");
process.exit(failed.length ? 1 : 0);
