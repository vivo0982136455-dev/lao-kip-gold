// Source #3: Thai Gold Traders Association price, 96.5% gold (MARKET).
// Uses a free community API that copies goldtraders.or.th. Unofficial - it may break,
// in that case the old values are kept and marked stale.
//
// Real response (checked 2026-09-29):
//   { "status": "success", "response": { "update_date": "29/09/2569",
//     "update_time": "เวลา 17:07 น. (ครั้งที่ 15)",
//     "price": { "gold": { "buy": "64,490.64", "sell": "66,800.00" },
//                "gold_bar": { "buy": "65,800.00", "sell": "66,000.00" } } } }
// Notes: the year is Buddhist Era (2569 = 2026). Time is Thai time (UTC+7).
//        "gold" = ornament gold, "gold_bar" = gold bar. Prices are THB per 1 baht-weight (15.244 g).

const { fetchJson, parseNumber, makeRecord, runSource, runIfMain } = require("./lib/common");

const URL = process.env.GOLD_THAI_URL || "https://api.chnwt.dev/thai-gold-api/latest";

const META = {
  source: "gold-thai",
  source_name: "Gold Traders Association of Thailand (96.5%)",
  source_url: "https://www.goldtraders.or.th",
  license: "Unofficial community API: https://api.chnwt.dev/thai-gold-api",
  kind: "market",
};

// "29/09/2569" + "เวลา 17:07 น." -> "2026-09-29T10:07:00.000Z"
function thaiDateTimeToIso(dateText, timeText) {
  const d = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((dateText || "").trim());
  const t = /(\d{1,2}):(\d{2})/.exec(timeText || "");
  if (!d || !t) throw new Error(`Cannot read date/time: "${dateText}" "${timeText}"`);

  const year = Number(d[3]) - 543; // Buddhist Era -> Christian Era
  const month = Number(d[2]);
  const day = Number(d[1]);
  // Thai time is UTC+7, so subtract 7 hours to get UTC
  const ms = Date.UTC(year, month - 1, day, Number(t[1]) - 7, Number(t[2]));

  // Sanity check: not in the future and not older than 30 days
  const ageDays = (Date.now() - ms) / 86400000;
  if (Number.isNaN(ms) || ageDays < -1 || ageDays > 30) {
    throw new Error(`Date looks wrong: "${dateText}" "${timeText}"`);
  }
  return new Date(ms).toISOString();
}

async function getRecords(fetchedAt) {
  const data = await fetchJson(URL);
  if (data.status !== "success" || !data.response) {
    throw new Error(`API status is "${data.status}"`);
  }
  const r = data.response;
  const price = r.price || {};
  if (!price.gold || !price.gold_bar) throw new Error('Missing "gold" or "gold_bar" prices');

  const sourceDate = thaiDateTimeToIso(r.update_date, r.update_time);
  const values = {
    bar_buy: price.gold_bar.buy,
    bar_sell: price.gold_bar.sell,
    ornament_buy: price.gold.buy,
    ornament_sell: price.gold.sell,
  };

  return Object.entries(values).map(([metric, raw]) =>
    makeRecord({
      source: "gold-thai",
      metric,
      value: parseNumber(raw, metric),
      unit: "THB per baht-weight",
      fetched_at: fetchedAt,
      source_date: sourceDate,
    })
  );
}

const run = () => runSource(META, getRecords);
runIfMain(module, run);

module.exports = { run, thaiDateTimeToIso };
