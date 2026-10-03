// Source #34: Laos next to its five neighbours on the main economic numbers - for the Economy > Compare tab
// (audit 2026-10-02, P1-6). Weekly. All free, no key.
// One request per indicator for the six countries, so every country's number is the SAME indicator code of the
// SAME source. The file keeps the last years of every country; the page then picks one year for the whole row -
// the newest year Laos has - and marks a country whose number is from another year (js/pages/eco-compare.js).
//   World Bank API   size, income, growth, inflation, external debt, reserves, foreign investment, exports, towns
//   IMF WEO (SDMX)   public debt: the World Bank has no government debt for Laos, Viet Nam, Myanmar and China.
//                    The IMF's past years are its own estimates, and the series runs on into forecast years:
//                    only finished years are kept here.
// Writes data/compare.json (loaded only on the Economy > Compare tab).
//
// Real answers (checked 2026-10-03):
//   World Bank  GET https://api.worldbank.org/v2/country/LAO;THA;VNM;KHM;MMR;CHN/indicator/NY.GDP.MKTP.CD
//                   ?format=json&per_page=100&date=2015:2026
//               [ { page, lastupdated: "2026-07-13" }, [ { countryiso3code: "LAO", date: "2025", value: 18303... }, ... ] ]
//               Newest year per country differs: GDP 2025 for all six, inflation Myanmar 2019, reserves Laos 2024,
//               exports of goods and services (NE.EXP.GNFS.ZS) Laos 2016 - which is why exports are the WTO's
//               merchandise exports (TX.VAL.MRCH.CD.WT, 2025 for all six).
//   IMF         GET https://api.imf.org/external/sdmx/2.1/data/IMF.RES,WEO/LAO+THA+VNM+KHM+MMR+CHN.GGXWDG_NGDP.A
//                   ?startPeriod=2015   (Accept: application/json)
//               structure.dimensions.series = [COUNTRY[CHN,KHM,LAO,MMR,THA,VNM], INDICATOR, FREQUENCY],
//               dataSets[0].series["2:0:0"].observations = { "0": ["69.13"], ... } (index into the time dimension)

const path = require("path");
const { DATA_DIR, fetchJson, parseAnyNumber, readJson, writeIfChanged } = require("./lib/common");
const { okEntry, failEntry } = require("./lib/parts");
const { IMF_SDMX, stampSources, noteSource, weoEdition } = require("./fetch-economy");
const { worldBank } = require("./fetch-population");

const OUT_FILE = path.join(DATA_DIR, "compare.json");
const COUNTRIES = ["LAO", "THA", "VNM", "KHM", "MMR", "CHN"];
const YEARS_KEPT = 10; // enough to find a common year even for a country whose numbers stopped years ago
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (v) => Math.round(v * 1000) / 1000;

const SOURCES = {
  worldbank: { source_name: "World Bank Open Data (World Development Indicators, International Debt Statistics)", source_url: "https://data.worldbank.org/", license: "CC BY 4.0 - The World Bank" },
  imf: { source_name: "IMF World Economic Outlook database", source_url: "https://www.imf.org/en/Publications/WEO", license: "IMF terms of use - free with attribution" },
};

// id -> the same code for all six countries. "unit" is what the value means after "scale" is applied.
const INDICATORS = {
  gdp: { source: "worldbank", code: "NY.GDP.MKTP.CD", unit: "USD bn", scale: 1e-9 },
  gdp_pc: { source: "worldbank", code: "NY.GDP.PCAP.CD", unit: "USD per person" },
  gdp_pc_ppp: { source: "worldbank", code: "NY.GDP.PCAP.PP.CD", unit: "intl$ per person" },
  growth: { source: "worldbank", code: "NY.GDP.MKTP.KD.ZG", unit: "% per year" },
  inflation: { source: "worldbank", code: "FP.CPI.TOTL.ZG", unit: "% per year" },
  debt: { source: "imf", code: "GGXWDG_NGDP", unit: "% of GDP" },
  ext_debt: { source: "worldbank", code: "DT.DOD.DECT.GN.ZS", unit: "% of GNI" },
  reserves: { source: "worldbank", code: "FI.RES.TOTL.MO", unit: "months" },
  fdi_gdp: { source: "worldbank", code: "BX.KLT.DINV.WD.GD.ZS", unit: "% of GDP" },
  fdi: { source: "worldbank", code: "BX.KLT.DINV.CD.WD", unit: "USD bn", scale: 1e-9 },
  exports: { source: "worldbank", code: "TX.VAL.MRCH.CD.WT", unit: "USD bn", scale: 1e-9 },
  urban: { source: "worldbank", code: "SP.URB.TOTL.IN.ZS", unit: "%" },
};

// [{ iso, year, value }] -> { LAO: [[year, value], ...oldest first], ... } for the countries we compare
function byCountry(list, scale = 1) {
  const rows = Object.fromEntries(COUNTRIES.map((iso) => [iso, []]));
  for (const x of list) if (rows[x.iso] && Number.isInteger(x.year) && Number.isFinite(x.value)) rows[x.iso].push([x.year, round(x.value * scale)]);
  for (const iso of COUNTRIES) rows[iso].sort((a, b) => a[0] - b[0]);
  return rows;
}

// One IMF WEO series for all six countries in one request -> { rows: [{ iso, year, value }], updated, edition }
// Only finished years: this year and later are the IMF's forecast.
async function imfWeo(code, firstYear, lastYear) {
  const key = `IMF.RES,WEO/${COUNTRIES.join("+")}.${code}.A`;
  const data = await fetchJson(`${IMF_SDMX}${key}?startPeriod=${firstYear}`, {}, 60000);
  return readImf(data, code, lastYear, key);
}
function readImf(data, code, lastYear, key = code) {
  const dims = data.structure && data.structure.dimensions;
  const set = data.dataSets && data.dataSets[0];
  if (!dims || !Array.isArray(dims.series) || !dims.observation || !set || !set.series) throw new Error(`Unexpected IMF SDMX response for ${key}`);
  const at = dims.series.findIndex((d) => d.id === "COUNTRY");
  if (at < 0) throw new Error(`IMF SDMX response for ${key} has no COUNTRY dimension`);
  const countries = dims.series[at].values.map((v) => v.id);
  const time = dims.observation[0].values.map((v) => Number(v.id));
  const rows = [];
  for (const [seriesKey, s] of Object.entries(set.series)) {
    const iso = countries[Number(seriesKey.split(":")[at])];
    for (const [i, obs] of Object.entries(s.observations || {})) {
      const year = time[Number(i)];
      if (!Number.isInteger(year) || year > lastYear || obs[0] === null || obs[0] === "") continue;
      rows.push({ iso, year, value: parseAnyNumber(obs[0], `${code} ${iso} ${year}`) });
    }
  }
  const { edition, updated } = weoEdition(data);
  return { rows, updated, edition };
}

async function main() {
  const old = readJson(OUT_FILE, { indicators: {} });
  const now = new Date().toISOString();
  const thisYear = new Date(Date.now() + 7 * 3600000).getUTCFullYear(); // Vientiane
  const firstYear = thisYear - YEARS_KEPT;
  const out = { sources: SOURCES, countries: COUNTRIES, indicators: {} };
  const seen = {};
  let failed = 0;

  for (const [id, def] of Object.entries(INDICATORS)) {
    const before = (old.indicators || {})[id];
    const head = { source: def.source, code: def.code, unit: def.unit };
    try {
      const r = def.source === "imf" ? await imfWeo(def.code, firstYear, thisYear - 1) : await worldBank(COUNTRIES.join(";"), def.code, `date=${firstYear}:${thisYear}`);
      const rows = byCountry(r.rows, def.scale || 1);
      if (!rows.LAO.length) throw new Error("no value for Laos");
      out.indicators[id] = okEntry(before, { ...head, rows, source_updated: r.updated || null }, now);
      noteSource(seen, def.source, { source_updated: r.updated, edition: r.edition });
      console.log(`[OK]   ${id}: ` + COUNTRIES.map((iso) => (rows[iso].length ? `${iso} ${rows[iso][rows[iso].length - 1].join(": ")}` : `${iso} -`)).join(" | "));
    } catch (err) {
      failed++;
      console.error(`[FAIL] ${id}: ${err.message}`);
      out.indicators[id] = failEntry(before, { ...head, rows: {} }, err, now);
    }
    await sleep(200);
  }
  out.sources = stampSources(SOURCES, old.sources, seen, now.slice(0, 10));

  // One indicator per line: small file for phones, still readable in git
  const block = (obj) => "{\n" + Object.entries(obj).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(",\n") + "\n }";
  const text = `{\n "sources": ${JSON.stringify(out.sources)},\n "countries": ${JSON.stringify(out.countries)},\n "indicators": ${block(out.indicators)}\n}\n`;
  JSON.parse(text); // safety: must be valid JSON
  writeIfChanged(OUT_FILE, text);
  const total = Object.keys(INDICATORS).length;
  console.log(`\nDone: ${failed} of ${total} failed. Wrote data/compare.json (${(text.length / 1024).toFixed(0)} KB)`);
  if (failed === total) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { main, byCountry, readImf, COUNTRIES, INDICATORS };
