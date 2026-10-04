// Page: how the numbers are worked out (audit 2026-10-02, P2-8: "a method page").
// One place that says, in plain words, what every number the site works out itself is made of, and what the labels
// mean. The sentences are in i18n ("mt_*"); every limit and constant in them is a placeholder that is filled from
// the code or the data that really uses it, so the page cannot say "12 months" while the code uses another number.

import { el, card, cardHead } from "../ui.js";
import { LB_PER_KG } from "../calc.js";
import { NEAR_ZERO } from "../charts.js";
import { fill, FRESH_MONTHS, OLD_AFTER, NEAR_GAP, NEAR_POINTS } from "./eco-common.js";
import { MIN_CASES, HINT_WINDOW_DAYS } from "./forecast.js";

// [title key, [sentence keys]]
const SECTIONS = [
  ["mt_sec_kinds", ["mt_kind_1", "mt_kind_2"]],
  ["mt_sec_fresh", ["mt_fresh_1", "mt_fresh_2", "mt_fresh_3"]],
  ["mt_sec_fx", ["mt_fx_1", "mt_fx_2", "mt_fx_3"]],
  ["mt_sec_gold", ["mt_gold_1", "mt_gold_2", "mt_gold_3", "mt_gold_4"]],
  ["mt_sec_real", ["mt_real_1", "mt_real_2"]],
  ["mt_sec_multi", ["mt_multi_1", "mt_multi_2", "mt_multi_3"]],
  ["mt_sec_plan", ["mt_plan_1"]],
  ["mt_sec_hint", ["mt_hint_1"]],
  ["mt_sec_chart", ["mt_chart_1", "mt_chart_2"]],
  ["mt_sec_units", ["mt_rubber_1", "mt_own_1"]],
  ["mt_sec_data", ["mt_data_1", "mt_data_2", "mt_data_3"]],
];

// The numbers the sentences name: taken from where they are used
export function methodValues(summary) {
  const premium = (summary && summary.gold_premium) || {};
  const b = premium.basis || {};
  const pct = (v) => (typeof v === "number" ? String(Math.round(v * 10000) / 100) : "—"); // 0.9999 -> "99.99"
  const or = (v) => (v === undefined || v === null ? "—" : v);
  return {
    year_months: FRESH_MONTHS.year,
    month_months: FRESH_MONTHS.month,
    old_years: OLD_AFTER.years,
    old_months: OLD_AFTER.months,
    near: Math.round(NEAR_GAP * 100),
    near_points: NEAR_POINTS,
    min: MIN_CASES,
    window: HINT_WINDOW_DAYS,
    near_zero: Math.round(NEAR_ZERO * 100),
    lb: LB_PER_KG,
    thai_g: or(b.thai_g),
    lao_g: or(b.lao_g),
    oz_g: or(b.oz_g),
    thai_pct: pct(b.thai_fineness),
    lbb_pct: pct(b.lbb_fineness),
    days: or(premium.window_days),
  };
}

export function render(view, ctx) {
  const { t, summary } = ctx;
  const values = methodValues(summary);
  view.append(el("p", "lead", t.mt_intro));
  const grid = el("div", "grid grid-2");
  for (const [title, items] of SECTIONS) {
    const c = card(null, "method-card");
    c.append(cardHead(t[title], null, false, t));
    const ul = el("ul", "watch-list");
    for (const key of items) ul.append(el("li", "", fill(t[key], values)));
    c.append(ul);
    grid.append(c);
  }
  view.append(grid);
  const go = el("div", "watch-links");
  const a = el("a", "btn", t.mt_to_sources);
  a.href = "#/settings";
  go.append(a);
  view.append(go, el("p", "note disclaimer", t.mt_note));
}
