// Source #3: Thai Gold Traders Association price, 96.5% gold (MARKET).
// Main:   the association's own price service - the JSON its website reads (its new website, October 2026).
// Backup: the free community API that copied the association's OLD website. It answered HTTP 500 from the
//         evening of 2026-10-01, when the website changed; it stays as a second try in case it comes back.
// If both fail, the old values are kept and marked stale.
//
// Real responses:
//   Main (checked 2026-10-02): GET https://www.goldtraders.or.th/api/GoldPrices/Latest?readjson=false
//     { "goldPriceID": 87779, "asTime": "2026-10-01T17:27:00", "seq": 22, "priceSeq": 22,
//       "bL_BuyPrice": 66200.00, "bL_SellPrice": 66400.00,            <- gold bar, THB per baht-weight
//       "oM965_BuyPrice": 64869.64, "oM965_SellPrice": 67200.00,      <- ornament gold 96.5%, THB per baht-weight
//       "oM965_BuyGPrice": 4279.00 (per gram), ..., "goldSpot": 4165.00, "bahtPerUSD": 33.68 }
//     "asTime" is Thai time (UTC+7) written without a zone. Checked against the last answer of the old source:
//     the four numbers and the time are identical.
//   Backup (checked 2026-09-29): GET https://api.chnwt.dev/thai-gold-api/latest
//     { "status": "success", "response": { "update_date": "29/09/2569",
//       "update_time": "เวลา 17:07 น. (ครั้งที่ 15)",
//       "price": { "gold": { "buy": "64,490.64", "sell": "66,800.00" },
//                  "gold_bar": { "buy": "65,800.00", "sell": "66,000.00" } } } }
//     The year is Buddhist Era (2569 = 2026). "gold" = ornament gold, "gold_bar" = gold bar.
// Prices are THB per 1 baht-weight (15.244 g).
// Terms of the association's website (read 2026-10-02): its content is for personal, non-commercial use.
// This dashboard is personal and non-commercial, asks once per run, and names the association as the source.

const { fetchJson, parseNumber, makeRecord, runSource, runIfMain } = require("./lib/common");

const MAIN_URL = process.env.GOLD_THAI_URL || "https://www.goldtraders.or.th/api/GoldPrices/Latest?readjson=false";
const BACKUP_URL = process.env.GOLD_THAI_BACKUP_URL || "https://api.chnwt.dev/thai-gold-api/latest";

const META = {
  source: "gold-thai",
  source_name: "Gold Traders Association of Thailand (96.5%)",
  source_url: "https://www.goldtraders.or.th",
  license: "Gold Traders Association - personal, non-commercial use, with attribution",
  kind: "market",
};

// Not in the future and not older than 30 days (the price is announced several times every business day)
function checkAge(ms, text) {
  const ageDays = (Date.now() - ms) / 86400000;
  if (Number.isNaN(ms) || ageDays < -1 || ageDays > 30) throw new Error(`Date looks wrong: ${text}`);
  return new Date(ms).toISOString();
}

// "29/09/2569" + "เวลา 17:07 น." -> "2026-09-29T10:07:00.000Z"
function thaiDateTimeToIso(dateText, timeText) {
  const d = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((dateText || "").trim());
  const t = /(\d{1,2}):(\d{2})/.exec(timeText || "");
  if (!d || !t) throw new Error(`Cannot read date/time: "${dateText}" "${timeText}"`);
  const year = Number(d[3]) - 543; // Buddhist Era -> Christian Era
  // Thai time is UTC+7, so subtract 7 hours to get UTC
  return checkAge(Date.UTC(year, Number(d[2]) - 1, Number(d[1]), Number(t[1]) - 7, Number(t[2])), `"${dateText}" "${timeText}"`);
}

// "2026-10-01T17:27:00" (Thai time, no zone) -> "2026-10-01T10:27:00.000Z"
function thaiLocalToIso(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(text || ""));
  if (!m) throw new Error(`Cannot read the time "${text}"`);
  return checkAge(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]) - 7, Number(m[5]), Number(m[6] || 0)), `"${text}"`);
}

async function fromAssociation() {
  const data = await fetchJson(MAIN_URL);
  for (const key of ["bL_BuyPrice", "bL_SellPrice", "oM965_BuyPrice", "oM965_SellPrice"]) {
    if (!(key in data)) throw new Error(`association: "${key}" is missing`);
  }
  return {
    time: thaiLocalToIso(data.asTime),
    values: { bar_buy: data.bL_BuyPrice, bar_sell: data.bL_SellPrice, ornament_buy: data.oM965_BuyPrice, ornament_sell: data.oM965_SellPrice },
  };
}

async function fromCommunityApi() {
  const data = await fetchJson(BACKUP_URL);
  if (data.status !== "success" || !data.response) throw new Error(`community API status is "${data.status}"`);
  const r = data.response;
  const price = r.price || {};
  if (!price.gold || !price.gold_bar) throw new Error('community API: missing "gold" or "gold_bar" prices');
  return {
    time: thaiDateTimeToIso(r.update_date, r.update_time),
    values: { bar_buy: price.gold_bar.buy, bar_sell: price.gold_bar.sell, ornament_buy: price.gold.buy, ornament_sell: price.gold.sell },
  };
}

// The four prices must look like Thai gold prices: positive, buy below sell, and all within a factor of two
function checkPrices(v) {
  const n = Object.fromEntries(Object.entries(v).map(([k, raw]) => [k, parseNumber(raw, k)]));
  if (!(n.bar_buy <= n.bar_sell) || !(n.ornament_buy <= n.ornament_sell)) throw new Error(`buy price above sell price: ${JSON.stringify(n)}`);
  const all = Object.values(n);
  if (Math.max(...all) > 2 * Math.min(...all) || Math.min(...all) < 5000) throw new Error(`prices do not look like THB per baht-weight: ${JSON.stringify(n)}`);
  return n;
}

async function getRecords(fetchedAt) {
  let result;
  try {
    result = await fromAssociation();
    result.values = checkPrices(result.values);
  } catch (err) {
    console.warn(`       gold-thai: main source failed (${err.message}), trying backup`);
    result = await fromCommunityApi(); // if this also fails, runSource marks the data stale
    result.values = checkPrices(result.values);
  }
  return Object.entries(result.values).map(([metric, value]) =>
    makeRecord({
      source: "gold-thai",
      metric,
      value,
      unit: "THB per baht-weight",
      fetched_at: fetchedAt,
      source_date: result.time,
    })
  );
}

const run = () => runSource(META, getRecords);
runIfMain(module, run);

module.exports = { run, thaiDateTimeToIso, thaiLocalToIso };
