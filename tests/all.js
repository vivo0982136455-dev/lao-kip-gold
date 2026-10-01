// Run every local browser test, one after the other (about 20 minutes). Usage: node tests/all.js [quick]
// quick = the short screen check (21 screens) instead of all 168.
const { spawnSync } = require("child_process");
const path = require("path");

const quick = process.argv.includes("quick");
const TESTS = [["screens.js", quick ? ["quick"] : []], ["states.js", []], ["menu.js", []], ["install.js", []], ["offline-label.js", []]];
const failed = [];
for (const [file, args] of TESTS) {
  console.log("\n=== " + file + " " + args.join(" ") + " ===");
  const r = spawnSync(process.execPath, [path.join(__dirname, file), ...args], { stdio: "inherit" });
  if (r.status !== 0) failed.push(file);
}
console.log(failed.length ? "\nFAILED: " + failed.join(", ") : "\nAll browser tests passed.");
process.exit(failed.length ? 1 : 0);
