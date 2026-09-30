// Shared helpers used by every fetch script.
// Every data source uses the same record shape:
//   { source, metric, value, unit, fetched_at, source_date }
//
// Files:
//   data/latest/<source>.json   -> newest values + status (stale or not)
//   data/history/<source>.json  -> every value ever seen, one record per line

const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.join(__dirname, "..", "..");
// DATA_DIR can be changed for tests: DATA_DIR=/some/folder node scripts/...
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT_DIR, "data");
const LATEST_DIR = path.join(DATA_DIR, "latest");
const HISTORY_DIR = path.join(DATA_DIR, "history");

const TIMEOUT_MS = 20000; // give up on a request after 20 seconds
const RETRY_WAIT_MS = 3000; // wait 3 seconds before the one retry

// ---------- Network ----------

// Download a URL as text. Tries twice before giving up.
// A value that is not http(s) is read as a local file (used for testing with sample files).
// extraHeaders: e.g. { Accept: "application/json" } (the IMF API answers XML without it)
// timeoutMs: raise it for big files (the WFP price file is ~7 MB)
async function fetchText(url, extraHeaders = {}, timeoutMs = TIMEOUT_MS) {
  if (!/^https?:\/\//i.test(url)) {
    const file = path.isAbsolute(url) ? url : path.join(ROOT_DIR, url);
    try {
      return fs.readFileSync(file, "utf8");
    } catch (err) {
      throw new Error(`Cannot read local file ${file}: ${err.message}`);
    }
  }
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "lao-kip-gold-dashboard (personal, non-commercial)", ...extraHeaders },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
      return await res.text();
    } catch (err) {
      lastError = err;
      if (attempt === 1) await new Promise((r) => setTimeout(r, RETRY_WAIT_MS));
    }
  }
  throw new Error(`Download failed (${url}): ${lastError.message}`);
}

// Download a URL and parse it as JSON.
async function fetchJson(url, extraHeaders = {}) {
  const text = await fetchText(url, { Accept: "application/json", ...extraHeaders });
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Not valid JSON from ${url}: ${text.slice(0, 100)}`);
  }
}

// ---------- Validation ----------

// Turn "64,490.64" or 64490.64 into a number. Throws if not a number > 0.
function parseNumber(raw, label) {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/,/g, "").trim());
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Bad value for ${label}: ${JSON.stringify(raw)}`);
  }
  return n;
}

// Like parseNumber, but zero and negative numbers are allowed (e.g. growth -2.5%).
function parseAnyNumber(raw, label) {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/,/g, "").trim());
  if (raw === null || raw === undefined || String(raw).trim() === "" || !Number.isFinite(n)) {
    throw new Error(`Bad value for ${label}: ${JSON.stringify(raw)}`);
  }
  return n;
}

// Read CSV text into a list of rows (each row = list of cells).
// Handles "quoted, cells" and "" inside quotes, like Google Sheets exports.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  text = text.replace(/^\uFEFF/, ""); // remove BOM if present
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// Check a date/time string can be read, and return it as ISO UTC ("2026-09-29T10:53:08.000Z").
function toIsoUtc(raw, label) {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new Error(`Bad date for ${label}: ${JSON.stringify(raw)}`);
  return d.toISOString();
}

// Build one record and check that all fields are present.
function makeRecord({ source, metric, value, unit, fetched_at, source_date }) {
  const record = { source, metric, value, unit, fetched_at, source_date };
  for (const [key, val] of Object.entries(record)) {
    if (val === undefined || val === null || val === "") {
      throw new Error(`Record for ${source}/${metric} is missing "${key}"`);
    }
  }
  parseNumber(value, `${source}/${metric}`);
  return record;
}

// ---------- Files ----------

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

// Write text only if it is different from what is already on disk.
// This keeps git quiet when nothing really changed. Returns true if written.
function writeIfChanged(file, text) {
  let old = null;
  try {
    old = fs.readFileSync(file, "utf8");
  } catch {
    /* file does not exist yet */
  }
  if (old === text) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return true;
}

// History is a JSON array written with one record per line (small git diffs).
function historyToText(records) {
  if (records.length === 0) return "[]\n";
  return "[\n" + records.map((r) => JSON.stringify(r)).join(",\n") + "\n]\n";
}

// The key that makes a record unique: same metric at the same source time = duplicate.
function recordKey(r) {
  return `${r.metric}|${r.source_date}`;
}

// Add new records to data/history/<source>.json, skipping duplicates.
// overwrite = true: a record with the same key REPLACES the stored one when its value changed
// (used by BCEL, which can publish a 2nd "round" for the same day - the newest round wins).
// Returns how many records were really added (or replaced).
function appendHistory(source, newRecords, overwrite = false) {
  const file = path.join(HISTORY_DIR, `${source}.json`);
  const history = readJson(file, []);
  const index = new Map(history.map((r, i) => [recordKey(r), i]));
  let added = 0;
  for (const r of newRecords) {
    const key = recordKey(r);
    if (index.has(key)) {
      const i = index.get(key);
      if (overwrite && history[i].value !== r.value) {
        history[i] = r;
        added++;
      }
      continue;
    }
    index.set(key, history.length);
    history.push(r);
    added++;
  }
  // Oldest first; same time -> sort by metric name so the order is stable
  history.sort((a, b) =>
    a.source_date === b.source_date
      ? a.metric.localeCompare(b.metric)
      : a.source_date < b.source_date ? -1 : 1
  );
  writeIfChanged(file, historyToText(history));
  return added;
}

// Replace the WHOLE history of a source (used for manual sources, where the
// Google Sheet is the full truth and a corrected entry must replace the old one).
function replaceHistory(source, records) {
  const file = path.join(HISTORY_DIR, `${source}.json`);
  const sorted = [...records].sort((a, b) =>
    a.source_date === b.source_date ? a.metric.localeCompare(b.metric) : a.source_date < b.source_date ? -1 : 1
  );
  writeIfChanged(file, historyToText(sorted));
}

// Compare two lists of records, ignoring fetched_at (that changes every run).
function sameValues(a, b) {
  const strip = (list) =>
    JSON.stringify((list || []).map((r) => [r.metric, r.value, r.unit, r.source_date]));
  return strip(a) === strip(b);
}

// Save a successful fetch: update latest (only if values changed) and history.
function saveSuccess(meta, records) {
  const file = path.join(LATEST_DIR, `${meta.source}.json`);
  const old = readJson(file, null);

  let latest;
  if (old && !old.stale && sameValues(old.records, records)) {
    latest = old; // nothing new -> keep the file exactly as it is
  } else {
    // Keep the old fetched_at for values that did not change
    const keepOld = old && sameValues(old.records, records);
    latest = {
      ...meta,
      stale: false,
      last_success_at: keepOld ? old.last_success_at : new Date().toISOString(),
      last_error: null,
      records: keepOld ? old.records : records,
    };
  }
  writeIfChanged(file, JSON.stringify(latest, null, 2) + "\n");
  return appendHistory(meta.source, records, meta.same_day_updates === true);
}

// Save a failed fetch: keep the old values, mark them stale, remember the error.
function saveFailure(meta, error) {
  const file = path.join(LATEST_DIR, `${meta.source}.json`);
  const old = readJson(file, null);

  // Same error as last time -> do not rewrite (avoids a commit every 30 minutes)
  if (old && old.stale && old.last_error && old.last_error.message === error.message) return;

  const latest = {
    ...meta,
    stale: true,
    last_success_at: old ? old.last_success_at : null,
    last_error: { message: error.message, at: new Date().toISOString() },
    records: old ? old.records : [],
  };
  writeIfChanged(file, JSON.stringify(latest, null, 2) + "\n");
}

// Run one source safely: fetch -> save. Never throws, so one broken source
// cannot stop the others. Returns { source, ok, message }.
async function runSource(meta, getRecords) {
  try {
    const fetchedAt = new Date().toISOString();
    const records = await getRecords(fetchedAt);
    if (!records.length) throw new Error("No records returned");
    const added = saveSuccess(meta, records);
    const message = `${records.length} values, ${added} new in history`;
    console.log(`[OK]   ${meta.source}: ${message}`);
    return { source: meta.source, ok: true, message };
  } catch (err) {
    console.error(`[FAIL] ${meta.source}: ${err.message}`);
    try {
      saveFailure(meta, err);
    } catch (saveErr) {
      console.error(`[FAIL] ${meta.source}: could not save error status: ${saveErr.message}`);
    }
    return { source: meta.source, ok: false, message: err.message };
  }
}

// Lets each fetch script also run on its own: node scripts/fetch-bol.js
function runIfMain(mod, run) {
  if (require.main === mod) {
    run().then((result) => {
      process.exitCode = result.ok ? 0 : 1;
    });
  }
}

module.exports = {
  ROOT_DIR,
  DATA_DIR,
  LATEST_DIR,
  HISTORY_DIR,
  fetchText,
  fetchJson,
  parseNumber,
  parseAnyNumber,
  parseCsv,
  toIsoUtc,
  makeRecord,
  readJson,
  writeIfChanged,
  appendHistory,
  replaceHistory,
  recordKey,
  runSource,
  runIfMain,
};
