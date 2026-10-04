// Cost of living page - parts added in version 2 (Oct 2026) + helpers shared with living.js:
//   factsBox          - "what you should know": short sentences computed from the data (never typed in)
//   fuelSection       - fuel in Laos (official pump prices, data/fuel-lao.json) vs Thailand (in kip), tomorrow's
//                       Thai price, the official Lao prices over time, trend vs world oil
//   inflationCompare  - inflation Laos vs Thailand (monthly) + world (IMF yearly)
//   budgetSection     - monthly budget: the same shopping basket in Laos (WFP) and Bangkok (Thai ministry)
// Everything shows the past or today's prices; nothing here is a forecast or financial advice.

import { el, card, cardHead, cardFoot, sourceLink, sectionTitle, table, pctPill, outLink } from "../ui.js";
import { formatNumber, formatPct, formatDate, todayVientiane, addDays } from "../format.js";
import { chartCard } from "../charts.js";
import { realRate } from "../calc.js";
import { PROVINCES, dayFull, freshness, fill } from "./eco-common.js";
import { inflationSeries } from "./eco-latest.js";

// ---------- Shared helpers ----------
export const monthText = (m, t) => `${t.months[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`; // "2026-08" -> "ส.ค. 2026"
export const monthShort = (m, t) => `${t.months[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`; // "ส.ค. 26" (chart axis)
export const addMonths = (m, n) => {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
export const lastOf = (values) => (values && values.length ? values[values.length - 1] : null);
export const pct = (from, to) => ((to - from) / from) * 100;
// Table whose first column (long names) may wrap, so the numbers still fit a phone screen
export const nameTable = (headers, rows) => {
  const wrap = table(headers, rows);
  wrap.classList.add("wrap-first");
  return wrap;
};
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode */
    }
  },
};

// ---------- Thai prices (data/thai-prices.json), loaded only on this page ----------
let thai = null;
let thaiState = "idle";
export function loadThai(rerender) {
  if (thaiState !== "idle") return;
  thaiState = "loading";
  fetch("data/thai-prices.json", { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
    .then((data) => {
      thai = data;
      thaiState = "ok";
    })
    .catch(() => {
      thaiState = "error";
    })
    .finally(rerender);
}

// ---------- Prices of one item ----------
const FUEL_THAI = { diesel: "diesel", petrol: "gasohol91" }; // Lao item -> Thai fuel metric ("petrol" = regular, 91 octane)
// The three fuels of the Lao notices -> the Thai pump price they are compared with
const LAO_FUELS = [
  ["premium", "fuel_premium", "gasohol95"],
  ["regular", "fuel_regular", "gasohol91"],
  ["diesel", "fuel_diesel", "diesel"],
];

// Official pump price in Vientiane Capital (data/fuel-lao.json). "petrol" = regular petrol, the grade most people buy.
// fuel: the content of the file, or null while it is not there
export function officialFuel(fuel, id) {
  const latest = fuel && fuel.capital && fuel.capital.latest;
  const value = latest ? (id === "diesel" ? latest.diesel : id === "petrol" ? latest.regular : null) : null;
  return value ? { value, date: latest.date } : null;
}

// Lao price (LAK per unit) of an item in a market (or the national average): newest month with a value.
// Fuel: the official pump price when it is there; else the WFP national estimate (newer than the market survey).
export function laoPrice(prices, id, market, fuel) {
  const off = officialFuel(fuel, id);
  if (off) return { value: off.value, month: off.date.slice(0, 7), date: off.date, estimate: false, official: true };
  const m = prices && prices.market;
  if (!m || !m.prices || !m.prices[id]) return null;
  const series = m.prices[id][market] || m.prices[id][prices.national_id];
  let found = null;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i] !== null) {
      found = { value: series[i], month: m.months[i], estimate: false };
      break;
    }
  }
  const est = prices.fuel_estimate && prices.fuel_estimate.values && lastOf(prices.fuel_estimate.values[id]);
  if (est && (!found || est[0] > found.month)) return { value: est[1], month: est[0], estimate: true };
  return found;
}

// Thai price in LAK per unit (Bangkok), converted with the market THB→LAK rate
export function thaiPriceLak(summary, id) {
  const rate = summary.metrics["fx-market.THB_LAK"];
  if (!rate) return null;
  if (FUEL_THAI[id]) {
    const f = summary.metrics["fuel-thai." + FUEL_THAI[id]];
    return f ? { value: f.latest.value * rate.latest.value, thb: f.latest.value, date: f.latest.source_date } : null;
  }
  const it = thai && thai.items && thai.items[id];
  if (!it || !it.latest) return null;
  return { value: it.latest.value * rate.latest.value, thb: it.latest.value, date: it.latest.date };
}

// ---------- Budget basket (default = 1 person, 1 month; fuel is per household) ----------
const BASKET = [
  ["rice_glutinous", 10],
  ["rice_ordinary", 2],
  ["pork", 2],
  ["chicken", 2],
  ["beef", 1],
  ["eggs", 30],
  ["fish", 2],
  ["sugar", 1],
  ["cooking_oil", 1],
  ["garlic", 0.5],
  ["petrol", 30],
  ["diesel", 0],
];
const HOUSEHOLD_ITEMS = new Set(["petrol", "diesel"]); // not multiplied by the number of people
const budget = {
  qty: { ...Object.fromEntries(BASKET), ...store.get("budget_qty", {}) },
  people: store.get("budget_people", 1),
  other: store.get("budget_other", 0), // rent, electricity, ... (LAK)
  salary: store.get("budget_salary", 0),
  salaryCur: store.get("budget_salary_cur", "LAK"),
};

// Totals of the basket: Lao total, and Lao vs Thai for the items that have BOTH prices
function basketTotals(prices, summary, market, fuel) {
  let lao = 0;
  let laoComparable = 0;
  let thaiComparable = 0;
  const rows = [];
  for (const [id] of BASKET) {
    const q = (budget.qty[id] || 0) * (HOUSEHOLD_ITEMS.has(id) ? 1 : budget.people);
    const lp = laoPrice(prices, id, market, fuel);
    const tp = thaiPriceLak(summary, id);
    const laoCost = lp ? lp.value * q : null;
    const thaiCost = tp ? tp.value * q : null;
    if (laoCost !== null) lao += laoCost;
    if (laoCost !== null && thaiCost !== null) {
      laoComparable += laoCost;
      thaiComparable += thaiCost;
    }
    rows.push({ id, q, lp, tp, laoCost, thaiCost });
  }
  return { rows, lao, laoComparable, thaiComparable };
}

// ---------- 1) Facts ----------
export function factsBox(ctx, prices, market) {
  const { t, economy: eco, summary, fuel } = ctx;
  const mon = eco.monthly || {};
  const facts = [];
  const add = (text, pill) => facts.push([text, pill]);

  // fuel first: it moves every other price
  const ld = laoPrice(prices, "diesel", prices ? prices.national_id : null, fuel);
  const td = thaiPriceLak(summary, "diesel");
  if (ld && td) add(t.fact_diesel.replace("{la}", formatNumber(ld.value, "LAK")).replace("{laMonth}", ld.official ? formatDate(ld.date, t) : monthText(ld.month, t)).replace("{th}", formatNumber(td.value, "LAK")).replace("{thDate}", formatDate(td.date, t)), pctPill(pct(td.value, ld.value), { decimals: 1 }));

  const laAll = inflationSeries(ctx); // the same "newest inflation" as every other page (eco-latest.js)
  const la = laAll && laAll.last;
  const th = lastOf(mon.tha_cpi_yoy && mon.tha_cpi_yoy.values);
  if (la && th) add(t.fact_inflation.replace("{la}", formatPct(la[1], 1)).replace("{laMonth}", monthText(la[0], t)).replace("{th}", formatPct(th[1], 1)).replace("{thMonth}", monthText(th[0], t)), null);

  if (prices && thai) {
    const b = basketTotals(prices, summary, market, fuel);
    if (b.thaiComparable > 0) add(t.fact_basket, pctPill(pct(b.thaiComparable, b.laoComparable), { decimals: 1 }));
  }

  const cats = Object.entries(mon).filter(([id, s]) => id.startsWith("cpi_cat_") && s.values.length);
  const top = cats.map(([id, s]) => [id, lastOf(s.values)]).sort((a, b) => b[1][1] - a[1][1])[0];
  if (top) add(t.fact_fastest.replace("{cat}", t.cpi_cats[top[0]]), pctPill(top[1][1], { decimals: 1 }));

  const dep = summary.metrics["bcel-deposit.LAK_fixed_12m"];
  if (dep && la) {
    const real = realRate(dep.latest.value, la[1]);
    add(t.fact_deposit.replace("{rate}", `${dep.latest.value.toFixed(2)}%`), pctPill(real, { decimals: 1 }));
  }
  const brent = mon.brent_usd && mon.brent_usd.values;
  if (brent && brent.length > 12) {
    const now = lastOf(brent);
    const ago = brent[brent.length - 13];
    add(t.fact_brent.replace("{usd}", now[1].toFixed(1)).replace("{month}", monthText(now[0], t)), pctPill(pct(ago[1], now[1]), { decimals: 1 }));
  }
  if (!facts.length) return null;

  const c = card("estimated", "facts-card");
  c.append(cardHead(t.facts_title, "estimated", false, t));
  const ul = el("ul", "facts");
  for (const [text, pill] of facts) {
    const li = el("li");
    li.append(el("span", "", text));
    if (pill) li.append(pill);
    ul.append(li);
  }
  c.append(ul, el("p", "note", t.facts_note));
  return c;
}

// ---------- 2) Fuel ----------
const NOTICE_LATE_DAYS = 8; // notices come weekly: a newest notice older than this may already have a successor

// Thai pump price of one fuel in kip, or null
function thaiFuelLak(summary, metric) {
  const rate = summary.metrics["fx-market.THB_LAK"];
  const m = summary.metrics["fuel-thai." + metric];
  return rate && m ? m.latest.value * rate.latest.value : null;
}

// The official pump prices in Vientiane Capital (the ministry's notices, data/fuel-lao.json) + the price list of
// the state fuel company for every province
function officialFuelCard(ctx) {
  const { t, summary, fuel } = ctx;
  const cap = fuel.capital;
  const now = cap.latest;
  const c = card("official");
  c.append(cardHead(t.fuel_off_title, "official", false, t));

  // which notice the prices come from
  const from = el("p", "note fuel-notice");
  if (now.from === "notice" && now.notice) {
    from.append(fill(t.fuel_off_notice, { no: now.notice.no, date: dayFull(now.notice.date, t), from: dayFull(now.date, t) }), " · ");
    from.append(outLink(t.fuel_off_open, now.notice.url));
  } else from.append(fill(t.fuel_off_company, { date: dayFull(now.date, t) }));
  c.append(from);

  const before = cap.previous; // [day, premium, regular, diesel]
  LAO_FUELS.forEach(([id, key, thaiMetric], i) => {
    if (!now[id]) return; // (in the 2026 crisis only two fuels were priced)
    const row = el("div", "row");
    row.append(el("span", "row-label", t[key]));
    const right = el("div", "row-right");
    const value = el("div", "value", formatNumber(now[id], "LAK"));
    value.append(el("span", "unit", `LAK / ${t.units.L}`));
    right.append(value);
    if (before && before[i + 1]) {
      // whole kip: "+280 (+0.65%)"
      const diff = now[id] - before[i + 1];
      const change = pct(before[i + 1], now[id]);
      const line = el("div", "change");
      line.append(pctPill(change, { text: diff === 0 ? "0" : `${diff > 0 ? "+" : "−"}${Math.abs(diff).toLocaleString("en-US")} (${formatPct(change)})` }), el("span", "vs", fill(t.fuel_off_change, { date: formatDate(before[0], t) })));
      right.append(line);
    }
    const thai = thaiFuelLak(summary, thaiMetric);
    if (thai) {
      const line = el("div", "change");
      line.append(el("span", "vs", t.fuel_vs_thai), pctPill(pct(thai, now[id]), { decimals: 1 }));
      right.append(line);
    }
    row.append(right);
    c.append(row);
  });

  // The ministry issues a notice about once a week but puts it on its page with some delay: when the newest
  // notice on the page is older than that, a newer one may exist that nobody can read here yet
  const newest = fuel.notices && fuel.notices.latest ? fuel.notices.latest.date : null;
  const age = newest ? Math.round((Date.parse(todayVientiane() + "T00:00:00Z") - Date.parse(newest + "T00:00:00Z")) / 86400000) : 0;
  if (age > NOTICE_LATE_DAYS) c.append(el("p", "note", fill(t.fuel_off_maybe_newer, { date: dayFull(newest, t), days: age })));

  // newer notices whose numbers could not be read with certainty: say so, and link to the newest
  if (cap.waiting) {
    const warn = el("div", "alert");
    const text = el("div", "", fill(t.fuel_off_waiting, { count: cap.waiting.count, no: cap.waiting.no, date: dayFull(cap.waiting.date, t) }) + " ");
    text.append(outLink(t.fuel_off_waiting_open, cap.waiting.url));
    warn.append(el("span", "", "⚠"), text);
    c.append(warn);
  }

  // every province (the state fuel company's list; it can be one or two notices behind)
  const prov = fuel.provinces;
  if (prov && prov.rows && prov.rows.length) {
    const byName = new Map(prov.rows.map((r) => [r[0], r]));
    const capital = byName.get("Vientiane Capital");
    const rows = PROVINCES.filter((p) => byName.has(p)).map((p) => {
      const [, , regular, diesel] = byName.get(p);
      // transport cost: the same for every fuel, so the first fuel that both rows have is enough
      const diff = capital ? (regular && capital[2] ? regular - capital[2] : diesel && capital[3] ? diesel - capital[3] : null) : null;
      return [t.provinces[p] || p, regular ? formatNumber(regular, "LAK") : "—", diesel ? formatNumber(diesel, "LAK") : "—", p === "Vientiane Capital" || diff === null ? "—" : `${diff >= 0 ? "+" : "−"}${formatNumber(Math.abs(diff), "LAK")}`];
    });
    const details = el("details", "fuel-provinces");
    details.append(el("summary", "", fill(t.fuel_prov_summary, { count: rows.length, date: dayFull(prov.date, t) })));
    details.append(nameTable([t.living_province, t.fuel_regular, t.fuel_diesel, t.fuel_col_vs_capital], rows));
    details.append(el("p", "note", (prov.date < now.date ? t.fuel_prov_older + " · " : "") + t.fuel_prov_note));
    c.append(details);
  }

  c.append(el("p", "note", t.fuel_off_note));
  const fresh = el("div", "card-foot");
  fresh.append(freshness(t, { date: now.date, stale: !!(cap.stale || (fuel.notices && fuel.notices.stale)), checked: fuel.checked_at ? fuel.checked_at.slice(0, 10) : undefined }));
  c.append(fresh);
  const foot = el("div", "card-foot", `${t.source}: `);
  [fuel.sources.dit, fuel.sources.lsf].filter(Boolean).forEach((src, i) => {
    if (i > 0) foot.append(", ");
    foot.append(sourceLink(src));
  });
  c.append(foot);
  return c;
}

// The official prices over time: one point per price that is known, on a day-by-day axis
const FUEL_GAP_DAYS = 45; // points further apart than this are joined with a dotted line
function officialFuelChart(ctx, years) {
  const { t, fuel } = ctx;
  const history = fuel.capital.history || [];
  if (history.length < 2) return null;
  const last = history[history.length - 1][0];
  const wanted = addDays(last, -365 * years);
  const rows = history.filter((r) => r[0] >= wanted);
  if (rows.length < 2) return null;
  const days = [];
  for (let d = rows[0][0]; d <= last; d = addDays(d, 1)) days.push(d);
  const byDay = new Map(rows.map((r) => [r[0], r]));
  const line = (col) => days.map((d) => (byDay.has(d) ? byDay.get(d)[col] : null));
  const company = rows.filter((r) => r[4] === null).length;
  return chartCard({
    title: t.fuel_chart_title,
    subtitle: `${fill(t.fuel_chart_sub, { points: rows.length, company, gap: FUEL_GAP_DAYS })}`,
    labels: days.map((d) => dayFull(d, t)),
    tickLabels: days.map((d) => monthShort(d.slice(0, 7), t)),
    series: [
      { label: t.fuel_regular, kind: "official", color: "--cat-1", gap: FUEL_GAP_DAYS, values: line(2) },
      { label: t.fuel_diesel, kind: "official", color: "--cat-3", gap: FUEL_GAP_DAYS, values: line(3) },
      { label: t.fuel_premium, kind: "official", color: "--cat-4", gap: FUEL_GAP_DAYS, values: line(1) },
    ],
    unit: "LAK",
    unitLabel: `${t.lak_per} 1 ${t.units.L}`,
    t,
    snap: true,
  });
}

function laoFuelCard(ctx, prices) {
  const { t, summary } = ctx;
  const c = card("estimated");
  c.append(cardHead(t.fuel_lao_title, "estimated", false, t));
  for (const [id, key] of [["diesel", "fuel_diesel"], ["petrol", "fuel_petrol"]]) {
    const lp = laoPrice(prices, id, prices.national_id, null);
    if (!lp) continue;
    const tp = thaiPriceLak(summary, id);
    const row = el("div", "row");
    row.append(el("span", "row-label", `${t[key]} (${monthText(lp.month, t)})`));
    const right = el("div", "row-right");
    const value = el("div", "value", formatNumber(lp.value, "LAK"));
    value.append(el("span", "unit", `LAK / ${t.units.L}`));
    right.append(value);
    if (tp) {
      const line = el("div", "change");
      line.append(el("span", "vs", t.fuel_vs_thai), pctPill(pct(tp.value, lp.value), { decimals: 1 }));
      right.append(line);
    }
    row.append(right);
    c.append(row);
  }
  c.append(el("p", "note", t.fuel_lao_note));
  if (prices.sources && prices.sources.wfp_realtime) {
    const foot = el("div", "card-foot", `${t.source}: `);
    foot.append(sourceLink(prices.sources.wfp_realtime));
    c.append(foot);
  }
  return c;
}

function thaiFuelCard(ctx) {
  const { t, summary } = ctx;
  const c = card("market");
  c.append(cardHead(t.fuel_thai_title, "market", false, t));
  const rate = summary.metrics["fx-market.THB_LAK"];
  const today = todayVientiane();
  for (const [metric, key] of [["diesel", "fuel_thai_diesel"], ["gasohol95", "fuel_thai_g95"], ["gasohol91", "fuel_thai_g91"]]) {
    const m = summary.metrics["fuel-thai." + metric];
    if (!m) continue;
    const row = el("div", "row");
    row.append(el("span", "row-label", t[key]));
    const right = el("div", "row-right");
    const value = el("div", "value", m.latest.value.toFixed(2));
    value.append(el("span", "unit", `THB / ${t.units.L}`));
    right.append(value);
    if (rate) right.append(el("div", "change", `≈ ${formatNumber(m.latest.value * rate.latest.value, "LAK")} LAK`));
    // Price already announced for tomorrow (only stored when it changes)
    const next = summary.metrics[`fuel-thai.${metric}_next`];
    if (next && next.latest.source_date > today) {
      const line = el("div", "change");
      line.append(el("span", "vs", `${t.fuel_tomorrow} (${formatDate(next.latest.source_date, t)}): ${next.latest.value.toFixed(2)}`), pctPill(pct(m.latest.value, next.latest.value)));
      right.append(line);
    }
    row.append(right);
    c.append(row);
  }
  c.append(el("p", "note", t.fuel_thai_note));
  c.append(cardFoot(["fuel-thai.diesel", "fx-market.THB_LAK"].filter((id) => summary.metrics[id]), summary, t));
  return c;
}

// Lao diesel vs world oil on one scale: every line = 100 at the start of the period.
// Diesel is priced in kip and crude oil in dollars: a line in kip against a line in dollars mixes the oil price with
// the fall of the kip. So the Lao diesel price is drawn a second time in dollars (the month's price ÷ the month's
// average BOL rate): kip line against dollar line = the kip, dollar line against crude oil = the oil price, taxes
// and transport (audit 2026-10-02, P2-6).
function fuelTrendChart(ctx, prices, years) {
  const { t, economy: eco } = ctx;
  const diesel = prices.fuel_estimate && prices.fuel_estimate.values && prices.fuel_estimate.values.diesel;
  const brent = eco.monthly && eco.monthly.brent_usd && eco.monthly.brent_usd.values;
  if (!diesel || !diesel.length || !brent || !brent.length) return null;
  const usd = new Map((eco.monthly.bol_usd_mid && eco.monthly.bol_usd_mid.values) || []);
  const dieselUsd = diesel.filter(([m]) => usd.has(m)).map(([m, v]) => [m, v / usd.get(m)]);
  const last = [lastOf(diesel)[0], lastOf(brent)[0]].sort().pop();
  const months = [];
  for (let m = addMonths(last, -12 * years + 1); m <= last; m = addMonths(m, 1)) months.push(m);
  const maps = { kip: new Map(diesel), usd: new Map(dieselUsd), brent: new Map(brent) };
  // every line = 100 in the SAME month (the first month of the period in which all of them have a value):
  // lines that start from different months could not be compared
  const lines = dieselUsd.length > 1 && months.some((m) => maps.usd.has(m)) ? ["kip", "usd", "brent"] : ["kip", "brent"];
  const base = months.find((m) => lines.every((k) => maps[k].has(m)));
  if (!base) return null;
  const index = (k) => months.map((m) => (maps[k].has(m) ? Math.round((maps[k].get(m) / maps[k].get(base)) * 1000) / 10 : null));
  return chartCard({
    title: t.fuel_trend_title,
    subtitle: fill(t.fuel_trend_sub, { base: monthText(base, t) }),
    labels: months.map((m) => monthText(m, t)),
    tickLabels: months.map((m) => monthShort(m, t)),
    series: [
      { label: t.fuel_trend_lao, kind: "estimated", color: "--cat-1", values: index("kip") },
      ...(lines.includes("usd") ? [{ label: t.fuel_trend_lao_usd, kind: "estimated", color: "--cat-4", dashed: true, values: index("usd") }] : []),
      { label: t.fuel_trend_brent, kind: "market", color: "--cat-3", values: index("brent") },
    ],
    unit: "index",
    t,
    firstColTitle: t.month,
  });
}

// controls: () => Node - the period buttons, placed directly above the chart they control
export function fuelSection(ctx, prices, years, view, controls) {
  const { t } = ctx;
  view.append(sectionTitle(t.fuel_title));
  if (!prices) {
    view.append(el("p", "muted", t.loading));
    return;
  }
  if (ctx.fuelState === "loading") {
    view.append(el("p", "muted", t.loading));
    return;
  }
  const official = ctx.fuel && ctx.fuel.capital && ctx.fuel.capital.latest;
  const grid = el("div", "grid grid-2");
  const left = el("div", "stack");
  // the official notices; when that file is not there, the monthly estimate of the WFP as before
  left.append(official ? officialFuelCard(ctx) : laoFuelCard(ctx, prices), thaiFuelCard(ctx));
  grid.append(left);
  const charts = [official ? officialFuelChart(ctx, years) : null, fuelTrendChart(ctx, prices, years)].filter(Boolean);
  if (charts.length) {
    const right = el("div", "stack");
    if (controls) right.append(controls());
    right.append(...charts);
    grid.append(right);
  }
  view.append(grid);
}

// ---------- 3) Inflation Laos vs Thailand (+ world, yearly) ----------
export function inflationCompare(ctx, years) {
  const { t, economy: eco } = ctx;
  const la = inflationSeries(ctx);
  const th = eco.monthly && eco.monthly.tha_cpi_yoy;
  if (!la || !th) return null;
  const last = lastOf(la.values)[0];
  const months = [];
  for (let m = addMonths(last, -12 * years + 1); m <= last; m = addMonths(m, 1)) months.push(m);
  const on = (s) => {
    const map = new Map(s.values);
    return months.map((m) => (map.has(m) ? map.get(m) : null));
  };
  const world = eco.indicators && eco.indicators["imf.PCPIPCH.WORLD"];
  const year = new Date().getFullYear();
  const w = world ? new Map(world.values).get(year) : undefined;
  return chartCard({
    title: t.infl_compare_title,
    subtitle: `${t.living_inflation_sub} · IMF${w !== undefined ? ` · ${t.infl_world} ${year}: ${formatPct(w, 1)} (${t.infl_imf_estimate})` : ""}`,
    labels: months.map((m) => monthText(m, t)),
    tickLabels: months.map((m) => monthShort(m, t)),
    series: [
      { label: t.infl_laos, kind: "official", color: "--cat-1", values: on(la) },
      { label: t.infl_thailand, kind: "official", color: "--cat-5", values: on(th) },
    ],
    unit: "%",
    unitLabel: t.unit_pct_yoy,
    t,
    firstColTitle: t.month,
  });
}

// ---------- 4) Monthly budget: same basket in Laos and Bangkok ----------
export function budgetSection(ctx, prices, market, placeName, view) {
  const { t, summary, fuel } = ctx;
  view.append(sectionTitle(t.budget_title));
  if (!prices || thaiState === "loading" || thaiState === "idle") {
    view.append(el("p", "muted", t.loading));
    return;
  }
  const rate = summary.metrics["fx-market.THB_LAK"];
  const c = card("estimated", "budget-card");
  c.append(cardHead(`${t.budget_card} · ${placeName}`, "estimated", false, t));
  c.append(el("p", "note", t.budget_intro));

  // Inputs: people, other costs, salary
  const inputs = el("div", "up-grid budget-inputs");
  const numberField = (label, value, step, onInput) => {
    const w = el("label", "up-field");
    w.append(el("span", "", label));
    const i = el("input");
    i.type = "number";
    i.inputMode = "decimal";
    i.min = "0";
    i.step = String(step);
    i.value = String(value);
    i.addEventListener("input", () => onInput(Math.max(0, Number(i.value) || 0)));
    w.append(i);
    return w;
  };
  inputs.append(
    numberField(t.budget_people, budget.people, 1, (v) => {
      budget.people = Math.max(1, Math.round(v));
      store.set("budget_people", budget.people);
      refresh();
    }),
    numberField(t.budget_other, budget.other, 100000, (v) => {
      budget.other = v;
      store.set("budget_other", v);
      refresh();
    }),
    numberField(`${t.budget_salary} (${budget.salaryCur})`, budget.salary, budget.salaryCur === "LAK" ? 100000 : 100, (v) => {
      budget.salary = v;
      store.set("budget_salary", v);
      refresh();
    })
  );
  const curToggle = el("div", "segmented small-seg");
  for (const cur of ["LAK", "THB"]) {
    const b = el("button", "", cur);
    b.type = "button";
    b.setAttribute("aria-pressed", String(budget.salaryCur === cur));
    b.addEventListener("click", () => {
      budget.salaryCur = cur;
      store.set("budget_salary_cur", cur);
      ctx.rerender();
    });
    curToggle.append(b);
  }
  const curWrap = el("div", "up-field");
  curWrap.append(el("span", "", t.budget_salary_cur), curToggle);
  inputs.append(curWrap);
  c.append(inputs);

  // Table: item | qty | Laos | Bangkok | difference
  const tbl = el("table");
  const head = el("tr");
  for (const h of [t.col_item, t.budget_qty, t.budget_laos, t.budget_bkk, t.budget_diff]) head.append(el("th", "", h));
  tbl.appendChild(el("thead")).append(head);
  const body = tbl.appendChild(el("tbody"));
  const cells = {};
  for (const [id] of BASKET) {
    const tr = el("tr");
    const unit = prices.market.items[id] ? prices.market.items[id].unit : "KG";
    const name = el("td");
    name.append(el("span", "", (t.items[id] || id).replace(/ (?=\d)/g, "\u00a0"))); // keep "(เกรด 1)" on one line
    name.append(el("span", "sub-line", `/ ${t.units[unit] || unit}${HOUSEHOLD_ITEMS.has(id) ? " · " + t.budget_household : ""}`));
    const qtyTd = el("td");
    const q = el("input", "qty-input");
    q.type = "number";
    q.inputMode = "decimal";
    q.min = "0";
    q.step = unit === "Unit" ? "1" : "0.5";
    q.value = String(budget.qty[id] ?? 0);
    q.setAttribute("aria-label", `${t.budget_qty} ${t.items[id] || id}`);
    q.addEventListener("input", () => {
      budget.qty[id] = Math.max(0, Number(q.value) || 0);
      store.set("budget_qty", budget.qty);
      refresh();
    });
    qtyTd.append(q);
    cells[id] = { lao: el("td"), bkk: el("td"), diff: el("td") };
    tr.append(name, qtyTd, cells[id].lao, cells[id].bkk, cells[id].diff);
    body.append(tr);
  }
  const foot = el("tr", "total-row");
  const totalCells = { label: el("td", "", t.budget_total), lao: el("td"), bkk: el("td"), diff: el("td") };
  totalCells.label.colSpan = 2; // label uses the empty quantity column too
  foot.append(totalCells.label, totalCells.lao, totalCells.bkk, totalCells.diff);
  tbl.appendChild(el("tfoot")).append(foot);
  const wrap = el("div", "table-wrap wrap-first budget-table");
  wrap.append(tbl);
  // table + (summary, notes): one column on phones, side by side on wide screens
  const summaryBox = el("div", "budget-summary");
  const notes = el("p", "note");
  const side = el("div", "budget-side");
  side.append(summaryBox, notes);
  const srcFoot = el("div", "card-foot", `${t.source}: `);
  const links = [prices.sources && prices.sources.wfp_markets, thai && thai.source, summary.sources["fx-market"]].filter(Boolean);
  links.forEach((src, i) => {
    if (i > 0) srcFoot.append(", ");
    srcFoot.append(sourceLink(src));
  });
  side.append(srcFoot);
  const layout = el("div", "budget-body");
  layout.append(wrap, side);
  c.append(layout);

  // kip amounts: whole kip, millions shortened ("1.89 ล้าน")
  const mil = (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(2)} ${t.million}` : Math.round(v).toLocaleString("en-US"));
  function refresh() {
    const b = basketTotals(prices, summary, market, fuel);
    for (const r of b.rows) {
      const cc = cells[r.id];
      cc.lao.textContent = r.laoCost === null ? "—" : mil(r.laoCost);
      cc.bkk.textContent = r.thaiCost === null ? "—" : mil(r.thaiCost);
      cc.diff.replaceChildren(r.laoCost !== null && r.thaiCost !== null && r.thaiCost > 0 ? pctPill(pct(r.thaiCost, r.laoCost), { decimals: 0, plain: true }) : "—");
    }
    totalCells.lao.textContent = mil(b.laoComparable);
    totalCells.bkk.textContent = mil(b.thaiComparable);
    totalCells.diff.replaceChildren(b.thaiComparable > 0 ? pctPill(pct(b.thaiComparable, b.laoComparable), { decimals: 0 }) : "—");

    // Summary lines: [label, main value (text or pill), smaller line under it]
    const monthTotal = b.lao + budget.other;
    const whole = (v) => Math.round(v).toLocaleString("en-US");
    const lines = [];
    lines.push([t.budget_sum_month, `${whole(monthTotal)} LAK`, rate ? `≈ ${whole(monthTotal / rate.latest.value)} THB` : ""]);
    if (b.thaiComparable > 0) lines.push([t.budget_sum_compare, pctPill(pct(b.thaiComparable, b.laoComparable), { decimals: 1 }), `${mil(b.laoComparable)} vs ${mil(b.thaiComparable)}`]);
    if (budget.salary > 0) {
      const salaryLak = budget.salaryCur === "THB" && rate ? budget.salary * rate.latest.value : budget.salary;
      lines.push([t.budget_sum_salary, `${((monthTotal / salaryLak) * 100).toFixed(0)}%`, ""]);
    }
    summaryBox.replaceChildren(
      ...lines.map(([label, main, sub]) => {
        const row = el("div", "row");
        row.append(el("span", "row-label", label));
        const right = el("div", "row-right");
        if (typeof main === "string") right.append(el("div", "value small-value", main));
        else right.append(main);
        if (sub) right.append(el("div", "change", sub));
        row.append(right);
        return row;
      })
    );

    // Where the numbers come from
    const laoMonth = lastOf(prices.market.months);
    const petrol = laoPrice(prices, "petrol", market, fuel);
    const thaiDate = thai && Object.values(thai.items || {}).map((x) => x.latest && x.latest.date).filter(Boolean).sort().pop();
    notes.textContent = t.budget_note
      .replace("{laoMonth}", laoMonth ? monthText(laoMonth, t) : "—")
      .replace("{fuel}", !petrol ? "" : petrol.official ? t.budget_note_fuel_official.replace("{date}", formatDate(petrol.date, t)) : t.budget_note_fuel_wfp.replace("{fuelMonth}", monthText(petrol.month, t)))
      .replace("{thaiDate}", thaiDate ? formatDate(thaiDate, t) : "—")
      .replace("{rate}", rate ? rate.latest.value.toFixed(2) : "—");
  }
  refresh();
  view.append(c);
}
