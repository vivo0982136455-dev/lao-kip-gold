// Shared by the shop-price scripts (gold: Phouvong, silver: PML). They read the SAME Google Sheet
// (the owner's form answers), downloaded once per run, and find their columns by header words.
//
// Sheet columns (form question order): A timestamp | B date | C jewellery sell | D jewellery buy | E note |
//   then questions added later at the END: gold bar sell / buy, silver sell / buy, the owner's own rubber price
//   (price, kind, place) and land prices (place, total price, area) - all found by header words.
//   Words that decide a column: แท่ง = gold bar, เงิน = silver, ยาง = rubber, ที่ดิน = land. Never use them in other titles.
// Rules:
//   - several answers on one day: for EACH price, the last non-empty answer of that day wins
//     (an answer with only a silver price does not erase that day's gold price)
//   - a price that fails its check is skipped with a warning; the rest of the row is still used

const path = require("path");
const { HISTORY_DIR, fetchText, parseCsv, parseNumber, makeRecord, readJson } = require("./common");
const { parseSheetDate, parseSheetTimestamp, notInFuture } = require("./manual");

const downloads = new Map(); // url -> Promise<rows> (one download per run for both scripts)
function loadSheet(url) {
  if (!downloads.has(url)) downloads.set(url, fetchText(url).then(parseCsv));
  return downloads.get(url);
}

const norm = (h) => String(h || "").replace(/\s+/g, " ").replace(/\*/g, "").trim();
const isSilver = (t) => t.includes("เงิน") || /silver/i.test(t);

// header row -> column index of every price (-1 = question not in the form yet)
function findColumns(header) {
  const h = header.map(norm);
  const find = (test) => h.findIndex(test);
  return {
    timestamp: 0,
    date: 1,
    sell: 2, // jewellery sell / buy: fixed positions since the form was created
    buy: 3,
    bar_sell: find((t) => t.includes("แท่ง") && t.includes("ขาย") && !isSilver(t)),
    bar_buy: find((t) => t.includes("แท่ง") && t.includes("ซื้อ") && !isSilver(t)),
    silver_sell: find((t) => isSilver(t) && t.includes("ขาย")),
    silver_buy: find((t) => isSilver(t) && t.includes("ซื้อ")),
    rubber_price: find((t) => t.includes("ยาง") && t.includes("ราคา")),
    rubber_type: find((t) => t.includes("ยาง") && t.includes("ชนิด")),
    rubber_place: find((t) => t.includes("ยาง") && t.includes("สถานที่")),
    land_place: find((t) => t.includes("ที่ดิน") && t.includes("สถานที่")),
    land_total: find((t) => t.includes("ที่ดิน") && t.includes("ราคา")),
    land_area: find((t) => t.includes("ที่ดิน") && t.includes("เนื้อที่")),
  };
}

// Lao Bullion Bank sell price per Lao baht (15 g) by day, for the plausibility check of gold prices
function lbbByDay() {
  const map = new Map();
  for (const r of readJson(path.join(HISTORY_DIR, "gold-lbb.json"), [])) {
    if (r.metric !== "sell_g") continue;
    map.set(new Date(Date.parse(r.source_date) + 7 * 3600000).toISOString().slice(0, 10), r.value * 15);
  }
  return map;
}
// LBB price of `day`, or of the nearest earlier day within a week
function lbbNear(lbb, day) {
  for (let i = 0; i <= 7; i++) {
    const d = new Date(Date.parse(day + "T00:00:00Z") - i * 86400000).toISOString().slice(0, 10);
    if (lbb.has(d)) return lbb.get(d);
  }
  return null;
}

// Read the Sheet and build the records of one source.
// prices: { metric: { column: "sell" | "bar_sell" | ..., label } }
// check(value, day): throws when the value is not believable
// Returns { records (all days), latest (newest record of each price), skipped, present (columns exist) }
async function readShopPrices(url, { source, unit, prices, check }) {
  const rows = await loadSheet(url);
  if (rows.length < 1) throw new Error("The sheet is empty");
  const cols = findColumns(rows[0]);
  const wanted = Object.entries(prices).filter(([, p]) => cols[p.column] >= 0);
  const byDay = new Map(); // day -> Map(metric -> record)
  let skipped = 0;
  for (const [i, row] of rows.slice(1).entries()) {
    const day = parseSheetDate(row[cols.date]) || parseSheetDate(row[cols.timestamp]);
    if (!day) {
      skipped++;
      console.warn(`       ${source}: skipped row ${i + 2}: cannot read date "${row[cols.date]}"`);
      continue;
    }
    // a date in the future would stay "the newest price" for ever, and no reference price exists to check it against
    if (!notInFuture(day)) {
      skipped++;
      console.warn(`       ${source}: skipped row ${i + 2}: the date ${day} is in the future`);
      continue;
    }
    const enteredAt = parseSheetTimestamp(row[cols.timestamp]) || new Date(`${day}T00:00:00+07:00`).toISOString();
    for (const [metric, p] of wanted) {
      const raw = String(row[cols[p.column]] || "").trim();
      if (raw === "") continue;
      try {
        const value = parseNumber(raw, p.label);
        check(value, day, p.label);
        if (!byDay.has(day)) byDay.set(day, new Map());
        byDay.get(day).set(metric, makeRecord({ source, metric, value, unit, fetched_at: enteredAt, source_date: day }));
      } catch (err) {
        skipped++;
        console.warn(`       ${source}: row ${i + 2} ${p.label}: ${err.message}`);
      }
    }
  }
  const records = [...byDay.values()].flatMap((m) => [...m.values()]);
  const latest = new Map();
  for (const r of records.sort((a, b) => (a.source_date < b.source_date ? -1 : 1))) latest.set(r.metric, r);
  return { records, latest: [...latest.values()], skipped, present: wanted.length > 0 };
}

module.exports = { loadSheet, findColumns, readShopPrices, lbbByDay, lbbNear };
