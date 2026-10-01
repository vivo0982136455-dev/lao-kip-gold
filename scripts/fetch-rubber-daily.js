// Source #25: daily rubber prices in the markets around Laos (all free, no key). Runs with the 30-minute job,
// but asks its sources at most every 3 hours (they publish once or twice a day; every hour while a part is failing).
//   thai_border  Rubber Authority of Thailand (RAOT), central rubber markets: the two markets next to Laos -
//                Nong Khai (across the Mekong from Vientiane) and Chiang Rai (next to Bokeo) - and the closing price
//                of all 8 markets. Cup lump (100% dry rubber), fresh latex, unsmoked sheet, smoked sheet RSS3.
//                Thailand buys almost no rubber from Laos (see fetch-rubber-borders.js): these are REFERENCE prices,
//                the nearest open market prices to Laos - not prices paid for Lao rubber.
//   malaysia     Malaysian Rubber Board (LGM): official daily prices of SMR 20 (block rubber) and latex in bulk
//   china        Shanghai Futures Exchange daily report: settlement price of the most traded contract of
//                natural rubber (RU) and of TSR 20 (NR, traded on its energy exchange INE)
//   fx           market rates of the US dollar (to turn baht, ringgit, yuan, peso into dollars and kip)
// Writes data/rubber-daily.json (loaded only on the Economy > Rubber tab).
// Usage: node scripts/fetch-rubber-daily.js            (today's numbers, always asks)
//        node scripts/fetch-rubber-daily.js months=14  (also read the 14 months before: fills the history once)
//
// Real answers (checked 2026-10-01):
//   RAOT  GET https://misdata.rubberthaiecon.com/report/repprices.php?selectrubber=4&selectmm=9&selectyy=2026
//         selectrubber: 1 unsmoked sheet, 2 smoked sheet RSS3, 3 fresh latex, 4 cup lump (DRC 100%), 5 crepe.
//         One HTML table. Header rows: date | "<kind> (Non EUDR)" over 8 markets | closing price | total kg |
//         "<kind> (EUDR)" over the same 8 markets | closing price | total kg | weighted average.
//         Market row: สงขลา นครศรีธรรมราช สุราษฎร์ธานี ยะลา บุรีรัมย์ หนองคาย ระยอง เชียงราย (twice).
//         Data row: "30/9/2569" (Buddhist year) | "" | 75.44 | 75.00 | 76.00 | 74.71 | 76.58 | 77.10 | 74.99 | 75.50 |
//         1,121,156.00 | ... An empty cell = no trade in that market that day.
//   LGM   GET https://www.lgm.gov.my/webv2api/api/rubberprice/month=10&year=2026
//         [ {"date":"2026-10-01","grade":"SMR 20","rm":"1038.50","us":"259.30","tone":"Steady"}, ...,
//           {"date":"2026-10-01","grade":"Latex in Bulk","rm":"746.00","us":"746.00","tone":"Steady"} ]
//         rm = Malaysian sen per kg, us = US cents per kg (for latex the "us" field repeats the sen value: not used)
//   SHFE  GET https://www.shfe.com.cn/data/tradedata/future/dailydata/kx20260930.dat  (404 on a day without trading)
//         { "report_date": "20260930", "o_curinstrument": [ { "PRODUCTID": "ru_f", "DELIVERYMONTH": "2701",
//           "SETTLEMENTPRICE": 19710, "VOLUME": 513683, ... }, { "PRODUCTID": "nr_f", ... }, subtotal rows ... ] }
//         Prices in yuan per tonne. Copyright SHFE: shown here for personal, non-commercial information, with the source.
//   FX    GET https://open.er-api.com/v6/latest/USD -> { "result": "success", "time_last_update_unix": ...,
//         "rates": { "THB": 33.59, "MYR": 4.0, "CNY": 7.0, "PHP": 57.2, "LAK": 22266.6, ... } }

const path = require("path");
const { DATA_DIR, fetchJson, fetchText, readJson, writeIfChanged } = require("./lib/common");
const { runParts, partsText } = require("./lib/parts");

const OUT_FILE = path.join(DATA_DIR, "rubber-daily.json");
const TIMEOUT_MS = 20000; // short: a source that hangs must not eat the 10 minutes of the 30-minute job
const GAP_OK_MS = 3 * 3600000; // run() from fetch-all.js: time between two checks when everything worked
const GAP_FAILED_MS = 3600000; // ... and while a part is failing
const PARTS = ["thai_border", "malaysia", "china", "fx"];
const DAYS_KEPT = 190; // daily rows kept per series (the chart shows up to 3 months)
const FIRST_MONTH = "2021-01"; // RAOT monthly averages kept from here (filled with months=N)

const SOURCES = {
  raot: { source_name: "Rubber Authority of Thailand: central rubber market prices", source_url: "https://misdata.rubberthaiecon.com/report/repprices.php", license: "Rubber Authority of Thailand - public price report, with attribution" },
  lgm: { source_name: "Malaysian Rubber Board (LGM): daily rubber prices", source_url: "https://www.lgm.gov.my", license: "Malaysian Rubber Board - official prices, with attribution" },
  shfe: { source_name: "Shanghai Futures Exchange: daily trading report (natural rubber RU, TSR 20 NR)", source_url: "https://www.shfe.com.cn/reports/tradedata/dailyandweeklydata/", license: "© Shanghai Futures Exchange - shown for personal, non-commercial information" },
  fx: { source_name: "Market mid rate (open.er-api.com / ExchangeRate-API)", source_url: "https://www.exchangerate-api.com", license: "Free API - attribution: Rates By Exchange Rate API" },
};

const RAOT_URL = process.env.RAOT_URL || "https://misdata.rubberthaiecon.com/report/repprices.php";
const RAOT_KINDS = { cuplump: 4, latex: 3, uss: 1, rss3: 2 };
const RAOT_MARKETS = { nongkhai: "หนองคาย", chiangrai: "เชียงราย" };
const LGM_URL = process.env.LGM_URL || "https://www.lgm.gov.my/webv2api/api/rubberprice";
const SHFE_URL = process.env.SHFE_URL || "https://www.shfe.com.cn/data/tradedata/future/dailydata";
const FX_URL = process.env.FX_MARKET_URL || "https://open.er-api.com/v6/latest/USD";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round2 = (v) => Math.round(v * 100) / 100;
const pad = (n) => String(n).padStart(2, "0");
// "2026-09" -> the month before
const monthBefore = (m) => {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 2, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};
// today's date in a time zone that is `hours` ahead of UTC
const dayAt = (hours, back = 0) => new Date(Date.now() + hours * 3600e3 - back * 86400e3).toISOString().slice(0, 10);

// Newest rows first in, then: sorted by day, one row per day, only the last DAYS_KEPT
function mergeDays(oldRows, newRows, keep = DAYS_KEPT) {
  const byDay = new Map((oldRows || []).map((r) => [r[0], r]));
  for (const r of newRows) byDay.set(r[0], r);
  return [...byDay.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-keep);
}

// ---------- Thailand: RAOT central markets ----------
const cellText = (html) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
function tableRows(html) {
  return [...html.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((tr) => [...tr[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => cellText(c[1])));
}
const thaiNumber = (s) => {
  const n = Number(String(s).replace(/,/g, ""));
  return s !== "" && Number.isFinite(n) && n > 0 ? n : null;
};

// One kind of rubber, one month -> [[day, nongkhai, chiangrai, close (all markets, non-EUDR), close EUDR], ...]
async function raotMonth(kind, month) {
  const url = `${RAOT_URL}?selectrubber=${RAOT_KINDS[kind]}&selectmm=${Number(month.slice(5, 7))}&selectyy=${month.slice(0, 4)}`;
  const rows = tableRows(await fetchText(url, {}, TIMEOUT_MS));
  const head = rows.find((r) => r.includes(RAOT_MARKETS.nongkhai) && r.includes(RAOT_MARKETS.chiangrai));
  if (!head) throw new Error(`RAOT ${kind} ${month}: the row with the market names was not found`);
  const n = head.length / 2; // the markets are listed twice: Non EUDR, then EUDR
  if (!Number.isInteger(n) || head.indexOf(RAOT_MARKETS.nongkhai) >= n) throw new Error(`RAOT ${kind} ${month}: unexpected market row (${head.length} cells)`);
  const col = { nongkhai: 1 + head.indexOf(RAOT_MARKETS.nongkhai), chiangrai: 1 + head.indexOf(RAOT_MARKETS.chiangrai), close: 1 + n, eudr: 1 + n + 2 + n };
  const out = [];
  for (const r of rows) {
    const d = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(r[0] || "");
    if (!d || r.length < col.eudr + 1) continue;
    const day = `${Number(d[3]) - 543}-${pad(d[2])}-${pad(d[1])}`; // Buddhist year -> AD
    if (day.slice(0, 7) !== month) throw new Error(`RAOT ${kind} ${month}: a row is dated ${day}`);
    // A value outside 10-250 baht per kg is a typing mistake in the source (seen: 715.84 for latex on 2021-05-29):
    // that one cell is left empty, the rest of the day is kept.
    const v = [r[col.nongkhai], r[col.chiangrai], r[col.close], r[col.eudr]].map((cell) => {
      const x = thaiNumber(cell);
      if (x !== null && (x < 10 || x > 250)) {
        console.warn(`[WARN] RAOT ${kind} ${day}: ${x} baht per kg is not a possible price - skipped`);
        return null;
      }
      return x;
    });
    if (v.some((x) => x !== null)) out.push([day, ...v]);
  }
  return out;
}

const average = (list) => (list.length ? round2(list.reduce((s, v) => s + v, 0) / list.length) : null);
// [[month, avg nongkhai, avg chiangrai, avg close, days with a closing price]]
function monthAverages(days) {
  const byMonth = new Map();
  for (const r of days) (byMonth.get(r[0].slice(0, 7)) || byMonth.set(r[0].slice(0, 7), []).get(r[0].slice(0, 7))).push(r);
  return [...byMonth].map(([m, rows]) => [m, ...[1, 2, 3].map((i) => average(rows.map((r) => r[i]).filter((x) => x !== null))), rows.filter((r) => r[3] !== null).length]);
}

async function thaiBorder(old, monthsBack) {
  const now = dayAt(7).slice(0, 7); // Thai time
  const months = [now];
  // the month before: at the start of a month (late corrections), or as many as asked for with months=N
  const extra = Math.max(monthsBack, Number(dayAt(7).slice(8, 10)) <= 5 ? 1 : 0);
  for (let i = 0; i < extra; i++) months.push(monthBefore(months[months.length - 1]));
  const kinds = {};
  let lastDay = null;
  for (const kind of Object.keys(RAOT_KINDS)) {
    const before = (old && old.kinds && old.kinds[kind]) || { days: [], months: [] };
    const fresh = [];
    for (const month of months) {
      if (month < FIRST_MONTH) break;
      fresh.push(...(await raotMonth(kind, month)));
      await sleep(400);
    }
    // monthly averages: recomputed for the months just read, kept for older months
    const read = new Set(months);
    const monthly = new Map(before.months.map((r) => [r[0], r]));
    for (const r of monthAverages(fresh)) if (read.has(r[0])) monthly.set(r[0], r);
    kinds[kind] = { days: mergeDays(before.days, fresh), months: [...monthly.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1)) };
    const days = kinds[kind].days;
    if (days.length && (!lastDay || days[days.length - 1][0] > lastDay)) lastDay = days[days.length - 1][0];
  }
  if (!lastDay) throw new Error("RAOT: no price rows at all");
  return { source: "raot", unit: "THB per kg", columns: ["nongkhai", "chiangrai", "all", "all_eudr"], latest_day: lastDay, kinds };
}

// ---------- Malaysia: LGM ----------
async function lgmMonth(month) {
  const list = await fetchJson(`${LGM_URL}/month=${Number(month.slice(5, 7))}&year=${month.slice(0, 4)}`, {}, TIMEOUT_MS);
  if (!Array.isArray(list)) throw new Error(`LGM ${month}: unexpected answer ${JSON.stringify(list).slice(0, 80)}`);
  const byDay = new Map();
  for (const r of list) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date || "")) continue;
    const row = byDay.get(r.date) || [r.date, null, null];
    if (r.grade === "SMR 20") row[1] = Number(r.us) > 20 && Number(r.us) < 2000 ? round2(Number(r.us) / 100) : null; // US cents -> USD per kg
    if (r.grade === "Latex in Bulk") row[2] = Number(r.rm) > 50 && Number(r.rm) < 5000 ? round2(Number(r.rm) / 100) : null; // sen -> ringgit per kg
    byDay.set(r.date, row);
  }
  return [...byDay.values()].filter((r) => r[1] !== null || r[2] !== null);
}
async function malaysia(old, monthsBack) {
  const now = dayAt(8).slice(0, 7);
  const months = [now];
  const extra = Math.max(Math.min(monthsBack, 7), Number(dayAt(8).slice(8, 10)) <= 5 ? 1 : 0);
  for (let i = 0; i < extra; i++) months.push(monthBefore(months[months.length - 1]));
  const fresh = [];
  for (const m of months) {
    fresh.push(...(await lgmMonth(m)));
    await sleep(300);
  }
  const days = mergeDays(old && old.days, fresh);
  if (!days.length) throw new Error("LGM: no price rows");
  return { source: "lgm", columns: ["smr20_usd_kg", "latex_myr_kg"], latest_day: days[days.length - 1][0], days };
}

// ---------- China: SHFE daily report ----------
// -> [day, RU settlement (yuan per tonne), RU contract, NR settlement, NR contract] or null on a day without trading
async function shfeDay(day) {
  let text;
  try {
    text = await fetchText(`${SHFE_URL}/kx${day.replace(/-/g, "")}.dat`, { Referer: "https://www.shfe.com.cn/" }, TIMEOUT_MS);
  } catch (err) {
    if (/HTTP 404/.test(err.message)) return null; // weekend or holiday
    throw err;
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null; // an HTML "not found" page
  }
  const main = (id) => {
    const rows = (data.o_curinstrument || []).filter((r) => String(r.PRODUCTID).trim() === id && /^\d{4}$/.test(String(r.DELIVERYMONTH).trim()) && Number(r.SETTLEMENTPRICE) > 0);
    if (!rows.length) return [null, null];
    const top = rows.reduce((a, b) => (Number(b.VOLUME) > Number(a.VOLUME) ? b : a));
    const price = Number(top.SETTLEMENTPRICE);
    if (price < 3000 || price > 100000) throw new Error(`SHFE ${id} ${day}: settlement price ${price} outside 3,000-100,000 yuan per tonne`);
    return [price, String(top.DELIVERYMONTH).trim()];
  };
  const row = [day, ...main("ru_f"), ...main("nr_f")];
  return row[1] === null && row[3] === null ? null : row;
}
async function china(old, monthsBack) {
  const have = new Set(((old && old.days) || []).map((r) => r[0]));
  const fresh = [];
  const lookBack = monthsBack ? 100 : 12; // calendar days
  let asked = 0;
  for (let back = 0; back <= lookBack; back++) {
    const day = dayAt(8, back);
    const weekday = new Date(day + "T00:00:00Z").getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    if (have.has(day) && back > 1) continue; // already stored (today and yesterday are read again: late publication)
    const row = await shfeDay(day);
    asked++;
    if (row) fresh.push(row);
    await sleep(350);
    if (!monthsBack && fresh.length >= 3 && asked >= 3) break; // normal run: the newest few days are enough
  }
  const days = mergeDays(old && old.days, fresh);
  if (!days.length) throw new Error("SHFE: no trading day found in the last days");
  return { source: "shfe", unit: "CNY per tonne", columns: ["ru", "ru_contract", "nr", "nr_contract"], latest_day: days[days.length - 1][0], days };
}

// ---------- market exchange rates ----------
async function fx() {
  const data = await fetchJson(FX_URL, {}, TIMEOUT_MS);
  if (data.result !== "success" || data.base_code !== "USD") throw new Error(`FX: unexpected answer (${data.result}, ${data.base_code})`);
  const rates = {};
  for (const cur of ["THB", "MYR", "CNY", "PHP", "LAK"]) {
    const v = Number(data.rates && data.rates[cur]);
    if (!(v > 0)) throw new Error(`FX: no rate for ${cur}`);
    rates[cur] = Math.round(v * 10000) / 10000;
  }
  return { source: "fx", unit: "per USD", date: new Date(Number(data.time_last_update_unix) * 1000).toISOString().slice(0, 10), rates };
}

async function main(args = process.argv.slice(2)) {
  const monthsBack = Number((args.find((a) => /^months=\d+$/.test(a)) || "months=0").slice(7));
  const old = readJson(OUT_FILE, {});
  const now = new Date().toISOString();
  if (args.includes("throttle") && old.checked_at) {
    const failing = PARTS.some((id) => !old[id] || old[id].stale);
    const minutes = Math.round((Date.parse(now) - Date.parse(old.checked_at)) / 60000);
    if (minutes * 60000 < (failing ? GAP_FAILED_MS : GAP_OK_MS)) {
      console.log(`rubber-daily: checked ${minutes} minutes ago - not asking again yet`);
      return { ok: true, skipped: true };
    }
  }
  const { out, failed } = await runParts(old, [
    ["thai_border", { source: "raot", unit: "THB per kg", columns: ["nongkhai", "chiangrai", "all", "all_eudr"], latest_day: null, kinds: {} }, (o) => thaiBorder(o, monthsBack), (p) => `to ${p.latest_day}, cup lump ${JSON.stringify(p.kinds.cuplump.days[p.kinds.cuplump.days.length - 1])}`],
    ["malaysia", { source: "lgm", columns: ["smr20_usd_kg", "latex_myr_kg"], latest_day: null, days: [] }, (o) => malaysia(o, monthsBack), (p) => `${p.days.length} days, latest ${JSON.stringify(p.days[p.days.length - 1])}`],
    ["china", { source: "shfe", unit: "CNY per tonne", columns: ["ru", "ru_contract", "nr", "nr_contract"], latest_day: null, days: [] }, (o) => china(o, monthsBack), (p) => `${p.days.length} days, latest ${JSON.stringify(p.days[p.days.length - 1])}`],
    ["fx", { source: "fx", unit: "per USD", date: null, rates: {} }, () => fx(), (p) => `${p.date} ${JSON.stringify(p.rates)}`],
  ]);
  const text = partsText({ sources: SOURCES, checked_at: now }, out);
  writeIfChanged(OUT_FILE, text);
  console.log(`rubber-daily: ${failed} of 4 parts failed. Wrote data/rubber-daily.json (${(text.length / 1024).toFixed(0)} KB)`);
  return { ok: failed < 4 };
}

if (require.main === module) main().then((r) => (process.exitCode = r.ok ? 0 : 1));

module.exports = { main, run: () => main(["throttle"]), raotMonth, lgmMonth, shfeDay, monthAverages };
