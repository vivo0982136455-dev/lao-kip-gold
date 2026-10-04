// Economy tab: wages - what the law says an employer must pay at least, in Laos and in 16 other countries
// (the 11 members of ASEAN, China, Japan, South Korea, Australia, the United States, Israel), and what an
// average employee earns.
//   data/invest-static.json "wages": the minimum wage in force in every country, read by hand from each government's
//       notice (with the date of the check; a rise that is already decided switches on by itself on its day)
//   data/wages.json (weekly, scripts/fetch-wages.js): market exchange rates, the ILO's minimum-wage series by year
//       (one method for all countries, 1-2 years behind) and the ILO's average monthly earnings
//   data/economy.json: the Lao price index - what the Lao minimum wage still buys since it was last raised
//   data/fuel-lao.json + the Thai pump price: litres of petrol a month of minimum wage buys
// A minimum wage is a legal floor, not what people typically earn, and the countries define it differently
// (per hour, day or month; by region; for some sectors only): every row says what it is.

import { el, card, cardHead, table, sourceLink } from "../ui.js";
import { chartCard } from "../charts.js";
import { lazyJson } from "../lazy.js";
import { lastOf, monthText, dayFull, freshness, sourcesFoot, invTile, factsCard, barTable, fill, staticSource, countryName, whole } from "./eco-common.js";
import { todayVientiane } from "../format.js";

const TREND = [
  ["LAO", "--cat-1"],
  ["THA", "--cat-5"],
  ["VNM", "--cat-3"],
  ["KHM", "--cat-4"],
  ["CHN", "--cat-2"],
]; // the lines of the ILO chart: Laos and the neighbours that have a dollar series
const mkip = (kip) => (kip / 1e6).toFixed(2); // kip -> "6.90" (million kip)
const amount = (v) => v.toLocaleString("en-US", Number.isInteger(v) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 }); // 400 · 26.44 · 1,004.90
const times = (v) => `${v >= 10 ? v.toFixed(0) : v.toFixed(1)}×`;
// "2012" (only the year is known) or a full day
const whenText = (when, t) => (when.length === 4 ? when : dayFull(when, t));
// "2.8–4.1" as one piece: a word joiner (U+2060) after the dash keeps a narrow tile from breaking the range in two
// (the unit then goes into the small line below: number + unit would not fit side by side on a phone)
const range = (low, high) => `${low}–${String.fromCharCode(0x2060)}${high}`;

// One country today: the step in force and the next one, the amount for a month in its own currency and in dollars.
//   steps = [[day, amount, (monthly amount named by the law)]]; rates = units of each currency for one US dollar
function rowOf(c, W, rates, today) {
  const step = lastOf(c.steps.filter(([from]) => from <= today));
  const next = c.steps.find(([from]) => from > today) || null;
  const perMonth = (s) => s[2] || (c.per === "month" ? s[1] : c.per === "day" ? s[1] * W.convert.days_per_month : s[1] * W.convert.hours_per_month);
  const rate = c.currency === "USD" ? 1 : rates ? rates[c.currency] : null;
  const usd = (local) => (rate ? local / rate : null);
  const low = c.low ? (c.per === "day" ? c.low * W.convert.days_per_month : c.low) : null;
  return { c, step, next, local: step ? perMonth(step) : null, usd: step ? usd(perMonth(step)) : null, lowUsd: low ? usd(low) : null, nextUsd: next ? usd(perMonth(next)) : null };
}

// "400 THB / day"
const legalText = (c, s, t) => `${amount(s[1])} ${c.currency}/${t["wg_per_" + c.per]}`;

// ---------- key numbers ----------
function tiles(e, rows, W, wages) {
  const { t } = e;
  const stats = el("div", "stats");
  const checked = W.checked;
  const lao = rows.find((r) => r.c.iso === "LAO");
  const tha = rows.find((r) => r.c.iso === "THA");
  const fxDate = wages && wages.fx && wages.fx.date;
  if (lao && lao.step) {
    stats.append(invTile(t, t.wg_k_lao, { num: mkip(lao.local), unit: t.pol_unit_mkip }, fill(t.wg_k_lao_sub, { usd: lao.usd ? whole(lao.usd) : "—", date: whenText(lao.step[0], t) }), freshness(t, { checked }), "official"));
  }
  const ranked = rows.filter((r) => r.usd !== null).sort((a, b) => b.usd - a.usd);
  if (lao && lao.usd && ranked.length > 3) {
    const rank = ranked.findIndex((r) => r.c.iso === "LAO") + 1;
    stats.append(invTile(t, t.wg_k_rank, `${rank} / ${ranked.length}`, t.wg_k_rank_sub, freshness(t, { date: fxDate, stale: wages.fx.stale }), "estimated"));
  }
  if (lao && lao.usd && tha && tha.usd) {
    stats.append(invTile(t, t.wg_k_thai, times(tha.usd / lao.usd), fill(t.wg_k_thai_sub, { rate: amount(tha.step[1]), kip: mkip(tha.usd * wages.fx.rates.LAK) }), freshness(t, { date: fxDate, stale: wages.fx.stale }), "estimated"));
  }
  // what the Lao minimum wage still buys: prices since the month it was last raised
  const real = realValue(e, lao);
  if (real) stats.append(invTile(t, t.wg_k_real, `${real.change < 0 ? "−" : "+"}${Math.abs(real.change).toFixed(1)}%`, fill(t.wg_k_real_sub, { cpi: real.cpi.toFixed(1), month: monthText(real.from, t) }), freshness(t, { month: real.to, stale: real.stale }), "estimated"));
  const avg = wages && wages.ilo_avg && wages.ilo_avg.latest && wages.ilo_avg.latest.LAO;
  if (avg) stats.append(invTile(t, t.wg_k_avg, { num: whole(avg.usd), unit: t.wg_unit_usd_month }, t.wg_k_avg_sub, freshness(t, { year: avg.year, stale: wages.ilo_avg.stale }), "official"));
  const review = e.stat.policy && e.stat.policy.areas.flatMap((a) => a.items).find((i) => i.id === "review" && i.labour);
  if (review) {
    const offers = [review.labour, review.government, review.employers];
    stats.append(invTile(t, t.wg_k_review, range((Math.min(...offers) / 1e6).toFixed(1), (Math.max(...offers) / 1e6).toFixed(1)), `${t.pol_unit_mkip} · ${fill(t.wg_k_review_sub, { date: dayFull(review.date, t) })}`, freshness(t, { checked: e.stat.policy.checked || e.stat.checked }), "official"));
  }
  return stats;
}

// Prices in Laos since the month the minimum wage was last raised -> { from, to, cpi (% rise), change (% of buying power) }
function realValue(e, lao) {
  const idx = e.economy.monthly && e.economy.monthly.cpi_index;
  if (!lao || !lao.step || lao.step[0].length < 7 || !idx || !idx.values.length) return null;
  const from = lao.step[0].slice(0, 7);
  const start = new Map(idx.values).get(from);
  const last = lastOf(idx.values);
  if (!start || last[0] <= from) return null;
  const cpi = (last[1] / start - 1) * 100;
  return { from, to: last[0], cpi, change: (start / last[1] - 1) * 100, value: (lao.local * start) / last[1], stale: !!idx.stale };
}

// ---------- what it means: sentences worked out from the numbers ----------
function meaningCard(e, rows, W, wages, fuel) {
  const { t } = e;
  const facts = [];
  const lao = rows.find((r) => r.c.iso === "LAO");
  const tha = rows.find((r) => r.c.iso === "THA");
  const rates = wages && wages.fx ? wages.fx.rates : null;
  if (lao && lao.usd && tha && tha.usd && tha.lowUsd && rates) {
    facts.push([fill(t.wg_f_thai, { low: amount(tha.c.low), high: amount(tha.step[1]), low_kip: mkip(tha.lowUsd * rates.LAK), high_kip: mkip(tha.usd * rates.LAK), low_x: times(tha.lowUsd / lao.usd), high_x: times(tha.usd / lao.usd) }), null]);
  }
  const real = realValue(e, lao);
  if (real) facts.push([fill(t.wg_f_real, { date: whenText(lao.step[0], t), cpi: real.cpi.toFixed(1), month: monthText(real.to, t), wage: whole(lao.local), value: whole(Math.round(real.value / 1000) * 1000) }), null]);
  // litres of regular petrol that one month of minimum wage buys, at the pump prices of today
  const laoPetrol = fuel && fuel.capital && fuel.capital.latest && fuel.capital.latest.regular;
  const thaiPetrol = e.summary && e.summary.metrics["fuel-thai.gasohol91"];
  if (lao && lao.local && laoPetrol && tha && tha.local && thaiPetrol) {
    facts.push([fill(t.wg_f_fuel, { la: whole(lao.local / laoPetrol), th: whole(tha.local / thaiPetrol.latest.value), la_price: whole(laoPetrol), th_price: thaiPetrol.latest.value.toFixed(2) }), null]);
  }
  // kip against dollars: the ILO's yearly series
  const s = wages && wages.ilo_min && wages.ilo_min.series && wages.ilo_min.series.LAO;
  if (s && s.usd.length > 5) {
    const end = lastOf(s.usd);
    const start = s.usd.find(([y]) => y === end[0] - 5);
    const lcu = new Map(s.lcu);
    if (start && lcu.has(start[0]) && lcu.has(end[0])) {
      const pct = (a, b) => `${b >= a ? "+" : "−"}${Math.abs(((b - a) / a) * 100).toFixed(0)}%`;
      facts.push([fill(t.wg_f_kip, { y0: start[0], y1: end[0], lcu0: whole(lcu.get(start[0])), lcu1: whole(lcu.get(end[0])), usd0: whole(start[1]), usd1: whole(end[1]), lcu_pct: pct(lcu.get(start[0]), lcu.get(end[0])), usd_pct: pct(start[1], end[1]) }), null]);
    }
  }
  const avg = wages && wages.ilo_avg && wages.ilo_avg.latest;
  if (avg && avg.LAO && avg.THA && avg.VNM) facts.push([fill(t.wg_f_avg, { la: whole(avg.LAO.usd), la_year: avg.LAO.year, th: whole(avg.THA.usd), th_year: avg.THA.year, vn: whole(avg.VNM.usd), vn_year: avg.VNM.year }), null]);
  if (!facts.length) return null;
  return factsCard(t, t.wg_meaning_title, facts, t.wg_meaning_note);
}

// ---------- the minimum wage in force today, every country ----------
function todayCard(e, rows, W, wages) {
  const { t } = e;
  const lao = rows.find((r) => r.c.iso === "LAO");
  const rates = wages && wages.fx ? wages.fx.rates : null;
  // highest first; a country without a general minimum wage comes last
  const sorted = [...rows].sort((a, b) => (a.usd === null) - (b.usd === null) || b.usd - a.usd);
  const list = sorted.map((r) => {
    const { c, step, next } = r;
    const parts = [];
    if (step) {
      if (rates && r.usd !== null) parts.push(fill(t.wg_row_kip, { kip: mkip(r.usd * rates.LAK) }));
      parts.push(`${legalText(c, step, t)} · ${fill(t.wg_row_since, { date: whenText(step[0], t) })}`);
    }
    parts.push(fill(t["wg_note_" + c.iso] || "", { ...c, low: c.low ? amount(c.low) : "", prev: c.prev ? amount(c.prev) : "", lqs: c.lqs ? amount(c.lqs) : "", weekly: c.weekly ? amount(c.weekly) : "" }));
    if (next) parts.push(fill(t.wg_row_next, { amount: legalText(c, next, t), date: whenText(next[0], t) }));
    return {
      label: `${countryName(t, null, c.iso)}${c.kind === "national" || c.kind === "none" ? "" : " *"}`,
      cls: c.iso === "LAO" ? "focus-name" : "",
      sub: parts.filter(Boolean).join(" · "),
      value: r.usd,
      text: r.usd === null ? (step ? legalText(c, step, t) : "—") : whole(r.usd),
      share: r.usd !== null && lao && lao.usd ? (c.iso === "LAO" ? "1×" : times(r.usd / lao.usd)) : "—",
    };
  });
  const c = card("official");
  c.append(cardHead(t.wg_today_title, "official", !!(wages && wages.fx && wages.fx.stale), t));
  const tb = barTable([t.rw_col_country, t.wg_col_usd, t.wg_col_times], list);
  tb.classList.add("wage-table");
  c.append(tb);
  const notes = el("ul", "watch-list");
  for (const k of ["wg_today_note_star", "wg_today_note_month", "wg_today_note_fx"]) {
    notes.append(el("li", "", fill(t[k], { hours: W.convert.hours_per_month, days: W.convert.days_per_month, date: wages && wages.fx && wages.fx.date ? dayFull(wages.fx.date, t) : "—", rate: rates ? whole(rates.LAK) : "—" })));
  }
  c.append(notes);
  // one source per country: a list that opens on demand (17 links would bury the card)
  const details = el("details");
  details.append(el("summary", "", fill(t.wg_sources_summary, { n: rows.length })));
  const ul = el("ul", "source-list");
  for (const r of rows) {
    const src = staticSource(e, r.c.source);
    if (!src) continue;
    const li = el("li", "", `${countryName(t, null, r.c.iso)}: `);
    li.append(sourceLink(src));
    ul.append(li);
  }
  details.append(ul);
  c.append(details);
  const fresh = el("div", "card-foot");
  fresh.append(freshness(t, { checked: W.checked }));
  c.append(fresh, sourcesFoot(t, [wages && wages.sources && wages.sources.fx]));
  return c;
}

// ---------- Thailand by province ----------
function thailandCard(e, rows, W, wages) {
  const { t } = e;
  const th = W.thailand;
  const rates = wages && wages.fx ? wages.fx.rates : null;
  const lao = rows.find((r) => r.c.iso === "LAO");
  if (!th || !rates || !lao || !lao.usd) return null;
  const list = th.rows.map(([name, rate, group]) => {
    const kip = ((rate * W.convert.days_per_month) / rates.THB) * rates.LAK;
    const label = el("span", "", name.split(", ").map((n) => t.wg_th_provinces[n] || n).join(" · "));
    label.append(el("span", "sub-line", t["wg_th_group_" + group]));
    return [label, String(rate), mkip(kip), times(kip / lao.local)];
  });
  const c = card("official");
  c.append(cardHead(t.wg_th_title, "official", false, t));
  const tb = table([t.wg_th_col_province, t.wg_th_col_day, t.wg_th_col_kip, t.wg_col_times], list);
  tb.classList.add("wrap-first");
  c.append(tb, el("p", "note", fill(t.wg_th_note, { notice: th.notice, hotel: th.hotel, date: dayFull(th.from, t), days: W.convert.days_per_month, rate: (rates.LAK / rates.THB).toFixed(0) })));
  const fresh = el("div", "card-foot");
  fresh.append(freshness(t, { checked: W.checked }));
  c.append(fresh, sourcesFoot(t, [staticSource(e, th.source)]));
  return c;
}

// ---------- the ILO's series: the same method for every country, by year ----------
function trendChart(e, wages) {
  const { t } = e;
  const all = wages && wages.ilo_min && wages.ilo_min.series;
  if (!all || !all.LAO || all.LAO.usd.length < 3) return null;
  const lines = TREND.filter(([iso]) => all[iso] && all[iso].usd.length);
  const years = [...new Set(lines.flatMap(([iso]) => all[iso].usd.map(([y]) => y)))].sort((a, b) => a - b);
  return chartCard({
    title: t.wg_trend_title,
    subtitle: `${t.unit}: ${t.wg_unit_usd_month} · ${t.source}: ILO · ${t.wg_trend_sub}${wages.ilo_min.stale ? " · ⚠ " + t.inv_fetch_failed : ""}`,
    labels: years.map(String),
    series: lines.map(([iso, color]) => {
      const m = new Map(all[iso].usd);
      return { label: countryName(t, null, iso), kind: "official", color, values: years.map((y) => (m.has(y) ? m.get(y) : null)) };
    }),
    unit: "USD per month",
    unitLabel: t.wg_unit_usd_month,
    t,
    firstColTitle: t.year,
  });
}

// ---------- what an average employee earns (ILO) ----------
// The average earnings of one country in one given year, or null when the ILO has no number for that year.
//   avg = data/wages.json "ilo_avg": latest { ISO: { year, usd } } and (newer files) series { ISO: [[year, usd]] }
export function earningsIn(avg, iso, year) {
  const now = avg.latest && avg.latest[iso];
  if (now && now.year === year) return now.usd;
  const hit = avg.series && avg.series[iso] && avg.series[iso].find(([y]) => y === year);
  return hit ? hit[1] : null;
}

function averageCard(e, rows, wages) {
  const { t } = e;
  const latest = wages && wages.ilo_avg && wages.ilo_avg.latest;
  if (!latest || !latest.LAO) return null;
  const data = rows.filter((r) => latest[r.c.iso]).map((r) => ({ iso: r.c.iso, ...latest[r.c.iso] })).sort((a, b) => b.usd - a.usd);
  // "x times Laos" only within ONE year: the value each country had in the year of Laos' own number (the newest
  // years differ - Laos 2022, Thailand 2025 - and a ratio across years is not a comparison). No value for that
  // year = a dash. The bar and the number of a row stay the country's newest year, with that year named.
  const base = latest.LAO.year;
  const multiple = (r) => {
    if (r.iso === "LAO") return "1×";
    const usd = earningsIn(wages.ilo_avg, r.iso, base);
    if (usd === null) return "—";
    const cell = el("span", "", times(usd / latest.LAO.usd));
    if (r.year !== base) cell.append(el("span", "sub-line", fill(t.wg_avg_same, { usd: whole(usd), year: base })));
    return cell;
  };
  const list = data.map((r) => ({
    label: countryName(t, null, r.iso),
    cls: r.iso === "LAO" ? "focus-name" : "",
    sub: fill(t.wg_avg_row, { year: r.year }),
    value: r.usd,
    text: whole(r.usd),
    share: multiple(r),
  }));
  const c = card("official");
  c.append(cardHead(t.wg_avg_title, "official", !!wages.ilo_avg.stale, t));
  const missing = rows.filter((r) => !latest[r.c.iso]).map((r) => countryName(t, null, r.c.iso));
  c.append(barTable([t.rw_col_country, t.wg_col_usd, fill(t.wg_col_times_same, { year: base })], list), el("p", "note", fill(t.wg_avg_note, { year: base, missing: missing.join(", ") || "—" })));
  const fresh = el("div", "card-foot");
  // the label shows the year of Laos' own number: the row everything is compared with
  fresh.append(freshness(t, { year: latest.LAO.year, stale: wages.ilo_avg.stale }));
  c.append(fresh, sourcesFoot(t, [wages.sources.ilo]));
  return c;
}

// ---------- how to read these numbers ----------
function howCard(t) {
  const c = card("estimated");
  c.append(cardHead(t.wg_how_title, null, false, t));
  const ul = el("ul", "watch-list");
  for (const k of ["wg_how_1", "wg_how_2", "wg_how_3", "wg_how_4"]) ul.append(el("li", "", t[k]));
  c.append(ul);
  return c;
}

export function wagesTab(panel, e) {
  const { t } = e;
  panel.append(el("p", "muted tab-intro", t.wg_intro));
  const file = lazyJson("data/wages.json", e.rerender);
  const fuelFile = lazyJson("data/fuel-lao.json", e.rerender);
  if (e.statState === "error" || (e.statState === "ok" && !e.stat.wages)) {
    panel.append(el("p", "muted", t.inv_load_error));
    return;
  }
  if (e.statState !== "ok" || file.state === "loading" || fuelFile.state === "loading") {
    const sk = el("div", "skeleton");
    sk.append(el("div"), el("div"), el("div"));
    panel.append(sk);
    return;
  }
  const W = e.stat.wages;
  const wages = file.state === "ok" ? file.data : null; // without it: the legal amounts only, no dollars
  const fuel = fuelFile.state === "ok" ? fuelFile.data : null;
  const today = todayVientiane();
  const rows = W.countries.map((c) => rowOf(c, W, wages && wages.fx && wages.fx.rates, today));
  if (!wages) panel.append(el("p", "muted", t.wg_no_rates));
  const add = (...nodes) => panel.append(...nodes.filter(Boolean));
  const two = (...nodes) => {
    const grid = el("div", "grid grid-2");
    grid.append(...nodes.filter(Boolean));
    if (grid.childNodes.length) panel.append(grid);
  };
  add(tiles(e, rows, W, wages), meaningCard(e, rows, W, wages, fuel));
  panel.append(el("h2", "section-title", t.wg_sec_today));
  add(todayCard(e, rows, W, wages));
  two(thailandCard(e, rows, W, wages), howCard(t));
  panel.append(el("h2", "section-title", t.wg_sec_time));
  two(trendChart(e, wages), averageCard(e, rows, wages));
}
