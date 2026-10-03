// Economy tab 7: rubber (the owner owns a rubber farm). Six views, chosen with the buttons at the top:
//   market - world price (IMF, RSS3, monthly since 2000), Thai market prices (Ministry of Commerce: cup lump, latex,
//            unsmoked sheet), each also in kip, and the average of every year
//   buyers - where Lao rubber is sold and at what price: buyers per year, the Vietnamese border by month, the kinds
//            of rubber bought, and the Thai central markets next to Laos as a reference    (eco-rubber-borders.js)
//   lao    - Laos itself: rubber area by province (NAFRI 2018, the newest table by province), production by year
//            (FAO), the ministry's yearly national price and the price at the Chinese border, single prices quoted
//            in news. No daily or provincial price is published anywhere (re-checked 2026-10-01).
//   asean  - the newest price in every ASEAN country + China + the world (eco-rubber-borders.js), then trade by
//            form of rubber, production, producer prices                                    (eco-rubber-world.js)
//   world  - world prices by month, the 10 biggest sellers and buyers, the biggest producers          (eco-rubber-world.js)
//   mine   - the price the owner's buyer really paid: entry form + history                           (own-entry.js)
// data/thai-prices.json, data/rubber-world.json, data/rubber-borders.json, data/rubber-daily.json and
// data/own-prices.json load only when this tab is opened.

import { el, card, cardHead, pctPill, table, sourceLink } from "../ui.js";
import { chartCard, dayRange, valuesFor } from "../charts.js";
import { formatNumber, formatDate } from "../format.js";
import { lazyJson } from "../lazy.js";
import { usdPerKg as perKg } from "../calc.js"; // US cents per pound -> USD per kg
import {
  lastOf, pct, indicator, freshness, sourcesFoot, invTile, barTable, ready, fill, monthText, monthShort, staticSource, choice, whole, PROVINCES,
} from "./eco-common.js";
import { aseanView, worldView, laoProductionChart } from "./eco-rubber-world.js";
import { buyersView, countryPricesCard } from "./eco-rubber-borders.js";
import { rubberEntryCard, rubberEntriesCard, rubberByProvince, RUBBER_TYPES } from "./own-entry.js";

const round2 = (v) => Math.round(v * 100) / 100;
const THAI = [
  ["rubber_cuplump", "inv_rub_cuplump", "--cat-1"],
  ["rubber_latex", "inv_rub_latex", "--cat-3"],
  ["rubber_sheet", "inv_rub_sheet", "--cat-4"],
];

// Average of the monthly values of each year: { 2024: 1.23, ... } (+ number of months)
function yearly(values) {
  const by = new Map();
  for (const [m, v] of values) {
    const y = Number(m.slice(0, 4));
    if (!by.has(y)) by.set(y, []);
    by.get(y).push(v);
  }
  return new Map([...by.entries()].map(([y, list]) => [y, { avg: list.reduce((a, b) => a + b, 0) / list.length, months: list.length }]));
}

// LAK per USD / per THB for each year: BOL monthly averages when we have them, else the World Bank yearly rate (USD)
function ratesByYear(e) {
  const out = { USD: new Map(), THB: new Map() };
  const wb = indicator(e, "wb.PA.NUS.FCRF");
  if (wb) for (const [y, v] of wb.values) out.USD.set(y, v);
  for (const [cur, id] of [["USD", "bol_usd_mid"], ["THB", "bol_thb_mid"]]) {
    const s = e.economy.monthly && e.economy.monthly[id];
    if (s) for (const [y, { avg, months }] of yearly(s.values)) if (months >= 3 || !out[cur].has(y)) out[cur].set(y, avg);
  }
  return out;
}

// Rubber prices of Laos itself, per year: the ministry's national average (kip) and the price at the Chinese
// border (China's customs value / weight, in USD and in kip of that year), plus single prices quoted in news.
function laoRubberCard(e, rates) {
  const { t } = e;
  const official = e.stat.rubber && e.stat.rubber.official_yearly;
  const china = e.invest.parts && e.invest.parts.rubber_china;
  const offMap = new Map(official ? official.values : []);
  const chinaMap = new Map(china && china.years ? china.years.map((row) => [row[0], row]) : []);
  const years = [...new Set([...offMap.keys(), ...chinaMap.keys()])].sort((a, b) => b - a);
  if (!years.length) return null;

  const rows = years.map((y) => {
    const c = chinaMap.get(y);
    const rate = rates.USD.get(y);
    return [
      String(y),
      offMap.has(y) ? formatNumber(offMap.get(y) / 1000, "LAK") : "—", // kip per tonne -> kip per kg
      c ? c[1].toFixed(2) : "—",
      c && rate ? formatNumber(c[1] * rate, "LAK") : "—",
      c ? Math.round(c[2] / 1000).toLocaleString("en-US") : "—",
    ];
  });
  const card1 = card("official");
  card1.append(cardHead(t.inv_rub_lao_title, "official", !!(china && china.stale), t));
  const tb = table([t.year, t.inv_rub_col_lao_off, t.inv_rub_col_china_usd, t.inv_rub_col_china_lak, t.inv_rub_col_china_tonnes], rows);
  tb.classList.add("wrap-all", "scroll-y");
  card1.append(tb);
  const notes = el("ul", "watch-list");
  for (const k of ["inv_rub_lao_note_1", "inv_rub_lao_note_2", "inv_rub_lao_note_3"]) notes.append(el("li", "", t[k]));
  card1.append(notes);

  // Single prices quoted in news / official statements
  const reports = (e.stat.rubber && e.stat.rubber.reports) || [];
  if (reports.length) {
    card1.append(el("p", "note", t.inv_rub_reports_title));
    const ul = el("ul", "watch-list");
    for (const r of reports) {
      const when = /^\d{4}$/.test(r.period) ? `${t.year} ${r.period}` : formatDate(r.period, t);
      const num = (v) => (v === undefined ? "" : formatNumber(v, "LAK"));
      const li = el("li", "", fill(t[r.text], { province: t.provinces[r.province] || r.province, when, value: num(r.value), low: num(r.low), high: num(r.high) }) + " — ");
      const src = staticSource(e, r.source);
      if (src) li.append(sourceLink(src));
      ul.append(li);
    }
    card1.append(ul);
  }

  const fresh = el("div", "card-foot");
  if (offMap.size) fresh.append(`${t.inv_rub_col_lao_off}: `, freshness(t, { year: Math.max(...offMap.keys()) }));
  if (offMap.size && chinaMap.size) fresh.append(" · ");
  if (chinaMap.size) fresh.append(`${t.inv_rub_china_short}: `, freshness(t, { year: Math.max(...chinaMap.keys()), stale: china.stale }));
  card1.append(fresh, sourcesFoot(t, [staticSource(e, "moic_dit"), china && e.invest.sources.comtrade, e.economy.sources.bol, e.economy.sources.worldbank].filter(Boolean)));
  return card1;
}

// ---------- View 1: market prices (world + Thailand) ----------
function marketView(panel, r) {
  const { t, summary, thai } = r;
  const world = r.invest.monthly.rubber_usd;
  const usdMonthly = r.economy.monthly && r.economy.monthly.bol_usd_mid;
  const thbLak = summary.metrics["fx-market.THB_LAK"];

  // Key numbers
  const stats = el("div", "stats");
  if (world && world.values.length > 12) {
    const now = lastOf(world.values);
    const ago = world.values[world.values.length - 13];
    const rate = usdMonthly && (new Map(usdMonthly.values).get(now[0]) || lastOf(usdMonthly.values)[1]);
    const sub = rate ? `≈ ${formatNumber(perKg(now[1]) * rate, "LAK")} ${t.inv_rub_lak_kg}` : "IMF";
    const tile = invTile(t, t.inv_rub_world, { num: perKg(now[1]).toFixed(2), unit: t.inv_rub_usd_kg }, sub, freshness(t, { month: now[0], stale: world.stale }), "market");
    tile.querySelector(".stat-sub").append(" ", pctPill(pct(ago[1], now[1]), { decimals: 1 }));
    stats.append(tile);
  }
  if (thai) {
    for (const [id, key] of THAI.slice(0, 2)) {
      const it = thai.items && thai.items[id];
      if (!it) continue;
      // newest day if we have it, else the newest monthly average
      const lastMonth = it.monthly && it.monthly.length ? it.monthly[it.monthly.length - 1] : null;
      const value = it.latest ? it.latest.value : lastMonth ? lastMonth[1] : null;
      if (value === null) continue;
      const when = it.latest ? { date: it.latest.date } : { month: lastMonth[0] };
      const lak = thbLak ? ` ≈ ${formatNumber(value * thbLak.latest.value, "LAK")} ${t.inv_rub_lak_kg}` : "";
      const label = it.latest ? t.inv_rub_thai_market : `${t.inv_rub_thai_market} · ${t.inv_rub_month_avg}`;
      stats.append(invTile(t, t[key], { num: value.toFixed(2), unit: t.inv_rub_thb_kg }, `${label}${lak}`, freshness(t, { ...when, stale: it.stale }), "market"));
    }
  }
  // Lao rubber at the Chinese border (the only automatic number that is about Lao rubber itself; yearly)
  const china = r.invest.parts && r.invest.parts.rubber_china;
  if (china && china.years && china.years.length > 1) {
    const now = lastOf(china.years);
    const before = china.years[china.years.length - 2];
    const rate = ratesByYear(r).USD.get(now[0]);
    const sub = rate ? `≈ ${formatNumber(now[1] * rate, "LAK")} ${t.inv_rub_lak_kg}` : t.inv_rub_china_short;
    const tile = invTile(t, t.inv_rub_china, { num: now[1].toFixed(2), unit: t.inv_rub_usd_kg }, sub, freshness(t, { year: now[0], stale: china.stale }), "official");
    tile.querySelector(".stat-sub").append(" ", pctPill(pct(before[1], now[1]), { decimals: 1 }));
    stats.append(tile);
  }
  panel.append(stats);
  if (r.thaiState === "loading") panel.append(el("p", "muted", t.loading));

  const grid = el("div", "grid grid-2");
  // World price, monthly
  if (world && world.values.length) {
    const recent = world.values.filter(([m]) => m >= "2015-01");
    grid.append(
      chartCard({
        title: t.inv_rub_world_chart,
        subtitle: `${t.unit}: ${t.inv_rub_usd_kg} · ${t.source}: IMF (RSS3)`,
        labels: recent.map(([m]) => monthText(m, t)),
        tickLabels: recent.map(([m]) => monthShort(m, t)),
        series: [{ label: t.inv_rub_world, kind: "market", values: recent.map(([, v]) => round2(perKg(v))) }],
        unit: "USD per kg",
        t,
        firstColTitle: t.month,
      })
    );
  }
  // Thai market prices, monthly
  if (thai) {
    const series = THAI.map(([id, key, color]) => [thai.items && thai.items[id], key, color]).filter(([it]) => it && it.monthly && it.monthly.length);
    if (series.length) {
      const months = [...new Set(series.flatMap(([it]) => it.monthly.map(([m]) => m)))].sort();
      grid.append(
        chartCard({
          title: t.inv_rub_thai_chart,
          subtitle: `${t.unit}: ${t.inv_rub_thb_kg} · ${t.source}: ${t.inv_rub_thai_source}`,
          labels: months.map((m) => monthText(m, t)),
          tickLabels: months.map((m) => monthShort(m, t)),
          series: series.map(([it, key, color]) => {
            const map = new Map(it.monthly.map(([m, v]) => [m, v]));
            return { label: t[key], kind: "market", color, values: months.map((m) => (map.has(m) ? map.get(m) : null)) };
          }),
          unit: "THB per kg",
          t,
          firstColTitle: t.month,
        })
      );
    }
  }
  panel.append(grid);

  // Price of each year
  const rates = ratesByYear(r);
  const wy = world ? yearly(world.values) : new Map();
  const cup = thai && thai.items && thai.items.rubber_cuplump && thai.items.rubber_cuplump.monthly ? yearly(thai.items.rubber_cuplump.monthly.map(([m, v]) => [m, v])) : new Map();
  const years = [...wy.keys()].filter((y) => y >= 2010).sort((a, b) => b - a);
  if (years.length) {
    const lastMonth = lastOf(world.values)[0];
    const rows = years.map((y) => {
      const w = wy.get(y);
      const usdKg = perKg(w.avg);
      const usdRate = rates.USD.get(y);
      const c = cup.get(y);
      const thbRate = rates.THB.get(y);
      const label = w.months < 12 ? `${y}*` : String(y);
      return [label, usdKg.toFixed(2), usdRate ? formatNumber(usdKg * usdRate, "LAK") : "—", c ? c.avg.toFixed(2) : "—", c && thbRate ? formatNumber(c.avg * thbRate, "LAK") : "—"];
    });
    const c = card("market");
    c.append(cardHead(t.inv_rub_years_title, "market", world.stale, t));
    const tb = table([t.year, t.inv_rub_col_world_usd, t.inv_rub_col_world_lak, t.inv_rub_col_thai_thb, t.inv_rub_col_thai_lak], rows);
    tb.classList.add("wrap-all", "scroll-y");
    c.append(tb);
    c.append(el("p", "note", fill(t.inv_rub_years_note, { month: monthText(lastMonth, t) })));
    const fresh = el("div", "card-foot");
    fresh.append(freshness(t, { month: lastMonth, stale: world.stale }));
    c.append(fresh, sourcesFoot(t, [r.invest.sources.imf_pcps, thai && thai.source, r.economy.sources.bol, r.economy.sources.worldbank].filter(Boolean)));
    panel.append(c);
  }

  // What the numbers mean for a farmer in Laos
  const n = card("estimated");
  n.append(cardHead(t.inv_rub_notes_title, null, false, t));
  const ul = el("ul", "watch-list");
  for (const k of ["inv_rub_note_1", "inv_rub_note_2", "inv_rub_note_3", "inv_rub_note_4", "inv_rub_note_5"]) ul.append(el("li", "", t[k]));
  n.append(ul);
  panel.append(n);
}

// ---------- View 2: Laos, province by province ----------
function provincesCard(r) {
  const { t } = r;
  const p = r.stat.rubber && r.stat.rubber.provinces;
  if (!p) return null;
  const mine = rubberByProvince(r.own);
  const byName = new Map(p.rows.map(([name, planted, tapped]) => [name, { planted, tapped }]));
  const mineLine = (name) => {
    const e = mine.get(name);
    return e ? fill(t.rw_mine_line, { price: whole(e.price), type: t["own_type_" + e.type] || e.type_text, date: formatDate(e.date, t) }) : null;
  };
  // biggest planted area first; provinces without a figure at the end (the owner asked to see every province)
  const names = [...PROVINCES].sort((a, b) => (byName.has(b) ? byName.get(b).planted : -1) - (byName.has(a) ? byName.get(a).planted : -1));
  const rows = names.map((name) => {
    const v = byName.get(name);
    return {
      label: t.provinces[name] || name,
      sub: mineLine(name),
      value: v ? v.planted : null,
      text: v ? whole(v.planted) : "—",
      share: v ? whole(v.tapped) : "—",
    };
  });
  rows.push({ label: t.rw_total_laos, sub: null, value: null, text: whole(p.total[0]), share: whole(p.total[1]) });
  const c = card("official");
  c.append(cardHead(fill(t.rw_lao_prov_title, { year: p.year }), "official", false, t));
  const tb = barTable([t.inv_land_col_province, t.rw_col_planted, t.rw_col_tapped], rows);
  tb.classList.add("total-last");
  c.append(tb);
  c.append(el("p", "note", t.rw_lao_prov_note));
  const fresh = el("div", "card-foot");
  fresh.append(freshness(t, { year: p.year, checked: r.stat.checked }));
  c.append(fresh, sourcesFoot(t, [staticSource(r, p.source)]));
  return c;
}

function laoView(panel, r) {
  const prov = provincesCard(r);
  if (prov) panel.append(prov);
  if (r.world) {
    const chart = laoProductionChart(r);
    if (chart) panel.append(chart);
  } else if (r.worldState === "loading") panel.append(el("p", "muted", r.t.loading));
  const lao = laoRubberCard(r, ratesByYear(r));
  if (lao) panel.append(lao);
}

// ---------- View: ASEAN + China - first the newest price in every country, then trade and production ----------
function aseanPlusView(panel, r) {
  // The price table is built from three files. While one is still on its way it is not shown half-filled (rows
  // would appear and prices would jump); a file that FAILED is left out and the page says so.
  const files = [r.bordersState, r.dailyState, r.worldState];
  if (files.includes("loading")) panel.append(el("p", "muted", r.t.loading));
  else {
    const prices = countryPricesCard(r);
    if (prices) panel.append(prices);
    if (r.bordersState === "error" || r.dailyState === "error") panel.append(el("p", "muted", r.t.inv_load_error));
  }
  if (r.world) aseanView(panel, r);
  else panel.append(el("p", "muted", r.worldState === "error" ? r.t.inv_load_error : r.t.loading));
}

// ---------- View 5: the owner's own selling prices ----------
function mineView(panel, r) {
  const { t, summary, thai, own, daily } = r;
  panel.append(rubberEntryCard(r, thai, daily));

  // His prices and the Thai market price of the same day, in kip (last 60 days)
  const entries = own && own.rubber ? own.rubber.entries : [];
  const days = dayRange(60);
  const types = [...new Set(entries.map((e) => e.type))].filter((id) => RUBBER_TYPES[id]);
  const inRange = entries.filter((e) => e.date >= days[0]);
  if (inRange.length >= 2) {
    const series = types.map((id, i) => ({
      label: `${t.own_mine} · ${t["own_type_" + id]}`,
      kind: "shop",
      color: i === 0 ? null : "--cat-" + (i + 1),
      values: valuesFor([...entries].reverse().filter((e) => e.type === id).map((e) => [e.date, e.price]), days),
    }));
    const rate = summary.metrics["fx-market.THB_LAK"];
    const rates = rate ? new Map(rate.daily) : new Map();
    const inKip = (pairs) => valuesFor(pairs.filter(([d, v]) => v !== null && rates.has(d)).map(([d, v]) => [d, Math.round(v * rates.get(d))]), days);
    // the two Thai markets next to Laos (cup lump); without them, the Thai national market price
    const border = daily && daily.thai_border && daily.thai_border.kinds && daily.thai_border.kinds.cuplump;
    const cup = thai && thai.items && thai.items.rubber_cuplump;
    if (border && rate) {
      series.push({ label: `${t.rb_m_nongkhai} · ${t.rb_kind_cuplump}`, kind: "market", values: inKip(border.days.map((x) => [x[0], x[1]])) });
      series.push({ label: `${t.rb_m_chiangrai} · ${t.rb_kind_cuplump}`, kind: "market", color: "--cat-1", values: inKip(border.days.map((x) => [x[0], x[2]])) });
    } else if (cup && cup.days && rate) series.push({ label: t.own_thai_cuplump_lak, kind: "market", values: inKip(cup.days) });
    panel.append(chartCard({ title: t.own_chart_title, subtitle: t.own_chart_sub, labels: days.map((d) => formatDate(d, t)), series, unit: "LAK per kg", t }));
  }
  panel.append(rubberEntriesCard(r, own, thai, daily));
  if (r.ownState === "loading") panel.append(el("p", "muted", t.loading));
}

const VIEWS = { market: marketView, buyers: buyersView, lao: laoView, asean: aseanPlusView, world: worldView, mine: mineView };

export function rubberTab(panel, e) {
  const { t } = e;
  panel.append(el("p", "muted tab-intro", t.inv_rub_intro));
  if (!ready(panel, e)) return;
  const thaiFile = lazyJson("data/thai-prices.json", e.rerender);
  const worldFile = lazyJson("data/rubber-world.json", e.rerender);
  const ownFile = lazyJson("data/own-prices.json", e.rerender);
  const bordersFile = lazyJson("data/rubber-borders.json", e.rerender);
  const dailyFile = lazyJson("data/rubber-daily.json", e.rerender);
  const r = {
    ...e,
    thai: thaiFile.state === "ok" ? thaiFile.data : null,
    thaiState: thaiFile.state,
    world: worldFile.state === "ok" ? worldFile.data : null,
    worldState: worldFile.state,
    own: ownFile.state === "ok" ? ownFile.data : null,
    ownState: ownFile.state,
    borders: bordersFile.state === "ok" ? bordersFile.data : null,
    bordersState: bordersFile.state,
    daily: dailyFile.state === "ok" ? dailyFile.data : null,
    dailyState: dailyFile.state,
  };
  const view = choice(e, "rubber_view", Object.keys(VIEWS).map((id) => [id, t["rw_view_" + id]]), "market");
  view.bar.classList.add("choice-main");
  view.bar.setAttribute("aria-label", t.rw_views_label);
  panel.append(view.bar);

  // The world view needs data/rubber-world.json (the other views say themselves what is still loading)
  if (view.current === "world" && !r.world) {
    panel.append(el("p", "muted", r.worldState === "error" ? t.inv_load_error : t.loading));
    return;
  }
  VIEWS[view.current](panel, r);
}
