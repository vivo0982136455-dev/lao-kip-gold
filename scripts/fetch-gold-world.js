// Source #2: World gold spot price XAU/USD (MARKET).
// Main: goldprice.dev (no key). Backup: gold-api.com (no key).
//
// Real responses (checked 2026-09-29):
//   goldprice.dev: { "symbols": [ { "symbol": "XAU", "quote_currency": "USD", "unit": "troy_ounce",
//                    "price": "4151.15", "is_stale": false, "computed_at": "2026-09-29T10:53:25.663061Z" } ] }
//   gold-api.com:  { "price": 4153.399902, "symbol": "XAU", "updatedAt": "2026-09-29T10:53:08Z", ... }

const { fetchJson, parseNumber, toIsoUtc, makeRecord, runSource, runIfMain } = require("./lib/common");

const MAIN_URL = process.env.GOLD_WORLD_URL || "https://api.goldprice.dev/v1/prices?symbol=XAU-USD-SPOT";
const BACKUP_URL = process.env.GOLD_WORLD_BACKUP_URL || "https://api.gold-api.com/price/XAU";

const META = {
  source: "gold-world",
  source_name: "World gold spot XAU/USD (goldprice.dev, backup gold-api.com)",
  source_url: "https://goldprice.dev",
  license: "Free public API, no key",
  kind: "market",
};

async function fromGoldpriceDev() {
  const data = await fetchJson(MAIN_URL);
  const item = (data.symbols || []).find((s) => s.symbol === "XAU" && s.quote_currency === "USD");
  if (!item) throw new Error("XAU/USD not found in goldprice.dev response");
  if (item.is_stale) throw new Error("goldprice.dev says its price is stale");
  return {
    price: parseNumber(item.price, "goldprice.dev price"),
    time: toIsoUtc(item.computed_at, "goldprice.dev computed_at"),
    from: "goldprice.dev",
  };
}

async function fromGoldApi() {
  const data = await fetchJson(BACKUP_URL);
  if (data.symbol !== "XAU") throw new Error("gold-api.com: symbol is not XAU");
  return {
    price: parseNumber(data.price, "gold-api.com price"),
    time: toIsoUtc(data.updatedAt, "gold-api.com updatedAt"),
    from: "gold-api.com",
  };
}

async function getRecords(fetchedAt) {
  let result;
  try {
    result = await fromGoldpriceDev();
  } catch (err) {
    console.warn(`       gold-world: main source failed (${err.message}), trying backup`);
    result = await fromGoldApi(); // if this also fails, runSource marks the data stale
  }
  return [
    makeRecord({
      source: "gold-world",
      metric: "XAU_USD",
      value: result.price,
      unit: "USD per troy oz",
      fetched_at: fetchedAt,
      source_date: result.time,
    }),
  ];
}

const run = () => runSource(META, getRecords);
runIfMain(module, run);

module.exports = { run };
