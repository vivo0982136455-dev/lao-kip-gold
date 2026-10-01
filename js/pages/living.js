// Page: Cost of living & savings.
//   0) What you should know - short facts computed from the data (living-parts.js)
//   1) Key numbers        - latest inflation, fastest-rising category, BCEL 12-month deposit, real interest
//   2) Fuel               - Laos vs Thailand in kip, tomorrow's Thai price, trend vs world oil (living-parts.js)
//   3) Inflation          - Laos vs Thailand, all items + main categories (IMF), and every category ranked
//   4) Everyday prices    - WFP market prices by province vs the national average
//   5) Monthly budget     - the same basket in Laos and Bangkok, editable (living-parts.js)
//   6) 1,000,000 kip      - what it is worth today if kept as kip / USD / THB / gold, before and after inflation
//   7) Deposit rates      - BCEL rates for every term, and the LAK rate after inflation
// Everything is calculated here from stored files. It shows the PAST, it is not a forecast or advice.

import { el, card, cardHead, sectionTitle, statTile, table, emptyState, pctPill } from "../ui.js";
import { formatNumber, formatPct } from "../format.js";
import { chartCard, mountCharts } from "../charts.js";
import { monthText, monthShort, addMonths, lastOf, pct, nameTable, loadThai, factsBox, fuelSection, inflationCompare, budgetSection } from "./living-parts.js";

const PERIODS = [1, 3, 5]; // years shown in charts / used for the savings comparison
const MAIN_CATEGORIES = [
  ["cpi_cat_CP01", "--cat-3"], // food
  ["cpi_cat_CP04", "--cat-2"], // housing, water, electricity
  ["cpi_cat_CP07", "--cat-4"], // transport
];

// ---------- Remembered choices ----------
function load(key, fallback, ok) {
  try {
    const v = localStorage.getItem(key);
    return v !== null && ok(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* ignore */
  }
}
let years = Number(load("living_years", "3", (v) => PERIODS.includes(Number(v))));
// Default = national average: some provinces repeat last year's number every month (WFP did not re-survey)
let market = load("living_market", "_national", () => true);
const FLAT_MONTHS = 6; // a price identical for 6+ months in a row is probably carried forward, not measured
let item = load("living_item", "rice_glutinous", () => true);

// ---------- prices.json is only needed on this page, so it is loaded here (not at app start) ----------
let prices = null;
let pricesState = "idle"; // idle | loading | ok | error
function loadPrices(rerender) {
  if (pricesState !== "idle") return;
  pricesState = "loading";
  fetch("data/prices.json", { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
    .then((data) => {
      prices = data;
      pricesState = "ok";
    })
    .catch(() => {
      pricesState = "error";
    })
    .finally(rerender);
}

// Name of the chosen place (national average or a province)
function placeNameOf(t) {
  if (!prices || !prices.market || market === prices.national_id) return t.living_national_avg;
  const mk = prices.market.markets.find((x) => x.id === market);
  return mk ? t.provinces[mk.province] || mk.province : t.living_national_avg;
}

function periodButtons(t, rerender) {
  const group = el("div", "segmented");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", t.range_label);
  for (const y of PERIODS) {
    const b = el("button", "", t["years_" + y]);
    b.type = "button";
    b.setAttribute("aria-pressed", String(y === years));
    b.addEventListener("click", () => {
      years = y;
      save("living_years", y);
      rerender();
    });
    group.append(b);
  }
  return group;
}

// Monthly series [[month, value]] -> values for each month in `months`
function valuesOn(series, months) {
  const map = new Map(series || []);
  return months.map((m) => (map.has(m) ? map.get(m) : null));
}

// ---------- 1) Key numbers ----------
function keyNumbers(ctx) {
  const { t, economy: eco, summary } = ctx;
  const mon = eco.monthly;
  const stats = el("div", "stats");
  const inf = lastOf(mon.cpi_yoy && mon.cpi_yoy.values);
  if (inf) stats.append(statTile(`${t.living_inflation} (${monthText(inf[0], t)})`, formatPct(inf[1], 1), t.living_inflation_sub, "official"));

  const cats = Object.entries(mon).filter(([id, s]) => id.startsWith("cpi_cat_") && s.values.length);
  const top = cats.map(([id, s]) => [id, lastOf(s.values)]).sort((a, b) => b[1][1] - a[1][1])[0];
  if (top) stats.append(statTile(t.living_fastest, formatPct(top[1][1], 1), `${t.cpi_cats[top[0]]} · ${t.living_fastest_sub}`, "official"));

  const dep = summary.metrics["bcel-deposit.LAK_fixed_12m"];
  if (dep) stats.append(statTile(t.living_deposit_12m, `${dep.latest.value.toFixed(2)}%`, t.living_deposit_sub, "bank"));
  if (dep && inf) {
    const real = ((1 + dep.latest.value / 100) / (1 + inf[1] / 100) - 1) * 100;
    stats.append(statTile(t.living_real_rate, formatPct(real, 1), t.living_real_rate_sub, "estimated"));
  }
  return stats;
}

// ---------- 2) Inflation ----------
function inflationSection(ctx, grid) {
  const { t, economy: eco } = ctx;
  const mon = eco.monthly;
  const all = mon.cpi_yoy;
  if (!all || !all.values.length) return;
  const last = lastOf(all.values)[0];
  const months = [];
  for (let m = addMonths(last, -12 * years + 1); m <= last; m = addMonths(m, 1)) months.push(m);

  const series = [{ label: t.cpi_all_items, kind: "official", color: "--cat-1", values: valuesOn(all.values, months) }];
  for (const [id, color] of MAIN_CATEGORIES) {
    if (mon[id]) series.push({ label: t.cpi_cats[id], kind: "official", color, values: valuesOn(mon[id].values, months) });
  }
  grid.append(
    chartCard({
      title: t.living_inflation_chart,
      subtitle: `${t.living_inflation_sub} · ${t.source}: IMF · ${t.latest_month} ${monthText(last, t)}${all.stale ? " · ⚠ " + t.stale_badge : ""}`,
      labels: months.map((m) => monthText(m, t)),
      tickLabels: months.map((m) => monthShort(m, t)),
      series,
      unit: "%",
      unitLabel: t.unit_pct_yoy,
      t,
      firstColTitle: t.month,
    })
  );

  // Every category, ranked (bar length measured from 0; negative values show text only)
  const cats = Object.entries(mon)
    .filter(([id, s]) => id.startsWith("cpi_cat_") && s.values.length)
    .map(([id, s]) => {
      const v = lastOf(s.values);
      const yearAgo = new Map(s.values).get(addMonths(v[0], -12));
      return { id, month: v[0], value: v[1], yearAgo };
    })
    .sort((a, b) => b.value - a.value);
  const max = Math.max(...cats.map((c) => c.value), 1);
  const rows = cats.map((c) => {
    const cell = el("div", "bar-cell");
    cell.append(el("span", c.value < 0 ? "neg-text" : "", formatPct(c.value, 1)));
    const track = el("div", "bar-track");
    const fill = el("div", "bar-fill");
    fill.style.width = `${Math.max(0, (c.value / max) * 100)}%`;
    track.append(fill);
    cell.append(track);
    return [t.cpi_cats[c.id], cell, c.yearAgo === undefined ? "—" : formatPct(c.yearAgo, 1)];
  });
  const c = card("official");
  c.append(cardHead(`${t.living_categories} (${monthText(cats[0].month, t)})`, "official", false, t));
  c.append(nameTable([t.col_category, t.col_vs_last_year, t.col_a_year_before], rows));
  c.append(el("p", "note", t.living_categories_note));
  grid.append(c);
}

// ---------- 3) Everyday prices ----------
function pricesSection(ctx, view) {
  const { t } = ctx;
  view.append(sectionTitle(t.living_prices_title));
  if (pricesState === "loading" || pricesState === "idle") {
    view.append(el("p", "muted", t.loading));
    return;
  }
  const m = prices && prices.market;
  if (pricesState === "error" || !m || !m.prices) {
    view.append(emptyState(t.not_enough_data, t.living_prices_missing));
    return;
  }
  const NAT = prices.national_id;
  const isNational = market === NAT;
  if (!isNational && !m.markets.some((x) => x.id === market)) market = NAT;
  if (!m.prices[item]) item = Object.keys(m.prices)[0];
  const provinceOf = (id) => (id === NAT ? null : (m.markets.find((x) => x.id === id) || {}).province);
  const placeName = (id) => (id === NAT ? t.living_national_avg : t.provinces[provinceOf(id)] || provinceOf(id));

  // Filter: national average (default) or one province
  const filters = el("div", "filters");
  const label = el("label", "", t.living_province);
  label.htmlFor = "market-select";
  const select = el("select");
  select.id = "market-select";
  const options = [NAT, ...m.markets.map((x) => x.id).sort((a, b) => placeName(a).localeCompare(placeName(b)))];
  for (const id of options) {
    const o = el("option", "", placeName(id));
    o.value = id;
    o.selected = id === market;
    select.append(o);
  }
  select.addEventListener("change", () => {
    market = select.value;
    save("living_market", market);
    ctx.rerender();
  });
  filters.append(label, select);
  view.append(filters);

  // Newest month that has a value, for one series
  const newest = (values) => {
    for (let i = values.length - 1; i >= 0; i--) if (values[i] !== null) return i;
    return -1;
  };
  const rows = [];
  const flatStarts = []; // month each "frozen" price started
  for (const [id, byMarket] of Object.entries(m.prices)) {
    const local = byMarket[market];
    const nat = byMarket[NAT];
    const i = local ? newest(local) : -1;
    if (i < 0) continue;
    const yearAgo = i >= 12 ? local[i - 12] : null;
    // Same number for FLAT_MONTHS+ months in a row -> probably carried forward
    let k = i;
    while (k > 0 && local[k - 1] === local[i]) k--;
    if (i - k + 1 >= FLAT_MONTHS) flatStarts.push(m.months[k]);
    const name = el("span", "", t.items[id] || id);
    name.append(el("span", "sub", `/ ${t.units[m.items[id].unit] || m.items[id].unit}`));
    rows.push({
      id,
      month: m.months[i],
      price: local[i],
      yearText: yearAgo ? pctPill(pct(yearAgo, local[i]), { decimals: 1 }) : "—",
      natText: nat && nat[i] ? pctPill(pct(nat[i], local[i]), { decimals: 1, plain: true }) : "—",
      name,
    });
  }
  // The month most items have = the table's month; an item with an older month shows it under its price
  const monthCount = new Map();
  for (const r of rows) monthCount.set(r.month, (monthCount.get(r.month) || 0) + 1);
  const dataMonth = [...monthCount.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1))[0][0];
  for (const r of rows) {
    const price = el("span", "", formatNumber(r.price, "LAK"));
    if (r.month !== dataMonth) price.append(el("span", "sub-line", monthText(r.month, t)));
    r.cells = [r.name, price, r.yearText, ...(isNational ? [] : [r.natText])]; // national: no "vs national" column
  }
  const tableCard = card("market");
  tableCard.append(cardHead(`${t.living_prices_in} ${placeName(market)} · ${monthText(dataMonth, t)}`, "market", m.stale, t));
  if (flatStarts.length >= rows.length / 2) {
    // Most common start month (one item frozen since long ago should not set the date for all)
    const count = new Map();
    for (const mo of flatStarts) count.set(mo, (count.get(mo) || 0) + 1);
    const flatSince = [...count.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
    const warn = el("div", "alert");
    warn.append(el("span", "", "⚠"), el("div", "", t.living_prices_flat_warn.replace("{month}", monthText(flatSince, t))));
    tableCard.append(warn);
  }
  const headers = [t.col_item, t.col_price_lak, t.col_vs_last_year, ...(isNational ? [] : [t.col_vs_national])];
  const tbl = nameTable(headers, rows.map((r) => r.cells));
  tbl.querySelectorAll("tbody tr").forEach((tr, i) => {
    const id = rows[i].id;
    tr.className = "clickable";
    tr.tabIndex = 0;
    tr.setAttribute("aria-selected", String(id === item));
    const choose = () => {
      item = id;
      save("living_item", id);
      ctx.rerender();
    };
    tr.addEventListener("click", choose);
    tr.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        choose();
      }
    });
  });
  tableCard.append(tbl, el("p", "note", t.living_prices_note));
  const foot = el("div", "card-foot", `${t.source}: `);
  const a = el("a", "", prices.sources.wfp_markets.source_name);
  a.href = prices.sources.wfp_markets.source_url;
  a.target = "_blank";
  a.rel = "noopener";
  foot.append(a);
  tableCard.append(foot);

  // Chart of the chosen item: this province vs national average
  const startIdx = Math.max(0, m.months.length - 12 * years);
  const months = m.months.slice(startIdx);
  const chart = chartCard({
    title: `${t.items[item] || item} (${t.lak_per} ${t.units[m.items[item].unit] || m.items[item].unit})`,
    subtitle: t.living_prices_chart_sub,
    labels: months.map((mo) => monthText(mo, t)),
    tickLabels: months.map((mo) => monthShort(mo, t)),
    series: [
      ...(isNational ? [] : [{ label: placeName(market), kind: "market", values: (m.prices[item][market] || []).slice(startIdx) }]),
      { label: t.living_national_avg, kind: "market", color: "--cat-1", values: m.prices[item][NAT].slice(startIdx) },
    ],
    unit: "LAK",
    unitLabel: `${t.lak_per} 1 ${t.units[m.items[item].unit] || m.items[item].unit}`,
    t,
    firstColTitle: t.month,
  });

  const grid = el("div", "grid grid-2");
  const right = el("div", "stack");
  right.append(chart);
  grid.append(tableCard, right);
  view.append(grid);
}

// ---------- 4) What 1,000,000 kip kept its value as ----------
function savingsSection(ctx, view) {
  const { t, economy: eco } = ctx;
  const mon = eco.monthly;
  const need = ["cpi_index", "gold_usd", "bol_usd_mid", "bol_thb_mid"];
  view.append(sectionTitle(t.living_savings_title));
  if (!need.every((k) => mon[k] && mon[k].values.length)) {
    view.append(emptyState(t.not_enough_data, t.living_savings_missing));
    return;
  }
  const maps = Object.fromEntries(need.map((k) => [k, new Map(mon[k].values)]));
  // Months where every input exists
  const common = mon.cpi_index.values.map(([m]) => m).filter((m) => need.every((k) => maps[k].has(m)));
  const end = common[common.length - 1];
  const wanted = addMonths(end, -12 * years);
  const start = common.find((m) => m >= wanted);
  const months = common.filter((m) => m >= start);

  const START = 1000000;
  const cpi = maps.cpi_index;
  const assets = [
    { id: "kip", color: "--cat-1", nominal: () => START },
    { id: "usd", color: "--cat-4", nominal: (m) => (START / maps.bol_usd_mid.get(start)) * maps.bol_usd_mid.get(m) },
    { id: "thb", color: "--cat-5", nominal: (m) => (START / maps.bol_thb_mid.get(start)) * maps.bol_thb_mid.get(m) },
    {
      id: "gold",
      color: "--cat-3",
      // gold in LAK = world gold (USD) × BOL USD rate; the unit cancels out in the ratio
      nominal: (m) => (START / (maps.gold_usd.get(start) * maps.bol_usd_mid.get(start))) * maps.gold_usd.get(m) * maps.bol_usd_mid.get(m),
    },
  ];
  const real = (a, m) => (a.nominal(m) * cpi.get(start)) / cpi.get(m); // in kip of the START month

  const grid = el("div", "grid grid-2");
  grid.append(
    chartCard({
      title: `${t.living_savings_chart} (${monthText(start, t)} → ${monthText(end, t)})`,
      subtitle: t.living_savings_chart_sub,
      labels: months.map((m) => monthText(m, t)),
      tickLabels: months.map((m) => monthShort(m, t)),
      series: assets.map((a) => ({ label: t["asset_" + a.id], kind: "estimated", color: a.color, values: months.map((m) => Math.round(real(a, m))) })),
      unit: "LAK",
      t,
      firstColTitle: t.month,
    })
  );

  const rows = assets
    .map((a) => ({ a, nominal: a.nominal(end), real: real(a, end) }))
    .sort((x, y) => y.real - x.real)
    .map(({ a, nominal, real: r }) => [
      t["asset_" + a.id],
      formatNumber(nominal, "LAK"),
      formatNumber(r, "LAK"),
      pctPill(pct(START, r), { decimals: 1 }),
    ]);
  const c = card("estimated");
  c.append(cardHead(`${t.living_savings_table} ${monthText(start, t)}`, "estimated", false, t));
  c.append(nameTable([t.col_kept_as, t.col_value_today, t.col_real_value, t.col_buying_power], rows));
  c.append(el("p", "note", t.living_savings_note));
  grid.append(c);
  view.append(grid);
}

// ---------- 5) Deposit rates ----------
function depositSection(ctx, view) {
  const { t, summary, economy: eco } = ctx;
  const m = summary.metrics;
  if (!m["bcel-deposit.LAK_fixed_12m"]) return;
  view.append(sectionTitle(t.living_deposit_title));
  const inf = lastOf(eco.monthly.cpi_yoy && eco.monthly.cpi_yoy.values);
  const terms = [...new Set(Object.keys(m).filter((k) => k.startsWith("bcel-deposit.LAK_")).map((k) => k.slice("bcel-deposit.LAK_".length)))];
  const termValue = (term) => (term === "saving" ? 0 : Number(term.replace(/\D/g, "")));
  terms.sort((a, b) => termValue(a) - termValue(b));
  const cur = (c, term) => {
    const x = m[`bcel-deposit.${c}_${term}`];
    return x ? x.latest.value.toFixed(2) : "—"; // the card title says "% per year"
  };
  const rows = terms.map((term) => {
    const lak = m[`bcel-deposit.LAK_${term}`];
    const real = lak && inf ? ((1 + lak.latest.value / 100) / (1 + inf[1] / 100) - 1) * 100 : null;
    return [
      term === "saving" ? t.term_saving : `${t.term_fixed} ${termValue(term)} ${t.term_months}`,
      cur("LAK", term),
      real === null ? "—" : pctPill(real, { decimals: 1 }),
      cur("USD", term),
      cur("THB", term),
      cur("CNY", term),
    ];
  });
  const c = card("bank");
  c.append(cardHead(t.living_deposit_card, "bank", false, t));
  c.append(nameTable([t.col_term, "LAK", `LAK ${t.col_after_inflation}`, "USD", "THB", "CNY"], rows));
  c.append(el("p", "note", inf ? t.living_deposit_note.replace("{inf}", formatPct(inf[1], 1)).replace("{month}", monthText(inf[0], t)) : t.not_enough_data));
  const foot = el("div", "card-foot", `${t.source}: `);
  const a = el("a", "", "BCEL");
  a.href = summary.sources["bcel-deposit"] ? summary.sources["bcel-deposit"].source_url : "https://www.bcel.com.la";
  a.target = "_blank";
  a.rel = "noopener";
  foot.append(a);
  c.append(foot);
  view.append(c);
}

// ---------- Page ----------
export function render(view, ctx) {
  const { t, economy: eco } = ctx;
  if (!eco || !eco.monthly) {
    view.append(emptyState(t.eco_missing_title, t.eco_missing_text));
    return;
  }
  loadPrices(ctx.rerender);
  loadThai(ctx.rerender);

  view.append(el("p", "lead", t.living_lead));
  const filters = el("div", "filters");
  filters.append(periodButtons(t, ctx.rerender));
  view.append(filters);
  const facts = factsBox(ctx, pricesState === "ok" ? prices : null, market);
  if (facts) view.append(facts);
  view.append(keyNumbers(ctx));

  fuelSection(ctx, pricesState === "ok" ? prices : null, years, view);

  view.append(sectionTitle(t.living_inflation_title));
  const infGrid = el("div", "grid grid-2");
  const compare = inflationCompare(ctx, years);
  if (compare) infGrid.append(compare);
  inflationSection(ctx, infGrid);
  view.append(infGrid);

  pricesSection(ctx, view);
  if (pricesState === "ok") budgetSection(ctx, prices, market, placeNameOf(t), view);
  savingsSection(ctx, view);
  depositSection(ctx, view);

  view.append(el("p", "note", t.living_disclaimer));
  mountCharts(view);
}
