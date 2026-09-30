// Source #17: numbers for the "Lao economy for investors" tabs (all automatic, free, no key).
//   - World Bank API (yearly): GDP per person, economic structure by sector, trade, remittances, external debt, reserves
//   - IMF DataMapper (yearly, with forecasts): GDP per person, government budget balance
//   - World Bank International Debt Statistics (IDS, source 6): government external debt BY CREDITOR, and the
//     repayment schedule of the existing debt for the next years (principal + interest; China separately)
//   - IMF Direct Investment Positions (DIP, ex-CDIS): who holds direct investment in Laos, by country
//     (Laos does not report it: the numbers come from what the investor countries report = "mirror" data)
//   - IMF Primary Commodity Prices: world rubber price, monthly (RSS3, US cents per pound)
// Writes data/invest.json (loaded only on the economy page). Run weekly: node scripts/fetch-invest.js
//
// Real responses (checked 2026-10-01):
//   IDS: GET https://api.worldbank.org/v2/sources/6/country/LAO/series/DT.DOD.DPPG.CD/counterpart-area/all/time/YR2024?format=json
//        { "source": { "data": [ { "variable": [ {concept:"Country"...}, {concept:"Series"...},
//          {concept:"Counterpart-Area", id:"730", value:"China"}, {concept:"Time", id:"YR2024"} ], "value": 5309000000 }, ... ] } }
//        Future years (YR2025..YR2032) of DT.AMT / DT.INT = payments due on the debt that exists today.
//   DIP: GET https://api.imf.org/external/sdmx/2.1/data/IMF.STA,DIP/LAO..INWD_D_NETLA_FALL_ALL..A (Accept: application/json)
//        series per counterpart (CHN, THA, ...; plus regions and G001 = World), values in US dollars.
// One failing part keeps its old numbers (marked stale); the other parts still update.

const path = require("path");
const { DATA_DIR, fetchJson, readJson, writeIfChanged } = require("./lib/common");
const { fromWorldBank, fromImf, fromImfSdmx } = require("./fetch-economy");

const OUT_FILE = path.join(DATA_DIR, "invest.json");
const RUBBER_FIRST_MONTH = "2000-01";
const TIMEOUT_MS = 90000; // IDS and DIP answers are slow (5-15 s, sometimes more)

const SOURCES = {
  worldbank: { source_name: "World Bank Open Data", source_url: "https://data.worldbank.org/country/lao-pdr", license: "CC BY 4.0 - The World Bank" },
  imf: { source_name: "IMF World Economic Outlook (DataMapper)", source_url: "https://www.imf.org/external/datamapper/profile/LAO", license: "IMF - free to use with attribution" },
  wb_ids: { source_name: "World Bank International Debt Statistics (IDS)", source_url: "https://www.worldbank.org/en/programs/debt-statistics/ids", license: "CC BY 4.0 - The World Bank" },
  imf_dip: { source_name: "IMF Direct Investment Positions by Counterpart Economy (formerly CDIS)", source_url: "https://data.imf.org/en/datasets/IMF.STA:DIP", license: "IMF - free to use with attribution" },
  imf_pcps: { source_name: "IMF Primary Commodity Prices (rubber, RSS3)", source_url: "https://data.imf.org/en/datasets/IMF.RES:PCPS", license: "IMF - free to use with attribution" },
};

// Yearly indicators ("unit" is the meaning after "scale")
const INDICATORS = {
  "wb.NY.GDP.PCAP.CD": { source: "worldbank", code: "NY.GDP.PCAP.CD", unit: "USD per person" },
  "wb.NV.AGR.TOTL.ZS": { source: "worldbank", code: "NV.AGR.TOTL.ZS", unit: "% of GDP" },
  "wb.NV.IND.TOTL.ZS": { source: "worldbank", code: "NV.IND.TOTL.ZS", unit: "% of GDP" },
  "wb.NV.IND.MANF.ZS": { source: "worldbank", code: "NV.IND.MANF.ZS", unit: "% of GDP" },
  "wb.NV.SRV.TOTL.ZS": { source: "worldbank", code: "NV.SRV.TOTL.ZS", unit: "% of GDP" },
  "wb.NV.AGR.TOTL.KD.ZG": { source: "worldbank", code: "NV.AGR.TOTL.KD.ZG", unit: "%" },
  "wb.NV.IND.TOTL.KD.ZG": { source: "worldbank", code: "NV.IND.TOTL.KD.ZG", unit: "%" },
  "wb.NV.IND.MANF.KD.ZG": { source: "worldbank", code: "NV.IND.MANF.KD.ZG", unit: "%" },
  "wb.NV.SRV.TOTL.KD.ZG": { source: "worldbank", code: "NV.SRV.TOTL.KD.ZG", unit: "%" },
  "wb.TX.VAL.MRCH.CD.WT": { source: "worldbank", code: "TX.VAL.MRCH.CD.WT", unit: "USD bn", scale: 1e-9 },
  "wb.TM.VAL.MRCH.CD.WT": { source: "worldbank", code: "TM.VAL.MRCH.CD.WT", unit: "USD bn", scale: 1e-9 },
  "wb.BX.TRF.PWKR.CD.DT": { source: "worldbank", code: "BX.TRF.PWKR.CD.DT", unit: "USD m", scale: 1e-6 },
  "wb.BX.KLT.DINV.WD.GD.ZS": { source: "worldbank", code: "BX.KLT.DINV.WD.GD.ZS", unit: "% of GDP" },
  "wb.DT.DOD.DECT.CD": { source: "worldbank", code: "DT.DOD.DECT.CD", unit: "USD bn", scale: 1e-9 },
  "wb.DT.DOD.DECT.GN.ZS": { source: "worldbank", code: "DT.DOD.DECT.GN.ZS", unit: "% of GNI" },
  "wb.DT.TDS.DECT.EX.ZS": { source: "worldbank", code: "DT.TDS.DECT.EX.ZS", unit: "% of exports" },
  "wb.DT.DOD.DPPG.CD": { source: "worldbank", code: "DT.DOD.DPPG.CD", unit: "USD bn", scale: 1e-9 },
  "wb.FI.RES.TOTL.CD": { source: "worldbank", code: "FI.RES.TOTL.CD", unit: "USD bn", scale: 1e-9 },
  "wb.FI.RES.TOTL.MO": { source: "worldbank", code: "FI.RES.TOTL.MO", unit: "months" },
  "wb.GC.REV.XGRT.GD.ZS": { source: "worldbank", code: "GC.REV.XGRT.GD.ZS", unit: "% of GDP" },
  "wb.SP.POP.TOTL": { source: "worldbank", code: "SP.POP.TOTL", unit: "million", scale: 1e-6 },
  "imf.NGDPDPC": { source: "imf", code: "NGDPDPC", unit: "USD per person" },
  "imf.GGXCNL_NGDP": { source: "imf", code: "GGXCNL_NGDP", unit: "% of GDP" },
};

const IDS = "https://api.worldbank.org/v2/sources/6/country/LAO/series";
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
const toM = (usd) => round(usd / 1e6, 1); // US dollars -> USD millions

// IDS rows -> [{ area, areaId, year, value }]
async function ids(series, area, time) {
  const data = await fetchJson(`${IDS}/${series}/counterpart-area/${area}/time/${time}?format=json&per_page=1000`, {}, TIMEOUT_MS);
  const rows = data && data.source && Array.isArray(data.source.data) ? data.source.data : null;
  if (!rows) throw new Error(`Unexpected IDS answer for ${series}: ${JSON.stringify(data).slice(0, 120)}`);
  return rows
    .filter((d) => d.value !== null)
    .map((d) => {
      const a = d.variable.find((v) => v.concept === "Counterpart-Area");
      const t = d.variable.find((v) => v.concept === "Time");
      return { area: a.value.trim(), areaId: a.id, year: Number(String(t.id).replace("YR", "")), value: Number(d.value) };
    });
}

// Government (public and publicly guaranteed) external debt by creditor, newest actual year
async function debtCreditors() {
  const history = (await ids("DT.DOD.DPPG.CD", "WLD", "all")).filter((r) => r.value > 0).sort((a, b) => a.year - b.year);
  if (!history.length) throw new Error("no PPG debt stock");
  const year = history[history.length - 1].year; // stocks exist only for actual years
  const rows = await ids("DT.DOD.DPPG.CD", "all", `YR${year}`);
  const total = rows.find((r) => r.areaId === "WLD");
  if (!total) throw new Error("no World total");
  // creditors = every row except the World total (ids are numbers, plus "BND" = bondholders)
  const list = rows
    .filter((r) => r.areaId !== "WLD" && r.value > 0)
    .sort((a, b) => b.value - a.value)
    .map((r) => [r.area, toM(r.value)]);
  if (list.length < 3) throw new Error(`only ${list.length} creditors`);
  // safety: the creditors must add up to the total (checked 2026-10-01: 10,024.5 vs 10,024.6)
  const sum = list.reduce((s, [, v]) => s + v, 0);
  if (Math.abs(sum - toM(total.value)) > 0.02 * toM(total.value)) throw new Error(`creditors add up to ${sum}, total is ${toM(total.value)}`);
  return { unit: "USD m", year, total: toM(total.value), list, history: history.map((r) => [r.year, toM(r.value)]) };
}

// Payments on the government external debt: actual for past years, "due on today's debt" for future years
async function debtService(stockYear) {
  const [principal, interest, china] = await Promise.all([
    ids("DT.AMT.DPPG.CD", "WLD", "all"),
    ids("DT.INT.DPPG.CD", "WLD", "all"),
    ids("DT.TDS.DPPG.CD", "730", "all"), // 730 = China (principal + interest)
  ]);
  const firstYear = stockYear - 6;
  const years = [...new Set([...principal, ...interest].map((r) => r.year))].filter((y) => y >= firstYear).sort((a, b) => a - b);
  const pick = (rows) => {
    const m = new Map(rows.map((r) => [r.year, toM(r.value)]));
    return years.map((y) => (m.has(y) ? m.get(y) : null));
  };
  if (!years.some((y) => y > stockYear)) throw new Error("no future years in the schedule");
  return { unit: "USD m", years, first_projected: stockYear + 1, principal: pick(principal), interest: pick(interest), china: pick(china) };
}

// Direct investment in Laos by investor country (IMF DIP, derived from the investors' own reports)
async function fdiPositions() {
  const data = await fetchJson("https://api.imf.org/external/sdmx/2.1/data/IMF.STA,DIP/LAO..INWD_D_NETLA_FALL_ALL..A?startPeriod=2015", { Accept: "application/json" }, TIMEOUT_MS);
  const ds = data.data || data;
  const set = ds.dataSets && ds.dataSets[0];
  const st = ds.structures ? ds.structures[0] : ds.structure;
  if (!set || !st) throw new Error("Unexpected IMF DIP answer");
  const dims = st.dimensions.series;
  const cpIdx = dims.findIndex((d) => d.id === "COUNTERPART_COUNTRY");
  const time = st.dimensions.observation.find((d) => d.id === "TIME_PERIOD").values;
  const byArea = new Map(); // code -> { name, values: Map(year -> USD) }
  for (const [key, s] of Object.entries(set.series)) {
    const cp = dims[cpIdx].values[Number(key.split(":")[cpIdx])];
    const values = new Map();
    for (const [i, obs] of Object.entries(s.observations || {})) {
      if (obs[0] === null || obs[0] === undefined || obs[0] === "") continue;
      values.set(Number(time[Number(i)].id || time[Number(i)].value), Number(obs[0]));
    }
    byArea.set(cp.id, { name: cp.name, values });
  }
  const world = byArea.get("G001");
  if (!world || !world.values.size) throw new Error("no World total in DIP");
  const year = Math.max(...world.values.keys());
  const list = [...byArea.entries()]
    .filter(([code, a]) => /^[A-Z]{3}$/.test(code) && a.values.get(year) >= 50000) // countries only (regions have other codes); drop ~0
    .map(([code, a]) => [code, a.name, toM(a.values.get(year))])
    .sort((a, b) => b[2] - a[2]);
  const totals = [...world.values.entries()].sort((a, b) => a[0] - b[0]).map(([y, v]) => [y, toM(v)]);
  return { unit: "USD m", year, total: toM(world.values.get(year)), list, totals };
}

// helpers: keep old numbers when a part fails
function okEntry(old, fields, now) {
  const { updated_at, stale, last_error, ...oldData } = old || {};
  const same = old && JSON.stringify(oldData) === JSON.stringify(fields);
  return { ...fields, updated_at: same ? updated_at : now, stale: false, last_error: null };
}
function failEntry(old, fallback, err, now) {
  return { ...(old || fallback), stale: true, last_error: old && old.stale ? old.last_error : { message: err.message, at: now } };
}

async function main() {
  const old = readJson(OUT_FILE, { indicators: {}, parts: {}, monthly: {} });
  const now = new Date().toISOString();
  const out = { sources: SOURCES, indicators: {}, parts: {}, monthly: {} };
  let failed = 0;
  let total = 0;

  for (const [id, def] of Object.entries(INDICATORS)) {
    total++;
    const before = old.indicators && old.indicators[id];
    try {
      const { values, source_updated } = def.source === "worldbank" ? await fromWorldBank(def) : await fromImf(def);
      if (!values.length) throw new Error("no values");
      out.indicators[id] = okEntry(before, { source: def.source, code: def.code, unit: def.unit, values, source_updated }, now);
      console.log(`[OK]   ${id}: ${values.length} years (to ${values[values.length - 1][0]})`);
    } catch (err) {
      failed++;
      console.error(`[FAIL] ${id}: ${err.message}`);
      out.indicators[id] = failEntry(before, { source: def.source, code: def.code, unit: def.unit, values: [] }, err, now);
    }
  }

  const parts = old.parts || {};
  // Debt by creditor first: its year tells where the repayment schedule turns into "due" amounts
  total++;
  try {
    out.parts.debt_creditors = okEntry(parts.debt_creditors, { source: "wb_ids", ...(await debtCreditors()) }, now);
    const d = out.parts.debt_creditors;
    console.log(`[OK]   debt_creditors: ${d.year}, total ${d.total} USD m, ${d.list.length} creditors (top: ${d.list[0][0]} ${d.list[0][1]})`);
  } catch (err) {
    failed++;
    console.error(`[FAIL] debt_creditors: ${err.message}`);
    out.parts.debt_creditors = failEntry(parts.debt_creditors, { source: "wb_ids", list: [] }, err, now);
  }
  total++;
  try {
    const stockYear = out.parts.debt_creditors.year;
    if (!stockYear) throw new Error("no debt stock year");
    out.parts.debt_service = okEntry(parts.debt_service, { source: "wb_ids", ...(await debtService(stockYear)) }, now);
    const s = out.parts.debt_service;
    console.log(`[OK]   debt_service: ${s.years[0]}-${s.years[s.years.length - 1]} (due from ${s.first_projected})`);
  } catch (err) {
    failed++;
    console.error(`[FAIL] debt_service: ${err.message}`);
    out.parts.debt_service = failEntry(parts.debt_service, { source: "wb_ids", years: [] }, err, now);
  }
  total++;
  try {
    out.parts.fdi_positions = okEntry(parts.fdi_positions, { source: "imf_dip", ...(await fdiPositions()) }, now);
    const f = out.parts.fdi_positions;
    console.log(`[OK]   fdi_positions: ${f.year}, total ${f.total} USD m, ${f.list.length} countries (top: ${f.list[0][1]} ${f.list[0][2]})`);
  } catch (err) {
    failed++;
    console.error(`[FAIL] fdi_positions: ${err.message}`);
    out.parts.fdi_positions = failEntry(parts.fdi_positions, { source: "imf_dip", list: [] }, err, now);
  }

  // World rubber price, monthly (IMF PCPS)
  total++;
  const oldRubber = old.monthly && old.monthly.rubber_usd;
  try {
    const [series] = await fromImfSdmx("IMF.RES,PCPS/G001.PRUBB.USD.M", RUBBER_FIRST_MONTH);
    if (!series || series.values.length < 24) throw new Error("fewer than 24 months returned");
    out.monthly.rubber_usd = okEntry(oldRubber, { source: "imf_pcps", unit: "US cents per pound", values: series.values }, now);
    console.log(`[OK]   monthly.rubber_usd: ${series.values.length} months (to ${series.values[series.values.length - 1][0]})`);
  } catch (err) {
    failed++;
    console.error(`[FAIL] monthly.rubber_usd: ${err.message}`);
    out.monthly.rubber_usd = failEntry(oldRubber, { source: "imf_pcps", unit: "US cents per pound", values: [] }, err, now);
  }

  // One entry per line: small diffs in git, still readable
  const block = (obj) => "{\n" + Object.entries(obj).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(",\n") + "\n }";
  const text = `{\n "sources": ${JSON.stringify(out.sources)},\n "indicators": ${block(out.indicators)},\n "parts": ${block(out.parts)},\n "monthly": ${block(out.monthly)}\n}\n`;
  JSON.parse(text); // safety: must be valid JSON
  writeIfChanged(OUT_FILE, text);
  console.log(`\nDone: ${failed} of ${total} failed. Wrote data/invest.json (${(text.length / 1024).toFixed(0)} KB)`);
  if (failed === total) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { main };
