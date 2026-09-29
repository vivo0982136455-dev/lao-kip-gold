// Health check for the data files. Does not download anything.
// Usage: node scripts/check-data.js
// Checks every history file: no duplicate rows, all values > 0, sorted by time,
// every field present. Also shows the status of every latest file.

const fs = require("fs");
const path = require("path");
const { LATEST_DIR, HISTORY_DIR, readJson, recordKey } = require("./lib/common");

const FIELDS = ["source", "metric", "value", "unit", "fetched_at", "source_date"];
let problems = 0;

function problem(msg) {
  problems++;
  console.log(`  !! ${msg}`);
}

function listJson(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
}

console.log("=== History files ===");
for (const file of listJson(HISTORY_DIR)) {
  const rows = readJson(path.join(HISTORY_DIR, file), null);
  if (!Array.isArray(rows)) {
    problem(`${file}: not a valid JSON list`);
    continue;
  }
  const seen = new Set();
  let dupes = 0;
  rows.forEach((r, i) => {
    const key = recordKey(r);
    if (seen.has(key)) dupes++;
    seen.add(key);
    for (const f of FIELDS) if (r[f] === undefined || r[f] === null) problem(`${file} row ${i}: missing ${f}`);
    if (!(r.value > 0)) problem(`${file} row ${i}: value is not > 0`);
    if (i > 0 && rows[i - 1].source_date > r.source_date) problem(`${file} row ${i}: not sorted by time`);
  });
  if (dupes) problem(`${file}: ${dupes} duplicate rows`);

  const first = rows[0] ? rows[0].source_date : "-";
  const last = rows.length ? rows[rows.length - 1].source_date : "-";
  console.log(`${file.padEnd(18)} ${String(rows.length).padStart(6)} rows   ${first}  ->  ${last}   duplicates: ${dupes}`);
}

console.log("\n=== Latest files ===");
for (const file of listJson(LATEST_DIR)) {
  const data = readJson(path.join(LATEST_DIR, file), null);
  if (!data) {
    problem(`${file}: not valid JSON`);
    continue;
  }
  const status = data.stale ? "STALE" : "ok";
  const error = data.last_error ? `  error: ${data.last_error.message}` : "";
  console.log(`${file.padEnd(18)} ${status.padEnd(6)} ${String((data.records || []).length).padStart(3)} values${error}`);
}

console.log(problems ? `\n${problems} problem(s) found.` : "\nAll checks passed.");
if (problems) process.exitCode = 1;
