// Source #14: World silver spot price XAG/USD (MARKET). gold-api.com (free, no key).
// (goldprice.dev, our gold source, only sells silver on paid plans - checked 2026-09-30: HTTP 403 "plan_gated".)
//
// Real response (checked 2026-09-30):
//   { "currency": "USD", "name": "Silver", "price": 60.588001, "symbol": "XAG", "updatedAt": "2026-09-30T15:34:47Z", ... }
// Price is USD per troy ounce. The summary turns it into LAK per kg (1 kg = 32.1507 troy oz).

const { fetchJson, parseNumber, toIsoUtc, makeRecord, runSource, runIfMain } = require("./lib/common");

const URL = process.env.SILVER_WORLD_URL || "https://api.gold-api.com/price/XAG";

const META = {
  source: "silver-world",
  source_name: "World silver spot XAG/USD (gold-api.com)",
  source_url: "https://gold-api.com",
  license: "Free public API, no key",
  kind: "market",
};

async function getRecords(fetchedAt) {
  const data = await fetchJson(URL);
  if (data.symbol !== "XAG") throw new Error("gold-api.com: symbol is not XAG");
  const price = parseNumber(data.price, "XAG price");
  if (price < 5 || price > 500) throw new Error(`XAG price looks wrong: ${price}`);
  return [
    makeRecord({
      source: "silver-world",
      metric: "XAG_USD",
      value: Math.round(price * 1000) / 1000,
      unit: "USD per troy oz",
      fetched_at: fetchedAt,
      source_date: toIsoUtc(data.updatedAt, "gold-api.com updatedAt"),
    }),
  ];
}

const run = () => runSource(META, getRecords);
runIfMain(module, run);

module.exports = { run };
