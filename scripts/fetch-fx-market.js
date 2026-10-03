// Source #4: Reference mid rates USD/LAK, USD/THB, THB/LAK from a general exchange-rate API (not official, and
// not a rate anybody in Laos trades at: on 2026-10-02 it was below the central bank's own buying rate - audit P1-5).
// The site calls it "reference mid rate (API)". The source id "fx-market" and the metric ids are kept: the
// history files are keyed by them. "kind" stays "market" as well - a copy of the app that was opened before this
// change knows no other id and would print "undefined" - and "shown_as" tells the page which label to use.
// Uses open.er-api.com (free, no key). Note: this API updates only ONCE per day,
// so running every 30 minutes just finds the same values most of the time.
//
// Real response (checked 2026-09-29):
//   { "result": "success", "time_last_update_unix": 1790640151,
//     "time_last_update_utc": "Tue, 29 Sep 2026 00:02:31 +0000",
//     "base_code": "USD", "rates": { "LAK": 22266.596155, "THB": 33.590728, ... } }

const { fetchJson, parseNumber, makeRecord, runSource, runIfMain } = require("./lib/common");

const URL = process.env.FX_MARKET_URL || "https://open.er-api.com/v6/latest/USD";

const META = {
  source: "fx-market",
  source_name: "Reference mid rate (API: open.er-api.com / ExchangeRate-API)",
  source_url: "https://www.exchangerate-api.com",
  license: "Free API - attribution: Rates By Exchange Rate API, https://www.exchangerate-api.com",
  kind: "market",
  shown_as: "reference",
};

async function getRecords(fetchedAt) {
  const data = await fetchJson(URL);
  if (data.result !== "success") throw new Error(`API result is "${data.result}"`);
  if (data.base_code !== "USD") throw new Error(`Expected base USD, got ${data.base_code}`);

  const rates = data.rates || {};
  const usdLak = parseNumber(rates.LAK, "USD/LAK");
  const usdThb = parseNumber(rates.THB, "USD/THB");
  const thbLak = Math.round((usdLak / usdThb) * 10000) / 10000; // LAK per 1 THB

  const unixSec = parseNumber(data.time_last_update_unix, "time_last_update_unix");
  const sourceDate = new Date(unixSec * 1000).toISOString();

  const make = (metric, value, unit) =>
    makeRecord({ source: "fx-market", metric, value, unit, fetched_at: fetchedAt, source_date: sourceDate });

  return [
    make("USD_LAK", usdLak, "LAK per USD"),
    make("USD_THB", usdThb, "THB per USD"),
    make("THB_LAK", thbLak, "LAK per THB"),
  ];
}

const run = () => runSource(META, getRecords);
runIfMain(module, run);

module.exports = { run };
