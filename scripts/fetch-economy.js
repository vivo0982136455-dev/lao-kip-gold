// Sources #6, #7, #8: Lao economy - yearly numbers + MONTHLY inflation and gold (all automatic).
//   #6 World Bank API (actual yearly data)          - free, no key
//   #7 IMF World Economic Outlook (yearly, with forecasts) - free, no key. First the IMF SDMX service
//      (dataset IMF.RES,WEO), then the DataMapper API: DataMapper answers HTTP 403 to GitHub's servers (2026-10-01)
//   #8 IMF SDMX API (monthly): Lao CPI (all items + 12 categories), CPI index, world gold price
//      (replaced the Google-Sheet CPI entry on 2026-09-30 - nothing to type in any more)
// Also builds monthly BOL mid rates (USD, THB, CNY) from data/history/bol.json for the "value kept" comparison
// and the yearly exchange-rate chart.
// Writes data/economy.json. Run monthly (GitHub Actions) or by hand: node scripts/fetch-economy.js
//
// Real responses (checked 2026-09-29 / 2026-09-30):
//   World Bank: [ {page, lastupdated:"2026-07-13"}, [ { "date": "2025", "value": 18302970218.59 }, ... ] ]
//   IMF DataMapper: { "values": { "NGDP_RPCH": { "LAO": { "2024": 4.3, ... "2031": 3 }, ...all countries } } }
//   IMF SDMX WEO (2026-10-01): GET .../IMF.RES,WEO/LAO.NGDP_RPCH.A -> same shape as the monthly series below, with
//                      TIME_PERIOD ids "1980" ... "2031" and values like "4.771627"; NGDPD is in US dollars (not bn);
//                      the world total is country "G001"
//                      Which EDITION the numbers are (2026-10-02): structure.attributes.dataSet[] holds
//                      { id: "PUBLICATION_DATE", values: [{ id: "2026-04-14T13:00:00Z" }] } and "UPDATE_DATE" the same
//                      way; dataSets[0].attributes[i] is the index into values. The attribute that would say up to
//                      which year the numbers are actual data ("LATEST_ACTUAL_ANNUAL_DATA") is empty for Laos, so
//                      the page calls every IMF number of a past year an estimate.
//   IMF SDMX (JSON): { structure: { dimensions: { series: [..., {id:"COICOP_1999", values:[{id:"CP01", name:"Food ..."}]}],
//                      observation: [{ id:"TIME_PERIOD", values:[{id:"2026-M08"}, ...] }] } },
//                      dataSets: [ { series: { "0:0:3:0:0": { observations: { "0": ["7.7", ...] } } } } ] }
// One failing indicator keeps its old values (marked stale); the others still update.

const path = require("path");
const { DATA_DIR, HISTORY_DIR, fetchJson, parseAnyNumber, readJson, writeIfChanged } = require("./lib/common");

const OUT_FILE = path.join(DATA_DIR, "economy.json");
const FIRST_YEAR = 2000;
const FIRST_MONTH = "2015-01";
const CATEGORY_FIRST_MONTH = "2019-01";
const IMF_SDMX = "https://api.imf.org/external/sdmx/2.1/data/";

const SOURCES = {
  worldbank: {
    source_name: "World Bank Open Data",
    source_url: "https://data.worldbank.org/country/lao-pdr",
    license: "CC BY 4.0 - The World Bank",
  },
  imf: {
    source_name: "IMF World Economic Outlook",
    source_url: "https://www.imf.org/external/datamapper/profile/LAO",
    license: "IMF - free to use with attribution",
  },
  imf_sdmx: {
    source_name: "IMF Data (CPI, Primary Commodity Prices)",
    source_url: "https://data.imf.org",
    license: "IMF - free to use with attribution",
  },
  bol: {
    source_name: "Bank of the Lao PDR (monthly average of the daily buying and selling rates)",
    source_url: "https://www.bol.gov.la/en/ExchangRate",
    license: "Official rates of the Bank of the Lao PDR - the days before October 2026 through the data mirror by AllRatesToday (CC BY 4.0)",
  },
};

// Monthly series from the IMF SDMX API. An empty key part ("LAO.CPI..") = every category at once.
const MONTHLY = {
  cpi_yoy: { key: "IMF.STA,CPI/LAO.CPI._T.YOY_PCH_PA_PT.M", unit: "%" }, // inflation vs same month last year
  cpi_index: { key: "IMF.STA,CPI/LAO.CPI._T.IX.M", unit: "index" }, // price level (for "real" values)
  gold_usd: { key: "IMF.RES,PCPS/G001.PGOLD.USD.M", unit: "USD per troy oz" }, // world gold, monthly average
  silver_usd: { key: "IMF.RES,PCPS/G001.PSILVER.USD.M", unit: "USD per troy oz" }, // world silver, monthly average
  brent_usd: { key: "IMF.RES,PCPS/G001.POILBRE.USD.M", unit: "USD per barrel" }, // Brent crude oil, monthly average
  tha_cpi_yoy: { key: "IMF.STA,CPI/THA.CPI._T.YOY_PCH_PA_PT.M", unit: "%" }, // Thailand inflation, for comparison
};
const CPI_CATEGORIES_KEY = "IMF.STA,CPI/LAO.CPI..YOY_PCH_PA_PT.M";

// id -> where to get it. "unit" is what the value means after "scale" is applied.
const INDICATORS = {
  "wb.NY.GDP.MKTP.CD": { source: "worldbank", code: "NY.GDP.MKTP.CD", unit: "USD bn", scale: 1e-9 },
  "wb.NY.GDP.MKTP.KD.ZG": { source: "worldbank", code: "NY.GDP.MKTP.KD.ZG", unit: "%" },
  "wb.FP.CPI.TOTL.ZG": { source: "worldbank", code: "FP.CPI.TOTL.ZG", unit: "%" },
  "wb.BX.KLT.DINV.CD.WD": { source: "worldbank", code: "BX.KLT.DINV.CD.WD", unit: "USD m", scale: 1e-6 },
  "wb.PA.NUS.FCRF": { source: "worldbank", code: "PA.NUS.FCRF", unit: "LAK per USD" },
  // the same official yearly rate of the baht and the yuan: kip per baht / per yuan of the years before our own
  // BOL history starts (2021) are worked out through the dollar on the page (audit 2026-10-02, P2-6)
  "wb.PA.NUS.FCRF.THA": { source: "worldbank", code: "PA.NUS.FCRF", area: "THA", unit: "THB per USD" },
  "wb.PA.NUS.FCRF.CHN": { source: "worldbank", code: "PA.NUS.FCRF", area: "CHN", unit: "CNY per USD" },
  "imf.NGDPD": { source: "imf", code: "NGDPD", unit: "USD bn" },
  "imf.NGDP_RPCH": { source: "imf", code: "NGDP_RPCH", unit: "%" },
  "imf.PCPIPCH": { source: "imf", code: "PCPIPCH", unit: "%" },
  "imf.BCA_NGDPD": { source: "imf", code: "BCA_NGDPD", unit: "% of GDP" },
  "imf.GGXWDG_NGDP": { source: "imf", code: "GGXWDG_NGDP", unit: "% of GDP" },
  // for comparison with Laos (Cost of living page): the world average (Thailand is compared month by month: tha_cpi_yoy)
  "imf.PCPIPCH.WORLD": { source: "imf", code: "PCPIPCH", area: "WEOWORLD", unit: "%" },
};

const round = (v) => Math.round(v * 1000) / 1000;

async function fromWorldBank(def) {
  const url = `https://api.worldbank.org/v2/country/${def.area || "LAO"}/indicator/${def.code}?format=json&per_page=100&date=${FIRST_YEAR}:2040`;
  const data = await fetchJson(url, {}, 60000); // the World Bank API sometimes needs more than 20 s
  if (!Array.isArray(data) || !Array.isArray(data[1])) {
    throw new Error(`Unexpected World Bank response: ${JSON.stringify(data).slice(0, 120)}`);
  }
  const values = data[1]
    .filter((row) => row.value !== null && /^\d{4}$/.test(row.date))
    .map((row) => [Number(row.date), round(parseAnyNumber(row.value, def.code) * (def.scale || 1))])
    .sort((a, b) => a[0] - b[0]); // World Bank sends newest first
  return { values, source_updated: data[0].lastupdated || null };
}

const WEO_AREA = { WEOWORLD: "G001" }; // DataMapper name -> SDMX country code (G001 = world)
const WEO_SCALE = { NGDPD: 1e-9 }; // SDMX gives US dollars; the unit here is USD bn (as DataMapper gives it)

// Which edition of the World Economic Outlook an SDMX answer is: { edition: "2026-04" (month of publication),
// updated: "2026-04-15" } - null when the answer does not say
function weoEdition(data) {
  const attrs = data.structure && data.structure.attributes && data.structure.attributes.dataSet;
  const picked = data.dataSets && data.dataSets[0] && data.dataSets[0].attributes;
  const day = (id) => {
    if (!Array.isArray(attrs) || !Array.isArray(picked)) return null;
    const i = attrs.findIndex((a) => a.id === id);
    const v = i >= 0 && picked[i] !== null && picked[i] !== undefined && attrs[i].values ? attrs[i].values[picked[i]] : null;
    const text = v ? String(v.id || v.name || "") : "";
    return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
  };
  const published = day("PUBLICATION_DATE");
  return { edition: published ? published.slice(0, 7) : null, updated: day("UPDATE_DATE") };
}

// IMF World Economic Outlook from the SDMX service (the road that works from GitHub's servers)
async function fromImfWeo(def) {
  const area = def.area || "LAO";
  const key = `IMF.RES,WEO/${WEO_AREA[area] || area}.${def.code}.A`;
  const data = await fetchJson(`${IMF_SDMX}${key}?startPeriod=${FIRST_YEAR}`);
  const dims = data.structure && data.structure.dimensions;
  const set = data.dataSets && data.dataSets[0];
  const series = set && set.series && Object.values(set.series)[0];
  if (!dims || !series || !series.observations) throw new Error(`Unexpected IMF SDMX response for ${key}`);
  const time = dims.observation[0].values;
  const values = Object.entries(series.observations)
    .map(([i, obs]) => [Number(time[Number(i)].id), obs[0]])
    .filter(([year, v]) => Number.isInteger(year) && year >= FIRST_YEAR && v !== null && v !== "")
    .map(([year, v]) => [year, round(parseAnyNumber(v, def.code) * (WEO_SCALE[def.code] || 1) * (def.scale || 1))])
    .sort((a, b) => a[0] - b[0]);
  const { edition, updated } = weoEdition(data);
  return { values, source_updated: updated, edition };
}

// The same numbers from the DataMapper API (second road; rounded by the IMF to 1-3 decimals)
async function fromImfDataMapper(def) {
  const area = def.area || "LAO";
  const data = await fetchJson(`https://www.imf.org/external/datamapper/api/v1/${def.code}/${area}`);
  const lao = data.values && data.values[def.code] && data.values[def.code][area];
  if (!lao) throw new Error(`No ${area} data in IMF response for ${def.code}`);
  const values = Object.entries(lao)
    .filter(([year, v]) => Number(year) >= FIRST_YEAR && v !== null)
    .map(([year, v]) => [Number(year), round(parseAnyNumber(v, def.code) * (def.scale || 1))]);
  return { values, source_updated: null, edition: null }; // this road does not say which edition it serves
}

// What the sources said about themselves in this run, kept in the "sources" block for the footers of the page:
//   edition   IMF: the month the World Economic Outlook was published ("2026-04")
//   updated   the day the source last changed its data (World Bank: "lastupdated" of its database)
//   retrieved the day we read it
// seen: { sourceId: { edition?, updated? } } for every source that answered in this run. A source that did not
// answer keeps what was stored before, so the footer never claims a reading that did not happen.
function stampSources(sources, oldSources, seen, today) {
  const out = {};
  for (const [id, src] of Object.entries(sources)) {
    const before = (oldSources && oldSources[id]) || {};
    const now = seen[id] ? { edition: seen[id].edition || before.edition, updated: seen[id].updated || before.updated, retrieved: today } : before;
    out[id] = { ...src };
    for (const k of ["edition", "updated", "retrieved"]) if (now[k]) out[id][k] = now[k];
  }
  return out;
}
// Remember what one answer said about its source (the newest "updated" day wins)
function noteSource(seen, id, { source_updated: updated, edition } = {}) {
  const s = seen[id] || (seen[id] = {});
  if (edition) s.edition = edition;
  if (updated && (!s.updated || updated > s.updated)) s.updated = updated;
}

async function fromImf(def) {
  try {
    const out = await fromImfWeo(def);
    if (out.values.length) return out;
    throw new Error("no values");
  } catch (first) {
    try {
      return await fromImfDataMapper(def);
    } catch (second) {
      throw new Error(`${first.message} | then: ${second.message}`);
    }
  }
}

// IMF SDMX -> list of { code, name, values: [["2026-08", 7.7], ...] } (one per series, e.g. per CPI category)
async function fromImfSdmx(key, startPeriod = FIRST_MONTH) {
  const data = await fetchJson(`${IMF_SDMX}${key}?startPeriod=${startPeriod}`);
  const dims = data.structure && data.structure.dimensions;
  const set = data.dataSets && data.dataSets[0];
  if (!dims || !set || !set.series) throw new Error(`Unexpected IMF SDMX response for ${key}`);
  const time = dims.observation[0].values;
  const coicop = dims.series.findIndex((d) => d.id === "COICOP_1999");
  return Object.entries(set.series).map(([seriesKey, s]) => {
    const cat = coicop >= 0 ? dims.series[coicop].values[Number(seriesKey.split(":")[coicop])] : null;
    const values = Object.entries(s.observations)
      .map(([i, obs]) => {
        const m = /^(\d{4})-M(\d{2})$/.exec(time[Number(i)].id); // "2026-M08" -> "2026-08"
        if (!m || obs[0] === null) return null;
        return [`${m[1]}-${m[2]}`, round(parseAnyNumber(obs[0], key))];
      })
      .filter(Boolean)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1));
    return { code: cat ? cat.id : null, name: cat ? cat.name : null, values };
  });
}

// BOL mid rate (buy+sell)/2, averaged per month, from our own stored history (no download)
function bolMonthly(cur) {
  const rows = readJson(path.join(HISTORY_DIR, "bol.json"), []);
  const byDay = new Map();
  for (const r of rows) {
    if (r.metric !== `${cur}_LAK_buy` && r.metric !== `${cur}_LAK_sell`) continue;
    const d = byDay.get(r.source_date) || {};
    d[r.metric.endsWith("buy") ? "buy" : "sell"] = r.value;
    byDay.set(r.source_date, d);
  }
  const byMonth = new Map();
  for (const [day, { buy, sell }] of byDay) {
    if (!buy || !sell) continue;
    const m = byMonth.get(day.slice(0, 7)) || [];
    m.push((buy + sell) / 2);
    byMonth.set(day.slice(0, 7), m);
  }
  return [...byMonth.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([month, list]) => [month, round(list.reduce((s, v) => s + v, 0) / list.length)]);
}

// Save one monthly series; on failure keep the old values and mark them stale
function monthlyEntry(old, fields, values, now) {
  const same = old && JSON.stringify(old.values) === JSON.stringify(values);
  return { ...fields, values, updated_at: same ? old.updated_at : now, stale: false, last_error: null };
}
function monthlyFailure(old, fields, err, now) {
  return { ...fields, values: [], ...(old || {}), stale: true, last_error: old && old.stale ? old.last_error : { message: err.message, at: now } };
}

async function main() {
  const old = readJson(OUT_FILE, { indicators: {}, monthly: {} });
  const oldMonthly = old.monthly || {};
  const now = new Date().toISOString();
  const out = { sources: SOURCES, indicators: {}, monthly: {} };
  const seen = {}; // what each source said about itself in this run (edition, last update)
  let failed = 0;

  for (const [id, def] of Object.entries(INDICATORS)) {
    const before = old.indicators[id];
    try {
      const answer = def.source === "worldbank" ? await fromWorldBank(def) : await fromImf(def);
      const { values, source_updated } = answer;
      if (!values.length) throw new Error("no values");
      noteSource(seen, def.source, answer);
      const same = before && JSON.stringify(before.values) === JSON.stringify(values);
      out.indicators[id] = {
        source: def.source,
        code: def.code,
        unit: def.unit,
        values,
        source_updated,
        updated_at: same ? before.updated_at : now, // only changes when the numbers change
        stale: false,
        last_error: null,
      };
      console.log(`[OK]   ${id}: ${values.length} years (${values[0][0]}-${values[values.length - 1][0]})`);
    } catch (err) {
      failed++;
      console.error(`[FAIL] ${id}: ${err.message}`);
      out.indicators[id] = before
        ? { ...before, stale: true, last_error: before.stale ? before.last_error : { message: err.message, at: now } }
        : { source: def.source, code: def.code, unit: def.unit, values: [], stale: true, last_error: { message: err.message, at: now } };
    }
  }

  // Monthly series (IMF SDMX)
  for (const [id, def] of Object.entries(MONTHLY)) {
    const fields = { source: "imf_sdmx", unit: def.unit };
    try {
      const [series] = await fromImfSdmx(def.key);
      if (!series || series.values.length < 12) throw new Error("fewer than 12 months returned");
      noteSource(seen, "imf_sdmx");
      out.monthly[id] = monthlyEntry(oldMonthly[id], fields, series.values, now);
      console.log(`[OK]   monthly.${id}: ${series.values.length} months (to ${series.values[series.values.length - 1][0]})`);
    } catch (err) {
      failed++;
      console.error(`[FAIL] monthly.${id}: ${err.message}`);
      out.monthly[id] = monthlyFailure(oldMonthly[id], fields, err, now);
    }
  }

  // CPI by category (CP01 food ... CP12), one request
  try {
    const list = (await fromImfSdmx(CPI_CATEGORIES_KEY)).filter((s) => /^CP\d{2}$/.test(s.code) && s.values.length);
    if (list.length < 5) throw new Error(`only ${list.length} CPI categories returned`);
    for (const s of list) {
      const id = `cpi_cat_${s.code}`;
      const recent = s.values.filter(([m]) => m >= CATEGORY_FIRST_MONTH); // categories: shorter history keeps the file small
      out.monthly[id] = monthlyEntry(oldMonthly[id], { source: "imf_sdmx", unit: "%", name_en: s.name }, recent, now);
    }
    console.log(`[OK]   monthly.cpi_cat_*: ${list.length} categories`);
  } catch (err) {
    failed++;
    console.error(`[FAIL] monthly.cpi_cat_*: ${err.message}`);
    for (const [id, entry] of Object.entries(oldMonthly)) {
      if (id.startsWith("cpi_cat_")) out.monthly[id] = monthlyFailure(entry, {}, err, now);
    }
  }

  // BOL monthly mid rates from our own history
  for (const cur of ["USD", "THB", "CNY"]) {
    const id = `bol_${cur.toLowerCase()}_mid`;
    const values = bolMonthly(cur);
    out.monthly[id] = values.length
      ? monthlyEntry(oldMonthly[id], { source: "bol", unit: `LAK per ${cur}` }, values, now)
      : monthlyFailure(oldMonthly[id], { source: "bol", unit: `LAK per ${cur}` }, new Error("no BOL history"), now);
  }

  // edition / last update / day of reading of every source that answered (the page shows them under each card)
  out.sources = stampSources(SOURCES, old.sources, seen, now.slice(0, 10));
  const imf = out.sources.imf;
  console.log(`[OK]   sources: World Bank updated ${out.sources.worldbank.updated || "?"} · IMF WEO edition ${imf.edition || "?"} (updated ${imf.updated || "?"})`);

  // One series per line: small file for phones, still readable in git
  const block = (obj) => "{\n" + Object.entries(obj).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(",\n") + "\n }";
  const text = `{\n "sources": ${JSON.stringify(out.sources)},\n "indicators": ${block(out.indicators)},\n "monthly": ${block(out.monthly)}\n}\n`;
  JSON.parse(text); // safety: must be valid JSON
  writeIfChanged(OUT_FILE, text);
  console.log(`\nDone: ${failed} failed. Wrote data/economy.json (${(text.length / 1024).toFixed(0)} KB)`);
  if (failed >= Object.keys(INDICATORS).length) process.exitCode = 1;
}

if (require.main === module) main();

// shared with fetch-invest.js
module.exports = { fromWorldBank, fromImf, fromImfSdmx, IMF_SDMX, stampSources, noteSource, weoEdition, INDICATORS, MONTHLY };
