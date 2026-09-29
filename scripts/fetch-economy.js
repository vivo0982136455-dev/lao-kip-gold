// Sources #6, #7, #8: Lao economy (yearly) + monthly CPI typed in by the owner.
//   #6 World Bank API (actual yearly data)       - free, no key
//   #7 IMF DataMapper API (includes forecasts)   - free, no key
//   #8 Monthly CPI inflation from the Google Sheet (config "lao_cpi_csv_url")
// Writes data/economy.json. Run monthly (GitHub Actions) or by hand: node scripts/fetch-economy.js
//
// Real responses (checked 2026-09-29):
//   World Bank: [ {page, lastupdated:"2026-07-13"}, [ { "date": "2025", "value": 18302970218.59 }, ... ] ]
//   IMF: { "values": { "NGDP_RPCH": { "LAO": { "2024": 4.3, "2025": 4.8, ... "2031": 3 }, ...all countries } } }
//   (the IMF API returns ALL countries even when asking for LAO - we pick "LAO")
// One failing indicator keeps its old values (marked stale); the others still update.

const path = require("path");
const { DATA_DIR, fetchJson, fetchText, parseAnyNumber, parseCsv, readJson, writeIfChanged } = require("./lib/common");
const { manualUrl, parseSheetMonth } = require("./lib/manual");

const OUT_FILE = path.join(DATA_DIR, "economy.json");
const FIRST_YEAR = 2000;

const SOURCES = {
  worldbank: {
    source_name: "World Bank Open Data",
    source_url: "https://data.worldbank.org/country/lao-pdr",
    license: "CC BY 4.0 - The World Bank",
  },
  imf: {
    source_name: "IMF World Economic Outlook (DataMapper)",
    source_url: "https://www.imf.org/external/datamapper/profile/LAO",
    license: "IMF - free to use with attribution",
  },
  cpi_manual: {
    source_name: "Lao Statistics Bureau (manual entry)",
    source_url: "https://laosis.lsb.gov.la",
    license: "Numbers typed in by the owner",
  },
};

// id -> where to get it. "unit" is what the value means after "scale" is applied.
const INDICATORS = {
  "wb.NY.GDP.MKTP.CD": { source: "worldbank", code: "NY.GDP.MKTP.CD", unit: "USD bn", scale: 1e-9 },
  "wb.NY.GDP.MKTP.KD.ZG": { source: "worldbank", code: "NY.GDP.MKTP.KD.ZG", unit: "%" },
  "wb.FP.CPI.TOTL.ZG": { source: "worldbank", code: "FP.CPI.TOTL.ZG", unit: "%" },
  "wb.BX.KLT.DINV.CD.WD": { source: "worldbank", code: "BX.KLT.DINV.CD.WD", unit: "USD m", scale: 1e-6 },
  "wb.PA.NUS.FCRF": { source: "worldbank", code: "PA.NUS.FCRF", unit: "LAK per USD" },
  "imf.NGDPD": { source: "imf", code: "NGDPD", unit: "USD bn" },
  "imf.NGDP_RPCH": { source: "imf", code: "NGDP_RPCH", unit: "%" },
  "imf.PCPIPCH": { source: "imf", code: "PCPIPCH", unit: "%" },
  "imf.BCA_NGDPD": { source: "imf", code: "BCA_NGDPD", unit: "% of GDP" },
  "imf.GGXWDG_NGDP": { source: "imf", code: "GGXWDG_NGDP", unit: "% of GDP" },
};

const round = (v) => Math.round(v * 1000) / 1000;

async function fromWorldBank(def) {
  const url = `https://api.worldbank.org/v2/country/LAO/indicator/${def.code}?format=json&per_page=100&date=${FIRST_YEAR}:2040`;
  const data = await fetchJson(url);
  if (!Array.isArray(data) || !Array.isArray(data[1])) {
    throw new Error(`Unexpected World Bank response: ${JSON.stringify(data).slice(0, 120)}`);
  }
  const values = data[1]
    .filter((row) => row.value !== null && /^\d{4}$/.test(row.date))
    .map((row) => [Number(row.date), round(parseAnyNumber(row.value, def.code) * (def.scale || 1))])
    .sort((a, b) => a[0] - b[0]); // World Bank sends newest first
  return { values, source_updated: data[0].lastupdated || null };
}

async function fromImf(def) {
  const data = await fetchJson(`https://www.imf.org/external/datamapper/api/v1/${def.code}/LAO`);
  const lao = data.values && data.values[def.code] && data.values[def.code].LAO;
  if (!lao) throw new Error(`No LAO data in IMF response for ${def.code}`);
  const values = Object.entries(lao)
    .filter(([year, v]) => Number(year) >= FIRST_YEAR && v !== null)
    .map(([year, v]) => [Number(year), round(parseAnyNumber(v, def.code) * (def.scale || 1))]);
  return { values, source_updated: null };
}

// Monthly CPI (%, compared with the same month last year) from the Google Sheet.
// CSV columns: 0 Timestamp | 1 Month | 2 CPI inflation % | 3 Note. Last entry for a month wins.
async function cpiFromSheet(url) {
  const rows = parseCsv(await fetchText(url));
  const byMonth = new Map();
  for (const [i, row] of rows.slice(1).entries()) {
    try {
      const month = parseSheetMonth(row[1]);
      if (!month) throw new Error(`cannot read month "${row[1]}"`);
      const value = parseAnyNumber(row[2], "CPI %");
      if (value < -50 || value > 500) throw new Error(`CPI looks wrong: ${row[2]}`);
      byMonth.set(month, round(value));
    } catch (err) {
      console.warn(`       cpi: skipped row ${i + 2}: ${err.message}`);
    }
  }
  if (!byMonth.size) throw new Error("No valid CPI rows");
  return [...byMonth.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

async function main() {
  const old = readJson(OUT_FILE, { indicators: {}, cpi_monthly: null });
  const now = new Date().toISOString();
  const out = { sources: SOURCES, indicators: {}, cpi_monthly: null };
  let failed = 0;

  for (const [id, def] of Object.entries(INDICATORS)) {
    const before = old.indicators[id];
    try {
      const { values, source_updated } = def.source === "worldbank" ? await fromWorldBank(def) : await fromImf(def);
      if (!values.length) throw new Error("no values");
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

  // Monthly CPI (manual)
  const cpiUrl = manualUrl("lao_cpi_csv_url", "LAO_CPI_CSV_URL");
  const oldCpi = old.cpi_monthly;
  if (!cpiUrl) {
    out.cpi_monthly = { configured: false, values: [], stale: false, last_error: null };
    console.log("[SKIP] cpi_monthly: no CSV link set in config/manual-sources.json");
  } else {
    try {
      const values = await cpiFromSheet(cpiUrl);
      const same = oldCpi && JSON.stringify(oldCpi.values) === JSON.stringify(values);
      out.cpi_monthly = { configured: true, unit: "%", values, updated_at: same ? oldCpi.updated_at : now, stale: false, last_error: null };
      console.log(`[OK]   cpi_monthly: ${values.length} months`);
    } catch (err) {
      failed++;
      console.error(`[FAIL] cpi_monthly: ${err.message}`);
      out.cpi_monthly = { ...(oldCpi || { values: [] }), configured: true, stale: true, last_error: { message: err.message, at: now } };
    }
  }

  writeIfChanged(OUT_FILE, JSON.stringify(out, null, 1) + "\n");
  console.log(`\nDone: ${failed} failed. Wrote data/economy.json`);
  if (failed === Object.keys(INDICATORS).length) process.exitCode = 1;
}

main();
