// Page 3: Gold - world, Thai, estimated Lao gold, and the Phouvong shop price (Phase 3).

import { el, card, cardHead, metricCard, sectionTitle, emptyState, table, rangeButtons, valueRow, cardFoot, sourceStatus } from "../ui.js";
import { formatNumber, formatPct, formatDate } from "../format.js";
import { dailyChartCard, mountCharts } from "../charts.js";

// Phouvong card: actual price vs our estimate (same day)
function phouvongCard(summary, t) {
  const c = card("shop");
  const status = sourceStatus("gold-lao-manual", summary);
  c.append(cardHead(t.card_phouvong, "shop", status === "stale" || status === "error", t));

  const actual = summary.metrics["gold-lao-manual.sell"];
  if (status === "not_configured" || !actual) {
    const box = emptyState(t.phouvong_not_setup_title, t.phouvong_not_setup_text);
    const steps = el("ol", "steps");
    for (const k of ["setup_step_1", "setup_step_2", "setup_step_3", "setup_step_4"]) steps.append(el("li", "", t[k]));
    box.append(steps);
    c.append(box);
    return c;
  }

  c.append(valueRow(t.row_phouvong_sell, actual, t));
  if (summary.metrics["gold-lao-manual.buy"]) c.append(valueRow(t.row_phouvong_buy, summary.metrics["gold-lao-manual.buy"], t));

  // Compare with the estimate for the SAME day as the shop price
  const day = actual.latest.source_date;
  const est = new Map((summary.metrics["calc.lao_gold_est_sell"] || { daily: [] }).daily).get(day);
  const adj = new Map((summary.metrics["calc.lao_gold_adj_sell"] || { daily: [] }).daily).get(day);
  const compare = (label, estimate) => {
    const row = el("div", "row");
    row.append(el("span", "row-label", label));
    const right = el("div", "row-right");
    if (estimate === undefined) {
      right.append(el("div", "change", t.not_enough_data));
    } else {
      const diff = actual.latest.value - estimate;
      right.append(el("div", "value", formatNumber(estimate, "LAK")));
      right.append(el("div", "change wrap", `${t.shop_minus_estimate}: ${diff >= 0 ? "+" : "−"}${formatNumber(Math.abs(diff), "LAK")} LAK (${formatPct((diff / estimate) * 100)})`));
    }
    row.append(right);
    return row;
  };
  c.append(compare(`${t.row_est_sell} (${formatDate(day, t)})`, est));
  c.append(compare(`${t.row_adj_sell} (${formatDate(day, t)})`, adj));

  const p = summary.gold_premium;
  const premText = p && p.avg_14d ? `${formatPct((p.avg_14d - 1) * 100)} (${t.premium_days}: ${p.days_used})` : t.not_enough_data;
  const prem = el("div", "row");
  prem.append(el("span", "row-label", t.premium_avg_14d), el("div", "row-right value", premText));
  c.append(prem);
  c.append(el("p", "note", t.note_premium));
  c.append(cardFoot(["gold-lao-manual.sell"], summary, t));
  return c;
}

export function render(view, ctx) {
  const { t, summary } = ctx;

  const filters = el("div", "filters");
  filters.append(rangeButtons(ctx.range, t, ctx.setRange));
  view.append(filters);

  const grid = el("div", "grid grid-2");
  grid.append(
    metricCard(
      {
        title: "card_lao_gold_est",
        kind: "estimated",
        note: "note_lao_gold_est",
        rows: [
          ["row_est_sell", "calc.lao_gold_est_sell"],
          ["row_est_buy", "calc.lao_gold_est_buy"],
          ["row_adj_sell", "calc.lao_gold_adj_sell", { emptyText: t.need_shop_prices }],
        ],
      },
      summary,
      t
    ),
    phouvongCard(summary, t),
    metricCard(
      {
        title: "card_gold_thai",
        kind: "market",
        rows: [
          ["row_bar_sell", "gold-thai.bar_sell"],
          ["row_bar_buy", "gold-thai.bar_buy"],
          ["row_ornament_sell", "gold-thai.ornament_sell"],
          ["row_ornament_buy", "gold-thai.ornament_buy"],
        ],
      },
      summary,
      t
    ),
    metricCard(
      {
        title: "card_gold_world",
        kind: "market",
        note: "note_gold_world_lak",
        rows: [["row_usd_oz", "gold-world.XAU_USD"], ["row_lak_baht", "calc.gold_world_lak"]],
      },
      summary,
      t
    )
  );
  view.append(grid);

  // Charts
  view.append(sectionTitle(t.charts_title));
  const hasAdj = !!summary.metrics["calc.lao_gold_adj_sell"];
  const charts = el("div", "grid grid-2");
  charts.append(
    dailyChartCard({
      title: t.chart_gold_lak,
      summary,
      rangeDays: ctx.range,
      t,
      unit: "LAK per baht",
      seriesDefs: [
        { metric: "gold-lao-manual.sell", label: t.series_phouvong, kind: "shop" },
        hasAdj
          ? { metric: "calc.lao_gold_adj_sell", label: t.series_lao_gold_adj, kind: "estimated" }
          : { metric: "calc.lao_gold_est_sell", label: t.series_lao_gold_est, kind: "estimated" },
        { metric: "calc.gold_world_lak", label: t.series_gold_world_lak, kind: "market" },
      ],
    }),
    dailyChartCard({
      title: t.chart_gold_usd,
      summary,
      rangeDays: ctx.range,
      t,
      seriesDefs: [{ metric: "gold-world.XAU_USD", label: t.series_gold_world, kind: "market" }],
    })
  );
  view.append(charts);

  // Comparison table: every day with a Phouvong price
  const actual = summary.metrics["gold-lao-manual.sell"];
  if (actual && actual.daily.length) {
    view.append(sectionTitle(t.compare_title));
    const est = new Map((summary.metrics["calc.lao_gold_est_sell"] || { daily: [] }).daily);
    const adj = new Map((summary.metrics["calc.lao_gold_adj_sell"] || { daily: [] }).daily);
    const rows = actual.daily
      .slice(-30)
      .reverse()
      .map(([d, v]) => [
        formatDate(d, t),
        formatNumber(v, "LAK"),
        est.has(d) ? formatNumber(est.get(d), "LAK") : "—",
        est.has(d) ? formatPct(((v - est.get(d)) / est.get(d)) * 100) : "—",
        adj.has(d) ? formatNumber(adj.get(d), "LAK") : "—",
      ]);
    const c = card("shop");
    c.append(table([t.col_date, t.col_phouvong, t.col_estimate, t.col_premium, t.col_adjusted], rows));
    view.append(c);
  }
  mountCharts(view);
}
