// Economy tab 6: inflation & the kip - how fast prices rise, how that follows the kip (BOL rate vs a year before),
// Laos vs Thailand, the yearly picture with the plan's goal, and why (World Bank report).

import { el, card, cardHead, pctPill } from "../ui.js";
import { chartCard } from "../charts.js";
import { formatNumber } from "../format.js";
import {
  THIS_YEAR, lastOf, pct, indicator, valueIn, pctText, freshness, sourcesFoot, invTile, yearChart, staticSource,
  fill, monthText, monthShort,
} from "./eco-common.js";
import { inflationCompare } from "./living-parts.js";
import { inflationSeries, latestInflation, differCard } from "./eco-latest.js";

const addMonths = (m, n) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7);

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
  if (target) stats.append(invTile(t, t.inv_k_infl_target, `≤ ${pctText(target.target, 0)}`, t.inv_plan_name, null));
  const usdNow = usd && lastOf(usd.values);
  const usdAgo = usd && usd.values.length > 12 ? usd.values[usd.values.length - 13] : null;
  if (usdNow && usdAgo) {
    const tile = invTile(t, t.inv_k_kip, { num: formatNumber(usdNow[1], "LAK"), unit: t.inv_kip_per_usd }, `BOL · ${t.inv_12m_change}`, freshness(t, { month: usdNow[0], stale: usd.stale }));
    tile.querySelector(".stat-sub").append(" ", pctPill(pct(usdAgo[1], usdNow[1]), { decimals: 1 }));
    stats.append(tile);
  }
  panel.append(stats);

  const grid = el("div", "grid grid-2");

  // ---------- Inflation vs the kip (both "compared with a year before") ----------
  if (cpi && usd && cpi.values.length && usd.values.length > 12) {
    const usdMap = new Map(usd.values);
    const cpiMap = new Map(cpi.values);
    const last = [lastOf(cpi.values)[0], lastOf(usd.values)[0]].sort().pop();
    // from the first month where both exist (the kip change needs the same month a year before)
    const start = [addMonths(usd.values[0][0], 12), cpi.values[0][0]].sort().pop();
    const months = [];
    for (let m = start; m <= last; m = addMonths(m, 1)) months.push(m);
    const kip = months.map((m) => {
      const a = usdMap.get(addMonths(m, -12));
      const b = usdMap.get(m);
      return a && b ? Math.round(pct(a, b) * 10) / 10 : null;
    });
    if (kip.some((v) => v !== null)) {
      grid.append(
        chartCard({
          title: t.inv_infl_vs_kip,
          subtitle: t.inv_infl_vs_kip_sub,
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
  const yearly = yearChart(e, { actual: "wb.FP.CPI.TOTL.ZG", forecast: "imf.PCPIPCH" }, { title: t.inv_infl_yearly, unitLabel: t.unit_pct_year, target: target && { value: target.target, label: t.inv_plan_target_line } });
  if (yearly) grid.append(yearly);
  // Official exchange rate, yearly average (World Bank): how far the kip has fallen over the years
  const fx = yearChart(e, { actual: "wb.PA.NUS.FCRF" }, { title: t.eco_fx_avg, firstYear: 2000 });
  if (fx) grid.append(fx);

  // ---------- Why (World Bank report) ----------
  const f = e.stat && e.stat.facts.inflation_why;
  if (f) {
    const c = card("official");
    c.append(cardHead(t.inv_infl_why_title, null, false, t));
    const ul = el("ul", "watch-list");
    const values = { ...f, peak_month: f.peak_month ? monthText(f.peak_month, t) : "" };
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
