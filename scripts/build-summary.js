// Build data/summary.json: a SMALL file the web page reads (fast on phones).
// It holds, for every metric: the latest value, the previous day's value (for ▲▼ change),
// and one value per day for the last DAYS_KEPT days (for charts).
// Also computes the calculated values (world gold in LAK, estimated Lao gold, BOL mid rates).
// Usage: node scripts/build-summary.js   (fetch-all.js also runs it at the end)

const fs = require("fs");
const path = require("path");
const { DATA_DIR, LATEST_DIR, HISTORY_DIR, readJson } = require("./lib/common");

const DAYS_KEPT = 100; // charts show up to 90 days; keep a few extra
const SOURCES = ["bol", "gold-world", "silver-world", "gold-thai", "fx-market", "fuel-thai", "gold-lbb", "bcel", "bcel-deposit", "gold-lao-manual", "silver-lao-manual", "rubber-lao-manual"];
const OUT_FILE = path.join(DATA_DIR, "summary.json");

// Weights and conversions: scripts/lib/units.js (tested in tests/calc.js)
const { mid, goldLakPerBaht, silverLakPerKg, lakPerLaoBaht, fineGoldPremium, GRAMS_PER_BAHT, GRAMS_PER_LAO_BAHT, GRAMS_PER_TROY_OZ } = require("./lib/units");
const PREMIUM_DAYS = 14; // the average of this many days is shown, and turns the estimate into the adjusted estimate

// ---------- Day helpers (all days are Asia/Vientiane, UTC+7, no daylight saving) ----------

// "2026-09-29T20:00:00Z" -> "2026-09-30" (Vientiane date). "2026-09-28" stays as it is.
function localDay(sourceDate) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(sourceDate)) return sourceDate;
  return new Date(new Date(sourceDate).getTime() + 7 * 3600000).toISOString().slice(0, 10);
}

function addDays(day, n) {
  return new Date(Date.parse(day + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
}

// ---------- Build one metric ----------

// daily: [[day, value], ...] oldest first. Returns the metric object used by the page.
function makeMetric({ source, kind, unit, sources, latest, daily }) {
  const cutoff = addDays(localDay(new Date().toISOString()), -DAYS_KEPT);
  const latestDay = localDay(latest.source_date);
  // "previous" = last daily value from an earlier day than the latest value
  const before = daily.filter(([day]) => day < latestDay);
  const prev = before.length ? { day: before[before.length - 1][0], value: before[before.length - 1][1] } : null;
  return {
    source,
    kind,
    unit,
    sources, // which raw sources this number depends on (for the stale badge)
    latest: { value: round(latest.value), source_date: latest.source_date },
    prev: prev && { day: prev.day, value: round(prev.value) },
    daily: daily.filter(([day]) => day >= cutoff).map(([d, v]) => [d, round(v)]),
  };
}

function round(v) {
  return Math.round(v * 10000) / 10000;
}

// Group raw history rows of one metric into one value per day (the LAST value of each day).
function dailyFromRows(rows) {
  const byDay = new Map();
  for (const r of rows) byDay.set(localDay(r.source_date), r.value); // rows are sorted, so last wins
  return [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

// Combine two or more daily series with a formula, day by day.
// If one input has no value on a day, its most recent earlier value is used ("carry forward").
// Days start only when ALL inputs have at least one value.
function combineDaily(inputs, formula) {
  const days = [...new Set(inputs.flatMap((s) => s.map(([d]) => d)))].sort();
  const lastSeen = inputs.map(() => null);
  const pos = inputs.map(() => 0);
  const out = [];
  for (const day of days) {
    inputs.forEach((series, i) => {
      while (pos[i] < series.length && series[pos[i]][0] <= day) {
        lastSeen[i] = series[pos[i]][1];
        pos[i]++;
      }
    });
    if (lastSeen.every((v) => v !== null)) out.push([day, formula(...lastSeen)]);
  }
  return out;
}

// ---------- Lao premium (Phase 3, automatic since LBB was added) ----------
// The REAL Lao price is Lao Bullion Bank's sell price per Lao baht (15 g) - it updates by itself.
// multiplier (per day) = LBB sell price ÷ our estimate (same day). It is NOT a premium: next to the price gap it
//                        holds the unit gap (Thai baht 15.244 g, Lao baht 15 g) and the purity gap (96.5%, 99.99%)
// avg_14d              = average multiplier of the last 14 days
// adjusted estimate    = estimate × average multiplier of the 14 days BEFORE that day
//                        (never uses the same day's real price, so accuracy tests stay honest)
// fine_avg_14d         = the like-for-like premium: fine gold in an LBB bar ÷ fine gold in a Thai bar, gram for
//                        gram (scripts/lib/units.js fineGoldPremium), average of the same days - what the Gold page
//                        shows as "how much dearer" (audit 2026-10-02, P2-1)
// basis                = the weights and purities the numbers were worked out with (the page prints them)
// How pure the two bars are: hand-read facts (data/invest-static.json "gold"). Without them there is no
// like-for-like premium - a guessed purity would be a made-up number.
function barFineness() {
  const gold = (readJson(path.join(DATA_DIR, "invest-static.json"), null) || {}).gold || {};
  const share = (bar) => (gold[bar] && typeof gold[bar].fineness === "number" && gold[bar].fineness > 0.5 && gold[bar].fineness <= 1 ? gold[bar].fineness : null);
  const [lbb, thai] = [share("lbb_bar"), share("thai_bar")];
  return lbb && thai ? { lbb, thai } : null;
}

function addLaoPremium(summary) {
  const m = summary.metrics;
  const actual = m["calc.lbb_sell_baht"];
  const perGram = m["gold-lbb.sell_g"];
  const est = m["calc.lao_gold_est_sell"];
  summary.gold_premium = null;
  if (!actual || !est) return;

  const estByDay = new Map(est.daily);
  const premiums = actual.daily.filter(([d]) => estByDay.has(d)).map(([d, v]) => [d, v / estByDay.get(d)]);
  if (!premiums.length) return;
  const fineness = barFineness();
  const fine = perGram && fineness ? perGram.daily.filter(([d]) => estByDay.has(d)).map(([d, v]) => [d, fineGoldPremium(v, estByDay.get(d), fineness)]) : [];

  const mean = (list) => list.reduce((sum, [, v]) => sum + v, 0) / list.length;
  const inDays = (list, endDay, fromOffset, toOffset) => list.filter(([d]) => d >= addDays(endDay, fromOffset) && d <= addDays(endDay, toOffset));
  const between = (endDay, fromOffset, toOffset) => inDays(premiums, endDay, fromOffset, toOffset);

  const today = localDay(new Date().toISOString());
  const last14 = between(today, 1 - PREMIUM_DAYS, 0);
  const fine14 = inDays(fine, today, 1 - PREMIUM_DAYS, 0);
  summary.gold_premium = {
    avg_14d: last14.length ? round(mean(last14)) : null,
    days_used: last14.length,
    last_day: premiums[premiums.length - 1][0],
    fine_avg_14d: fine14.length ? round(mean(fine14)) : null,
    window_days: PREMIUM_DAYS,
    basis: { thai_g: GRAMS_PER_BAHT, thai_fineness: fineness ? fineness.thai : null, lao_g: GRAMS_PER_LAO_BAHT, lbb_fineness: fineness ? fineness.lbb : null, oz_g: GRAMS_PER_TROY_OZ },
  };

  m["calc.shop_premium"] = makeMetric({
    source: "calc",
    kind: "estimated",
    unit: "ratio",
    sources: [...new Set([...est.sources, ...actual.sources])],
    latest: { value: premiums[premiums.length - 1][1], source_date: premiums[premiums.length - 1][0] },
    daily: premiums,
  });

  const adjDaily = est.daily
    .map(([d, v]) => {
      const before = between(d, -PREMIUM_DAYS, -1);
      return before.length ? [d, v * mean(before)] : null;
    })
    .filter(Boolean);
  const latestBefore = between(localDay(est.latest.source_date), -PREMIUM_DAYS, -1);
  if (!latestBefore.length) return; // need at least one earlier real price

  m["calc.lao_gold_adj_sell"] = makeMetric({
    source: "calc",
    kind: "estimated",
    unit: "LAK per baht (15 g)",
    sources: [...new Set([...est.sources, ...actual.sources])],
    latest: { value: est.latest.value * mean(latestBefore), source_date: est.latest.source_date },
    daily: adjDaily,
  });
}

// ---------- Main ----------

function main() {
  const summary = { sources: {}, metrics: {} };
  const kinds = {};

  // 1) Raw metrics straight from each source
  for (const source of SOURCES) {
    const latestFile = readJson(path.join(LATEST_DIR, `${source}.json`), null);
    if (!latestFile) {
      console.warn(`[summary] no latest file for ${source} - skipped`);
      continue;
    }
    const { records, ...info } = latestFile;
    const dates = (records || []).map((r) => r.source_date).sort();
    summary.sources[source] = { ...info, latest_source_date: dates[dates.length - 1] || null };
    kinds[source] = info.kind;

    const history = readJson(path.join(HISTORY_DIR, `${source}.json`), []);
    for (const rec of records || []) {
      const rows = history.filter((h) => h.metric === rec.metric);
      summary.metrics[`${source}.${rec.metric}`] = makeMetric({
        source,
        kind: info.kind,
        unit: rec.unit,
        sources: [source],
        latest: rec,
        daily: dailyFromRows(rows),
      });
    }
  }

  // 2) Calculated metrics (only when all inputs exist)
  const m = summary.metrics;
  const newest = (...ids) => ids.map((id) => m[id].latest.source_date).sort().pop();
  function derive(id, { kind, unit, inputs, formula }) {
    if (!inputs.every((i) => m[i])) {
      console.warn(`[summary] ${id}: missing input - skipped`);
      return;
    }
    const value = formula(...inputs.map((i) => m[i].latest.value));
    m[id] = makeMetric({
      source: "calc",
      kind,
      unit,
      sources: [...new Set(inputs.map((i) => m[i].sources).flat())],
      latest: { value, source_date: newest(...inputs) },
      daily: combineDaily(inputs.map((i) => m[i].daily), formula),
    });
  }

  // BOL mid rate = (buy + sell) / 2 -> fair comparison with the market MID rate in charts
  for (const cur of ["USD", "THB"]) {
    derive(`calc.bol_${cur}_LAK_mid`, {
      kind: "official",
      unit: `LAK per ${cur}`,
      inputs: [`bol.${cur}_LAK_buy`, `bol.${cur}_LAK_sell`],
      formula: mid,
    });
  }

  // World gold in LAK per baht-weight = XAU/USD × (15.244 / 31.1035) × USD→LAK (market)
  derive("calc.gold_world_lak", {
    kind: "market",
    unit: "LAK per baht-weight",
    inputs: ["gold-world.XAU_USD", "fx-market.USD_LAK"],
    formula: goldLakPerBaht,
  });

  // World silver in LAK per kg = XAG/USD × 32.1507 × USD→LAK (market). PML's shop price is per kg too.
  derive("calc.silver_world_lak_kg", {
    kind: "market",
    unit: "LAK per kg",
    inputs: ["silver-world.XAG_USD", "fx-market.USD_LAK"],
    formula: silverLakPerKg,
  });

  // Thai fuel in LAK per litre (× THB→LAK market) - compared with fuel prices in Laos
  for (const fuel of ["diesel", "gasohol95"]) {
    derive(`calc.fuel_thai_${fuel}_lak`, {
      kind: "market",
      unit: "LAK per litre",
      inputs: [`fuel-thai.${fuel}`, "fx-market.THB_LAK"],
      formula: (thb, thbLak) => thb * thbLak,
    });
  }

  // Estimated Lao gold = Thai association bar price (THB per baht-weight) × THB→LAK (market)
  for (const side of ["sell", "buy"]) {
    derive(`calc.lao_gold_est_${side}`, {
      kind: "estimated",
      unit: "LAK per baht-weight",
      inputs: [`gold-thai.bar_${side}`, "fx-market.THB_LAK"],
      formula: (thb, thbLak) => thb * thbLak,
    });
  }

  // Lao Bullion Bank per Lao baht (15 g) - LBB itself prices per gram
  for (const side of ["sell", "buy"]) {
    derive(`calc.lbb_${side}_baht`, {
      kind: "bank",
      unit: "LAK per baht (15 g)",
      inputs: [`gold-lbb.${side}_g`],
      formula: lakPerLaoBaht,
    });
  }

  // BCEL mid rate = (buy + sell) / 2 -> compared with BOL mid and market mid in charts
  for (const cur of ["USD", "THB"]) {
    derive(`calc.bcel_${cur}_LAK_mid`, {
      kind: "bank",
      unit: `LAK per ${cur}`,
      inputs: [`bcel.${cur}_LAK_buy`, `bcel.${cur}_LAK_sell`],
      formula: mid,
    });
  }

  // Lao premium (vs LBB) + adjusted estimate (Phase 3)
  addLaoPremium(summary);

  // Compact output: one metric per line keeps the file small and git diffs readable
  const lines = Object.entries(summary.metrics).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  const text =
    "{\n" +
    `  "sources": ${JSON.stringify(summary.sources, null, 2).replace(/\n/g, "\n  ")},\n` +
    `  "gold_premium": ${JSON.stringify(summary.gold_premium ?? null)},\n` +
    `  "metrics": {\n${lines.join(",\n")}\n  }\n}\n`;

  let old = null;
  try {
    old = fs.readFileSync(OUT_FILE, "utf8");
  } catch {
    /* first run */
  }
  if (old !== text) fs.writeFileSync(OUT_FILE, text);
  console.log(`[summary] ${Object.keys(summary.metrics).length} metrics -> data/summary.json (${(text.length / 1024).toFixed(1)} KB)`);
}

if (require.main === module) main();

module.exports = { main };
