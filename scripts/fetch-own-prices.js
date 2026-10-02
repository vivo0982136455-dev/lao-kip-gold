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
// The form link is public: anybody can send an answer. Until only the owner can write (see README, "Who can
// write"), every answer is checked hard before it may appear on the site (audit 2026-10-02):
//   - rubber: inside a band around the Thai market price of the same kind of rubber on that day, in kip
//   - land:   inside a band around the official assessed prices
//   - the day must not lie in the future
//   - text: no links, no e-mail addresses, no phone numbers, at most 40 characters
// The limits are in LIMITS below; the page reads the same numbers from data/manual-form.json ("limits").
//
// Writes:
//   data/own-prices.json               every entry, newest first (text fields included) - read by the Economy page
//   data/latest|history/rubber-lao-manual.json   newest price of each kind of rubber + one value per day (for charts)
// The Sheet is the full truth: both files are rebuilt from it on every run.

const path = require("path");
const { DATA_DIR, LATEST_DIR, HISTORY_DIR, parseNumber, makeRecord, readJson, replaceHistory, writeIfChanged, runSource, runIfMain } = require("./lib/common");
const { manualUrl, parseSheetDate, parseSheetTimestamp, notInFuture } = require("./lib/manual");
const { loadSheet, findColumns } = require("./lib/manual-sheet");

const OUT_FILE = path.join(DATA_DIR, "own-prices.json");
const META = {
  source: "rubber-lao-manual",
  source_name: "Rubber price the owner was paid (owner's form)",
  source_url: null,
  license: "Prices entered by the owner",
  kind: "shop",
};

// Plausible values only. "band" = times the reference price of that day; the page is a little stricter
// ("page_band"), so that what the page accepts is never skipped here (the two use slightly different
// reference prices: nearest border market and market exchange rate there, all markets and the central bank's rate here).
const LIMITS = {
  rubber: {
    min: 1000, // LAK per kg: outer limits, the only check when no Thai price is known for the day
    max: 200000,
    band: [0.15, 1.3], // x the Thai market price of the same kind of rubber on that day, in kip.
    // Why so wide: Thailand quotes cup lump and latex per kg of DRY rubber, a Lao farmer is paid per kg as delivered
    // (wet): the prices reported from Bokeo and Oudomxai in 2025 (10,000-22,000 kip, data/invest-static.json
    // "rubber.reports") were 25%-66% of the Thai cup lump price of that year in kip. Sheets sell near the Thai price.
    page_band: [0.17, 1.2],
  },
  land: {
    area_min: 1, // square metres
    area_max: 100000000, // 10,000 hectares
    sqm_min: 50, // LAK per square metre: outer limits
    sqm_max: 1000000000,
    official_low: 0.5, // Vientiane Capital: not below half of the lowest official assessed price there ...
    official_high: 20, // ... every province: not above 20 x the highest official assessed price in the capital
    // (market prices lie above assessed prices; the tables of the other provinces are not in the app, so only
    // the upper end can be checked for them)
  },
  text_max: 40,
};

const PROVINCES = [
  "Vientiane Capital", "Louangphabang", "Phongsaly", "Louangnamtha", "Bokeo", "Oudomxai", "Houaphan", "Xaignabouly", "Xiengkhouang",
  "Vientiane", "Xaisomboun", "Bolikhamxai", "Khammouan", "Savannakhet", "Salavan", "Sekong", "Champasack", "Attapeu",
];

// ---------- text typed by hand (shown on a public page) ----------
// Links, e-mail addresses and phone numbers are taken out; the rest is cut at LIMITS.text_max characters.
const DIGIT = "[0-9๐-๙໐-໙]"; // also Thai and Lao digits
const LINK = /(?:https?:\/\/|www\.)\S+|\b[\w-]+(?:\.[\w-]+)*\.(?:com|net|org|info|biz|io|co|me|ly|gl|cc|xyz|app|link|shop|site|online|la|th|vn|cn|kh|mm|sg|my)\b(?:\/\S*)?/gi;
const MAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE = new RegExp(`\\+?(?:${DIGIT}[\\s\\-.()]*){7,}`, "g"); // 7 or more digits in a row, also with spaces or dashes between them
const tidy = (text) => String(text || "").replace(/\s+/g, " ").trim();
function cleanText(text, max = LIMITS.text_max) {
  const s = tidy(tidy(text).replace(MAIL, " ").replace(LINK, " ").replace(PHONE, " ").replace(/[<>]/g, " "));
  return [...s].slice(0, max).join("").trim(); // cut by characters, never in the middle of one
}

// "Louangnamtha | ເມືອງສິງ" -> { province: "Louangnamtha", place: "ເມືອງສິງ" }; anything else -> { province: null, place: text }
function splitPlace(text) {
  const s = tidy(text);
  const i = s.indexOf("|");
  if (i > 0) {
    const head = s.slice(0, i).trim().toLowerCase();
    const province = PROVINCES.find((p) => p.toLowerCase() === head);
    if (province) return { province, place: cleanText(s.slice(i + 1)) };
  }
  return { province: null, place: cleanText(s) };
}

// Kind of rubber from the words typed (Thai, Lao or English). Checked in this order.
function rubberType(text) {
  const s = tidy(text).toLowerCase();
  if (/ก้อน|ถ้วย|ກ້ອນ|ຖ້ວຍ|cup|lump/.test(s)) return "cuplump";
  if (/น้ำยาง|ນ້ຳຢາງ|ນໍ້າຢາງ|latex/.test(s)) return "latex";
  if (/รมควัน|ຮົມຄວັນ|smoked|rss/.test(s)) return "rss";
  if (/แผ่น|ແຜ່ນ|sheet/.test(s)) return "sheet";
  return "other";
}

// ---------- reference prices for the checks (all from files the other fetchers keep up to date) ----------
const RAOT_KIND = { cuplump: "cuplump", latex: "latex", sheet: "uss", rss: "rss3" }; // data/rubber-daily.json
const MOC_ITEM = { cuplump: "rubber_cuplump", latex: "rubber_latex", sheet: "rubber_sheet", rss: "rubber_sheet" }; // data/thai-prices.json
const NEAR_DAYS = 7; // a price of up to a week before still counts as "that day" (markets close on holidays)
const daysBetween = (a, b) => (Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000;
// newest row [day, ...] that is not after `day` and not more than `within` days before it
const nearRow = (rows, day, within, ok = () => true) => {
  let best = null;
  for (const r of rows || []) if (r[0] <= day && daysBetween(r[0], day) <= within && ok(r) && (!best || r[0] > best[0])) best = r;
  return best;
};

function loadReferences() {
  const daily = readJson(path.join(DATA_DIR, "rubber-daily.json"), null);
  const thai = readJson(path.join(DATA_DIR, "thai-prices.json"), null);
  const stat = readJson(path.join(DATA_DIR, "invest-static.json"), null);
  const kinds = (daily && daily.thai_border && daily.thai_border.kinds) || {};
  const items = (thai && thai.items) || {};

  // kip per baht by day: Bank of the Lao PDR (middle of buying and selling), else the market rate
  const sides = new Map(); // day -> { buy, sell }
  for (const r of readJson(path.join(HISTORY_DIR, "bol.json"), [])) {
    if (r.metric !== "THB_LAK_buy" && r.metric !== "THB_LAK_sell") continue;
    const day = String(r.source_date).slice(0, 10);
    if (!sides.has(day)) sides.set(day, {});
    sides.get(day)[r.metric === "THB_LAK_buy" ? "buy" : "sell"] = r.value;
  }
  const rates = [...sides].filter(([, s]) => s.buy && s.sell).map(([day, s]) => [day, (s.buy + s.sell) / 2]);
  for (const r of readJson(path.join(HISTORY_DIR, "fx-market.json"), [])) {
    const day = new Date(Date.parse(r.source_date) + 7 * 3600000).toISOString().slice(0, 10);
    if (r.metric === "THB_LAK" && !sides.has(day)) rates.push([day, r.value]);
  }
  const rate = (day) => {
    const row = nearRow(rates, day, 10);
    return row ? row[1] : null;
  };

  // Thai market price of one kind of rubber on a day, baht per kg: the central markets together (RAOT), else the
  // ministry of commerce's price; a day of up to a week before; else the average of that month
  const thb = (kind, day) => {
    const raot = kinds[RAOT_KIND[kind]];
    const moc = items[MOC_ITEM[kind]];
    const value = (r) => (r[3] !== null && r[3] !== undefined ? r[3] : r[1] !== null && r[1] !== undefined ? r[1] : r[2]);
    const a = raot && nearRow(raot.days, day, NEAR_DAYS, (r) => value(r) > 0);
    if (a) return value(a);
    const b = moc && nearRow(moc.days, day, NEAR_DAYS, (r) => r[1] > 0);
    if (b) return b[1];
    const month = day.slice(0, 7);
    const c = raot && (raot.months || []).find((r) => r[0] === month && value(r) > 0);
    if (c) return value(c);
    const d = moc && (moc.monthly || []).find((r) => r[0] === month && r[1] > 0);
    return d ? d[1] : null;
  };
  // -> [lowest, highest] reference in kip per kg for an entry of `type` on `day` (the same number twice for a
  //    known kind; the cheapest and the dearest kind for "other"), or null when nothing is known for that day
  const rubber = (type, day) => {
    const lak = rate(day);
    if (!lak) return null;
    const list = (RAOT_KIND[type] ? [type] : Object.keys(RAOT_KIND)).map((k) => thb(k, day)).filter((v) => v > 0);
    return list.length ? [Math.min(...list) * lak, Math.max(...list) * lak] : null;
  };

  // official assessed land prices of Vientiane Capital, kip per square metre: [lowest, highest] of the whole table
  let official = null;
  const districts = stat && stat.land && stat.land.vientiane && stat.land.vientiane.districts;
  if (districts && districts.length) {
    const classes = stat.land.vientiane.classes;
    const all = districts.flatMap((d) => classes.flatMap((c) => (Array.isArray(d[c]) ? d[c] : [])));
    if (all.length) official = [Math.min(...all), Math.max(...all)];
  }
  // -> [lowest, highest] accepted price per square metre in that province
  const land = (province) => {
    const L = LIMITS.land;
    if (!official) return [L.sqm_min, L.sqm_max];
    return [province === "Vientiane Capital" ? Math.max(L.sqm_min, official[0] * L.official_low) : L.sqm_min, Math.min(L.sqm_max, official[1] * L.official_high)];
  };
  return { rubber, land, official };
}

// ---------- the checks ----------
function checkRubber(price, type, day, refs) {
  const L = LIMITS.rubber;
  if (price < L.min || price > L.max) throw new Error(`price looks wrong: ${price}`);
  const ref = refs && refs.rubber(type, day);
  if (!ref) return;
  const low = Math.round(L.band[0] * ref[0]);
  const high = Math.round(L.band[1] * ref[1]);
  if (price < low || price > high) throw new Error(`price ${price} is outside ${low}-${high} (the Thai market price of that day in kip x ${L.band[0]} to x ${L.band[1]})`);
}
function checkLand(perSqm, area, province, refs) {
  const L = LIMITS.land;
  if (area < L.area_min || area > L.area_max) throw new Error(`area looks wrong: ${area}`);
  const [low, high] = refs ? refs.land(province) : [L.sqm_min, L.sqm_max];
  if (perSqm < low || perSqm > high) throw new Error(`price per square metre ${perSqm} is outside ${low}-${high}`);
}

// One row of the sheet -> its day and the time it was entered (throws when the date is missing or in the future)
function rowTime(row, cols) {
  const day = parseSheetDate(row[cols.date]) || parseSheetDate(row[cols.timestamp]);
  if (!day) throw new Error(`cannot read date "${row[cols.date]}"`);
  if (!notInFuture(day)) throw new Error(`the date ${day} is in the future`);
  return { day, at: parseSheetTimestamp(row[cols.timestamp]) || new Date(`${day}T00:00:00+07:00`).toISOString() };
}

function readRubber(rows, cols, refs) {
  const entries = [];
  let skipped = 0;
  if (cols.rubber_price < 0) return { configured: false, entries, skipped };
  rows.slice(1).forEach((row, i) => {
    const raw = String(row[cols.rubber_price] || "").trim();
    if (raw === "") return;
    try {
      const time = rowTime(row, cols);
      const price = parseNumber(raw, "rubber price");
      const rawType = cols.rubber_type >= 0 ? row[cols.rubber_type] : "";
      const type = rubberType(rawType);
      checkRubber(price, type, time.day, refs);
      entries.push({ date: time.day, type, type_text: cleanText(rawType), price, ...splitPlace(cols.rubber_place >= 0 ? row[cols.rubber_place] : ""), at: time.at });
    } catch (err) {
      skipped++;
      console.warn(`       own rubber: skipped row ${i + 2}: ${err.message}`);
    }
  });
  return { configured: true, entries: newestFirst(entries), skipped };
}

function readLand(rows, cols, refs) {
  const entries = [];
  let skipped = 0;
  if (cols.land_total < 0 || cols.land_area < 0) return { configured: false, entries, skipped };
  rows.slice(1).forEach((row, i) => {
    const rawTotal = String(row[cols.land_total] || "").trim();
    const rawArea = String(row[cols.land_area] || "").trim();
    if (rawTotal === "" && rawArea === "") return;
    try {
      const time = rowTime(row, cols);
      const total = parseNumber(rawTotal, "land price");
      const area = parseNumber(rawArea, "land area");
      const where = splitPlace(cols.land_place >= 0 ? row[cols.land_place] : "");
      const perSqm = Math.round(total / area);
      checkLand(perSqm, area, where.province, refs);
      entries.push({ date: time.day, ...where, total, area, per_sqm: perSqm, at: time.at });
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
  const refs = loadReferences();
  const rubber = readRubber(rows, cols, refs);
  const land = readLand(rows, cols, refs);
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

module.exports = { run, splitPlace, rubberType, readRubber, readLand, cleanText, loadReferences, checkRubber, checkLand, PROVINCES, LIMITS };
