// Page 3: Gold & silver - real Lao gold price (Lao Bullion Bank), our estimate, the optional Phouvong price,
// Thai and world gold; world silver + the optional PML shop silver price.

import { el, card, cardHead, metricCard, sectionTitle, emptyState, table, rangeButtons, valueRow, cardFoot, sourceStatus, pctPill } from "../ui.js";
import { formatNumber, formatPct, formatDate } from "../format.js";
import { dailyChartCard, mountCharts } from "../charts.js";
import { uploadCard } from "./gold-upload.js";
import { fill } from "./eco-common.js";

// Value of a daily metric on one day (undefined when there is none)
const onDay = (summary, id, day) => new Map((summary.metrics[id] || { daily: [] }).daily).get(day);

// Our estimate of the Lao price (Thai bar price × the baht rate), and what the real price (Lao Bullion Bank) says
// about it - two different numbers that must not be mixed up (audit 2026-10-02, P2-1):
//   "how much dearer": fine gold in an LBB bar against fine gold in a Thai bar, gram for gram (like for like)
//   the multiplier that turns the estimate into the adjusted estimate: it also holds the gap between the two
//   units (15.244 g and 15 g) and between the two purities, so it is larger and is not a premium
function estimateCard(summary, t) {
  const c = metricCard(
    {
      title: "card_lao_gold_est",
      kind: "estimated",
      rows: [
        ["row_est_sell", "calc.lao_gold_est_sell"],
        ["row_est_buy", "calc.lao_gold_est_buy"],
        ["row_adj_sell", "calc.lao_gold_adj_sell", { emptyText: t.need_shop_prices }],
      ],
    },
    summary,
    t
  );
  const foot = c.querySelector(".card-foot");
  const p = summary.gold_premium;
  const days = p && p.window_days;
  // a row like the price rows above: the number, and under it over how many days it is an average
  const row = (label, text) => {
    const r = el("div", "row");
    const right = el("div", "row-right");
    right.append(el("div", "value", text || "—"));
    right.append(el("div", "change", text ? fill(t.premium_window, { days, used: p.days_used }) : t.not_enough_data));
    r.append(el("span", "row-label", label), right);
    c.insertBefore(r, foot);
  };
  if (days) {
    row(t.premium_fine_14d, p.fine_avg_14d ? formatPct((p.fine_avg_14d - 1) * 100, 1) : null);
    row(t.premium_avg_14d, p.avg_14d ? `× ${p.avg_14d.toFixed(3)}` : null);
  }
  const b = p && p.basis;
  if (b && days && b.thai_fineness && b.lbb_fineness) {
    const pct = (v) => String(Math.round(v * 10000) / 100); // 0.9999 -> "99.99"
    c.insertBefore(el("p", "note", fill(t.note_lao_gold_est, { days, thai_g: b.thai_g, thai_pct: pct(b.thai_fineness), lao_g: b.lao_g, lbb_pct: pct(b.lbb_fineness) })), foot);
  }
  return c;
}

// Phouvong card: jewellery + gold bar prices, bar compared with Lao Bullion Bank (bar vs bar, same day)
function phouvongCard(summary, t) {
  const c = card("shop");
  const status = sourceStatus("gold-lao-manual", summary);
  const m = (id) => summary.metrics["gold-lao-manual." + id];
  const actual = m("sell") || m("bar_sell");
  // Optional source: warn only when there ARE prices and they stopped updating (an empty form is not an error)
  c.append(cardHead(t.card_phouvong, "shop", !!actual && (status === "stale" || status === "error"), t));

  if (!actual && status !== "not_configured") {
    // Form is connected but nobody has typed a price yet
    c.append(emptyState(t.phouvong_empty_title, t.phouvong_empty_text));
    return c;
  }
  if (!actual) {
    const box = emptyState(t.phouvong_not_setup_title, t.phouvong_not_setup_text);
    const steps = el("ol", "steps");
    for (const k of ["setup_step_1", "setup_step_2", "setup_step_3", "setup_step_4"]) steps.append(el("li", "", t[k]));
    box.append(steps);
    c.append(box);
    return c;
  }

  for (const [id, key] of [["sell", "row_phouvong_sell"], ["buy", "row_phouvong_buy"], ["bar_sell", "row_phouvong_bar_sell"], ["bar_buy", "row_phouvong_bar_buy"]]) {
    if (m(id)) c.append(valueRow(t[key], m(id), t));
  }

  // Compare with a reference price of the SAME day: shop - reference, in LAK and %
  const compare = (label, shop, reference, diffLabel) => {
    const row = el("div", "row");
    row.append(el("span", "row-label", label));
    const right = el("div", "row-right");
    if (reference === undefined) {
      right.append(el("div", "change", t.not_enough_data));
    } else {
      const diff = shop - reference;
      right.append(el("div", "value", formatNumber(reference, "LAK")));
      const line = el("div", "change wrap");
      line.append(el("span", "vs", `${diffLabel}: ${diff >= 0 ? "+" : "−"}${formatNumber(Math.abs(diff), "LAK")} LAK`), pctPill((diff / reference) * 100));
      right.append(line);
    }
    row.append(right);
    return row;
  };
  if (m("bar_sell")) {
    const day = m("bar_sell").latest.source_date;
    c.append(compare(`${t.row_lbb_sell} (${formatDate(day, t)})`, m("bar_sell").latest.value, onDay(summary, "calc.lbb_sell_baht", day), t.shop_bar_minus_lbb));
  }
  if (m("sell")) {
    const day = m("sell").latest.source_date;
    c.append(compare(`${t.row_adj_sell} (${formatDate(day, t)})`, m("sell").latest.value, onDay(summary, "calc.lao_gold_adj_sell", day), t.shop_minus_estimate));
  }

  c.append(cardFoot(["gold-lao-manual.sell", "gold-lao-manual.bar_sell"].filter((id) => summary.metrics[id]), summary, t));
  return c;
}

// Silver: PML shop price per kg (optional, from the form) compared with the world price in LAK per kg
function silverShopCard(summary, t) {
  const c = card("shop");
  const m = (id) => summary.metrics["silver-lao-manual." + id];
  c.append(cardHead(t.card_silver_pml, "shop", false, t));
  if (!m("sell") && !m("buy")) {
    c.append(emptyState(t.silver_pml_empty_title, t.silver_pml_empty));
    return c;
  }
  if (m("sell")) c.append(valueRow(t.row_pml_sell, m("sell"), t));
  if (m("buy")) c.append(valueRow(t.row_pml_buy, m("buy"), t));
  const sell = m("sell");
  const world = sell ? onDay(summary, "calc.silver_world_lak_kg", sell.latest.source_date) : undefined;
  if (sell) {
    const row = el("div", "row");
    row.append(el("span", "row-label", `${t.pml_vs_world} (${formatDate(sell.latest.source_date, t)})`));
    const right = el("div", "row-right");
    if (world === undefined) right.append(el("div", "change", t.not_enough_data));
    else {
      right.append(el("div", "value", formatNumber(world, "LAK")));
      const diff = sell.latest.value - world;
      const line = el("div", "change wrap");
      line.append(el("span", "vs", `${t.shop_minus_world}: ${diff >= 0 ? "+" : "−"}${formatNumber(Math.abs(diff), "LAK")} LAK`), pctPill((diff / world) * 100));
      right.append(line);
    }
    row.append(right);
    c.append(row);
  }
  c.append(el("p", "note", t.note_silver_pml));
  c.append(cardFoot(["silver-lao-manual.sell", "silver-lao-manual.buy"].filter((id) => summary.metrics[id]), summary, t));
  return c;
}

export function render(view, ctx) {
  const { t, summary } = ctx;

  // Save a shop price from its picture (Phouvong gold / PML silver)
  view.append(uploadCard(ctx));

  // The range buttons control the charts only: one row directly above each group of charts (same state)
  const rangeRow = () => {
    const filters = el("div", "filters");
    filters.append(rangeButtons(ctx.range, t, ctx.setRange));
    return filters;
  };

  // Row 1: real Lao price (LBB) | our estimate.  Row 2: Phouvong (optional) | Thai + world stacked.
  const grid = el("div", "grid grid-2");
  grid.append(
    metricCard(
      {
        title: "card_lbb",
        kind: "bank",
        note: "note_lbb",
        rows: [
          ["row_lbb_sell_baht", "calc.lbb_sell_baht"],
          ["row_lbb_buy_baht", "calc.lbb_buy_baht"],
          ["row_lbb_sell_g", "gold-lbb.sell_g"],
          ["row_lbb_buy_g", "gold-lbb.buy_g"],
        ],
      },
      summary,
      t
    ),
    estimateCard(summary, t)
  );
  const markets = el("div", "stack");
  markets.append(
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
  grid.append(phouvongCard(summary, t), markets);
  view.append(grid);

  // Charts
  view.append(sectionTitle(t.charts_title));
  view.append(rangeRow());
  const hasAdj = !!summary.metrics["calc.lao_gold_adj_sell"];
  const charts = el("div", "grid grid-2");
  charts.append(
    dailyChartCard({
      title: t.chart_gold_lak,
      subtitle: t.chart_gold_lak_sub,
      summary,
      rangeDays: ctx.range,
      t,
      unit: "LAK per baht",
      seriesDefs: [
        { metric: "calc.lbb_sell_baht", label: t.series_lbb, kind: "bank" },
        { metric: "gold-lao-manual.bar_sell", label: t.series_phouvong_bar, kind: "shop" },
        { metric: "gold-lao-manual.sell", label: t.series_phouvong, kind: "shop", dashed: true }, // dashed = jewellery (the bar line is solid)
        hasAdj
          ? { metric: "calc.lao_gold_adj_sell", label: t.series_lao_gold_adj, kind: "estimated", dashed: true }
          : { metric: "calc.lao_gold_est_sell", label: t.series_lao_gold_est, kind: "estimated", dashed: true }, // dashed = estimate (and tells it apart from the bank line)
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

  // Silver (world price automatic + PML shop price from the owner's form)
  view.append(sectionTitle(t.silver_title));
  const silver = el("div", "grid grid-2");
  const silverCards = el("div", "stack");
  silverCards.append(
    metricCard(
      {
        title: "card_silver_world",
        kind: "market",
        note: "note_silver_world",
        rows: [["row_xag_usd_oz", "silver-world.XAG_USD"], ["row_silver_lak_kg", "calc.silver_world_lak_kg"]],
      },
      summary,
      t
    ),
    silverShopCard(summary, t)
  );
  const silverCharts = el("div", "stack");
  silverCharts.append(
    rangeRow(),
    dailyChartCard({
      title: t.chart_silver_lak,
      summary,
      rangeDays: ctx.range,
      t,
      unit: "LAK per kg",
      seriesDefs: [
        { metric: "calc.silver_world_lak_kg", label: t.series_silver_world_lak, kind: "market" },
        { metric: "silver-lao-manual.sell", label: t.series_pml_sell, kind: "shop" },
      ],
    }),
    dailyChartCard({
      title: t.chart_silver_usd,
      summary,
      rangeDays: ctx.range,
      t,
      seriesDefs: [{ metric: "silver-world.XAG_USD", label: t.series_silver_world, kind: "market" }],
    })
  );
  silver.append(silverCards, silverCharts);
  view.append(silver);

  // Comparison table: every day with a Phouvong price. Bar vs LBB (both bars), jewellery vs our adjusted estimate.
  // Values in millions of LAK (46.26) with the unit in the title, so 6 columns fit a phone.
  const shopDays = new Set([
    ...((summary.metrics["gold-lao-manual.sell"] || {}).daily || []).map(([d]) => d),
    ...((summary.metrics["gold-lao-manual.bar_sell"] || {}).daily || []).map(([d]) => d),
  ]);
  if (shopDays.size) {
    view.append(sectionTitle(`${t.compare_title} (${t.unit_million_lak})`));
    const mil = (v) => (v === undefined ? "—" : (v / 1e6).toFixed(2));
    const rows = [...shopDays]
      .sort()
      .reverse()
      .slice(0, 30)
      .map((d) => {
        const bar = onDay(summary, "gold-lao-manual.bar_sell", d);
        const lbb = onDay(summary, "calc.lbb_sell_baht", d);
        const orn = onDay(summary, "gold-lao-manual.sell", d);
        const adj = onDay(summary, "calc.lao_gold_adj_sell", d);
        return [
          formatDate(d, t),
          mil(bar),
          mil(lbb),
          bar !== undefined && lbb !== undefined ? pctPill(((bar - lbb) / lbb) * 100) : "—",
          mil(orn),
          mil(adj),
        ];
      });
    const c = card("shop");
    const tbl = table([t.col_date, t.col_phouvong_bar, "LBB", t.col_bar_vs_lbb, t.col_phouvong, t.col_adjusted], rows);
    tbl.classList.add("wrap-all");
    c.append(tbl);
    view.append(c);
  }
  mountCharts(view);
}
