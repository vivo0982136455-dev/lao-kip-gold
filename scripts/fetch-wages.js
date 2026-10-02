// Source #32: wages in Laos and 16 other countries (the 11 members of ASEAN, China, Japan, South Korea, Australia,
// the United States, Israel). Once a week; all free, no key.
//   ilo_min   ILO (ILOSTAT): statutory monthly minimum wage by year, in US dollars and in dollars of equal buying
//             power (PPP) - the same method for every country, but one or two years behind
//   ilo_avg   ILO (ILOSTAT): average monthly earnings of employees, in US dollars - the newest year each country has
//   fx        market rates of the US dollar, to turn today's legal minimum wages into dollars and kip
// The minimum wages in force TODAY are not in this file: they are read by hand from each government's notice and
// kept in data/invest-static.json ("wages"), with the date of the check.
// Writes data/wages.json (loaded only on the Economy > Wages tab).
// Usage: node scripts/fetch-wages.js
//
// Real answers (checked 2026-10-02):
//   GET https://rplumber.ilo.org/data/indicator/?id=EAR_INEE_CUR_NB_A&ref_area=LAO+THA+...&timefrom=2012&format=.csv
//       "ref_area","source","indicator","classif1","time","obs_value","note_indicator","note_source"
//       "LAO","FX:3245","EAR_INEE_CUR_NB","CUR_TYPE_USD","2024",79.336,"I19:3444_T30:133",
//       classif1: CUR_TYPE_LCU (own currency) | CUR_TYPE_USD | CUR_TYPE_PPP. No rows for Singapore and Brunei.
//       Cambodia: the "LCU" value is already US dollars (200) and its USD / PPP values are wrong (0.049): the LCU value
//       is used as dollars, PPP is left out. Myanmar: no USD value after 2020.
//   GET https://rplumber.ilo.org/data/indicator/?id=EAR_EMTA_SEX_CUR_NB_A&ref_area=...&sex=SEX_T&timefrom=2015&format=.csv
//       "ref_area","source","indicator","sex","classif1","time","obs_value","obs_status",...
//       "THA","BA:501","EAR_EMTA_SEX_CUR_NB","SEX_T","CUR_TYPE_USD","2025",508.3,...
//       Several sources per country and year can exist: the first row of the newest year is kept.
//   GET https://open.er-api.com/v6/latest/USD -> { "result": "success", "time_last_update_unix": ..., "rates": { "LAK": ... } }

const path = require("path");
const { DATA_DIR, fetchJson, fetchText, parseCsv, readJson, writeIfChanged } = require("./lib/common");
const { runParts, partsText } = require("./lib/parts");

const OUT_FILE = path.join(DATA_DIR, "wages.json");
const TIMEOUT_MS = 60000;
const ILO_URL = process.env.ILO_URL || "https://rplumber.ilo.org/data/indicator/";
const FX_URL = process.env.FX_MARKET_URL || "https://open.er-api.com/v6/latest/USD";
const COUNTRIES = ["LAO", "THA", "VNM", "KHM", "MMR", "MYS", "IDN", "PHL", "SGP", "BRN", "TLS", "CHN", "JPN", "KOR", "AUS", "USA", "ISR"];
const CURRENCIES = ["LAK", "THB", "VND", "MMK", "MYR", "IDR", "PHP", "SGD", "BND", "CNY", "JPY", "KRW", "AUD", "ILS"];
const MIN_FROM = 2012;
const AVG_FROM = 2015;
const USD_IS_LCU = new Set(["KHM"]); // the minimum wage is set in US dollars and reported in the LCU column

const SOURCES = {
  ilo: { source_name: "ILO (ILOSTAT): statutory minimum wage; average monthly earnings of employees", source_url: "https://ilostat.ilo.org/topics/wages/", license: "ILO - CC BY 4.0" },
  fx: { source_name: "Market mid rate (open.er-api.com / ExchangeRate-API)", source_url: "https://www.exchangerate-api.com", license: "Free API - attribution: Rates By Exchange Rate API" },
};

// One ILO indicator as rows of { area, type, year, value, ... }
async function ilo(id, extra, from) {
  const url = `${ILO_URL}?id=${id}&ref_area=${COUNTRIES.join("+")}${extra}&timefrom=${from}&format=.csv`;
  const rows = parseCsv(await fetchText(url, {}, TIMEOUT_MS));
  const head = rows[0] || [];
  const col = (name) => head.indexOf(name);
  const need = ["ref_area", "classif1", "time", "obs_value"];
  if (need.some((n) => col(n) < 0)) throw new Error(`ILO ${id}: the columns ${need.join(", ")} are not all in the answer (${head.join(", ").slice(0, 120)})`);
  return rows.slice(1).map((r) => ({ area: r[col("ref_area")], type: r[col("classif1")], year: Number(r[col("time")]), value: Number(r[col("obs_value")]) })).filter((r) => COUNTRIES.includes(r.area) && Number.isInteger(r.year) && Number.isFinite(r.value) && r.value > 0);
}
const round = (v, digits) => Math.round(v * 10 ** digits) / 10 ** digits;

// Monthly minimum wage by year: { LAO: { usd: [[year, value]], ppp: [[year, value]], lcu: [[year, value]] }, ... }
async function minimumWage() {
  const rows = await ilo("EAR_INEE_CUR_NB_A", "", MIN_FROM);
  const out = {};
  for (const r of rows) {
    const c = (out[r.area] = out[r.area] || { usd: new Map(), ppp: new Map(), lcu: new Map() });
    const key = r.type === "CUR_TYPE_USD" ? "usd" : r.type === "CUR_TYPE_PPP" ? "ppp" : r.type === "CUR_TYPE_LCU" ? "lcu" : null;
    if (key && !c[key].has(r.year)) c[key].set(r.year, r.value);
  }
  const series = {};
  for (const [area, c] of Object.entries(out)) {
    const list = (map, digits) => [...map].sort((a, b) => a[0] - b[0]).map(([y, v]) => [y, round(v, digits)]);
    if (USD_IS_LCU.has(area)) series[area] = { usd: list(c.lcu, 0), ppp: [], lcu: list(c.lcu, 0) };
    else series[area] = { usd: list(c.usd, 0), ppp: list(c.ppp, 0), lcu: list(c.lcu, 0) };
    // a dollar value that cannot be a monthly wage means the columns have changed their meaning
    for (const [y, v] of series[area].usd) if (v < 15 || v > 8000) throw new Error(`ILO minimum wage: ${area} ${y} = ${v} US$ a month is not possible`);
  }
  const lao = series.LAO && new Map(series.LAO.lcu).get(2023);
  if (lao !== 1600000) throw new Error(`ILO minimum wage: the known value Laos 2023 = 1,600,000 kip is missing (got ${lao}) - has the series changed?`);
  if (Object.keys(series).length < 12) throw new Error(`ILO minimum wage: only ${Object.keys(series).length} countries`);
  return { source: "ilo", indicator: "EAR_INEE_CUR_NB_A", unit: "per month", series };
}

// Average monthly earnings, newest year per country: { THA: { year, usd, ppp }, ... }
async function averageEarnings() {
  const rows = await ilo("EAR_EMTA_SEX_CUR_NB_A", "&sex=SEX_T", AVG_FROM);
  const latest = {};
  for (const r of rows) {
    if (r.type !== "CUR_TYPE_USD" && r.type !== "CUR_TYPE_PPP") continue;
    const key = r.type === "CUR_TYPE_USD" ? "usd" : "ppp";
    const c = (latest[r.area] = latest[r.area] || {});
    // the newest year that has a dollar value decides; PPP of the same year is added when it is there
    if (key === "usd" && (!c.year || r.year > c.year)) Object.assign(c, { year: r.year, usd: round(r.value, 0), ppp: null });
  }
  for (const r of rows) {
    const c = latest[r.area];
    if (c && r.type === "CUR_TYPE_PPP" && r.year === c.year && c.ppp === null) c.ppp = round(r.value, 0);
  }
  for (const [area, c] of Object.entries(latest)) if (c.usd < 30 || c.usd > 20000) throw new Error(`ILO average earnings: ${area} ${c.year} = ${c.usd} US$ a month is not possible`);
  if (Object.keys(latest).length < 12) throw new Error(`ILO average earnings: only ${Object.keys(latest).length} countries`);
  return { source: "ilo", indicator: "EAR_EMTA_SEX_CUR_NB_A", unit: "per month", latest };
}

async function fx() {
  const data = await fetchJson(FX_URL, {}, 20000);
  if (!data || data.result !== "success" || !data.rates) throw new Error("exchange rates: no rates in the answer");
  const rates = {};
  for (const cur of CURRENCIES) {
    const v = Number(data.rates[cur]);
    if (!Number.isFinite(v) || v <= 0) throw new Error(`exchange rates: no rate for ${cur}`);
    rates[cur] = v;
  }
  const date = new Date(Number(data.time_last_update_unix) * 1000).toISOString().slice(0, 10);
  return { source: "fx", base: "USD", date, rates };
}

async function main() {
  const old = readJson(OUT_FILE, {});
  const { out, failed } = await runParts(old, [
    ["ilo_min", { source: "ilo", indicator: "EAR_INEE_CUR_NB_A", unit: "per month", series: {} }, minimumWage, (p) => `${Object.keys(p.series).length} countries; Laos ${JSON.stringify(p.series.LAO.usd.slice(-2))} US$`],
    ["ilo_avg", { source: "ilo", indicator: "EAR_EMTA_SEX_CUR_NB_A", unit: "per month", latest: {} }, averageEarnings, (p) => `${Object.keys(p.latest).length} countries; Laos ${JSON.stringify(p.latest.LAO)}`],
    ["fx", { source: "fx", base: "USD", date: null, rates: {} }, fx, (p) => `${Object.keys(p.rates).length} currencies on ${p.date}; 1 US$ = ${p.rates.LAK} kip`],
  ]);
  const text = partsText({ sources: SOURCES }, out);
  writeIfChanged(OUT_FILE, text);
  console.log(`\nDone: ${failed} of 3 parts failed. Wrote data/wages.json (${(text.length / 1024).toFixed(1)} KB)`);
  return { ok: failed < 3 };
}

if (require.main === module) main().then((r) => (process.exitCode = r.ok ? 0 : 1));

module.exports = { main };
