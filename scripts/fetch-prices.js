// Source #12: prices of everyday goods in Laos - WFP (UN World Food Programme), via HDX. Free, no key.
//   a) Market prices, monthly, 17 provinces (rice, meat, eggs, oil, fuel ...): measured by WFP, ~2-3 months late
//   b) National fuel price estimate, monthly: WFP "real-time" MODEL estimate (newer, but an estimate)
// Writes data/prices.json (read only by the "Cost of living" page). Run monthly: node scripts/fetch-prices.js
//
// The download links are looked up in the HDX catalogue each run (package_show), so a new file version
// does not break us. Real files (checked 2026-09-30):
//   a) date,admin1,admin2,market,market_id,latitude,longitude,category,commodity,commodity_id,unit,priceflag,pricetype,currency,price,usdprice
//      2026-06-15,Vientiane Capital,...,Vientiane Municipality,...,"Rice (glutinous, first quality)",194,KG,actual,Retail,LAK,23000,1.07
//   b) ISO3,country,adm1_name,...,mkt_name,...,DATES,year,month,currency,...,c_fuel_diesel,...,c_fuel_petrol_gasoline,...
//      LAO,Lao PDR,Market Average,...,Market Average,...,2026-08-01,2026,8,LAK,...,28914.85,...,31362.06,...
// On failure the old file is kept and marked stale.

const path = require("path");
const { DATA_DIR, fetchJson, fetchText, parseCsv, readJson, writeIfChanged } = require("./lib/common");
const { stampedSources } = require("./lib/parts");

const OUT_FILE = path.join(DATA_DIR, "prices.json");
const FIRST_MONTH = "2020-01";
const HDX = "https://data.humdata.org/api/3/action/package_show?id=";
const MARKET_PACKAGE = "wfp-food-prices-for-lao-people-s-democratic-republic";
const REALTIME_PACKAGE = "lao-people-s-democratic-republic-real-time-prices";

// Our id -> WFP commodity name (exact) and unit. Kept to 12 everyday items so the file stays small.
const ITEMS = {
  rice_glutinous: { wfp: "Rice (glutinous, first quality)", unit: "KG" },
  rice_ordinary: { wfp: "Rice (ordinary, first quality)", unit: "KG" },
  pork: { wfp: "Meat (pork, first quality)", unit: "KG" },
  chicken: { wfp: "Meat (chicken)", unit: "KG" },
  beef: { wfp: "Meat (beef, first quality)", unit: "KG" },
  eggs: { wfp: "Eggs", unit: "Unit" },
  fish: { wfp: "Fish (tilapia, farmed)", unit: "KG" },
  sugar: { wfp: "Sugar (brown)", unit: "KG" },
  cooking_oil: { wfp: "Oil (soybean)", unit: "L" },
  garlic: { wfp: "Garlic (small)", unit: "KG" },
  diesel: { wfp: "Fuel (diesel)", unit: "L" },
  petrol: { wfp: "Fuel (petrol-gasoline)", unit: "L" },
};
const NATIONAL = "_national"; // our average of all markets
const BIG_FILE_TIMEOUT_MS = 120000; // the market price file is ~7 MB

const SOURCES = {
  wfp_markets: {
    source_name: "WFP market prices (UN World Food Programme, via HDX)",
    source_url: "https://data.humdata.org/dataset/" + MARKET_PACKAGE,
    license: "CC BY-IGO - WFP",
  },
  wfp_realtime: {
    source_name: "WFP real-time price estimates (model)",
    source_url: "https://data.humdata.org/dataset/" + REALTIME_PACKAGE,
    license: "CC BY-IGO - WFP",
  },
};

// Find a resource download link in an HDX package by (part of) its name
async function hdxLink(pkg, namePart) {
  const data = await fetchJson(HDX + pkg);
  const res = data.success && data.result.resources.find((r) => r.name.includes(namePart));
  if (!res) throw new Error(`HDX package ${pkg}: no resource named "${namePart}"`);
  return res.url;
}

// CSV rows -> list of objects keyed by the header row
function csvObjects(text) {
  const [head, ...rows] = parseCsv(text);
  return rows.filter((r) => !String(r[0]).startsWith("#")).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

async function marketPrices() {
  const rows = csvObjects(await fetchText(await hdxLink(MARKET_PACKAGE, "Food Prices"), {}, BIG_FILE_TIMEOUT_MS));
  const byName = Object.fromEntries(Object.entries(ITEMS).map(([id, d]) => [d.wfp, id]));
  const markets = new Map(); // market -> province
  const cells = new Map(); // "item|market|month" -> [prices]
  for (const r of rows) {
    const id = byName[r.commodity];
    const month = String(r.date).slice(0, 7);
    if (!id || month < FIRST_MONTH || r.currency !== "LAK" || r.pricetype !== "Retail" || r.unit !== ITEMS[id].unit) continue;
    const price = Number(r.price);
    if (!(price > 0)) continue;
    markets.set(r.market, r.admin1);
    const key = `${id}|${r.market}|${month}`;
    (cells.get(key) || cells.set(key, []).get(key)).push(price);
  }
  if (!cells.size) throw new Error("no matching WFP rows (commodity names changed?)");

  const months = [...new Set([...cells.keys()].map((k) => k.split("|")[2]))].sort();
  const marketList = [...markets.keys()].sort();
  const avg = (list) => list.reduce((s, v) => s + v, 0) / list.length;
  const prices = {};
  for (const id of Object.keys(ITEMS)) {
    prices[id] = {};
    for (const m of marketList) {
      const values = months.map((mo) => (cells.has(`${id}|${m}|${mo}`) ? Math.round(avg(cells.get(`${id}|${m}|${mo}`))) : null));
      if (values.some((v) => v !== null)) prices[id][m] = values;
    }
    // National average = mean of the markets that reported that month
    prices[id][NATIONAL] = months.map((_, i) => {
      const list = Object.entries(prices[id]).filter(([m, v]) => m !== NATIONAL && v[i] !== null).map(([, v]) => v[i]);
      return list.length ? Math.round(avg(list)) : null;
    });
  }
  return {
    months,
    markets: marketList.map((m) => ({ id: m, province: markets.get(m) })),
    items: Object.fromEntries(Object.entries(ITEMS).map(([id, d]) => [id, { unit: d.unit, name_en: d.wfp }])),
    prices,
  };
}

// National fuel estimate (WFP model): "c_" = month-close value
async function fuelEstimate() {
  const rows = csvObjects(await fetchText(await hdxLink(REALTIME_PACKAGE, "Energy"), {}, BIG_FILE_TIMEOUT_MS));
  const out = { diesel: [], petrol: [] };
  for (const r of rows) {
    if (r.mkt_name !== "Market Average" || r.currency !== "LAK") continue;
    const month = String(r.DATES).slice(0, 7);
    if (month < FIRST_MONTH) continue;
    for (const [id, col] of [["diesel", "c_fuel_diesel"], ["petrol", "c_fuel_petrol_gasoline"]]) {
      const v = Number(r[col]);
      if (r[col] !== "" && v > 0) out[id].push([month, Math.round(v)]);
    }
  }
  if (!out.diesel.length && !out.petrol.length) throw new Error("no national fuel estimates found");
  for (const id of Object.keys(out)) out[id].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return out;
}

async function main() {
  const old = readJson(OUT_FILE, {});
  const now = new Date().toISOString();
  const out = { sources: SOURCES, national_id: NATIONAL };
  let failed = 0;

  try {
    const m = await marketPrices();
    const same = old.market && JSON.stringify(old.market.prices) === JSON.stringify(m.prices);
    out.market = { ...m, updated_at: same ? old.market.updated_at : now, stale: false, last_error: null };
    console.log(`[OK]   prices: ${Object.keys(m.items).length} items, ${m.markets.length} markets, ${m.months[0]} -> ${m.months[m.months.length - 1]}`);
  } catch (err) {
    failed++;
    console.error(`[FAIL] prices: ${err.message}`);
    out.market = { ...(old.market || {}), stale: true, last_error: { message: err.message, at: now } };
  }

  try {
    const f = await fuelEstimate();
    const same = old.fuel_estimate && JSON.stringify(old.fuel_estimate.values) === JSON.stringify(f);
    out.fuel_estimate = { values: f, unit: "LAK per L", updated_at: same ? old.fuel_estimate.updated_at : now, stale: false, last_error: null };
    console.log(`[OK]   fuel estimate: diesel to ${f.diesel.length ? f.diesel[f.diesel.length - 1][0] : "-"}, petrol to ${f.petrol.length ? f.petrol[f.petrol.length - 1][0] : "-"}`);
  } catch (err) {
    failed++;
    console.error(`[FAIL] fuel estimate: ${err.message}`);
    out.fuel_estimate = { ...(old.fuel_estimate || {}), stale: true, last_error: { message: err.message, at: now } };
  }

  // the day each source was last read (the survey prices and the estimate are two files of the WFP)
  out.sources = stampedSources(SOURCES, old.sources, { market: { source: "wfp_markets", stale: !!out.market.stale }, fuel: { source: "wfp_realtime", stale: !!out.fuel_estimate.stale } }, now);

  // Compact: one item per line
  const m = out.market;
  const pricesText = m.prices
    ? "{\n" + Object.entries(m.prices).map(([id, v]) => `   ${JSON.stringify(id)}: ${JSON.stringify(v)}`).join(",\n") + "\n  }"
    : "null";
  const { prices, ...marketRest } = m;
  const text =
    `{\n "sources": ${JSON.stringify(out.sources)},\n "national_id": ${JSON.stringify(NATIONAL)},\n` +
    ` "fuel_estimate": ${JSON.stringify(out.fuel_estimate)},\n` +
    ` "market": ${JSON.stringify(marketRest).slice(0, -1)}${m.prices ? "," : ""}\n  ${m.prices ? `"prices": ${pricesText}` : ""}\n }\n}\n`;
  JSON.parse(text); // safety: must be valid JSON
  writeIfChanged(OUT_FILE, text);
  console.log(`Done: ${failed} failed. Wrote data/prices.json (${(text.length / 1024).toFixed(0)} KB)`);
  if (failed === 2) process.exitCode = 1;
}

main();
