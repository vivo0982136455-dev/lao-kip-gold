// Build data/long.json: WEEKLY points for the "1 year" and "all" chart ranges.
// summary.json keeps only ~100 days (small = fast on phones); this file holds the long history
// of the main series and is loaded by the page only when a long range is chosen.
//   calc.bol_<CUR>_LAK_mid  BOL mid rate (buy+sell)/2, 7 currencies, since 2021
//   calc.lbb_sell_baht / calc.lbb_buy_baht  Lao Bullion Bank per Lao baht (15 g), since Aug 2025
//   gold-world.XAU_USD / calc.gold_world_lak  world gold (IMF monthly since 2015 + our recent daily prices)
// Weekly point = last value of the week, labelled with the Monday that starts the week (never a future date).
// Usage: node scripts/build-long.js   (fetch-all.js also runs it)

const path = require("path");
const { DATA_DIR, HISTORY_DIR, readJson, writeIfChanged } = require("./lib/common");

const OUT_FILE = path.join(DATA_DIR, "long.json");
const BOL_CURRENCIES = ["USD", "THB", "CNY", "GBP", "EUR", "JPY", "KRW"];
const GRAMS_PER_LAO_BAHT = 15;

const localDay = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : new Date(Date.parse(iso) + 7 * 3600000).toISOString().slice(0, 10));
const addDays = (day, n) => new Date(Date.parse(day + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
// Monday that starts the week of `day` (same rule as js/charts.js weekStart)
const weekStart = (day) => addDays(day, -((new Date(day + "T00:00:00Z").getUTCDay() + 6) % 7));
const round = (v) => Math.round(v * 100) / 100;

// rows (sorted oldest first) of one metric -> [[weekStart, value]]
function weekly(rows, valueOf) {
  const m = new Map();
  for (const r of rows) {
    const v = valueOf(r);
    if (v !== null) m.set(weekStart(localDay(r.source_date)), round(v));
  }
  return [...m.entries()];
}

function main() {
  const metrics = {};

  // BOL mid per day, then weekly
  const bol = readJson(path.join(HISTORY_DIR, "bol.json"), []);
  for (const cur of BOL_CURRENCIES) {
    const byDay = new Map();
    for (const r of bol) {
      if (r.metric !== `${cur}_LAK_buy` && r.metric !== `${cur}_LAK_sell`) continue;
      const d = byDay.get(r.source_date) || { source_date: r.source_date };
      d[r.metric.endsWith("buy") ? "buy" : "sell"] = r.value;
      byDay.set(r.source_date, d);
    }
    const days = [...byDay.values()].sort((a, b) => (a.source_date < b.source_date ? -1 : 1));
    const list = weekly(days, (d) => (d.buy && d.sell ? (d.buy + d.sell) / 2 : null));
    if (list.length) metrics[`calc.bol_${cur}_LAK_mid`] = list;
  }

  // Lao Bullion Bank per Lao baht
  const lbb = readJson(path.join(HISTORY_DIR, "gold-lbb.json"), []);
  for (const side of ["sell", "buy"]) {
    const rows = lbb.filter((r) => r.metric === `${side}_g`);
    const list = weekly(rows, (r) => r.value * GRAMS_PER_LAO_BAHT);
    if (list.length) metrics[`calc.lbb_${side}_baht`] = list;
  }

  // World gold: IMF monthly average (economy.json, since 2015) + our own recent daily prices, weekly.
  // A monthly average is placed on the week of the 15th of that month.
  const eco = readJson(path.join(DATA_DIR, "economy.json"), null);
  const monthlyGold = eco && eco.monthly && eco.monthly.gold_usd ? eco.monthly.gold_usd.values : [];
  const bolUsdMonthly = new Map(eco && eco.monthly && eco.monthly.bol_usd_mid ? eco.monthly.bol_usd_mid.values : []);
  const recentGold = readJson(path.join(HISTORY_DIR, "gold-world.json"), []).filter((r) => r.metric === "XAU_USD");
  const firstRecentWeek = recentGold.length ? weekStart(localDay(recentGold[0].source_date)) : "9999";
  const goldUsd = new Map(monthlyGold.map(([m, v]) => [weekStart(`${m}-15`), round(v)]).filter(([w]) => w < firstRecentWeek));
  for (const [w, v] of weekly(recentGold, (r) => r.value)) goldUsd.set(w, v);
  if (goldUsd.size) metrics["gold-world.XAU_USD"] = [...goldUsd.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  // Same, in LAK per Thai baht-weight (world gold × BOL USD mid), like calc.gold_world_lak in the summary
  const goldLak = monthlyGold
    .filter(([m]) => bolUsdMonthly.has(m) && weekStart(`${m}-15`) < firstRecentWeek)
    .map(([m, v]) => [weekStart(`${m}-15`), round(v * (15.244 / 31.1035) * bolUsdMonthly.get(m))]);
  if (goldLak.length) metrics["calc.gold_world_lak"] = goldLak;

  const text =
    "{\n" +
    `  "note": "Weekly points (last value of each week, labelled by the Monday starting it). Built by scripts/build-long.js",\n` +
    `  "metrics": {\n` +
    Object.entries(metrics).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(",\n") +
    "\n  }\n}\n";
  JSON.parse(text); // safety: valid JSON
  writeIfChanged(OUT_FILE, text);
  console.log(`[long] ${Object.keys(metrics).length} series -> data/long.json (${(text.length / 1024).toFixed(1)} KB)`);
}

if (require.main === module) main();

module.exports = { main };
