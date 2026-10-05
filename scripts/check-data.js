// Health check for the data files. Does not download anything.
// Usage: node scripts/check-data.js          (DATA_DIR=<folder> checks a copy: tests/data-check.js does that)
//   1. history files      no duplicate rows, all values > 0, sorted by time, every field present
//   2. latest files       valid, status shown (stale is a state of a source, not a problem of the file)
//   3. series files       economy.json, invest.json, population.json, compare.json (audit 2026-10-02, P1-10):
//                         required fields, a known source, years / months in order and not impossible, every
//                         value a number inside what its unit allows; and an indicator that is kept in two files
//                         (Laos' GDP in economy.json and compare.json ...) has the same number in both
//   4. hand-read facts    invest-static.json: every source has a name, a link and a publication date (or says it
//                         has none), every fact names a source that exists, every section says when it was read;
//                         the World Bank's debt numbers, which several facts quote, are the same in all of them
//   5. the other files    valid JSON, sources with a name and a link, kip hints well-formed
//   6. links              every address in a data file is https (audit 2026-10-02, P2-9: an address read from
//                         somebody else's page becomes something the reader can tap)
// The ranges are wide on purpose: they catch a wrong unit or a broken reading (a growth of 4,500%, a GDP of 0, a
// year 20255), not an unusual year. A unit without a range is a problem too - a new unit must be given one.

const fs = require("fs");
const path = require("path");
const { DATA_DIR, LATEST_DIR, HISTORY_DIR, readJson, recordKey } = require("./lib/common");

const FIELDS = ["source", "metric", "value", "unit", "fetched_at", "source_date"];
const NOW = new Date(Date.now() + 7 * 3600000); // Vientiane
const TODAY = NOW.toISOString().slice(0, 10);
const THIS_MONTH = TODAY.slice(0, 7);
const THIS_YEAR = NOW.getUTCFullYear();
let problems = 0;

function problem(msg) {
  problems++;
  console.log(`  !! ${msg}`);
}

function listJson(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
}

// ---------- 1. history files ----------
console.log("=== History files ===");
for (const file of listJson(HISTORY_DIR)) {
  const rows = readJson(path.join(HISTORY_DIR, file), null);
  if (!Array.isArray(rows)) {
    problem(`${file}: not a valid JSON list`);
    continue;
  }
  const seen = new Set();
  let dupes = 0;
  rows.forEach((r, i) => {
    const key = recordKey(r);
    if (seen.has(key)) dupes++;
    seen.add(key);
    for (const f of FIELDS) if (r[f] === undefined || r[f] === null) problem(`${file} row ${i}: missing ${f}`);
    if (!(r.value > 0)) problem(`${file} row ${i}: value is not > 0`);
    if (i > 0 && rows[i - 1].source_date > r.source_date) problem(`${file} row ${i}: not sorted by time`);
  });
  if (dupes) problem(`${file}: ${dupes} duplicate rows`);

  const first = rows[0] ? rows[0].source_date : "-";
  const last = rows.length ? rows[rows.length - 1].source_date : "-";
  console.log(`${file.padEnd(18)} ${String(rows.length).padStart(6)} rows   ${first}  ->  ${last}   duplicates: ${dupes}`);
}

// ---------- 2. latest files ----------
console.log("\n=== Latest files ===");
for (const file of listJson(LATEST_DIR)) {
  const data = readJson(path.join(LATEST_DIR, file), null);
  if (!data) {
    problem(`${file}: not valid JSON`);
    continue;
  }
  const status = data.stale ? "STALE" : "ok";
  const error = data.last_error ? `  error: ${data.last_error.message}` : "";
  const route = data.route ? `  route: ${data.route}` : "";
  console.log(`${file.padEnd(18)} ${status.padEnd(6)} ${String((data.records || []).length).padStart(3)} values${route}${error}`);
}

// ---------- 3. series files ----------
// unit -> [lowest, highest] a value can sensibly be
const RANGES = {
  "%": [-60, 300],
  "% per year": [-60, 300],
  "LAK billion": [-10000000, 10000000],
  "% of GDP": [-100, 400],
  "% of GNI": [0, 500],
  "% of exports": [0, 500],
  "% of people": [0, 100],
  "% of people 15+": [0, 100],
  "% of workers": [0, 100],
  "% of labour force": [0, 100],
  "USD bn": [-1000, 100000],
  "USD m": [-100000, 10000000],
  "USD per person": [50, 300000],
  "intl$ per person": [100, 400000],
  "USD per troy oz": [1, 100000],
  "USD per barrel": [1, 1000],
  "US cents per pound": [1, 5000],
  "LAK per USD": [1000, 1000000],
  "LAK per THB": [50, 50000],
  "LAK per CNY": [100, 200000],
  "THB per USD": [5, 200],
  "CNY per USD": [1, 50],
  index: [1, 100000],
  months: [0, 60],
  million: [0.1, 2000],
  people: [-5000000, 2000000000],
  years: [20, 100],
  "births per woman": [0.5, 9],
  "per 100 of working age": [10, 200],
  "people per sq km": [0.1, 30000],
};
const FIRST_YEAR = 1960;
const isDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
const isMonth = (s) => typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

// One list of [period, value] rows. kind: "year" (lastYear = the latest year allowed) or "month".
function checkRows(where, rows, unit, kind, lastYear) {
  if (!Array.isArray(rows)) return problem(`${where}: no list of values`);
  const range = RANGES[unit];
  if (!range) problem(`${where}: no range known for the unit ${JSON.stringify(unit)} - add it to RANGES in scripts/check-data.js`);
  let before = null;
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2) {
      problem(`${where}: a row is not [period, value]: ${JSON.stringify(row)}`);
      continue;
    }
    const [period, value] = row;
    if (kind === "year") {
      if (!Number.isInteger(period) || period < FIRST_YEAR || period > lastYear) problem(`${where}: impossible year ${JSON.stringify(period)}`);
    } else if (!isMonth(period)) problem(`${where}: impossible month ${JSON.stringify(period)}`);
    else if (period > THIS_MONTH) problem(`${where}: month ${period} is in the future`);
    if (before !== null && !(period > before)) problem(`${where}: ${JSON.stringify(period)} comes after ${JSON.stringify(before)} - not in order, or twice`);
    before = period;
    if (typeof value !== "number" || !Number.isFinite(value)) problem(`${where} ${period}: value ${JSON.stringify(value)} is not a number`);
    else if (range && (value < range[0] || value > range[1])) problem(`${where} ${period}: ${value} is outside what "${unit}" can be (${range[0]} to ${range[1]})`);
  }
}

// The fields every automatic series or part carries
function checkEntry(where, entry, sources) {
  if (!entry || typeof entry !== "object") return problem(`${where}: missing`);
  if (!entry.source) problem(`${where}: no source`);
  else if (sources && !sources[entry.source]) problem(`${where}: source "${entry.source}" is not in the file's list of sources`);
  if (typeof entry.stale !== "boolean") problem(`${where}: "stale" is not true / false`);
  if (entry.stale && !(entry.last_error && entry.last_error.message)) problem(`${where}: marked stale without an error message`);
}

function checkSources(file, sources) {
  if (!sources || typeof sources !== "object") return problem(`${file}: no list of sources`);
  for (const [id, src] of Object.entries(sources)) {
    if (!src.source_name || typeof src.source_name !== "string") problem(`${file} source ${id}: no name`);
    if (src.source_url !== undefined && src.source_url !== null && !/^https:\/\//.test(src.source_url)) problem(`${file} source ${id}: link is not https: ${JSON.stringify(src.source_url)}`);
    for (const k of ["updated", "retrieved"]) if (src[k] !== undefined && !isDay(src[k])) problem(`${file} source ${id}: "${k}" is not a day: ${JSON.stringify(src[k])}`);
    if (src.retrieved && src.retrieved > TODAY) problem(`${file} source ${id}: read on ${src.retrieved}, which is in the future`);
  }
}

// economy.json / invest.json / population.json: { sources, indicators: { id: { source, unit, values } }, monthly? }
function checkSeriesFile(name, { lastYear = THIS_YEAR + 6 } = {}) {
  const data = readJson(path.join(DATA_DIR, name), null);
  if (!data) return problem(`${name}: missing or not valid JSON`);
  checkSources(name, data.sources);
  let series = 0;
  let stale = 0;
  let newest = 0;
  for (const [id, ind] of Object.entries(data.indicators || {})) {
    const where = `${name} ${id}`;
    checkEntry(where, ind, data.sources);
    if (!ind.unit) problem(`${where}: no unit`);
    if (!ind.stale && !(Array.isArray(ind.values) && ind.values.length)) problem(`${where}: no values`);
    checkRows(where, ind.values, ind.unit, "year", lastYear);
    series++;
    if (ind.stale) stale++;
    for (const [y] of ind.values || []) if (Number.isInteger(y) && y <= THIS_YEAR) newest = Math.max(newest, y);
  }
  let months = 0;
  for (const [id, s] of Object.entries(data.monthly || {})) {
    const where = `${name} monthly ${id}`;
    checkEntry(where, s, data.sources);
    if (!s.stale && !(Array.isArray(s.values) && s.values.length)) problem(`${where}: no values`);
    checkRows(where, s.values, s.unit, "month");
    months++;
    if (s.stale) stale++;
  }
  if (!series) problem(`${name}: no indicators`);
  console.log(`${name.padEnd(18)} ${String(series).padStart(4)} yearly series (newest year ${newest || "-"})${months ? `, ${months} monthly` : ""}${stale ? `   STALE: ${stale}` : ""}`);
  return data;
}

console.log("\n=== Series files ===");
checkSeriesFile("economy.json");
const invest = checkSeriesFile("invest.json");
if (invest) {
  for (const [id, part] of Object.entries(invest.parts || {})) {
    checkEntry(`invest.json part ${id}`, part, invest.sources);
    if (part.year !== undefined && part.year !== null && (!Number.isInteger(part.year) || part.year < FIRST_YEAR || part.year > THIS_YEAR)) problem(`invest.json part ${id}: impossible year ${JSON.stringify(part.year)}`);
  }
}
const population = checkSeriesFile("population.json");
if (population) {
  const proj = population.projections;
  if (proj) {
    checkEntry("population.json projections", proj, population.sources);
    for (const [id, rows] of Object.entries(proj.series || {})) checkRows(`population.json projections ${id}`, rows, (population.indicators[id] || {}).unit, "year", 2100);
  }
  const nb = population.neighbours;
  if (nb) {
    checkEntry("population.json neighbours", nb, population.sources);
    for (const [iso, row] of Object.entries(nb.rows || {})) {
      for (const [id, cell] of Object.entries(row)) checkRows(`population.json neighbours ${iso} ${id}`, [cell], (population.indicators[id] || {}).unit, "year", THIS_YEAR);
    }
  }
  const pv = population.provinces;
  if (pv) {
    checkEntry("population.json provinces", pv, population.sources);
    if (!pv.stale && !(Array.isArray(pv.rows) && pv.rows.length >= 17 && pv.total > 1000000)) problem(`population.json provinces: ${pv.rows ? pv.rows.length : 0} provinces, total ${pv.total}`);
  }
}
// compare.json: { sources, countries, indicators: { id: { source, unit, rows: { ISO: [[year, value]] } } } }
{
  const name = "compare.json";
  const data = readJson(path.join(DATA_DIR, name), null);
  if (!data) problem(`${name}: missing or not valid JSON`);
  else {
    checkSources(name, data.sources);
    if (!Array.isArray(data.countries) || !data.countries.includes("LAO")) problem(`${name}: the list of countries has no LAO`);
    let stale = 0;
    for (const [id, ind] of Object.entries(data.indicators || {})) {
      const where = `${name} ${id}`;
      checkEntry(where, ind, data.sources);
      if (ind.stale) stale++;
      if (!ind.stale && !(ind.rows && Array.isArray(ind.rows.LAO) && ind.rows.LAO.length)) problem(`${where}: no values for Laos`);
      for (const [iso, rows] of Object.entries(ind.rows || {})) {
        if (!(data.countries || []).includes(iso)) problem(`${where}: ${iso} is not in the list of countries`);
        checkRows(`${where} ${iso}`, rows, ind.unit, "year", THIS_YEAR);
      }
    }
    console.log(`${name.padEnd(18)} ${String(Object.keys(data.indicators || {}).length).padStart(4)} indicators x ${(data.countries || []).length} countries${stale ? `   STALE: ${stale}` : ""}`);
  }
}

// The same indicator (same code of the same source) is kept in more than one file - Laos' GDP in economy.json and
// in compare.json, the workers' remittances in invest.json and in population.json ... Until one registry replaces these
// copies (docs/proposal-data-registry-th.md), the copies must not drift apart: for every year both files have,
// the numbers must be the same (units may differ by thousands: USD m / USD bn).
{
  const copies = new Map(); // code -> [{ where, values: Map(year -> value) }]
  const note = (code, where, rows) => {
    if (!code || !Array.isArray(rows)) return;
    if (!copies.has(code)) copies.set(code, []);
    copies.get(code).push({ where, values: new Map(rows.filter((r) => Array.isArray(r) && typeof r[1] === "number")) });
  };
  for (const name of ["economy.json", "invest.json", "population.json"]) {
    const data = readJson(path.join(DATA_DIR, name), null);
    // economy.json also holds other areas under the same code (id "wb.PA.NUS.FCRF.THA", "imf.PCPIPCH.WORLD"): Laos'
    // own series is the one whose id ends with the code itself
    for (const [id, ind] of Object.entries((data && data.indicators) || {})) if (!ind.code || name === "population.json" || id.endsWith("." + ind.code)) note(`${ind.source}:${ind.code || id}`, `${name} ${id}`, ind.values);
  }
  const cmp = readJson(path.join(DATA_DIR, "compare.json"), null);
  for (const [id, ind] of Object.entries((cmp && cmp.indicators) || {})) note(`${ind.source}:${ind.code}`, `compare.json ${id} LAO`, ind.rows && ind.rows.LAO);
  const same = (a, b) => {
    if (Math.abs(a) < 1 && Math.abs(b) < 1) return Math.abs(a - b) < 0.01;
    if (a === 0 || b === 0 || a * b < 0) return false;
    const ratio = Math.abs(a / b);
    const thousands = Math.round(Math.log10(ratio) / 3) * 3;
    return Math.abs(ratio / 10 ** thousands - 1) < 0.002;
  };
  let shared = 0;
  let compared = 0;
  for (const [code, list] of copies) {
    if (list.length < 2) continue;
    shared++;
    for (let i = 1; i < list.length; i++) {
      for (const [year, value] of list[i].values) {
        if (!list[0].values.has(year)) continue;
        compared++;
        if (!same(list[0].values.get(year), value)) problem(`${code} ${year}: ${list[0].where} says ${list[0].values.get(year)}, ${list[i].where} says ${value} - two copies of one number differ`);
      }
    }
  }
  console.log(`same indicator in two files: ${shared} indicators, ${compared} values compared`);
}

// ---------- 4. hand-read facts ----------
console.log("\n=== Hand-read facts (invest-static.json) ===");
{
  const name = "invest-static.json";
  const data = readJson(path.join(DATA_DIR, name), null);
  if (!data) problem(`${name}: missing or not valid JSON`);
  else {
    const sources = data.sources || {};
    // a source: name, https link, and "published": a day, a month, a year - or null for a page that carries no date
    for (const [id, src] of Object.entries(sources)) {
      if (!src.source_name) problem(`${name} source ${id}: no name`);
      if (!/^https:\/\//.test(src.source_url || "")) problem(`${name} source ${id}: no https link`);
      if (!("published" in src)) problem(`${name} source ${id}: does not say when it was published (use null for a page without a date)`);
      else if (src.published !== null) {
        const p = src.published;
        if (!(isDay(p) || isMonth(p) || /^(19|20)\d\d$/.test(p))) problem(`${name} source ${id}: "published" is not a day, a month or a year: ${JSON.stringify(p)}`);
        else if (String(p) > (isDay(p) ? TODAY : isMonth(p) ? THIS_MONTH : String(THIS_YEAR))) problem(`${name} source ${id}: published ${p}, which is in the future`);
      }
    }
    // every "checked" in the file is a day that has come
    const checkedDays = [];
    const used = new Set();
    let facts = 0;
    const visit = (node, where) => {
      if (Array.isArray(node)) return node.forEach((x, i) => visit(x, `${where}[${i}]`));
      if (!node || typeof node !== "object") return;
      if ("checked" in node) {
        checkedDays.push(node.checked);
        if (!isDay(node.checked)) problem(`${name} ${where || "file"}: "checked" is not a day: ${JSON.stringify(node.checked)}`);
        else if (node.checked > TODAY) problem(`${name} ${where || "file"}: checked on ${node.checked}, which is in the future`);
      }
      if (where && "source" in node) {
        facts++;
        if (typeof node.source !== "string" || !sources[node.source]) problem(`${name} ${where}: source ${JSON.stringify(node.source)} is not in the list of sources`);
        else used.add(node.source);
      }
      if (where && Array.isArray(node.sources)) {
        for (const id of node.sources) {
          if (!sources[id]) problem(`${name} ${where}: source ${JSON.stringify(id)} is not in the list of sources`);
          else used.add(id);
        }
      }
      for (const [k, v] of Object.entries(node)) if (!(where === "" && k === "sources")) visit(v, where ? `${where}.${k}` : k);
    };
    visit(data, "");
    if (!isDay(data.checked)) problem(`${name}: the file does not say when it was last checked`);
    // every fact names its source: the entries of these lists and groups are facts, one by one
    const needSource = (list, where) => {
      for (const [key, fact] of Array.isArray(list) ? list.entries() : Object.entries(list || {})) {
        if (!fact || typeof fact !== "object" || Array.isArray(fact)) continue; // "_about", "checked" ...
        if (!fact.source && !(Array.isArray(fact.sources) && fact.sources.length)) problem(`${name} ${where}.${fact.id || fact.iso || key}: a fact without a source`);
      }
    };
    needSource(data.facts, "facts");
    needSource(data.population, "population");
    for (const area of (data.policy && data.policy.areas) || []) needSource(area.items, `policy.${area.id}`);
    needSource(data.policy && data.policy.calendar, "policy.calendar");
    needSource(data.wages && data.wages.countries, "wages.countries");
    needSource(data.rubber && data.rubber.reports, "rubber.reports");
    needSource(data.land && data.land.official_extra, "land.official_extra");
    for (const [where, fact] of [["plan", data.plan], ["plan.projects", data.plan && data.plan.projects], ["policy.outlook", data.policy && data.policy.outlook], ["policy.advice", data.policy && data.policy.advice], ["wages.thailand", data.wages && data.wages.thailand], ["rubber.official_yearly", data.rubber && data.rubber.official_yearly], ["rubber.production_basis", data.rubber && data.rubber.production_basis]]) {
      if (!fact || !fact.source) problem(`${name} ${where}: a fact without a source`);
    }
    // ... and when it was read: the section's own "checked", else the file's
    // the purity of the two gold bars: a share (0.9999), not a percentage - build-summary.js divides by it
    needSource(data.gold, "gold");
    for (const bar of ["lbb_bar", "thai_bar"]) {
      const f = data.gold && data.gold[bar] && data.gold[bar].fineness;
      if (!(typeof f === "number" && f > 0.5 && f <= 1)) problem(`${name} gold.${bar}: fineness ${JSON.stringify(f)} is not a share between 0.5 and 1 (99.99% is written 0.9999)`);
    }
    for (const section of ["plan", "facts", "policy", "wages", "gold"]) if (!data[section] || !isDay(data[section].checked)) problem(`${name} ${section}: does not say when it was last checked`);
    // The World Bank's public-debt numbers are quoted in several facts (the series for the chart, the sentences
    // of the debt tab, the policy card, the outlook table): one year must have one number everywhere
    const wbDebt = data.facts && data.facts.debt_wb;
    if (wbDebt) {
      checkRows(`${name} facts.debt_wb`, wbDebt.values, "% of GDP", "year", THIS_YEAR + 6);
      const series = new Map(Array.isArray(wbDebt.values) ? wbDebt.values : []);
      const copy = (where, year, value) => {
        if (year === undefined || value === undefined) return;
        if (!series.has(year)) problem(`${name} ${where}: ${value}% for ${year}, but facts.debt_wb has no ${year}`);
        else if (series.get(year) !== value) problem(`${name} ${where}: ${value}% for ${year}, facts.debt_wb says ${series.get(year)}% - two copies of one number differ`);
      };
      const peak = data.facts.debt_peak || {};
      copy("facts.debt_peak (before)", peak.before_year, peak.before);
      copy("facts.debt_peak (now)", peak.now_year, peak.now);
      const debtArea = ((data.policy && data.policy.areas) || []).find((a) => a.id === "debt");
      const level = (debtArea && debtArea.items.find((i) => i.id === "level")) || {};
      copy("policy.debt.level", level.year, level.pct);
      copy("policy.debt.level (before)", level.before_year, level.before);
      const outlook = (data.policy && data.policy.outlook) || {};
      if (outlook.rows && outlook.rows.debt) outlook.years.forEach((y, i) => copy("policy.outlook.debt", y, outlook.rows.debt[i]));
      if (outlook.first_forecast !== undefined && outlook.first_forecast !== wbDebt.first_forecast) problem(`${name} facts.debt_wb: forecasts start in ${wbDebt.first_forecast}, in policy.outlook in ${outlook.first_forecast}`);
    }
    const idle = Object.keys(sources).filter((id) => !used.has(id));
    console.log(`${name.padEnd(18)} ${String(Object.keys(sources).length).padStart(4)} sources, ${facts} facts with a source, last checked ${checkedDays.filter(isDay).sort().pop() || "-"}${idle.length ? `   (no fact names: ${idle.join(", ")})` : ""}`);
  }
}

// ---------- 5. the other files ----------
console.log("\n=== Other data files ===");
const DONE = new Set(["economy.json", "invest.json", "population.json", "compare.json", "invest-static.json"]);
for (const file of listJson(DATA_DIR).filter((f) => !DONE.has(f))) {
  const data = readJson(path.join(DATA_DIR, file), undefined);
  if (data === undefined) {
    problem(`${file}: not valid JSON`);
    continue;
  }
  if (data && typeof data === "object" && data.sources && file !== "summary.json") checkSources(file, data.sources);
  const stale = data && typeof data === "object" ? Object.entries(data).filter(([, v]) => v && typeof v === "object" && v.stale === true).map(([k]) => k) : [];
  console.log(`${file.padEnd(18)} ok${stale.length ? `   STALE parts: ${stale.join(", ")}` : ""}`);
}
// Links. A link in a data file was read from somebody else's page (a notice, a report, a price list) and becomes
// something the reader can tap: only "https://" may get that far (audit 2026-10-02, P2-9). Checked in every data
// file, also the ones above; the page refuses any other link as well (js/ui.js safeUrl).
{
  let links = 0;
  let bad = 0;
  const visit = (node, where) => {
    if (typeof node === "string") {
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(node) || /^(javascript|data|vbscript|file):/i.test(node)) {
        links++;
        if (!/^https:\/\/[^\s/]+\.[^\s/]+/.test(node)) {
          bad++;
          problem(`${where}: a link that is not https: ${JSON.stringify(node.slice(0, 80))}`);
        }
      }
      return;
    }
    if (Array.isArray(node)) return node.forEach((x, i) => visit(x, `${where}[${i}]`));
    if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) visit(v, `${where}.${k}`);
  };
  for (const file of listJson(DATA_DIR)) visit(readJson(path.join(DATA_DIR, file), null), file);
  for (const file of listJson(LATEST_DIR)) visit(readJson(path.join(LATEST_DIR, file), null), `latest/${file}`);
  console.log(`links in the data files: ${links}${bad ? ` - NOT https: ${bad}` : " - every one https"}`);
}
{
  const file = path.join("forecast", "hints.json");
  const data = readJson(path.join(DATA_DIR, file), null);
  if (!data || !Array.isArray(data.hints)) problem(`${file}: missing or without a list of hints`);
  else {
    const DIRS = ["up", "down", "flat"];
    let before = "";
    for (const h of data.hints) {
      const where = `${file} ${h.target_date}`;
      if (!isDay(h.target_date)) problem(`${where}: not a day`);
      if (h.target_date <= before) problem(`${where}: not in order, or twice`);
      before = h.target_date;
      if (!["pending", "resolved", "no_publication"].includes(h.status)) problem(`${where}: unknown status ${JSON.stringify(h.status)}`);
      if (!h.hint || !DIRS.includes(h.hint.usd) || !DIRS.includes(h.hint.thb)) problem(`${where}: hint is not up / down / flat`);
      if (h.status === "resolved") {
        for (const cur of ["usd", "thb"]) {
          if (!h.actual || !DIRS.includes(h.actual[cur])) problem(`${where}: checked without an actual direction for ${cur}`);
          else if (!h.correct || h.correct[cur] !== (h.hint[cur] === h.actual[cur])) problem(`${where}: "correct" for ${cur} does not follow from hint and actual`);
        }
      }
    }
    console.log(`${file.padEnd(18)} ok   ${data.hints.length} hints, ${data.hints.filter((h) => h.status === "resolved").length} checked`);
  }
}

// ---------- the central bank's money and bank statistics (data/bol-money.json): three parts of [period, value] rows ----------
{
  const name = "bol-money.json";
  const data = readJson(path.join(DATA_DIR, name), null);
  if (!data) problem(`${name}: missing or not valid JSON`);
  else {
    checkSources(name, data.sources);
    const isQuarter = (s) => typeof s === "string" && /^\d{4}-Q[1-4]$/.test(s);
    let series = 0;
    for (const id of ["money", "rates", "soundness"]) {
      const part = data[id];
      const where = `${name} ${id}`;
      checkEntry(where, part, data.sources);
      if (!part || typeof part !== "object") continue;
      if (!part.unit) problem(`${where}: no unit`);
      const rows = part.rows || {};
      if (!part.stale && !Object.keys(rows).length) problem(`${where}: no series`);
      for (const [key, list] of Object.entries(rows)) {
        series++;
        if (!part.stale && !(Array.isArray(list) && list.length)) problem(`${where} ${key}: no values`);
        if (id !== "soundness") checkRows(`${where} ${key}`, list, part.unit, "month");
        else {
          // quarters: in order, none in the future, a possible percentage
          let before = "";
          for (const row of Array.isArray(list) ? list : []) {
            const [q, v] = Array.isArray(row) ? row : [];
            if (!isQuarter(q)) problem(`${where} ${key}: impossible quarter ${JSON.stringify(q)}`);
            else if (`${q.slice(0, 4)}-${String(Number(q.slice(6)) * 3 - 2).padStart(2, "0")}` > THIS_MONTH) problem(`${where} ${key}: quarter ${q} is in the future`);
            if (before && !(q > before)) problem(`${where} ${key}: ${JSON.stringify(q)} comes after ${JSON.stringify(before)} - not in order, or twice`);
            before = q;
            if (typeof v !== "number" || !Number.isFinite(v)) problem(`${where} ${key} ${q}: value ${JSON.stringify(v)} is not a number`);
            else if (v < -100 || v > 200) problem(`${where} ${key} ${q}: ${v} is outside what "%" of a bank ratio can be (-100 to 200)`);
          }
        }
      }
    }
    // the four parts of broad money add up to it, month by month (1% of slack: rounding)
    const m = data.money && data.money.rows;
    if (m && m.m2) {
      const maps = ["cash", "demand", "kip_deposits", "fx_deposits"].map((k) => new Map(m[k] || []));
      for (const [month, total] of m.m2) {
        if (!maps.every((x) => x.has(month))) continue;
        const sum = maps.reduce((a, x) => a + x.get(month), 0);
        if (Math.abs(sum / total - 1) > 0.01) problem(`${name} money ${month}: the parts of broad money add up to ${Math.round(sum)}, the total is ${total}`);
      }
    }
    const sec = data.soundness && data.soundness.sectors;
    if (sec && sec.shares) {
      const total = Object.values(sec.shares).reduce((a, b) => a + b, 0);
      if (Math.abs(total - 100) > 1) problem(`${name} soundness: the loans by sector of ${sec.quarter} add up to ${total.toFixed(1)}%, not 100%`);
    }
    const stale = ["money", "rates", "soundness"].filter((id) => data[id] && data[id].stale);
    console.log(`${name.padEnd(18)} ${String(series).padStart(4)} series in 3 parts${stale.length ? "   STALE: " + stale.join(", ") : ""}`);
  }
}

console.log(problems ? `\n${problems} problem(s) found.` : "\nAll checks passed.");
if (problems) process.exitCode = 1;
