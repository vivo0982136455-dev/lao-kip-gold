// Source #27: the people of Laos - how many, how old, where, what work - for the Economy > Population tab.
// Weekly. All free, no key.
//   indicators   World Bank API, Laos, yearly since 2000: population, growth, age groups, towns, births per woman,
//                life expectancy, people of working age per dependant, migration, labour force, work by sector,
//                money sent home by workers abroad; and what people can spend: income per person at purchasing
//                power, household consumption, poverty rates
//   projections  World Bank "Population estimates and projections" (source 40): population and age groups to 2050
//   neighbours   the newest value of the main numbers for Laos, Thailand, Viet Nam, Cambodia, Myanmar and China
//   provinces    Lao Statistics Bureau / UNFPA population by province, sex and age group (newest projection year),
//                published on the Humanitarian Data Exchange (HDX) as "COD-PS" - CC BY-IGO
// Writes data/population.json (loaded only on the Economy > Population tab).
// The 2025 census (counted 3 Nov - 28 Dec 2025) has no published result yet (checked 2026-10-01): when it comes
// out, the Lao Statistics Bureau numbers will differ from these estimates - see data/invest-static.json "population".
//
// Real answers (checked 2026-10-02):
//   World Bank  GET https://api.worldbank.org/v2/country/LAO/indicator/SP.POP.TOTL?format=json&per_page=100&date=2000:2040
//               [ { page, lastupdated: "2026-07-13" }, [ { countryiso3code: "LAO", date: "2025", value: 7873046 }, ... ] ]
//               (per_page=400 or date=1990:... answered "502" that day: keep the request small)
//               several countries: /country/LAO;THA;VNM;KHM;MMR;CHN/indicator/SP.POP.TOTL?format=json&mrnev=1
//               (mrnev=1 = the newest year that has a value, per country)
//               projections: the same address with &source=40&date=2000:2050 -> values up to 2050
//   HDX         GET https://data.humdata.org/api/3/action/package_show?id=cod-ps-lao -> result.resources[]:
//               { name: "lao_admpop_adm1_2024.csv", url: ".../download/lao_admpop_adm1_2024.csv" }, adm0 the same.
//               CSV header: year,ISO3,ADM0_EN,ADM0_PCODE,ADM1_EN,ADM1_PCODE,F_TL,M_TL,T_TL,F_00_04,...,F_80Plus,
//               M_00_04,...,M_80Plus,T_00_04,...,T_80Plus   (one row per province; LA01 = Vientiane Capital ...)

const path = require("path");
const { DATA_DIR, fetchJson, fetchText, parseCsv, readJson, writeIfChanged } = require("./lib/common");
const { okEntry, failEntry } = require("./lib/parts");
const { stampSources, noteSource } = require("./fetch-economy");

const OUT_FILE = path.join(DATA_DIR, "population.json");
const TIMEOUT_MS = 60000;
const FIRST_YEAR = 2000;
const WB = "https://api.worldbank.org/v2";

const SOURCES = {
  worldbank: { source_name: "World Bank Open Data (World Development Indicators)", source_url: "https://data.worldbank.org/country/lao-pdr", license: "CC BY 4.0 - The World Bank" },
  wb_projections: { source_name: "World Bank: Population estimates and projections", source_url: "https://databank.worldbank.org/source/population-estimates-and-projections", license: "CC BY 4.0 - The World Bank" },
  hdx_codps: { source_name: "Lao Statistics Bureau / UNFPA: population by province, sex and age (HDX COD-PS)", source_url: "https://data.humdata.org/dataset/cod-ps-lao", license: "CC BY-IGO" },
};

// id -> World Bank code. "unit" is what the value means after "scale" is applied.
const INDICATORS = {
  pop: { code: "SP.POP.TOTL", unit: "people" },
  growth: { code: "SP.POP.GROW", unit: "% per year" },
  young: { code: "SP.POP.0014.TO.ZS", unit: "% of people" },
  working: { code: "SP.POP.1564.TO.ZS", unit: "% of people" },
  old: { code: "SP.POP.65UP.TO.ZS", unit: "% of people" },
  urban: { code: "SP.URB.TOTL.IN.ZS", unit: "% of people" },
  urban_pop: { code: "SP.URB.TOTL", unit: "people" },
  fertility: { code: "SP.DYN.TFRT.IN", unit: "births per woman" },
  life: { code: "SP.DYN.LE00.IN", unit: "years" },
  net_migration: { code: "SM.POP.NETM", unit: "people" },
  labour: { code: "SL.TLF.TOTL.IN", unit: "people" },
  participation: { code: "SL.TLF.CACT.ZS", unit: "% of people 15+" },
  emp_agri: { code: "SL.AGR.EMPL.ZS", unit: "% of workers" },
  emp_ind: { code: "SL.IND.EMPL.ZS", unit: "% of workers" },
  emp_srv: { code: "SL.SRV.EMPL.ZS", unit: "% of workers" },
  wage_workers: { code: "SL.EMP.WORK.ZS", unit: "% of workers" },
  remit_usd: { code: "BX.TRF.PWKR.CD.DT", unit: "USD m", scale: 1e-6 },
  remit_gdp: { code: "BX.TRF.PWKR.DT.GD.ZS", unit: "% of GDP" },
  // what people can spend - a head count is not a market (audit 2026-10-02, P1-8). Checked 2026-10-03: income per
  // person 2025, poverty 2024, household consumption only up to 2016 (shown with that year, marked as old).
  gni_ppp: { code: "NY.GNP.PCAP.PP.CD", unit: "intl$ per person" },
  consumption: { code: "NE.CON.PRVT.CD", unit: "USD bn", scale: 1e-9 },
  consumption_gdp: { code: "NE.CON.PRVT.ZS", unit: "% of GDP" },
  poverty_national: { code: "SI.POV.NAHC", unit: "% of people" },
  poverty_3usd: { code: "SI.POV.DDAY", unit: "% of people" },
};
const PROJECTED = { pop: "SP.POP.TOTL", young: "SP.POP.0014.TO.ZS", working: "SP.POP.1564.TO.ZS", old: "SP.POP.65UP.TO.ZS" };
const NEIGHBOURS = ["LAO", "THA", "VNM", "KHM", "MMR", "CHN"];
const COMPARED = { pop: "SP.POP.TOTL", growth: "SP.POP.GROW", young: "SP.POP.0014.TO.ZS", old: "SP.POP.65UP.TO.ZS", urban: "SP.URB.TOTL.IN.ZS", fertility: "SP.DYN.TFRT.IN", life: "SP.DYN.LE00.IN" };
// HDX province code -> the province names used on the site (i18n "provinces")
const PROVINCE_BY_CODE = {
  LA01: "Vientiane Capital", LA02: "Phongsaly", LA03: "Louangnamtha", LA04: "Oudomxai", LA05: "Bokeo", LA06: "Louangphabang",
  LA07: "Houaphan", LA08: "Xaignabouly", LA09: "Xiengkhouang", LA10: "Vientiane", LA11: "Bolikhamxai", LA12: "Khammouan",
  LA13: "Savannakhet", LA14: "Salavan", LA15: "Sekong", LA16: "Champasack", LA17: "Attapeu", LA18: "Xaisomboun",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (v) => Math.round(v * 1000) / 1000;

// One World Bank request -> { rows: [{ iso, year, value }], updated }. Three tries: the API has slow minutes.
async function worldBank(countries, code, query) {
  const url = `${WB}/country/${countries}/indicator/${code}?format=json&per_page=100&${query}`;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const data = await fetchJson(url, {}, TIMEOUT_MS);
      if (!Array.isArray(data) || !Array.isArray(data[1])) throw new Error(`Unexpected World Bank answer: ${JSON.stringify(data).slice(0, 120)}`);
      return {
        rows: data[1].filter((r) => r.value !== null && /^\d{4}$/.test(r.date)).map((r) => ({ iso: r.countryiso3code, year: Number(r.date), value: Number(r.value) })),
        updated: data[0].lastupdated || null,
      };
    } catch (err) {
      lastError = err;
      await sleep(4000 * attempt);
    }
  }
  throw lastError;
}
const series = (rows, scale = 1) => rows.map((r) => [r.year, round(r.value * scale)]).sort((a, b) => a[0] - b[0]);

async function projections() {
  const out = {};
  let updated = null;
  for (const [id, code] of Object.entries(PROJECTED)) {
    const r = await worldBank("LAO", code, `source=40&date=${FIRST_YEAR}:2050`);
    out[id] = series(r.rows);
    if (!out[id].length || out[id][out[id].length - 1][0] < 2040) throw new Error(`projections of ${code} end in ${out[id].length ? out[id][out[id].length - 1][0] : "no year"}`);
    updated = r.updated || updated;
  }
  return { source: "wb_projections", source_updated: updated, series: out };
}

async function neighbours() {
  const rows = Object.fromEntries(NEIGHBOURS.map((iso) => [iso, {}]));
  for (const [id, code] of Object.entries(COMPARED)) {
    const r = await worldBank(NEIGHBOURS.join(";"), code, "mrnev=1");
    for (const x of r.rows) if (rows[x.iso]) rows[x.iso][id] = [x.year, round(x.value)];
  }
  if (!rows.LAO.pop) throw new Error("no population for Laos in the comparison");
  return { source: "worldbank", countries: NEIGHBOURS, rows };
}

async function provinces() {
  const pack = await fetchJson("https://data.humdata.org/api/3/action/package_show?id=cod-ps-lao", {}, TIMEOUT_MS);
  const list = (pack.result && pack.result.resources) || [];
  // the newest "lao_admpop_adm1_YYYY.csv"
  const found = list.map((r) => [/^lao_admpop_adm1_(\d{4})\.csv$/i.exec(r.name || ""), r]).filter(([m]) => m).sort((a, b) => Number(b[0][1]) - Number(a[0][1]))[0];
  if (!found) throw new Error("HDX: no province population file in the package");
  const year = Number(found[0][1]);
  const table = parseCsv((await fetchText(found[1].url, {}, TIMEOUT_MS)).replace(/^﻿/, ""));
  const head = table[0];
  const col = (name) => {
    const i = head.indexOf(name);
    if (i < 0) throw new Error(`HDX: column ${name} is missing`);
    return i;
  };
  const AGES = ["00_04", "05_09", "10_14", "15_19", "20_24", "25_29", "30_34", "35_39", "40_44", "45_49", "50_54", "55_59", "60_64", "65_69", "70_74", "75_79", "80Plus"];
  const sum = (row, prefix, ages) => ages.reduce((n, a) => n + Number(row[col(`${prefix}_${a}`)]), 0);
  const rows = [];
  const pyramid = AGES.map((a) => [a.replace("_", "-").replace("Plus", "+").replace(/\b0(\d)/g, "$1"), 0, 0]);
  for (const row of table.slice(1)) {
    if (row.length < head.length) continue;
    const name = PROVINCE_BY_CODE[row[col("ADM1_PCODE")]];
    if (!name) throw new Error(`HDX: unknown province code ${row[col("ADM1_PCODE")]}`);
    const total = Number(row[col("T_TL")]);
    if (!(total > 50000 && total < 3000000)) throw new Error(`HDX: population of ${name} is ${total}`);
    rows.push([name, total, Number(row[col("F_TL")]), Number(row[col("M_TL")]), sum(row, "T", AGES.slice(0, 3)), sum(row, "T", AGES.slice(3, 13)), sum(row, "T", AGES.slice(13))]);
    AGES.forEach((a, i) => {
      pyramid[i][1] += Number(row[col(`F_${a}`)]);
      pyramid[i][2] += Number(row[col(`M_${a}`)]);
    });
  }
  if (rows.length !== 18) throw new Error(`HDX: ${rows.length} provinces instead of 18`);
  rows.sort((a, b) => b[1] - a[1]);
  return {
    source: "hdx_codps",
    year,
    columns: ["province", "total", "female", "male", "age 0-14", "age 15-64", "age 65+"],
    total: rows.reduce((n, r) => n + r[1], 0),
    rows,
    ages: pyramid, // [age group, women, men] of the whole country
  };
}

async function main() {
  const old = readJson(OUT_FILE, { indicators: {} });
  const now = new Date().toISOString();
  const out = { sources: SOURCES, indicators: {} };
  const seen = {}; // what each source said about itself in this run -> the footers of the page (see stampSources)
  let failed = 0;

  for (const [id, def] of Object.entries(INDICATORS)) {
    const before = (old.indicators || {})[id];
    try {
      const r = await worldBank("LAO", def.code, `date=${FIRST_YEAR}:2040`);
      const values = series(r.rows, def.scale || 1);
      if (!values.length) throw new Error("no values");
      out.indicators[id] = okEntry(before, { source: "worldbank", code: def.code, unit: def.unit, values, source_updated: r.updated }, now);
      noteSource(seen, "worldbank", { source_updated: r.updated });
      console.log(`[OK]   ${id}: ${values.length} years (to ${values[values.length - 1][0]}: ${values[values.length - 1][1]})`);
    } catch (err) {
      failed++;
      console.error(`[FAIL] ${id}: ${err.message}`);
      out.indicators[id] = failEntry(before, { source: "worldbank", code: def.code, unit: def.unit, values: [] }, err, now);
    }
    await sleep(150);
  }

  const parts = [
    ["projections", { source: "wb_projections", series: {} }, projections, (p) => `population ${p.series.pop[p.series.pop.length - 1].join(": ")}`],
    ["neighbours", { source: "worldbank", countries: NEIGHBOURS, rows: {} }, neighbours, (p) => NEIGHBOURS.map((iso) => `${iso} ${p.rows[iso].pop ? (p.rows[iso].pop[1] / 1e6).toFixed(1) + "M" : "?"}`).join(", ")],
    ["provinces", { source: "hdx_codps", year: null, total: 0, rows: [], ages: [] }, provinces, (p) => `${p.year}: ${p.rows.length} provinces, ${p.total.toLocaleString("en-US")} people`],
  ];
  for (const [id, fallback, run, describe] of parts) {
    try {
      out[id] = okEntry(old[id], await run(), now);
      noteSource(seen, out[id].source, out[id]);
      console.log(`[OK]   ${id}: ${describe(out[id])}`);
    } catch (err) {
      failed++;
      console.error(`[FAIL] ${id}: ${err.message}`);
      out[id] = failEntry(old[id], fallback, err, now);
    }
  }

  out.sources = stampSources(SOURCES, old.sources, seen, now.slice(0, 10));

  // One series per line: small file for phones, still readable in git
  const block = (obj) => "{\n" + Object.entries(obj).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(",\n") + "\n }";
  const text = `{\n "sources": ${JSON.stringify(out.sources)},\n "indicators": ${block(out.indicators)},\n "projections": ${JSON.stringify(out.projections)},\n "neighbours": ${JSON.stringify(out.neighbours)},\n "provinces": ${JSON.stringify(out.provinces)}\n}\n`;
  JSON.parse(text); // safety: must be valid JSON
  writeIfChanged(OUT_FILE, text);
  const total = Object.keys(INDICATORS).length + parts.length;
  console.log(`\nDone: ${failed} of ${total} failed. Wrote data/population.json (${(text.length / 1024).toFixed(0)} KB)`);
  if (failed === total) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { main, provinces, PROVINCE_BY_CODE, worldBank, INDICATORS };
