// Source #23: natural rubber in the world, in ASEAN + China, and who buys rubber from Laos (all free, no key).
//   trade        UN Comtrade (free "preview" endpoint): every country's exports and imports of natural rubber
//                (HS 4001) and of its forms, for the last 3 years:
//                  400110 latex · 400121 smoked sheets · 400122 block rubber (TSNR, made mostly from cup lump) ·
//                  400129 other forms (raw cup lump, unsmoked sheets, crepe ...)
//                value / weight = the average price at the border (USD per kg).
//                A country that has not reported a year yet is estimated from what its partners reported ("mirror").
//   production   FAOSTAT bulk file QCL: production and tapped area of natural rubber, by country
//   farm_price   FAOSTAT bulk file PP: price received by producers (USD per tonne), by country
//   world_prices World Bank "Pink Sheet": TSR20 (block rubber) and RSS3 (smoked sheet), monthly, USD per kg
// Writes data/rubber-world.json (loaded only on the Economy > Rubber tab). Weekly: node scripts/fetch-rubber-world.js
//
// Real responses (checked 2026-10-01):
//   Comtrade  GET https://comtradeapi.un.org/public/v1/preview/C/A/HS?period=2024&partnerCode=0&flowCode=X&cmdCode=4001&includeDesc=true
//             (no reporterCode = all reporters; ONE period per request; at most 500 rows per answer)
//             { "count": 97, "error": "", "data": [ { "reporterCode": 764, "reporterISO": "THA", "reporterDesc": "Thailand",
//               "cmdCode": "4001", "flowCode": "X", "partnerCode": 0, "partner2Code": 0, "customsCode": "C00", "motCode": 0,
//               "netWgt": 2816944149.005, "primaryValue": 4992318950, ... }, ... ] }
//             netWgt is in kg and can be null (Côte d'Ivoire); primaryValue is in US dollars.
//   FAOSTAT   https://bulks-faostat.fao.org/production/datasets_E.json  -> { Datasets: { Dataset: [ { DatasetCode: "QCL",
//             FileLocation: ".../Production_Crops_Livestock_E_All_Data_(Normalized).zip", DateUpdate: "2025-12-31T00:00:00" } ] } }
//             CSV lines: "216","'764","Thailand","836","'01950.01","Natural rubber in primary forms","5510","Production","2024","2024","t","4789042.000000","A",
//             item 836 = natural rubber; element 5510 production (t), 5312 area harvested (ha), 5532 producer price (USD/tonne);
//             area codes from 5000 are groups (5000 = World); 351 "China" repeats 41 "China, mainland".
//             The zips are 34 MB + 12 MB, so they are downloaded only when FAO's update date has changed.
//   Pink Sheet link on https://www.worldbank.org/en/research/commodity-markets (the document id changes every year):
//             .../related/CMO-Historical-Data-Monthly.xlsx, sheet "Monthly Prices": row 5 = names ("Rubber, TSR20 **",
//             "Rubber, RSS3"), rows from 7 = "1960M01", ... ; a missing value is "…".
// One failing part keeps its old numbers (marked stale); the other parts still update.

const path = require("path");
const { DATA_DIR, fetchJson, fetchText, parseCsv, readJson, writeIfChanged } = require("./lib/common");
const { stampedSources } = require("./lib/parts");
const { unpack, eachLine } = require("./lib/zip");

const OUT_FILE = path.join(DATA_DIR, "rubber-world.json");
const TIMEOUT_MS = 90000;
const PAUSE_MS = 2000; // the free Comtrade endpoint is rate limited
const YEARS_KEPT = 3;
const TOP = 15; // countries kept per list (the page shows 10)
const FIRST_YEAR = 2010; // FAO history kept from this year
const FIRST_MONTH = "2000-01"; // world prices kept from this month

const SOURCES = {
  comtrade: { source_name: "UN Comtrade: trade in natural rubber (HS 4001)", source_url: "https://comtradeplus.un.org/", license: "UN Comtrade - free public data, with attribution" },
  faostat: { source_name: "FAOSTAT: production and producer prices of natural rubber", source_url: "https://www.fao.org/faostat/en/#data/QCL", license: "FAO - CC BY 4.0" },
  wb_pink: { source_name: "World Bank Commodity Price Data (Pink Sheet)", source_url: "https://www.worldbank.org/en/research/commodity-markets", license: "CC BY 4.0 - The World Bank" },
};

const COMTRADE = "https://comtradeapi.un.org/public/v1/preview/C/A/HS";
const CODES = ["4001", "400110", "400121", "400122", "400129"];
// ASEAN (10) + China: ISO code -> UN country code used by Comtrade and FAO
const FOCUS = { LAO: 418, THA: 764, VNM: 704, KHM: 116, MMR: 104, MYS: 458, IDN: 360, PHL: 608, SGP: 702, BRN: 96, CHN: 156 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round1 = (v) => Math.round(v * 10) / 10;

async function fetchBuffer(url, timeoutMs) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "lao-kip-gold-dashboard (personal, non-commercial)" }, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastError = err;
      if (attempt === 1) await sleep(3000);
    }
  }
  throw new Error(`Download failed (${url}): ${lastError.message}`);
}

// ---------- Trade (UN Comtrade) ----------
const names = {}; // ISO -> English name, filled from the answers

async function comtrade(query) {
  const url = `${COMTRADE}?${query}&includeDesc=true`;
  for (let attempt = 1; ; attempt++) {
    await sleep(PAUSE_MS);
    try {
      const data = await fetchJson(url, {}, TIMEOUT_MS);
      if (data.error) throw new Error(`Comtrade: ${data.error}`);
      const rows = data.data || [];
      if (rows.length >= 500) throw new Error("Comtrade answer may be cut off at 500 rows");
      // totals only (no split by second partner, customs procedure or transport), real economies only
      return rows.filter((r) => r.partner2Code === 0 && r.motCode === 0 && r.customsCode === "C00" && /^[A-Z0-9]{3}$/.test(r.reporterISO || ""));
    } catch (err) {
      if (attempt >= 2) throw err;
      await sleep(15000); // most likely "too many requests": wait and try once more
    }
  }
}

// One answer row -> [ISO, tonnes (null when no weight was reported), USD thousands]
function tradeRow(r) {
  names[r.reporterISO] = r.reporterDesc || r.reporterISO;
  const kg = Number(r.netWgt);
  return [r.reporterISO, kg > 0 ? round1(kg / 1000) : null, Math.round(Number(r.primaryValue) / 1000)];
}

// Rows of one form of rubber -> { world: [tonnes, USD k, USD k of the rows that have a weight], n, rows: top + ASEAN/China }
function summarise(list) {
  const rows = list.filter((x) => x[2] > 0).sort((a, b) => b[2] - a[2]);
  const weighed = rows.filter((x) => x[1] !== null);
  return {
    world: [round1(weighed.reduce((n, x) => n + x[1], 0)), rows.reduce((n, x) => n + x[2], 0), weighed.reduce((n, x) => n + x[2], 0)],
    n: rows.length,
    rows: rows.filter(([iso], i) => i < TOP || FOCUS[iso]),
  };
}

// What every reporter traded WITH one country (its partners' side of the story), per form of rubber:
// { "4001": { total: [tonnes, USD k, USD k with weight], n, rows: top partners }, ... }
async function mirror(year, partnerCode, flow) {
  const rows = await comtrade(`period=${year}&partnerCode=${partnerCode}&flowCode=${flow}&cmdCode=${CODES.join(",")}`);
  const out = {};
  for (const code of CODES) {
    const s = summarise(rows.filter((r) => r.cmdCode === code).map(tradeRow));
    if (s.n) out[code] = { total: s.world, n: s.n, rows: s.rows.slice(0, 10) };
  }
  return out;
}

async function tradeYear(year) {
  const out = { reporters: {}, missing: {}, X: {}, M: {}, mirror: { X: {}, M: {} }, lao_buyers: {} };
  for (const flow of ["X", "M"]) {
    const rows = [];
    for (const codes of [["4001"], ["400110", "400121"], ["400122", "400129"]]) {
      rows.push(...(await comtrade(`period=${year}&partnerCode=0&flowCode=${flow}&cmdCode=${codes.join(",")}`)));
    }
    const total = rows.filter((r) => r.cmdCode === "4001");
    out.reporters[flow] = new Set(total.map((r) => r.reporterISO)).size;
    out.missing[flow] = Object.keys(FOCUS).filter((iso) => !total.some((r) => r.reporterISO === iso));
    for (const code of CODES) out[flow][code] = summarise(rows.filter((r) => r.cmdCode === code).map(tradeRow));
  }
  if (out.reporters.X < 20 || out.reporters.M < 20) return null; // the year is not published yet

  // Who bought rubber from Laos = imports of every reporter from Laos (also Laos' exports when it has not reported)
  const laoBuyers = await mirror(year, FOCUS.LAO, "M");
  out.lao_buyers = laoBuyers;
  // ASEAN / China countries that have not reported this year: what their partners reported
  for (const iso of out.missing.X) {
    const m = iso === "LAO" ? laoBuyers : await mirror(year, FOCUS[iso], "M");
    if (Object.keys(m).length) out.mirror.X[iso] = Object.fromEntries(Object.entries(m).map(([code, v]) => [code, [...v.total, v.n]]));
  }
  for (const iso of out.missing.M) {
    const m = await mirror(year, FOCUS[iso], "X");
    if (Object.keys(m).length) out.mirror.M[iso] = Object.fromEntries(Object.entries(m).map(([code, v]) => [code, [...v.total, v.n]]));
  }
  return out;
}

async function trade() {
  const thisYear = new Date().getUTCFullYear();
  const years = {};
  for (let y = thisYear - 1; y >= thisYear - 4 && Object.keys(years).length < YEARS_KEPT; y--) {
    const data = await tradeYear(y);
    if (data) years[y] = data;
    console.log(`       trade ${y}: ${data ? `${data.reporters.X} exporters, ${data.reporters.M} importers reported; not yet: exports ${data.missing.X.join(" ") || "-"} · imports ${data.missing.M.join(" ") || "-"}` : "not published"}`);
  }
  if (!Object.keys(years).length) throw new Error("no year returned");
  return { codes: CODES, focus: Object.keys(FOCUS), years };
}

// ---------- Production and producer prices (FAOSTAT bulk files) ----------
async function faoIndex() {
  const list = await fetchJson("https://bulks-faostat.fao.org/production/datasets_E.json", {}, TIMEOUT_MS);
  const sets = (list.Datasets && list.Datasets.Dataset) || [];
  const pick = (code) => {
    const d = sets.find((x) => x.DatasetCode === code);
    if (!d || !d.FileLocation) throw new Error(`FAOSTAT dataset ${code} not found`);
    return { url: d.FileLocation, updated: String(d.DateUpdate || "").slice(0, 10) };
  };
  return { QCL: pick("QCL"), PP: pick("PP") };
}

// UN country code -> ISO code (Comtrade's public reference list)
async function isoByCode() {
  const ref = await fetchJson("https://comtradeapi.un.org/files/v1/app/reference/Reporters.json", {}, TIMEOUT_MS);
  const map = new Map();
  for (const r of ref.results || ref) {
    if (r.reporterCodeIsoAlpha3 && !r.isGroup) {
      map.set(Number(r.reporterCode), r.reporterCodeIsoAlpha3);
      if (!names[r.reporterCodeIsoAlpha3]) names[r.reporterCodeIsoAlpha3] = r.reporterDesc;
    }
  }
  if (map.size < 150) throw new Error("country reference list looks wrong");
  return map;
}

// Every natural-rubber row of a FAOSTAT "All Data (Normalized)" zip -> onRow({ iso | "WLD", element, year, value, flag, months })
async function faoRubberRows(url, iso, onRow) {
  const buf = await fetchBuffer(url, 300000);
  let ix = null;
  await eachLine(buf, (name) => /All_Data_\(Normalized\)\.csv$/.test(name), (line) => {
    if (!ix) {
      ix = Object.fromEntries(line.replace(/^﻿/, "").split(",").map((h, i) => [h.trim(), i]));
      for (const h of ["Area Code", "Area Code (M49)", "Item Code", "Element Code", "Year", "Value", "Flag"]) if (ix[h] === undefined) throw new Error(`FAOSTAT file has no column "${h}"`);
      return;
    }
    if (!line.includes('"836"')) return; // cheap first test: almost every line is another product
    const row = parseCsv(line)[0];
    if (!row || row[ix["Item Code"]] !== "836" || row[ix.Value] === "") return;
    const area = Number(row[ix["Area Code"]]);
    const code = area === 5000 ? "WLD" : area < 5000 && area !== 351 ? iso.get(Number(String(row[ix["Area Code (M49)"]]).replace(/\D/g, ""))) : null;
    if (!code) return;
    onRow({ iso: code, element: row[ix["Element Code"]], year: Number(row[ix.Year]), value: Number(row[ix.Value]), flag: row[ix.Flag], months: ix["Months Code"] === undefined ? null : row[ix["Months Code"]] });
  });
  if (!ix) throw new Error("FAOSTAT file is empty");
}

async function production(info, iso) {
  const prod = new Map(); // iso -> Map(year -> [tonnes, flag])
  const area = new Map(); // iso -> Map(year -> hectares)
  await faoRubberRows(info.url, iso, (r) => {
    if (r.year < FIRST_YEAR) return;
    if (r.element === "5510") (prod.get(r.iso) || prod.set(r.iso, new Map()).get(r.iso)).set(r.year, [Math.round(r.value), r.flag]);
    if (r.element === "5312") (area.get(r.iso) || area.set(r.iso, new Map()).get(r.iso)).set(r.year, Math.round(r.value));
  });
  const world = prod.get("WLD");
  if (!world || !world.size) throw new Error("no world total for natural rubber");
  const year = Math.max(...world.keys());
  const haOf = (code) => (area.get(code) && area.get(code).has(year) ? area.get(code).get(year) : null);
  const rows = [...prod.entries()]
    .filter(([code, m]) => code !== "WLD" && m.has(year))
    .map(([code, m]) => [code, m.get(year)[0], haOf(code), m.get(year)[1]])
    .sort((a, b) => b[1] - a[1])
    .filter(([code], i) => i < 20 || FOCUS[code]);
  if (rows.length < 10) throw new Error("fewer than 10 producing countries");
  const history = {};
  for (const code of ["WLD", ...Object.keys(FOCUS)]) {
    if (prod.has(code)) history[code] = [...prod.get(code).entries()].sort((a, b) => a[0] - b[0]).map(([y, v]) => [y, v[0]]);
  }
  return { source: "faostat", updated: info.updated, unit: "tonnes", year, world: [world.get(year)[0], haOf("WLD")], rows, history };
}

async function farmPrice(info, iso) {
  const by = new Map(); // iso -> Map(year -> USD per tonne)
  await faoRubberRows(info.url, iso, (r) => {
    if (r.element !== "5532" || r.months !== "7021" || r.year < FIRST_YEAR || r.iso === "WLD") return; // annual value in USD per tonne
    (by.get(r.iso) || by.set(r.iso, new Map()).get(r.iso)).set(r.year, Math.round(r.value));
  });
  const rows = {};
  for (const [code, m] of by) {
    if (Math.max(...m.keys()) >= new Date().getUTCFullYear() - 8) rows[code] = [...m.entries()].sort((a, b) => a[0] - b[0]);
  }
  if (Object.keys(rows).length < 3) throw new Error("fewer than 3 countries with a producer price");
  return { source: "faostat", updated: info.updated, unit: "USD per tonne", rows };
}

// ---------- World prices by month (World Bank Pink Sheet) ----------
async function worldPrices() {
  const page = await fetchText("https://www.worldbank.org/en/research/commodity-markets", {}, TIMEOUT_MS);
  const link = /https:\/\/thedocs\.worldbank\.org\/[^"'\s<>]*CMO-Historical-Data-Monthly\.xlsx/.exec(page);
  if (!link) throw new Error("Pink Sheet link not found on the World Bank page");
  const buf = await fetchBuffer(link[0], 180000);
  const xml = (file) => unpack(buf, (name) => name === file).toString("utf8");

  // sheet "Monthly Prices" -> its file
  const sheetTag = /<sheet [^>]*name="Monthly Prices"[^>]*>/.exec(xml("xl/workbook.xml"));
  const rid = sheetTag && /r:id="([^"]+)"/.exec(sheetTag[0]);
  const rel = rid && new RegExp(`<Relationship [^>]*Id="${rid[1]}"[^>]*>`).exec(xml("xl/_rels/workbook.xml.rels"));
  const target = rel && /Target="([^"]+)"/.exec(rel[0]);
  if (!target) throw new Error('Pink Sheet: sheet "Monthly Prices" not found');

  const strings = [...xml("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(""));
  const sheet = xml("xl/" + target[1].replace(/^\//, ""));
  const cellsOf = (rowXml) => {
    const out = new Map(); // column letters -> text
    for (const m of rowXml.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const v = /<v>([\s\S]*?)<\/v>/.exec(m[3] || "");
      if (!v) continue;
      out.set(m[1], /t="s"/.test(m[2]) ? strings[Number(v[1])] : v[1]);
    }
    return out;
  };
  const cols = {}; // "tsr20" | "rss3" -> column letters
  const series = { tsr20: [], rss3: [] };
  let updated = null;
  for (const m of sheet.matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = cellsOf(m[1]);
    const first = String(cells.get("A") || "");
    if (!cols.tsr20) {
      const up = /Updated on (.+)/.exec(first);
      if (up && !Number.isNaN(Date.parse(up[1]))) updated = new Date(Date.parse(up[1] + " UTC")).toISOString().slice(0, 10);
      for (const [col, text] of cells) {
        if (/^Rubber, TSR20/.test(String(text))) cols.tsr20 = col;
        if (/^Rubber, RSS3/.test(String(text))) cols.rss3 = col;
      }
      continue;
    }
    const month = /^(\d{4})M(\d{2})$/.exec(first);
    if (!month) continue;
    const key = `${month[1]}-${month[2]}`;
    if (key < FIRST_MONTH) continue;
    for (const id of ["tsr20", "rss3"]) {
      const v = Number(cells.get(cols[id]));
      if (cols[id] && Number.isFinite(v) && v > 0) series[id].push([key, Math.round(v * 1000) / 1000]);
    }
  }
  if (!cols.tsr20 || !cols.rss3) throw new Error("Pink Sheet: rubber columns not found");
  if (series.tsr20.length < 24 || series.rss3.length < 24) throw new Error("Pink Sheet: fewer than 24 months of rubber prices");
  for (const id of ["tsr20", "rss3"]) {
    const last = series[id][series[id].length - 1][1];
    if (last < 0.3 || last > 10) throw new Error(`Pink Sheet: ${id} ${last} USD per kg looks wrong`);
  }
  return { source: "wb_pink", unit: "USD per kg", updated, tsr20: series.tsr20, rss3: series.rss3 };
}

// ---------- Run ----------
function okEntry(old, fields, now) {
  const { updated_at, stale, last_error, ...oldData } = old || {};
  const same = old && JSON.stringify(oldData) === JSON.stringify(fields);
  return { ...fields, updated_at: same ? updated_at : now, stale: false, last_error: null };
}
function failEntry(old, fallback, err, now) {
  return { ...(old || fallback), stale: true, last_error: old && old.stale ? old.last_error : { message: err.message, at: now } };
}

async function main() {
  const old = readJson(OUT_FILE, {});
  const now = new Date().toISOString();
  const out = { sources: SOURCES, names: old.names || {} };
  let failed = 0;
  const part = async (id, fallback, run) => {
    try {
      out[id] = okEntry(old[id], await run(), now);
      return true;
    } catch (err) {
      failed++;
      console.error(`[FAIL] ${id}: ${err.message}`);
      out[id] = failEntry(old[id], fallback, err, now);
      return false;
    }
  };

  if (await part("trade", { source: "comtrade", codes: CODES, focus: Object.keys(FOCUS), years: {} }, async () => ({ source: "comtrade", ...(await trade()) }))) {
    console.log(`[OK]   trade: years ${Object.keys(out.trade.years).join(", ")}`);
  }

  // FAO: download the big files only when FAO has published a new edition
  let info = null;
  let iso = null;
  try {
    info = await faoIndex();
    iso = await isoByCode();
  } catch (err) {
    console.error(`[FAIL] faostat index: ${err.message}`);
  }
  for (const [id, key, run, fallback] of [
    ["production", "QCL", production, { source: "faostat", rows: [], history: {} }],
    ["farm_price", "PP", farmPrice, { source: "faostat", rows: {} }],
  ]) {
    if (info && old[id] && !old[id].stale && old[id].updated === info[key].updated) {
      out[id] = old[id];
      console.log(`[OK]   ${id}: FAO edition ${info[key].updated} already stored`);
      continue;
    }
    const ok = await part(id, fallback, async () => {
      if (!info || !iso) throw new Error("FAOSTAT file list or country list could not be read");
      return run(info[key], iso);
    });
    if (ok) console.log(`[OK]   ${id}: FAO edition ${out[id].updated}${out[id].year ? `, latest year ${out[id].year}, ${out[id].rows.length} countries` : `, ${Object.keys(out[id].rows).length} countries`}`);
  }

  if (await part("world_prices", { source: "wb_pink", unit: "USD per kg", tsr20: [], rss3: [] }, worldPrices)) {
    const w = out.world_prices;
    console.log(`[OK]   world_prices: TSR20 ${w.tsr20.length} months (to ${w.tsr20[w.tsr20.length - 1][0]}), RSS3 ${w.rss3.length} months, file updated ${w.updated}`);
  }

  // English names of every country that appears in the file (the page translates the common ones)
  const used = new Set(Object.keys(FOCUS));
  JSON.stringify(out, (k, v) => {
    if (typeof v === "string" && /^[A-Z0-9]{3}$/.test(v)) used.add(v);
    return v;
  });
  for (const code of Object.keys(out.farm_price.rows || {})) used.add(code);
  for (const code of Object.keys(out.production.history || {})) used.add(code);
  const allNames = { ...out.names, ...names };
  out.names = Object.fromEntries([...used].filter((c) => allNames[c]).sort().map((c) => [c, allNames[c]]));

  // One part per line, one trade year per line: small diffs in git
  const tradeText = (t) => {
    const { years, ...head } = t;
    const lines = Object.entries(years || {}).map(([y, v]) => `   ${JSON.stringify(y)}: ${JSON.stringify(v)}`);
    return JSON.stringify({ ...head, years: "@" }).replace('"@"', "{\n" + lines.join(",\n") + "\n  }");
  };
  // the day each source was last read (a source whose parts failed keeps its old day)
  out.sources = stampedSources(SOURCES, old.sources, { trade: out.trade, production: out.production, farm_price: out.farm_price, world_prices: out.world_prices }, now);
  const text =
    `{\n "sources": ${JSON.stringify(out.sources)},\n "names": ${JSON.stringify(out.names)},\n "trade": ${tradeText(out.trade)},\n` +
    ` "production": ${JSON.stringify(out.production)},\n "farm_price": ${JSON.stringify(out.farm_price)},\n "world_prices": ${JSON.stringify(out.world_prices)}\n}\n`;
  JSON.parse(text); // safety: must be valid JSON
  writeIfChanged(OUT_FILE, text);
  console.log(`\nDone: ${failed} of 4 parts failed. Wrote data/rubber-world.json (${(text.length / 1024).toFixed(0)} KB)`);
  if (failed === 4) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { main, tradeYear, worldPrices, production, farmPrice };
