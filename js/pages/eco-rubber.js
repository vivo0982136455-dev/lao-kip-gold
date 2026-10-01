// Economy tabs 7 + 8 (owner owns a rubber farm; land is expensive):
//   Rubber - world price (IMF, RSS3, monthly since 2000), Thai market prices (Ministry of Commerce: cup lump, latex,
//            unsmoked sheet), each also in kip, and the average of every year. For Laos itself there is no daily or
//            provincial price online; what exists is shown as it is: the ministry's yearly national average
//            (2019-2023), the yearly price of Lao rubber at the Chinese border (China's customs, UN Comtrade) and
//            single prices quoted in news.
//   Land   - official ASSESSED prices per province (decisions in the Lao Official Gazette, data/land.json: which
//            province has one, its date, the link) - not market prices. No open data of real sale prices exists:
//            say so, and point to the numbers on this site that move land values.

import { el, card, cardHead, pctPill, table, sourceLink } from "../ui.js";
import { chartCard } from "../charts.js";
import { formatNumber, formatDate } from "../format.js";
import { lazyJson } from "../lazy.js";
import {
  lastOf, pct, indicator, valueIn, freshness, sourcesFoot, invTile, ready, fill, monthText, monthShort, staticSource,
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
  // Lao rubber at the Chinese border (the only automatic number that is about Lao rubber itself; yearly)
  const china = e.invest.parts && e.invest.parts.rubber_china;
  if (china && china.years && china.years.length > 1) {
    const now = lastOf(china.years);
    const before = china.years[china.years.length - 2];
    const rate = ratesByYear(e).USD.get(now[0]);
    const sub = rate ? `≈ ${formatNumber(now[1] * rate, "LAK")} ${t.inv_rub_lak_kg}` : t.inv_rub_china_short;
    const tile = invTile(t, t.inv_rub_china, { num: now[1].toFixed(2), unit: t.inv_rub_usd_kg }, sub, freshness(t, { year: now[0], stale: china.stale }), "official");
    tile.querySelector(".stat-sub").append(" ", pctPill(pct(before[1], now[1]), { decimals: 1 }));
    stats.append(tile);
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

  // ---------- Prices of Laos itself (yearly) ----------
  const lao = laoRubberCard(e, rates);
  if (lao) panel.append(lao);

  // ---------- What the numbers mean for a farmer in Laos ----------
  const n = card("estimated");
  n.append(cardHead(t.inv_rub_notes_title, null, false, t));
  const ul = el("ul", "watch-list");
  for (const k of ["inv_rub_note_1", "inv_rub_note_2", "inv_rub_note_3", "inv_rub_note_4", "inv_rub_note_5"]) ul.append(el("li", "", t[k]));
  n.append(ul);
  panel.append(n);
}

// Official assessed land prices: one row per province = newest decision, its date and the link to the document.
// The documents are scans in Lao, so the prices inside cannot be read by a script; the weekly job only watches for
// new decisions. A decision older than the legal re-valuation period (3 years) is marked.
function officialLandCard(e, file) {
  const { t } = e;
  const land = e.stat.land;
  const c = card("official");
  const data = file.state === "ok" ? file.data : null;
  c.append(cardHead(t.inv_land_official_title, "official", !!(data && data.stale), t));
  const ul = el("ul", "watch-list");
  for (const k of ["inv_land_official_1", "inv_land_official_2", "inv_land_official_3"]) ul.append(el("li", "", fill(t[k], { years: land.revaluation_years })));
  c.append(ul);
  if (!data) {
    c.append(el("p", "muted", file.state === "error" ? t.inv_load_error : t.loading));
    return c;
  }

  const limit = new Date();
  limit.setFullYear(limit.getFullYear() - land.revaluation_years);
  const tooOld = (day) => new Date(day + "T00:00:00Z") < limit;
  // always with the year: the rows span many years
  const dayText = (day) => `${Number(day.slice(8, 10))} ${t.months[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;
  const list = Object.entries(data.provinces).map(([name, p]) => ({ name, decision: p.decisions[0] || null, note: null }));
  // decisions that are not in the Gazette list (Vientiane Capital): from the hand-checked file
  for (const x of land.official_extra || []) {
    const row = list.find((r) => r.name === x.province);
    if (row && !row.decision) {
      row.decision = { decided: x.decided, pdf: x.pdf, url: x.pdf };
      row.note = t[x.note];
    }
  }
  const label = (r) => t.provinces[r.name] || r.name;
  list.sort((a, b) => {
    if (a.decision && b.decision) return a.decision.decided < b.decision.decided ? 1 : -1; // newest first
    if (a.decision || b.decision) return a.decision ? -1 : 1;
    return label(a).localeCompare(label(b));
  });
  const have = list.filter((r) => r.decision).length;
  c.append(el("p", "note", fill(t.inv_land_official_count, { have, total: list.length })));

  const rows = list.map((r) => {
    const name = el("span", "", label(r));
    if (!r.decision) return [name, el("span", "muted", t.inv_land_none), "—"];
    const when = el("span", "", dayText(r.decision.decided));
    if (tooOld(r.decision.decided)) when.append(" ", el("span", "fresh-old", fill(t.inv_land_older, { years: land.revaluation_years })));
    if (r.note) when.append(el("span", "sub-line", r.note));
    const a = el("a", "", t.inv_land_open_doc);
    a.href = r.decision.pdf || r.decision.url;
    a.target = "_blank";
    a.rel = "noopener";
    return [name, when, a];
  });
  const tb = table([t.inv_land_col_province, t.inv_land_col_decided, t.inv_land_col_doc], rows);
  tb.classList.add("wrap-first", "land-table");
  c.append(tb);

  const fresh = el("div", "card-foot");
  fresh.append(freshness(t, { checked: data.checked_at.slice(0, 10), stale: data.stale }));
  c.append(fresh, sourcesFoot(t, [data.source, staticSource(e, "thaipublica_land"), staticSource(e, land.revaluation_source)]));
  return c;
}

export function landTab(panel, e) {
  const { t } = e;
  panel.append(el("p", "muted tab-intro", t.inv_land_intro));
  if (!ready(panel, e, ["stat"])) return;
  const land = e.stat.land;
  panel.append(officialLandCard(e, lazyJson("data/land.json", e.rerender)));

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
