// Source #15: Thai retail fuel prices, Bangkok (MARKET). Bangchak's own public price API (no key);
// backup: the community Thai oil API (PTT prices). Used to compare fuel in Laos and Thailand.
//
// Real responses (checked 2026-09-30):
//   Bangchak: [ { "OilDateNow": "30/09/2569", "OilRemark2": "ราคามีผล ณ วันที่ 24 ก.ย. 69 เวลา 05.00 น.",
//                 "OilList": "[{\"OilName\":\"ไฮดีเซล S\",\"PriceToday\":41.44,\"PriceTomorrow\":41.44,...}, ...]" } ]
//   chnwt:    { "status": "success", "response": { "date": "30 กันยายน 2569",
//               "stations": { "ptt": { "diesel": { "name": "ดีเซล B7", "price": "41.44" }, "gasohol_95": {...}, "gasohol_91": {...} } } } }
// Prices are THB per litre. One record per day (the date of the reading); when Bangchak has already
// announced a DIFFERENT price for tomorrow, it is stored as "<fuel>_next" dated tomorrow.

const { fetchJson, parseNumber, makeRecord, runSource, runIfMain } = require("./lib/common");

const MAIN_URL = process.env.FUEL_THAI_URL || "https://oil-price.bangchak.co.th/ApiOilPrice2/th";
const BACKUP_URL = process.env.FUEL_THAI_BACKUP_URL || "https://api.chnwt.dev/thai-oil-api/latest";

const META = {
  source: "fuel-thai",
  source_name: "Thai fuel prices, Bangkok (Bangchak; backup PTT)",
  source_url: "https://www.bangchak.co.th/th/oilprice",
  license: "Public price lists of the fuel companies",
  kind: "market",
};

// our metric -> Bangchak name / PTT key
const FUELS = {
  diesel: { bangchak: "ไฮดีเซล S", ptt: "diesel" },
  gasohol95: { bangchak: "แก๊สโซฮอล์ 95 S EVO", ptt: "gasohol_95" },
  gasohol91: { bangchak: "แก๊สโซฮอล์ 91 S EVO", ptt: "gasohol_91" },
};

// "30/09/2569" (Buddhist year) -> "2026-09-30"
function beDay(text) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(text || "").trim());
  if (!m) return null;
  const y = Number(m[3]) - 543;
  return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}
const addDay = (day) => new Date(Date.parse(day + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);
const todayBangkok = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);

function checkPrice(value, label) {
  if (value < 10 || value > 150) throw new Error(`${label} looks wrong: ${value}`);
  return value;
}

async function fromBangchak(fetchedAt) {
  const data = await fetchJson(MAIN_URL);
  const d = Array.isArray(data) ? data[0] : null;
  if (!d || !d.OilList) throw new Error("Bangchak: no OilList");
  const list = JSON.parse(d.OilList);
  const day = beDay(d.OilDateNow) || todayBangkok();
  const records = [];
  for (const [metric, f] of Object.entries(FUELS)) {
    const o = list.find((x) => x.OilName === f.bangchak);
    if (!o) throw new Error(`Bangchak: "${f.bangchak}" not in the list`);
    const today = checkPrice(parseNumber(o.PriceToday, metric), metric);
    records.push(makeRecord({ source: META.source, metric, value: today, unit: "THB per litre", fetched_at: fetchedAt, source_date: day }));
    const tomorrow = Number(o.PriceTomorrow);
    if (tomorrow > 0 && Math.abs(tomorrow - today) >= 0.01) {
      records.push(makeRecord({ source: META.source, metric: `${metric}_next`, value: checkPrice(tomorrow, metric + " tomorrow"), unit: "THB per litre", fetched_at: fetchedAt, source_date: addDay(day) }));
    }
  }
  return records;
}

async function fromPtt(fetchedAt) {
  const data = await fetchJson(BACKUP_URL);
  const ptt = data && data.status === "success" && data.response && data.response.stations && data.response.stations.ptt;
  if (!ptt) throw new Error("PTT backup: no station data");
  const day = todayBangkok();
  return Object.entries(FUELS).map(([metric, f]) => {
    if (!ptt[f.ptt]) throw new Error(`PTT backup: no ${f.ptt}`);
    return makeRecord({ source: META.source, metric, value: checkPrice(parseNumber(ptt[f.ptt].price, metric), metric), unit: "THB per litre", fetched_at: fetchedAt, source_date: day });
  });
}

async function getRecords(fetchedAt) {
  try {
    return await fromBangchak(fetchedAt);
  } catch (err) {
    console.warn(`       fuel-thai: Bangchak failed (${err.message}), trying PTT backup`);
    return await fromPtt(fetchedAt);
  }
}

const run = () => runSource(META, getRecords);
runIfMain(module, run);

module.exports = { run };
