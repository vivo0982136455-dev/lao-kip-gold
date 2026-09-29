// Phase 5: kip direction hint + accuracy tracking.
// Writes data/forecast/hints.json. Run after the fetch scripts (fetch-all.js does this).
//
// How it works (all days are Vientiane dates):
// 1) MAKE a hint for today - only on weekdays, only if BOL has NOT published today's rate yet,
//    and only when the market rate for today is available. The hint is the direction of the
//    market rate (today vs the previous market day): up / down / flat. A hint is never changed later.
// 2) CHECK the hint when BOL publishes that day: compare BOL mid rate (buy+sell)/2 with the
//    previous BOL day -> actual direction -> correct or not.
//    If BOL has not published after 5 days (holiday), the hint is closed as "no_publication".
// "up" = more kip for 1 USD/THB (kip weaker). Changes smaller than FLAT_PCT count as "flat".
// Accuracy is calculated by the web page from this stored file - nothing is hard-coded.
// For tests the current time can be set: NOW=2026-09-29T08:00:00+07:00 node scripts/update-forecast.js

const path = require("path");
const { DATA_DIR, HISTORY_DIR, readJson, writeIfChanged } = require("./lib/common");

const OUT_FILE = path.join(DATA_DIR, "forecast", "hints.json");
const FLAT_PCT = 0.02; // |change| below 0.02 % = flat
const GIVE_UP_DAYS = 5;

const localDay = (iso) =>
  /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : new Date(Date.parse(iso) + 7 * 3600000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
const isWeekend = (day) => [0, 6].includes(new Date(day + "T00:00:00Z").getUTCDay());

function direction(pct) {
  if (Math.abs(pct) < FLAT_PCT) return "flat";
  return pct > 0 ? "up" : "down";
}
const pctChange = (from, to) => Math.round(((to - from) / from) * 100 * 10000) / 10000;

// day -> last value of that day, for one metric
function daily(rows, metric) {
  const map = new Map();
  for (const r of rows) if (r.metric === metric) map.set(localDay(r.source_date), r.value);
  return map;
}

// day -> BOL mid rate for one currency
function bolMid(rows, cur) {
  const buy = daily(rows, `${cur}_LAK_buy`);
  const sell = daily(rows, `${cur}_LAK_sell`);
  const map = new Map();
  for (const [day, b] of buy) if (sell.has(day)) map.set(day, (b + sell.get(day)) / 2);
  return map;
}

// Newest day in the map that is before `day`
function previousDay(map, day) {
  return [...map.keys()].filter((d) => d < day).sort().pop() || null;
}

function main() {
  const now = process.env.NOW ? new Date(process.env.NOW) : new Date();
  const today = localDay(now.toISOString());
  const data = readJson(OUT_FILE, null) || { flat_threshold_pct: FLAT_PCT, hints: [] };

  const bolRows = readJson(path.join(HISTORY_DIR, "bol.json"), []);
  const fxRows = readJson(path.join(HISTORY_DIR, "fx-market.json"), []);
  const bol = { usd: bolMid(bolRows, "USD"), thb: bolMid(bolRows, "THB") };
  const market = { usd: daily(fxRows, "USD_LAK"), thb: daily(fxRows, "THB_LAK") };

  // 1) Make today's hint
  const exists = data.hints.some((h) => h.target_date === today);
  if (!exists && !isWeekend(today) && !bol.usd.has(today) && market.usd.has(today) && market.thb.has(today)) {
    const fromDay = previousDay(market.usd, today);
    if (fromDay && market.thb.has(fromDay)) {
      const usdPct = pctChange(market.usd.get(fromDay), market.usd.get(today));
      const thbPct = pctChange(market.thb.get(fromDay), market.thb.get(today));
      data.hints.push({
        target_date: today,
        made_at: now.toISOString(),
        basis: { from_day: fromDay, to_day: today, usd_pct: usdPct, thb_pct: thbPct },
        hint: { usd: direction(usdPct), thb: direction(thbPct) },
        status: "pending",
      });
      console.log(`[forecast] new hint for ${today}: USD ${direction(usdPct)}, THB ${direction(thbPct)}`);
    }
  }

  // 2) Check pending hints
  for (const h of data.hints) {
    if (h.status !== "pending") continue;
    const day = h.target_date;
    if (bol.usd.has(day) && bol.thb.has(day)) {
      const actual = {};
      const pct = {};
      for (const cur of ["usd", "thb"]) {
        const prev = previousDay(bol[cur], day);
        if (!prev) continue;
        pct[cur] = pctChange(bol[cur].get(prev), bol[cur].get(day));
        actual[cur] = direction(pct[cur]);
      }
      if (!actual.usd || !actual.thb) continue;
      h.actual = actual;
      h.actual_pct = pct;
      h.correct = { usd: h.hint.usd === actual.usd, thb: h.hint.thb === actual.thb };
      h.status = "resolved";
      h.resolved_at = now.toISOString();
      console.log(`[forecast] checked ${day}: USD ${h.correct.usd ? "correct" : "wrong"}, THB ${h.correct.thb ? "correct" : "wrong"}`);
    } else if (daysBetween(day, today) > GIVE_UP_DAYS) {
      h.status = "no_publication";
      console.log(`[forecast] ${day}: BOL did not publish - closed`);
    }
  }

  data.hints.sort((a, b) => (a.target_date < b.target_date ? -1 : 1));
  const text = "{\n" + `  "flat_threshold_pct": ${FLAT_PCT},\n  "hints": [\n` +
    data.hints.map((h) => "    " + JSON.stringify(h)).join(",\n") + (data.hints.length ? "\n" : "") + "  ]\n}\n";
  writeIfChanged(OUT_FILE, text);
  const pending = data.hints.filter((h) => h.status === "pending").length;
  console.log(`[forecast] ${data.hints.length} hints stored (${pending} waiting for BOL)`);
}

if (require.main === module) main();

module.exports = { main };
