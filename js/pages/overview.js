// Page 1: Overview - the most important numbers at a glance.

import { el, metricCard, sectionTitle, isStale, sourceStatus } from "../ui.js";
import { dailyChartCard, mountCharts } from "../charts.js";
import { todayHintCard } from "./forecast.js";

// Sources that raise the "not updating" alert. The Phouvong form is optional, so it never alerts here
// (its own card and the Settings page still show its status).
const SOURCE_NAMES = ["bol", "gold-world", "silver-world", "gold-thai", "fx-market", "gold-lbb", "bcel"];

export function render(view, ctx) {
  const { t, summary, hints } = ctx;

  // Warning if any source is stale
  const stale = SOURCE_NAMES.filter((id) => summary.sources[id] && isStale(id, summary));
  if (stale.length) {
    const alert = el("div", "alert");
    alert.append(el("span", "", "⚠"));
    const text = el("div");
    text.append(`${t.alert_stale}: ${stale.map((id) => summary.sources[id].source_name).join(", ")}. `);
    const a = el("a", "", t.see_details);
    a.href = "#/settings";
    text.append(a);
    alert.append(text);
    view.append(alert);
  }

  const top = el("div", "grid grid-2");
  top.append(todayHintCard(hints, t, true));
  top.append(
    metricCard(
      {
        // Real Lao price (LBB, automatic) first; estimate and the optional Phouvong price under it
        title: "card_lao_gold",
        kind: "bank",
        note: "note_lbb",
        rows: [
          ["row_lbb_sell", "calc.lbb_sell_baht"],
          ["row_lbb_buy", "calc.lbb_buy_baht"],
          ["row_adj_sell", "calc.lao_gold_adj_sell", { emptyText: t.need_shop_prices }],
          [
            "row_phouvong_sell",
            "gold-lao-manual.sell",
            { emptyText: sourceStatus("gold-lao-manual", summary) === "not_configured" ? t.not_configured_short : t.phouvong_empty_title },
          ],
        ],
      },
      summary,
      t
    )
  );
  view.append(top);

  view.append(sectionTitle(t.overview_rates));
  const cards = el("div", "grid grid-2");
  cards.append(
    metricCard({ title: "card_bol_usd", kind: "official", rows: [["row_sell", "bol.USD_LAK_sell"], ["row_buy", "bol.USD_LAK_buy"]] }, summary, t),
    metricCard({ title: "card_bol_thb", kind: "official", rows: [["row_sell", "bol.THB_LAK_sell"], ["row_buy", "bol.THB_LAK_buy"]] }, summary, t),
    metricCard(
      {
        title: "card_bcel",
        kind: "bank",
        note: "note_bcel",
        rows: [["row_usd_sell", "bcel.USD_LAK_sell"], ["row_usd_buy", "bcel.USD_LAK_buy"], ["row_thb_sell", "bcel.THB_LAK_sell"], ["row_thb_buy", "bcel.THB_LAK_buy"]],
      },
      summary,
      t
    ),
    metricCard(
      { title: "card_market_fx", kind: "reference", note: "note_market_fx", rows: [["row_usd_lak", "fx-market.USD_LAK"], ["row_thb_lak", "fx-market.THB_LAK"]] },
      summary,
      t
    )
  );
  view.append(cards);

  view.append(sectionTitle(t.overview_trend));
  const charts = el("div", "grid grid-2");
  charts.append(
    dailyChartCard({
      title: t.chart_usd_lak,
      summary,
      rangeDays: 30,
      t,
      seriesDefs: [
        { metric: "calc.bol_USD_LAK_mid", label: t.series_bol_mid, kind: "official" },
        { metric: "calc.bcel_USD_LAK_mid", label: t.series_bcel_mid, kind: "bank" },
        { metric: "fx-market.USD_LAK", label: t.series_market, kind: "reference" },
      ],
    }),
    dailyChartCard({
      title: t.chart_thb_lak,
      summary,
      rangeDays: 30,
      t,
      seriesDefs: [
        { metric: "calc.bol_THB_LAK_mid", label: t.series_bol_mid, kind: "official" },
        { metric: "calc.bcel_THB_LAK_mid", label: t.series_bcel_mid, kind: "bank" },
        { metric: "fx-market.THB_LAK", label: t.series_market, kind: "reference" },
      ],
    })
  );
  view.append(charts);
  mountCharts(view);
}
