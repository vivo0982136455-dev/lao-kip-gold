// Source #1: Bank of the Lao PDR official exchange rates (OFFICIAL).
// Data comes from a public mirror of bol.gov.la made by AllRatesToday (CC BY 4.0).
// BOL publishes once per business day; running more often is harmless (duplicates are skipped).
//
// Real response (checked 2026-09-29):
//   { "date": "2026-09-28", "rates": [ { "base": "USD", "quote": "LAK", "type": "buy", "value": 22329 }, ... ] }

const { fetchJson, parseNumber, makeRecord, runSource, runIfMain } = require("./lib/common");

const URL =
  process.env.BOL_URL ||
  "https://raw.githubusercontent.com/AllRates-Today/central-bank-exchange-rates/main/data/bol/latest.json";

// Currencies we keep (all against LAK). Owner's choice - change here to add more.
const CURRENCIES = ["USD", "THB", "CNY", "GBP", "EUR", "JPY", "KRW"];
const TYPES = ["buy", "sell"];

const META = {
  source: "bol",
  source_name: "Bank of the Lao PDR (official rate)",
  source_url: "https://www.bol.gov.la/ExchangRate.php",
  license: "CC BY 4.0 - data mirror by AllRatesToday, https://allratestoday.com",
  kind: "official",
};

async function getRecords(fetchedAt) {
  const data = await fetchJson(URL);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date || "")) {
    throw new Error(`Missing or bad "date": ${JSON.stringify(data.date)}`);
  }
  if (!Array.isArray(data.rates)) throw new Error('Missing "rates" list');

  const records = [];
  for (const cur of CURRENCIES) {
    for (const type of TYPES) {
      const rate = data.rates.find((r) => r.base === cur && r.quote === "LAK" && r.type === type);
      if (!rate) throw new Error(`Rate ${cur}/LAK ${type} not found`);
      records.push(
        makeRecord({
          source: "bol",
          metric: `${cur}_LAK_${type}`,
          value: parseNumber(rate.value, `${cur} ${type}`),
          unit: `LAK per ${cur}`,
          fetched_at: fetchedAt,
          source_date: data.date,
        })
      );
    }
  }
  return records;
}

const run = () => runSource(META, getRecords);
runIfMain(module, run);

module.exports = { run, CURRENCIES, TYPES };
