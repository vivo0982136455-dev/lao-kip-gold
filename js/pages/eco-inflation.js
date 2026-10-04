// Economy tab 6: inflation & the kip - how fast prices rise, how that follows the kip (BOL rate vs a year before),
// Laos vs Thailand, the yearly picture with the plan's goal, and why (World Bank report).

import { el, card, cardHead, pctPill } from "../ui.js";
import { chartCard } from "../charts.js";
import { formatNumber } from "../format.js";
import {
  THIS_YEAR, lastOf, indicator, valueIn, pctText, freshness, sourcesFoot, invTile, yearChart, staticSource,
  fill, monthText, monthShort, planLabel, planYears, sourceWords, choice, unitName,
} from "./eco-common.js";
import { dearer, kipChange } from "../calc.js";
import { inflationCompare } from "./living-parts.js";
import { inflationSeries, latestInflation, differCard } from "./eco-latest.js";

const addMonths = (m, n) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7);

// ---------- the kip against the dollar, the baht and the yuan, year by year ----------
// Two lines, NOT glued into one, because the two sources do not count the same thing (audit 2026-10-02, P2-6:
// the World Bank's line ended in 2024 and was to be "extended" with the central bank's averages):
//   World Bank  the official exchange rate, average of the year (its database, taken from the IMF). Baht and
//               yuan: worked out through the dollar from the same series of Thailand and of China.
//   BOL         the middle of the buying and the selling rate on the Bank of the Lao PDR's exchange-rate page,
//               averaged over the year from our monthly averages (2021 onwards; the running year = so far).
// In 2024 the two are 7% apart: one line would show a jump in 2025 that never happened.
const FX = { USD: null, THB: "wb.PA.NUS.FCRF.THA", CNY: "wb.PA.NUS.FCRF.CHN" }; // currency -> its own dollar rate
const round3 = (v) => Math.round(v * 1000) / 1000;
// -> { years, wb: [value | null], bol: [value | null], partial: { year, month } | null, gap: { year, pct } | null,
//      stale } or null when there is nothing to draw. economy = data/economy.json, thisYear = the running year
export function fxYears(economy, cur, thisYear) {
  const ind = (economy && economy.indicators) || {};
  const lak = ind["wb.PA.NUS.FCRF"];
  const other = FX[cur] ? ind[FX[cur]] : null;
  const monthly = economy && economy.monthly && economy.monthly[`bol_${cur.toLowerCase()}_mid`];
  if (!lak || !lak.values.length || (FX[cur] && !other)) return null;
  const wbMap = new Map();
  for (const [y, v] of lak.values) {
    const per = other ? valueIn(other, y) : 1;
    if (per) wbMap.set(y, round3(v / per));
  }
  // our own monthly averages: a finished year counts only with all twelve months, the running year as it stands
  const byYear = new Map();
  for (const [m, v] of (monthly && monthly.values) || []) {
    const y = Number(m.slice(0, 4));
    byYear.set(y, [...(byYear.get(y) || []), [m, v]]);
  }
  const bolMap = new Map();
  let partial = null;
  for (const [y, rows] of byYear) {
    if (y < thisYear && rows.length < 12) continue;
    bolMap.set(y, round3(rows.reduce((sum, [, v]) => sum + v, 0) / rows.length));
    if (y === thisYear && rows.length < 12) partial = { year: y, month: rows[rows.length - 1][0] };
  }
  const all = [...wbMap.keys(), ...bolMap.keys()];
  if (!all.length) return null;
  const years = [];
  for (let y = Math.min(...all); y <= Math.max(...all); y++) years.push(y);
  const both = years.filter((y) => wbMap.has(y) && bolMap.has(y)).pop();
  return {
    years,
    wb: years.map((y) => (wbMap.has(y) ? wbMap.get(y) : null)),
    bol: years.map((y) => (bolMap.has(y) ? bolMap.get(y) : null)),
    partial,
    gap: both === undefined ? null : { year: both, pct: (bolMap.get(both) / wbMap.get(both) - 1) * 100 },
    stale: !!(lak.stale || (other && other.stale) || (monthly && monthly.stale)),
  };
}

function fxYearCard(e) {
  const { t, economy: eco } = e;
  const { current, bar } = choice(e, "fx_cur", Object.keys(FX).map((c) => [c, `${t["cur_" + c]} (${c})`]));
  const f = fxYears(eco, current, THIS_YEAR);
  if (!f) return null;
  const unit = `LAK per ${current}`;
  const subtitle = [
    `${t.unit}: ${unitName(unit, t)}`,
    `${t.source}: World Bank, BOL`,
    f.partial ? fill(t.fx_year_partial, { year: f.partial.year, month: monthText(f.partial.month, t) }) : null,
    f.stale ? "⚠ " + t.inv_fetch_failed : null,
  ].filter(Boolean).join(" · ");
  const c = chartCard({
    title: t.eco_fx_avg,
    subtitle,
    labels: f.years.map(String),
    series: [
      { label: current === "USD" ? t.fx_line_wb : t.fx_line_wb_cross, kind: "official", values: f.wb },
      { label: t.fx_line_bol, kind: "official", color: "--cat-3", values: f.bol },
    ],
    unit,
    t,
    firstColTitle: t.year,
  });
  const note = [current === "USD" ? t.fx_year_note_wb : t.fx_year_note_cross, t.fx_year_note_bol];
  if (f.gap) note.push(fill(t.fx_year_note_gap, { year: f.gap.year, gap: Math.abs(f.gap.pct).toFixed(1) }));
  c.append(el("p", "note", note.join(" · ")), sourcesFoot(t, [eco.sources.worldbank, eco.sources.bol]));
  const cell = el("div", "stack");
  cell.append(bar, c);
  return cell;
}

export function inflationTab(panel, e) {
  const { t, economy: eco } = e;
  panel.append(el("p", "muted tab-intro", t.inv_infl_intro));
  const mon = eco.monthly || {};
  const cpi = inflationSeries(e); // the IMF's months, continued with the newer months of the central bank
  const usd = mon.bol_usd_mid;
  const target = e.stat && e.stat.plan.targets.find((x) => x.id === "inflation");

  // ---------- Key numbers ----------
  const stats = el("div", "stats");
  const now = latestInflation(e);
  if (now) stats.append(invTile(t, t.inv_k_inflation, pctText(now.value), `${now.src} · ${t.inv_vs_last_year}`, freshness(t, { ...now.when, stale: now.stale })));
  const imfNow = valueIn(indicator(e, "imf.PCPIPCH"), THIS_YEAR);
  if (imfNow !== null) stats.append(invTile(t, fill(t.inv_k_imf_year, { year: THIS_YEAR }), pctText(imfNow), `IMF · ${t.inv_yearly_avg}`, freshness(t, { year: THIS_YEAR })));
  if (target) stats.append(invTile(t, t.inv_k_infl_target, `≤ ${pctText(target.target, 0)}`, fill(t.inv_plan_name, planYears(e)), null));
  const usdNow = usd && lastOf(usd.values);
  const usdAgo = usd && usd.values.length > 12 ? usd.values[usd.values.length - 13] : null;
  if (usdNow && usdAgo) {
    // the tile is about the kip, so its arrow is the kip's own change in value (down = the kip buys fewer dollars)
    const tile = invTile(t, t.inv_k_kip, { num: formatNumber(usdNow[1], "LAK"), unit: t.inv_kip_per_usd }, `BOL · ${t.inv_kip_12m}`, freshness(t, { month: usdNow[0], stale: usd.stale }));
    tile.querySelector(".stat-sub").append(" ", pctPill(kipChange(usdAgo[1], usdNow[1]), { decimals: 1 }));
    stats.append(tile);
  }
  panel.append(stats);

  const grid = el("div", "grid grid-2");

  // ---------- Inflation vs the dollar becoming dearer (both "compared with a year before") ----------
  // The line is how much dearer a dollar became in kip - the measure import prices follow. It is NOT "how much the
  // kip lost" (a dollar that doubles = a kip that lost half): the subtitle says so with the line's own highest month.
  if (cpi && usd && cpi.values.length && usd.values.length > 12) {
    const usdMap = new Map(usd.values);
    const cpiMap = new Map(cpi.values);
    const last = [lastOf(cpi.values)[0], lastOf(usd.values)[0]].sort().pop();
    // from the first month where both exist (the change needs the same month a year before)
    const start = [addMonths(usd.values[0][0], 12), cpi.values[0][0]].sort().pop();
    const months = [];
    for (let m = start; m <= last; m = addMonths(m, 1)) months.push(m);
    const pair = (m) => [usdMap.get(addMonths(m, -12)), usdMap.get(m)];
    const kip = months.map((m) => {
      const [a, b] = pair(m);
      return a && b ? Math.round(dearer(a, b) * 10) / 10 : null;
    });
    if (kip.some((v) => v !== null)) {
      const top = kip.reduce((best, v, i) => (v !== null && (best < 0 || v > kip[best]) ? i : best), -1);
      const [a, b] = pair(months[top]);
      const example = { month: monthText(months[top], t), dearer: dearer(a, b).toFixed(0), lost: Math.abs(kipChange(a, b)).toFixed(0) };
      grid.append(
        chartCard({
          title: t.inv_infl_vs_kip,
          subtitle: fill(t.inv_infl_vs_kip_sub, example),
          labels: months.map((m) => monthText(m, t)),
          tickLabels: months.map((m) => monthShort(m, t)),
          series: [
            { label: t.inv_infl_line, kind: "official", values: months.map((m) => (cpiMap.has(m) ? cpiMap.get(m) : null)) },
            { label: t.inv_kip_line, kind: "official", color: "--cat-3", values: kip },
          ],
          unit: "%",
          unitLabel: t.unit_pct_yoy,
          t,
          firstColTitle: t.month,
        })
      );
    }
  }

  // Laos vs Thailand (same chart as the cost-of-living page), 5 years
  const compare = inflationCompare(e, 5);
  if (compare) grid.append(compare);

  // Yearly, with the IMF forecast and the plan's goal
  const yearly = yearChart(e, { actual: "wb.FP.CPI.TOTL.ZG", forecast: "imf.PCPIPCH" }, { title: t.inv_infl_yearly, unitLabel: t.unit_pct_year, target: target && { value: target.target, label: planLabel(e) } });
  if (yearly) grid.append(yearly);
  // The kip against the dollar, the baht and the yuan, year by year (the choice sits directly above its chart)
  const fx = fxYearCard(e);
  if (fx) grid.append(fx);

  // ---------- Why (World Bank report) ----------
  const f = e.stat && e.stat.facts.inflation_why;
  if (f) {
    const c = card("official");
    c.append(cardHead(fill(t.inv_infl_why_title, f), null, false, t));
    const ul = el("ul", "watch-list");
    const values = { ...sourceWords(e, f.source), ...f, peak_month: f.peak_month ? monthText(f.peak_month, t) : "", jan_month: f.jan_month ? t.months[Number(f.jan_month.slice(5, 7)) - 1] : "" };
    for (const k of ["inv_infl_why_1", "inv_infl_why_2", "inv_infl_why_3"]) ul.append(el("li", "", fill(t[k], values)));
    c.append(ul);
    const more = el("p", "note");
    const a = el("a", "", t.inv_infl_more);
    a.href = "#/living";
    more.append(a);
    c.append(more, sourcesFoot(t, [staticSource(e, f.source)]));
    grid.append(c);
  }
  panel.append(grid);

  // the monthly number of two sources and the yearly averages are not the same measure: said side by side
  const differ = differCard(e, ["inflation"]);
  if (differ) panel.append(differ);
}
