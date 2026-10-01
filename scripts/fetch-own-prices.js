// Source #22: the owner's OWN prices, from the same Google Form / Sheet as the shop prices (MANUAL):
//   - rubber: the price his buyer really pays (LAK per kg), with the kind of rubber and the place
//   - land:   prices he sees or is offered (total price in LAK and the area in square metres), with the place
// No source publishes Lao rubber prices by province or real land sale prices (re-checked 2026-10-01), so these
// entries are the only local numbers. Entered on the page (Economy > Rubber / Land) or in the form itself.
//
// Sheet columns (checked 2026-10-01; found by header words, so their position does not matter):
//   "ยาง ราคา (กีบ ต่อ 1 กิโล)" | "ยาง ชนิด" | "ยาง สถานที่" | "ที่ดิน สถานที่" | "ที่ดิน ราคารวม (กีบ)" | "ที่ดิน เนื้อที่ (ตารางเมตร)"
// A place written by the page looks like "Louangnamtha | ເມືອງສິງ": province (same spelling as "provinces" in
// i18n/*.json), then the district / village typed by the owner. Text typed straight into the form is kept as it is.
//
// Writes:
//   data/own-prices.json               every entry, newest first (text fields included) - read by the Economy page
//   data/latest|history/rubber-lao-manual.json   newest price of each kind of rubber + one value per day (for charts)
// The Sheet is the full truth: both files are rebuilt from it on every run.

const path = require("path");
const { DATA_DIR, LATEST_DIR, parseNumber, makeRecord, readJson, replaceHistory, writeIfChanged, runSource, runIfMain } = require("./lib/common");
const { manualUrl, parseSheetDate, parseSheetTimestamp } = require("./lib/manual");
const { loadSheet, findColumns } = require("./lib/manual-sheet");

const OUT_FILE = path.join(DATA_DIR, "own-prices.json");
const META = {
  source: "rubber-lao-manual",
  source_name: "Rubber price the owner was paid (owner's form)",
  source_url: null,
  license: "Prices entered by the owner",
  kind: "shop",
};

// Plausible values only: catches a missing / extra digit and fake answers (the form link is public)
const RUBBER_MIN = 1000; // LAK per kg
const RUBBER_MAX = 200000;
const LAND_AREA_MIN = 1; // square metres
const LAND_AREA_MAX = 100000000; // 10,000 hectares
const LAND_SQM_MIN = 50; // LAK per square metre (the lowest official assessed price in Vientiane is 1,000)
const LAND_SQM_MAX = 1000000000;
const TEXT_MAX = 80;

const PROVINCES = [
  "Vientiane Capital", "Louangphabang", "Phongsaly", "Louangnamtha", "Bokeo", "Oudomxai", "Houaphan", "Xaignabouly", "Xiengkhouang",
  "Vientiane", "Xaisomboun", "Bolikhamxai", "Khammouan", "Savannakhet", "Salavan", "Sekong", "Champasack", "Attapeu",
];

const clean = (text) => String(text || "").replace(/\s+/g, " ").trim().slice(0, TEXT_MAX);

// "Louangnamtha | ເມືອງສິງ" -> { province: "Louangnamtha", place: "ເມືອງສິງ" }; anything else -> { province: null, place: text }
function splitPlace(text) {
  const s = clean(text);
  const i = s.indexOf("|");
  if (i > 0) {
    const head = s.slice(0, i).trim().toLowerCase();
    const province = PROVINCES.find((p) => p.toLowerCase() === head);
    if (province) return { province, place: s.slice(i + 1).trim() };
  }
  return { province: null, place: s };
}

// Kind of rubber from the words typed (Thai, Lao or English). Checked in this order.
function rubberType(text) {
  const s = clean(text).toLowerCase();
  if (/ก้อน|ถ้วย|ກ້ອນ|ຖ້ວຍ|cup|lump/.test(s)) return "cuplump";
  if (/น้ำยาง|ນ້ຳຢາງ|ນໍ້າຢາງ|latex/.test(s)) return "latex";
  if (/รมควัน|ຮົມຄວັນ|smoked|rss/.test(s)) return "rss";
  if (/แผ่น|ແຜ່ນ|sheet/.test(s)) return "sheet";
  return "other";
}

// One row of the sheet -> its day and the time it was entered (null when the date cannot be read)
function rowTime(row, cols) {
  const day = parseSheetDate(row[cols.date]) || parseSheetDate(row[cols.timestamp]);
  if (!day) return null;
  return { day, at: parseSheetTimestamp(row[cols.timestamp]) || new Date(`${day}T00:00:00+07:00`).toISOString() };
}

function readRubber(rows, cols) {
  const entries = [];
  let skipped = 0;
  if (cols.rubber_price < 0) return { configured: false, entries, skipped };
  rows.slice(1).forEach((row, i) => {
    const raw = String(row[cols.rubber_price] || "").trim();
    if (raw === "") return;
    try {
      const time = rowTime(row, cols);
      if (!time) throw new Error(`cannot read date "${row[cols.date]}"`);
      const price = parseNumber(raw, "rubber price");
      if (price < RUBBER_MIN || price > RUBBER_MAX) throw new Error(`price looks wrong: ${price}`);
      const typeText = cols.rubber_type >= 0 ? clean(row[cols.rubber_type]) : "";
      entries.push({ date: time.day, type: rubberType(typeText), type_text: typeText, price, ...splitPlace(cols.rubber_place >= 0 ? row[cols.rubber_place] : ""), at: time.at });
    } catch (err) {
      skipped++;
      console.warn(`       own rubber: skipped row ${i + 2}: ${err.message}`);
    }
  });
  return { configured: true, entries: newestFirst(entries), skipped };
}

function readLand(rows, cols) {
  const entries = [];
  let skipped = 0;
  if (cols.land_total < 0 || cols.land_area < 0) return { configured: false, entries, skipped };
  rows.slice(1).forEach((row, i) => {
    const rawTotal = String(row[cols.land_total] || "").trim();
    const rawArea = String(row[cols.land_area] || "").trim();
    if (rawTotal === "" && rawArea === "") return;
    try {
      const time = rowTime(row, cols);
      if (!time) throw new Error(`cannot read date "${row[cols.date]}"`);
      const total = parseNumber(rawTotal, "land price");
      const area = parseNumber(rawArea, "land area");
      if (area < LAND_AREA_MIN || area > LAND_AREA_MAX) throw new Error(`area looks wrong: ${area}`);
      const perSqm = Math.round(total / area);
      if (perSqm < LAND_SQM_MIN || perSqm > LAND_SQM_MAX) throw new Error(`price per square metre looks wrong: ${perSqm}`);
      entries.push({ date: time.day, ...splitPlace(cols.land_place >= 0 ? row[cols.land_place] : ""), total, area, per_sqm: perSqm, at: time.at });
    } catch (err) {
      skipped++;
      console.warn(`       own land: skipped row ${i + 2}: ${err.message}`);
    }
  });
  return { configured: true, entries: newestFirst(entries), skipped };
}

const newestFirst = (list) => list.sort((a, b) => (a.date === b.date ? (a.at < b.at ? 1 : -1) : a.date < b.date ? 1 : -1));

// One entry per line: small git diffs. updated_at only moves when an entry changed.
function writeOwn({ stale, rubber, land }) {
  const norm = (p) => ({ configured: p.configured, skipped: p.skipped, entries: p.entries }); // same key order as the file
  const body = { stale, rubber: norm(rubber), land: norm(land) };
  const old = readJson(OUT_FILE, null);
  const { updated_at: oldTime, ...oldBody } = old || {};
  const same = old && JSON.stringify(oldBody) === JSON.stringify(body);
  const out = { updated_at: same ? oldTime : new Date().toISOString(), ...body };
  const list = (entries) => (entries.length ? "[\n" + entries.map((e) => "      " + JSON.stringify(e)).join(",\n") + "\n    ]" : "[]");
  const part = (p) => `{\n    "configured": ${p.configured},\n    "skipped": ${p.skipped},\n    "entries": ${list(p.entries)}\n  }`;
  const text = `{\n  "updated_at": ${JSON.stringify(out.updated_at)},\n  "stale": ${out.stale},\n  "rubber": ${part(out.rubber)},\n  "land": ${part(out.land)}\n}\n`;
  JSON.parse(text); // safety: must be valid JSON
  writeIfChanged(OUT_FILE, text);
}

function writeStatus(extra) {
  const status = { ...META, stale: false, last_success_at: null, last_error: null, records: [], ...extra };
  writeIfChanged(path.join(LATEST_DIR, `${META.source}.json`), JSON.stringify(status, null, 2) + "\n");
}

async function run() {
  const url = manualUrl("lao_gold_csv_url", "LAO_GOLD_CSV_URL");
  const none = { configured: false, entries: [], skipped: 0 };
  if (!url) {
    writeOwn({ stale: false, rubber: none, land: none });
    writeStatus({ configured: false });
    console.log(`[SKIP] own-prices: no CSV link set in config/manual-sources.json`);
    return { source: META.source, ok: true, message: "not configured" };
  }

  let rows;
  try {
    rows = await loadSheet(url);
    if (rows.length < 1) throw new Error("The sheet is empty");
  } catch (err) {
    // Download problem: keep what we had, and say so
    const old = readJson(OUT_FILE, null);
    if (old) writeOwn({ stale: true, rubber: old.rubber || none, land: old.land || none });
    return runSource({ ...META, configured: true }, async () => {
      throw err;
    });
  }

  const cols = findColumns(rows[0]);
  const rubber = readRubber(rows, cols);
  const land = readLand(rows, cols);
  writeOwn({ stale: false, rubber, land });
  console.log(`[OK]   own-prices: rubber ${rubber.configured ? rubber.entries.length + " entries" : "no questions"}${rubber.skipped ? ` (${rubber.skipped} skipped)` : ""}, land ${land.configured ? land.entries.length + " entries" : "no questions"}${land.skipped ? ` (${land.skipped} skipped)` : ""}`);

  // Standard records for rubber: newest value of each kind + one value per day and kind (charts, Settings page)
  if (!rubber.configured) {
    writeStatus({ configured: false });
    return { source: META.source, ok: true, message: "not configured" };
  }
  if (!rubber.entries.length) {
    replaceHistory(META.source, []);
    writeStatus({ configured: true, empty: true }); // questions exist, nothing entered yet: not an error
    return { source: META.source, ok: true, message: "no entries yet" };
  }
  return runSource({ ...META, configured: true }, async () => {
    const byKey = new Map(); // "day|type" -> record (entries are newest first, so the first one seen wins)
    for (const e of rubber.entries) {
      const key = `${e.date}|${e.type}`;
      if (!byKey.has(key)) byKey.set(key, makeRecord({ source: META.source, metric: e.type, value: e.price, unit: "LAK per kg (own)", fetched_at: e.at, source_date: e.date }));
    }
    const records = [...byKey.values()];
    replaceHistory(META.source, records);
    const latest = new Map();
    for (const r of records.sort((a, b) => (a.source_date < b.source_date ? -1 : 1))) latest.set(r.metric, r);
    return [...latest.values()];
  });
}

runIfMain(module, run);

module.exports = { run, splitPlace, rubberType, readRubber, readLand, PROVINCES };
