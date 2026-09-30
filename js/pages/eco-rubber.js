// Economy tabs 7 + 8 (owner owns a rubber farm; land is expensive):
//   Rubber - world price (IMF, RSS3, monthly since 2000), Thai market prices (Ministry of Commerce: cup lump, latex,
//            unsmoked sheet), each also in kip, and the average of every year. No Lao prices are published online.
//   Land   - no open, official land-price data exists for Laos: say so, show what we checked, and point to the
//            numbers on this site that move land values.

import { el, card, cardHead, pctPill, table } from "../ui.js";
import { chartCard } from "../charts.js";
import { formatNumber, formatDate } from "../format.js";
import { lazyJson } from "../lazy.js";
import {
  lastOf, pct, indicator, valueIn, freshness, sourcesFoot, invTile, ready, fill, monthText, monthShort,
} from "./eco-common.js";

const LB_PER_KG = 2.20462;
const perKg = (centsPerLb) => (centsPerLb * LB_PER_KG) / 100; // US cents per pound -> USD per kg
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

export function rubberTab(panel, e) {
  const { t, summary } = e;
  panel.append(el("p", "muted tab-intro", t.inv_rub_intro));
  if (!ready(panel, e)) return;
  const thaiFile = lazyJson("data/thai-prices.json", e.rerender);
  const thai = thaiFile.state === "ok" ? thaiFile.data : null;
  const world = e.invest.monthly.rubber_usd;
  const usdMonthly = e.economy.monthly && e.economy.monthly.bol_usd_mid;
  const thbLak = summary.metrics["fx-market.THB_LAK"];

  // ---------- Key numbers ----------
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
  panel.append(stats);
  if (thaiFile.state === "loading") panel.append(el("p", "muted", t.loading));

  const grid = el("div", "grid grid-2");
  // ---------- World price, monthly ----------
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
  // ---------- Thai market prices, monthly ----------
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

  // ---------- Price of each year ----------
  const rates = ratesByYear(e);
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
      return [
        label,
        usdKg.toFixed(2),
        usdRate ? formatNumber(usdKg * usdRate, "LAK") : "—",
        c ? c.avg.toFixed(2) : "—",
        c && thbRate ? formatNumber(c.avg * thbRate, "LAK") : "—",
      ];
    });
    const c = card("market");
    c.append(cardHead(t.inv_rub_years_title, "market", world.stale, t));
    const tb = table([t.year, t.inv_rub_col_world_usd, t.inv_rub_col_world_lak, t.inv_rub_col_thai_thb, t.inv_rub_col_thai_lak], rows);
    tb.classList.add("wrap-all", "scroll-y");
    c.append(tb);
    c.append(el("p", "note", fill(t.inv_rub_years_note, { month: monthText(lastMonth, t) })));
    const fresh = el("div", "card-foot");
    fresh.append(freshness(t, { month: lastMonth, stale: world.stale }));
    c.append(fresh, sourcesFoot(t, [e.invest.sources.imf_pcps, thai && thai.source, e.economy.sources.bol, e.economy.sources.worldbank].filter(Boolean)));
    panel.append(c);
  }

  // ---------- What the numbers mean for a farmer in Laos ----------
  const n = card("estimated");
  n.append(cardHead(t.inv_rub_notes_title, null, false, t));
  const ul = el("ul", "watch-list");
  for (const k of ["inv_rub_note_1", "inv_rub_note_2", "inv_rub_note_3", "inv_rub_note_4", "inv_rub_note_5"]) ul.append(el("li", "", t[k]));
  n.append(ul);
  panel.append(n);
}

export function landTab(panel, e) {
  const { t } = e;
  panel.append(el("p", "muted tab-intro", t.inv_land_intro));
  if (!ready(panel, e, ["stat"])) return;
  const land = e.stat.land;

  const c = card("estimated");
  c.append(cardHead(t.inv_land_title, null, false, t));
  const ul = el("ul", "watch-list");
  for (const k of ["inv_land_1", "inv_land_2", "inv_land_3"]) ul.append(el("li", "", t[k]));
  c.append(ul);
  c.append(el("p", "note", t.inv_land_listings));
  const links = el("ul", "watch-list");
  for (const src of land.listings) {
    const li = el("li");
    const a = el("a", "", src.source_name);
    a.href = src.source_url;
    a.target = "_blank";
    a.rel = "noopener";
    li.append(a);
    links.append(li);
  }
  c.append(links);
  const fresh = el("div", "card-foot");
  fresh.append(freshness(t, { checked: e.stat.checked }));
  c.append(fresh);
  panel.append(c);

  // Numbers on this site that move land values
  const w = card("official");
  w.append(cardHead(t.inv_land_watch_title, null, false, t));
  const wl = el("ul", "watch-list");
  for (const k of ["inv_land_watch_1", "inv_land_watch_2", "inv_land_watch_3", "inv_land_watch_4"]) wl.append(el("li", "", t[k]));
  w.append(wl);
  const row = el("div", "watch-links");
  for (const [to, label] of [["gdp", "inv_tab_gdp"], ["inflation", "inv_tab_inflation"], ["fdi", "inv_tab_fdi"], ["debt", "inv_tab_debt"]]) {
    const b = el("button", "btn", t[label]);
    b.type = "button";
    b.addEventListener("click", () => e.go(to));
    row.append(b);
  }
  const a = el("a", "btn", t.page_living);
  a.href = "#/living";
  row.append(a);
  w.append(row);
  panel.append(w);
}

export { formatDate, valueIn };
