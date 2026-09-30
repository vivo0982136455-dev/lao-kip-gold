// Source #16: Thai retail prices of everyday food (Bangkok) + Thai rubber market prices, Ministry of Commerce open data (no key).
// Food: compare the same shopping basket in Laos (WFP prices) and Thailand. Rubber: economy page, rubber tab.
// Rubber history before the first run came from scripts/backfill-thai-rubber.js (one month per request).
// Writes data/thai-prices.json (monthly averages). Run weekly: node scripts/fetch-thai-prices.js
//
// Real response (checked 2026-09-30), GET https://dataapi.moc.go.th/gis-product-prices?product_id=P11003&from_date=..&to_date=..
//   { "product_id": "P11003", "product_name": "สุกรชำแหละ เนื้อแดง สะโพก (ตัดแต่ง)", "unit": "บาท/กก.",
//     "price_list": [ { "date": "2026-09-30T00:00:00", "price_min": 140.0, "price_max": 150.0 }, ... ] }
// Note the plural "gis-product-prices" (the documented singular path answers 404).
// The API is slow and times out on long ranges (checked 2026-09-30: 14 months ~40 s or time-out,
// 10 days ~15 s, 3 weeks ~25 s). So every run asks only for the last 3 weeks, one product at a time.
// The daily prices of the last ~2 months are kept in the file ("days"), and a month's average
// [month, value, number of days] is only replaced by one that is based on at least as many days,
// so a partly-covered month never overwrites a complete one. Older months stay from earlier runs.

const path = require("path");
const { DATA_DIR, fetchJson, readJson, writeIfChanged } = require("./lib/common");

const OUT_FILE = path.join(DATA_DIR, "thai-prices.json");
const API = "https://dataapi.moc.go.th/gis-product-prices";
const WINDOW_DAYS = 21; // days asked per run
const REQUEST_TIMEOUT_MS = 45000;
const DAYS_KEPT = 62; // daily prices kept in the file
const MONTHS_KEPT = 26; // monthly averages kept (rubber items keep more, see ITEMS)
const SECOND_TRY_BEFORE_MS = 8 * 60000; // failed items get a second try if the first pass took less than this

// Our item id (same ids as the WFP Lao prices) -> MOC product, and what to divide by to get the same unit
const ITEMS = {
  rice_glutinous: { id: "R13007", per: 15, unit: "KG" }, // ข้าวสารเหนียว สันป่าตอง 100%, บาท / 15 กก.
  rice_ordinary: { id: "R13003", per: 15, unit: "KG" }, // ข้าวสารเจ้า 100% ธรรมดา, บาท / 15 กก.
  pork: { id: "P11003", per: 1, unit: "KG" }, // สุกรชำแหละ เนื้อแดง สะโพก (ตัดแต่ง)
  chicken: { id: "P11013", per: 1, unit: "KG" }, // ไก่สดชำแหละ น่อง สะโพก
  beef: { id: "P11031", per: 1, unit: "KG" }, // เนื้อโค สะโพก
  eggs: { id: "P11028", per: 1, unit: "Unit" }, // ไข่ไก่ เบอร์ 3, บาท/ฟอง
  fish: { id: "P12017", per: 1, unit: "KG" }, // ปลานิล
  cooking_oil: { id: "P16006", per: 1, unit: "L" }, // น้ำมันถั่วเหลือง 1 ลิตร, บาท/ขวด
  garlic: { id: "P15001", per: 1, unit: "KG" }, // กระเทียมแห้ง มัดจุก หัวใหญ่
  // Rubber (economy page, rubber tab): Thai market reference prices, บาท/กก.
  rubber_cuplump: { id: "W16034", per: 1, unit: "KG", months: 120 }, // ยางก้อนถ้วย 100% ราคากลางเปิดตลาด
  rubber_latex: { id: "W16036", per: 1, unit: "KG", months: 120 }, // น้ำยางสด ราคากลางเปิดตลาด
  rubber_sheet: { id: "W16023", per: 1, unit: "KG", months: 120 }, // ยางแผ่นดิบชั้น 3 ราคาเกษตรกรขายได้ จ.สุราษฎร์ธานี
};

const dayStr = (d) => d.toISOString().slice(0, 10);
const daysBack = (n) => dayStr(new Date(Date.now() - n * 86400000));

async function fetchItem(key, def, fromDay) {
  const url = `${API}?product_id=${def.id}&from_date=${fromDay}&to_date=${dayStr(new Date())}`;
  const data = await fetchJson(url, {}, REQUEST_TIMEOUT_MS);
  const list = Array.isArray(data.price_list) ? data.price_list : [];
  const days = [];
  for (const p of list) {
    const lo = Number(p.price_min);
    const hi = Number(p.price_max);
    if (!(lo > 0) || !(hi > 0)) continue;
    days.push([String(p.date).slice(0, 10), round2((lo + hi) / 2 / def.per)]); // middle of the day's price range
  }
  days.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const last = days[days.length - 1];
  return {
    moc_id: def.id,
    name_th: data.product_name || null,
    unit: def.unit,
    latest: last ? { date: last[0], value: last[1] } : null,
    days,
  };
}

const round2 = (v) => Math.round(v * 100) / 100;

// Merge the new daily prices into the stored ones, then update the monthly averages
function mergeItem(before, fresh, keepMonths = MONTHS_KEPT) {
  const dayMap = new Map(before && before.days ? before.days : []);
  for (const [d, v] of fresh.days) dayMap.set(d, v);
  const days = [...dayMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-DAYS_KEPT);

  const byMonth = new Map();
  for (const [d, v] of days) {
    const m = d.slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(v);
  }
  // [month, average, days]; entries saved before this format have no day count = treated as complete
  const months = new Map((before && before.monthly ? before.monthly : []).map(([m, v, n]) => [m, [v, n === undefined ? 31 : n]]));
  for (const [m, vals] of byMonth) {
    const old = months.get(m);
    if (!old || vals.length >= old[1]) months.set(m, [round2(vals.reduce((a, b) => a + b, 0) / vals.length), vals.length]);
  }
  const monthly = [...months.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-keepMonths).map(([m, [v, n]]) => [m, v, n]);
  return { days, monthly };
}

const SOURCE = { source_name: "Ministry of Commerce Thailand - retail prices, Bangkok (MOC Open Data)", source_url: "https://data.moc.go.th/OpenData/GISProductPrice", license: "Thai government open data" };

// One item per line (small diffs in git); items in the ITEMS order
function writePrices(out) {
  const keys = Object.keys(ITEMS).filter((k) => out.items[k]);
  const text =
    "{\n" +
    `  "source": ${JSON.stringify(out.source)},\n  "unit_note": ${JSON.stringify(out.unit_note)},\n  "items": {\n` +
    keys.map((k) => `    ${JSON.stringify(k)}: ${JSON.stringify(out.items[k])}`).join(",\n") +
    "\n  }\n}\n";
  JSON.parse(text);
  writeIfChanged(OUT_FILE, text);
  return text;
}

async function main() {
  const old = readJson(OUT_FILE, { items: {} });
  const now = new Date().toISOString();
  const out = { source: SOURCE, unit_note: "THB per unit (KG / L / egg)", items: {} };
  const keys = Object.keys(ITEMS);
  // Optional: only some items, e.g. "node scripts/fetch-thai-prices.js pork eggs" (the others stay as they are)
  const only = process.argv.slice(2);
  for (const k of only) if (!ITEMS[k]) throw new Error(`Unknown item "${k}". Items: ${keys.join(", ")}`);
  const todo = only.length ? keys.filter((k) => only.includes(k)) : keys;
  for (const k of keys) if (!todo.includes(k) && old.items[k]) out.items[k] = old.items[k];

  const startedAt = Date.now();
  const fromDay = daysBack(WINDOW_DAYS);
  async function fetchOne(key) {
    const before = old.items[key];
    try {
      const fresh = await fetchItem(key, ITEMS[key], fromDay);
      if (!fresh.days.length) throw new Error("no prices returned");
      const { days, monthly } = mergeItem(before, fresh, ITEMS[key].months);
      out.items[key] = { ...fresh, monthly, days, stale: false, last_error: null };
      console.log(`[OK]   thai-prices ${key}: ${days.length} days, ${monthly.length} months, latest ${fresh.latest.date}`);
      return true;
    } catch (err) {
      console.error(`[FAIL] thai-prices ${key}: ${err.message}`);
      out.items[key] = { ...(before || { moc_id: ITEMS[key].id, unit: ITEMS[key].unit, monthly: [] }), stale: true, last_error: { message: err.message, at: now } };
      return false;
    }
  }
  // one at a time (the server fails when asked in parallel); the server sometimes answers
  // "HTTP 500" for a while, so failed items get one more try at the end if there is time left
  let failedKeys = [];
  for (const key of todo) if (!(await fetchOne(key))) failedKeys.push(key);
  if (failedKeys.length && Date.now() - startedAt < SECOND_TRY_BEFORE_MS) {
    console.log(`       thai-prices: trying ${failedKeys.join(", ")} again in 15 s`);
    await new Promise((r) => setTimeout(r, 15000));
    const again = [];
    for (const key of failedKeys) if (!(await fetchOne(key))) again.push(key);
    failedKeys = again;
  }
  const failed = failedKeys.length;
  const text = writePrices(out);
  console.log(`Done: ${failed} failed. Wrote data/thai-prices.json (${(text.length / 1024).toFixed(0)} KB)`);
  if (failed === todo.length) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { ITEMS, API, OUT_FILE, SOURCE, writePrices, round2 };
