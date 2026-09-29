// Page 1: Overview - the most important numbers at a glance.

import { el, metricCard, sectionTitle, isStale } from "../ui.js";
import { dailyChartCard, mountCharts } from "../charts.js";
import { todayHintCard } from "./forecast.js";

const SOURCE_NAMES = ["bol", "gold-world", "gold-thai", "fx-market", "gold-lao-manual"];

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
        title: "card_lao_gold",
        kind: "estimated",
        note: "note_lao_gold_est",
        rows: [
          ["row_est_sell", "calc.lao_gold_est_sell"],
          ["row_adj_sell", "calc.lao_gold_adj_sell", { emptyText: t.need_shop_prices }],
          ["row_phouvong_sell", "gold-lao-manual.sell", { emptyText: t.not_configured_short }],
        ],
      },
      summary,
      t
    )
  );
  view.append(top);

  view.append(sectionTitle(t.overview_rates));
  const cards = el("div", "grid grid-3");
  cards.append(
    metricCard({ title: "card_bol_usd", kind: "official", rows: [["row_sell", "bol.USD_LAK_sell"], ["row_buy", "bol.USD_LAK_buy"]] }, summary, t),
    metricCard({ title: "card_bol_thb", kind: "official", rows: [["row_sell", "bol.THB_LAK_sell"], ["row_buy", "bol.THB_LAK_buy"]] }, summary, t),
    metricCard(
      { title: "card_market_fx", kind: "market", note: "note_market_fx", rows: [["row_usd_lak", "fx-market.USD_LAK"], ["row_thb_lak", "fx-market.THB_LAK"]] },
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
        { metric: "fx-market.USD_LAK", label: t.series_market, kind: "market" },
      ],
    }),
    dailyChartCard({
      title: t.chart_thb_lak,
      summary,
      rangeDays: 30,
      t,
      seriesDefs: [
        { metric: "calc.bol_THB_LAK_mid", label: t.series_bol_mid, kind: "official" },
        { metric: "fx-market.THB_LAK", label: t.series_market, kind: "market" },
      ],
    })
  );
  view.append(charts);
  mountCharts(view);
}
