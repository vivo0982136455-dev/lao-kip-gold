// Page 2: Exchange rates - all 7 BOL currencies + market rates + history chart.

import { el, card, cardHead, metricCard, sectionTitle, isStale, cardFoot, rangeButtons, table, deltaPill } from "../ui.js";
import { formatNumber } from "../format.js";
import { dailyChartCard, mountCharts } from "../charts.js";

const CURRENCIES = ["USD", "THB", "CNY", "GBP", "EUR", "JPY", "KRW"];
const BCEL_CURRENCIES = ["USD", "THB", "CNY"];

// BCEL bank rates (what people really get at the counter): buy / sell / change of sell
function bcelCard(summary, t) {
  const c = card("bank");
  c.append(cardHead(t.card_bcel, "bank", isStale("bcel", summary), t));
  const ids = [];
  const rows = BCEL_CURRENCIES.map((cur) => {
    const buy = summary.metrics[`bcel.${cur}_LAK_buy`];
    const sell = summary.metrics[`bcel.${cur}_LAK_sell`];
    if (sell) ids.push(`bcel.${cur}_LAK_sell`);
    const change = sell && sell.prev ? deltaPill(sell.latest.value, sell.prev.value, sell.unit, { pctOnly: true }) : "—";
    const name = el("span", "", cur);
    name.append(el("span", "sub", t["cur_" + cur]));
    return [name, buy ? formatNumber(buy.latest.value, buy.unit) : "—", sell ? formatNumber(sell.latest.value, sell.unit) : "—", change];
  });
  c.append(table([t.col_currency, t.col_buy, t.col_sell, t.col_change], rows), el("p", "note", t.note_bcel), cardFoot(ids, summary, t));
  return c;
}

// Day -> (buy + sell) / 2 for one source ("bol" or "bcel")
function midDailyOf(summary, source, cur) {
  const buy = summary.metrics[`${source}.${cur}_LAK_buy`];
  const sell = summary.metrics[`${source}.${cur}_LAK_sell`];
  if (!buy || !sell) return null;
  const sellMap = new Map(sell.daily);
  return buy.daily.filter(([d]) => sellMap.has(d)).map(([d, b]) => [d, (b + sellMap.get(d)) / 2]);
}

function loadCurrency() {
  try {
    const c = localStorage.getItem("rates_cur");
    return CURRENCIES.includes(c) ? c : "USD";
  } catch {
    return "USD";
  }
}
let selected = loadCurrency();

export function render(view, ctx) {
  const { t, summary } = ctx;

  // Filters (one row above everything they control)
  const filters = el("div", "filters");
  const label = el("label", "", t.currency);
  label.htmlFor = "cur-select";
  const select = el("select");
  select.id = "cur-select";
  for (const cur of CURRENCIES) {
    const o = el("option", "", `${cur} · ${t["cur_" + cur]}`);
    o.value = cur;
    o.selected = cur === selected;
    select.append(o);
  }
  const choose = (cur) => {
    selected = cur;
    try {
      localStorage.setItem("rates_cur", cur);
    } catch {
      /* ignore */
    }
    ctx.rerender();
  };
  select.addEventListener("change", () => choose(select.value));
  filters.append(label, select, rangeButtons(ctx.range, t, ctx.setRange));
  view.append(filters);

  // Table of all 7 currencies (BOL official)
  const tableCard = card("official");
  tableCard.append(cardHead(t.card_all_currencies, "official", isStale("bol", summary), t));
  const tbl = el("table");
  const head = el("tr");
  for (const k of ["col_currency", "col_buy", "col_sell", "col_change"]) head.append(el("th", "", t[k]));
  tbl.appendChild(el("thead")).append(head);
  const body = tbl.appendChild(el("tbody"));
  const ids = [];
  for (const cur of CURRENCIES) {
    const buy = summary.metrics[`bol.${cur}_LAK_buy`];
    const sell = summary.metrics[`bol.${cur}_LAK_sell`];
    if (sell) ids.push(`bol.${cur}_LAK_sell`);
    const tr = el("tr", "clickable");
    tr.tabIndex = 0;
    tr.setAttribute("aria-selected", String(cur === selected));
    const name = el("td", "", cur);
    name.append(el("span", "sub", t["cur_" + cur]));
    tr.append(name);
    tr.append(el("td", "", buy ? formatNumber(buy.latest.value, buy.unit) : "—"));
    tr.append(el("td", "", sell ? formatNumber(sell.latest.value, sell.unit) : "—"));
    const td = el("td");
    td.append(sell && sell.prev ? deltaPill(sell.latest.value, sell.prev.value, sell.unit, { pctOnly: true }) : "—");
    tr.append(td);
    tr.addEventListener("click", () => choose(cur));
    tr.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        choose(cur);
      }
    });
    body.append(tr);
  }
  const wrap = el("div", "table-wrap");
  wrap.append(tbl);
  tableCard.append(wrap, el("p", "note", t.note_rates_table), cardFoot(ids, summary, t));

  // Left: BOL table. Right: BCEL + market stacked, so both columns end at a similar height.
  const right = el("div", "stack");
  right.append(
    bcelCard(summary, t),
    metricCard(
      {
        title: "card_market_fx",
        kind: "market",
        note: "note_market_fx",
        rows: [["row_usd_lak", "fx-market.USD_LAK"], ["row_thb_lak", "fx-market.THB_LAK"], ["row_usd_thb", "fx-market.USD_THB"]],
      },
      summary,
      t
    )
  );
  const top = el("div", "grid grid-2");
  top.append(tableCard, right);
  view.append(top);

  // Chart for the selected currency
  view.append(sectionTitle(`${t.history_of} ${selected} → LAK`));
  // longId: the weekly history in data/long.json used for the 1-year / all ranges
  const seriesDefs = [{ daily: midDailyOf(summary, "bol", selected), longId: `calc.bol_${selected}_LAK_mid`, label: t.series_bol_mid, kind: "official" }];
  if (BCEL_CURRENCIES.includes(selected)) seriesDefs.push({ daily: midDailyOf(summary, "bcel", selected), label: t.series_bcel_mid, kind: "bank" });
  if (selected === "USD") seriesDefs.push({ metric: "fx-market.USD_LAK", label: t.series_market, kind: "market" });
  if (selected === "THB") seriesDefs.push({ metric: "fx-market.THB_LAK", label: t.series_market, kind: "market" });
  const chart = dailyChartCard({
    title: `${selected} → LAK (${t.lak_per} 1 ${selected})`,
    subtitle: t.chart_rates_sub,
    summary,
    rangeDays: ctx.range,
    t,
    unit: `LAK per ${selected}`,
    seriesDefs: seriesDefs.filter((s) => s.daily || s.metric),
  });
  view.append(chart);
  mountCharts(view);
}
