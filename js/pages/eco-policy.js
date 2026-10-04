// Economy tab: policy - what the State has decided, since when, which numbers it moves, and where on this site
// the effect can be watched.
//   data/invest-static.json "policy": hand-checked facts from named reports, laws and official notices (the numbers
//       and dates there, the sentences in i18n "pol_*")
//   data/bol-policy.json (weekly, scripts/fetch-bol-policy.js): the central bank's policy rate and reserve
//       requirement (every change with its date), its foreign-exchange reserves by month and this year's inflation
//       month by month - all read from the bank's own website
//   data/fuel-lao.json (every few hours, scripts/fetch-fuel-lao.js): the official pump prices from the ministry's notices
//   data/report-watch.json (weekly): is there a newer edition of the World Bank report the hand-read facts come from?
//   data/economy.json: monthly inflation (IMF) - drawn next to the policy rate
// A fact without a source and a date does not belong on this tab, and nothing here is advice.

import { el, card, cardHead, table, outLink } from "../ui.js";
import { chartCard } from "../charts.js";
import { lazyJson } from "../lazy.js";
import { lastOf, monthText, monthShort, dayFull as dayText, freshness, sourcesFoot, invTile, fill, staticSource, ready, whole, planYears, sourceWords } from "./eco-common.js";
import { todayVientiane } from "../format.js";
import { inflationSeries } from "./eco-latest.js";

const isDay = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isMonth = (v) => typeof v === "string" && /^\d{4}-\d{2}$/.test(v);
const nextMonth = (m) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1)).toISOString().slice(0, 7);
const CHART_FROM = "2021-01"; // the chart starts before the 2022-2023 inflation wave
const billions = (millions) => (millions / 1000).toFixed(2); // US$ million -> "3.77"

// The raw fields of one fact as text for its sentence: "2026-04" -> "เม.ย. 2026", 2500000 -> "2,500,000"
function words(item, t) {
  const out = {};
  for (const [k, v] of Object.entries(item)) {
    if (isDay(v)) out[k] = dayText(v, t);
    else if (isMonth(v)) out[k] = monthText(v, t);
    else if (typeof v === "number" && Math.abs(v) >= 10000) out[k] = whole(v);
    else out[k] = v;
  }
  return out;
}

// "2026" · "พ.ย. 2026" · "30 ธ.ค. 2026" · "2026–2030"
function whenText(when, t) {
  if (isDay(when)) return dayText(when, t);
  if (isMonth(when)) return monthText(when, t);
  return when.replace("-", "–");
}
// the last day on which a calendar entry is still ahead
function lastDay(when) {
  if (isDay(when)) return when;
  if (isMonth(when)) return `${when}-31`;
  return `${when.slice(-4)}-12-31`;
}

function findItem(policy, area, id) {
  const a = policy.areas.find((x) => x.id === area);
  return a ? a.items.find((x) => x.id === id) || null : null;
}

// ---------- the central bank's own numbers ----------
// What the bank's website says now (read every week). When that file could not be loaded, the hand-checked values
// of data/invest-static.json are used and labelled with their check date.
//   -> { rate: { rate, date, old, old_date, stale } | null, reserve: { kip, foreign, date, stale } | null,
//        history: rows | null, reserves: { rows: [[month, US$ million]], stale } | null,
//        inflation: { rows: [[month, %]], stale } | null, sources }
function liveLevers(file) {
  const d = file.state === "ok" ? file.data : null;
  const part = (id, min) => (d && d[id] && d[id].rows && d[id].rows.length >= min ? d[id] : null);
  const rate = part("policy_rate", 2);
  const reserve = part("reserve", 1);
  const reserves = part("reserves", 13);
  const inflation = part("inflation", 1);
  const out = { rate: null, reserve: null, history: rate ? rate.rows : null, reserves: null, inflation: null, sources: (d && d.sources) || {} };
  if (rate) {
    const now = rate.rows[rate.rows.length - 1];
    const before = rate.rows[rate.rows.length - 2];
    out.rate = { rate: now[1], date: now[0], old: before[1], old_date: before[0], stale: !!rate.stale };
  }
  if (reserve) {
    const now = lastOf(reserve.rows);
    out.reserve = { kip: now[1], foreign: now[2], date: now[0], stale: !!reserve.stale };
  }
  if (reserves) out.reserves = { rows: reserves.rows, stale: !!reserves.stale, swap: reserves.includes_swap_since || null };
  if (inflation) out.inflation = { rows: inflation.rows, stale: !!inflation.stale };
  return out;
}

// (monthly inflation - the IMF series continued with the central bank's newer months - comes from eco-latest.js,
// the same resolver every tab uses)

// ---------- the official fuel prices ----------
// What the newest notice says, next to the price before the 2026 crisis and the highest price since then.
//   fuelFile: lazy data/fuel-lao.json; crisisFrom: the day the crisis prices start (data/invest-static.json)
//   -> { now, before, peak, stale } with rows [day, premium, regular, diesel, notice] | null
function fuelNow(fuelFile, crisisFrom) {
  const cap = fuelFile.state === "ok" && fuelFile.data.capital;
  if (!cap || !cap.latest || !cap.history || !cap.history.length) return null;
  const before = cap.history.filter((r) => r[0] < crisisFrom).pop() || null;
  const since = cap.history.filter((r) => r[0] >= crisisFrom && r[3]);
  const peak = since.length ? since.reduce((a, b) => (b[3] > a[3] ? b : a)) : null;
  return { now: cap.latest, before, peak, waiting: cap.waiting, stale: !!cap.stale, sources: fuelFile.data.sources };
}

// ---------- the levers and where they stand ----------
// A rule (a tax rate, a band) is labelled with the day it was last checked; a measured value (reserves) with
// its month, so that it turns into "old data" by itself when no newer number was read.
function tiles(e, live, fuel) {
  const { t } = e;
  const P = e.stat.policy;
  const checked = P.checked || e.stat.checked;
  const stats = el("div", "stats");
  const add = (label, value, sub, when) => stats.append(invTile(t, label, value, sub, freshness(t, when), "official"));
  const rate = live.rate || findItem(P, "money", "rate");
  if (rate) add(t.pol_k_rate, `${rate.rate}%`, fill(t.pol_k_rate_sub, { date: dayText(rate.date, t), old: rate.old }), live.rate ? { stale: live.rate.stale } : { checked });
  const fx = findItem(P, "money", "fx");
  if (fx) add(t.pol_k_band, `±${fx.band}%`, fill(t.pol_k_band_sub, { old: fx.old_band, date: dayText(fx.date, t) }), { checked });
  // the newest inflation next to the ceiling of the plan
  const inf = inflationSeries(e);
  const target = e.stat.plan && e.stat.plan.targets.find((x) => x.id === "inflation");
  if (inf) {
    const who = inf.from === "bol" ? "BOL" : "IMF";
    add(t.pol_k_inflation, `${inf.last[1].toFixed(1)}%`, target ? `${fill(t.pol_k_inflation_sub, { target: target.target })} · ${who}` : who, { month: inf.last[0], stale: inf.stale });
  }
  // foreign-exchange reserves: the central bank's monthly number; else the World Bank's (months of imports)
  const res = findItem(P, "money", "reserves");
  if (live.reserves) {
    const rows = live.reserves.rows;
    const now = lastOf(rows);
    const prev = rows[rows.length - 2];
    add(t.pol_k_reserves, { num: billions(now[1]), unit: t.unit_usd_bn }, fill(t.pol_k_reserves_live_sub, { prev: billions(prev[1]), prev_month: monthText(prev[0], t) }), { month: now[0], stale: live.reserves.stale });
  } else if (res) add(t.pol_k_reserves, { num: String(res.months), unit: t.unit_names.months }, fill(t.pol_k_reserves_sub, { usd_bn: res.usd_bn }), { month: res.month, checked });
  const vat = findItem(P, "tax", "vat");
  if (vat) add(t.pol_k_vat, `${vat.rate}%`, fill(t.pol_k_vat_sub, { old: vat.old, year: vat.year }), { checked });
  // fuel: the official diesel price now; without that file, the excise rate on diesel as last read
  const restore = findItem(P, "fuel", "restore");
  if (fuel && fuel.now.diesel) {
    const sub = fuel.before && fuel.peak ? fill(t.pol_k_fuel_sub, { before: whole(fuel.before[3]), peak: whole(fuel.peak[3]) }) : "";
    add(t.pol_k_fuel, { num: whole(fuel.now.diesel), unit: t.pol_unit_kip_l }, sub, { date: fuel.now.date, stale: fuel.stale });
  } else if (restore) add(t.pol_k_diesel, `${restore.diesel}%`, fill(t.pol_k_diesel_sub, { date: dayText(restore.date, t), before: restore.diesel_before }), { checked });
  const wage = findItem(P, "wages", "min");
  if (wage) add(t.pol_k_wage, { num: (wage.lak / 1e6).toFixed(1), unit: t.pol_unit_mkip }, fill(t.pol_k_wage_sub, { old: (wage.old / 1e6).toFixed(1), date: dayText(wage.date, t) }), { checked });
  const service = findItem(P, "debt", "service_year"); // one year, in % of GDP (not the 5-year average in dollars)
  if (service) add(t.pol_k_service, `${service.gdp}%`, t.pol_k_service_sub, { year: service.year, checked });
  return stats;
}

// ---------- what is read by hand, what updates itself, and is there a newer report? ----------
function readCard(e, watch) {
  const { t } = e;
  const P = e.stat.policy;
  const read = P.read;
  if (!read) return null;
  const lem = watch.state === "ok" ? watch.data.lem : null;
  const newer = lem && lem.latest && lem.latest.date > read.date ? lem.latest : null;
  const c = card("estimated", "policy-read");
  c.append(cardHead(t.pol_read_title, null, false, t));
  if (newer) {
    const warn = el("div", "alert");
    const text = el("div", "", fill(t.pol_read_newer, { date: dayText(newer.date, t), read: monthText(read.date.slice(0, 7), t) }) + " ");
    text.append(outLink(t.pol_read_open, newer.url));
    warn.append(el("span", "", "⚠"), text);
    c.append(warn);
  }
  const ul = el("ul", "watch-list");
  ul.append(el("li", "", t.pol_read_auto));
  ul.append(el("li", "", fill(t.pol_read_hand, { read: monthText(read.date.slice(0, 7), t), checked: dayText(P.checked || e.stat.checked, t) })));
  if (lem && !newer) ul.append(el("li", "", fill(t.pol_read_watch, { looked: watch.data.checked_at ? dayText(watch.data.checked_at, t) : "—", read: monthText(read.date.slice(0, 7), t) }) + (lem.stale ? ` ⚠ ${t.inv_fetch_failed}` : "")));
  c.append(ul);
  c.append(sourcesFoot(t, [staticSource(e, read.source), lem ? watch.data.sources[lem.source] : null]));
  return c;
}

// ---------- how to read a policy ----------
function howCard(t) {
  const c = card("estimated");
  c.append(cardHead(t.pol_how_title, null, false, t));
  const ol = el("ol", "steps");
  for (const k of ["pol_how_1", "pol_how_2", "pol_how_3", "pol_how_4"]) ol.append(el("li", "", t[k]));
  c.append(ol);
  return c;
}

// ---------- one policy and its effect in one picture: the policy rate next to inflation ----------
function rateChart(e, live) {
  const { t } = e;
  const inf = inflationSeries(e);
  if (!live.history || !inf) return null;
  const today = todayVientiane();
  const thisMonth = today.slice(0, 7);
  const months = [];
  for (let m = CHART_FROM; m <= thisMonth; m = nextMonth(m)) months.push(m);
  // the rate in force at the end of each month (today, for the running month)
  const rateAt = (m) => {
    const end = m === thisMonth ? today : `${m}-31`;
    let v = null;
    for (const [day, rate] of live.history) if (day <= end) v = rate;
    return v;
  };
  const inflation = new Map(inf.values);
  const c = chartCard({
    title: t.pol_chart_title,
    subtitle: `${t.unit}: ${t.unit_names["% per year"]} · ${t.source}: BOL, IMF · ${t.pol_chart_sub}${live.rate.stale ? " · ⚠ " + t.inv_fetch_failed : ""}`,
    labels: months.map((m) => monthText(m, t)),
    tickLabels: months.map((m) => monthShort(m, t)),
    series: [
      { label: t.pol_chart_inflation, kind: "official", values: months.map((m) => (inflation.has(m) ? Math.round(inflation.get(m) * 10) / 10 : null)) },
      { label: t.pol_chart_rate, kind: "official", color: "--cat-3", stepped: true, values: months.map(rateAt) },
    ],
    unit: "%",
    unitLabel: t.unit_names["% per year"],
    t,
    firstColTitle: t.month,
  });
  // what the picture says, worked out from the two lines
  const last = inf.last;
  const rateThen = rateAt(last[0]);
  const peak = live.history.reduce((a, b) => (b[1] > a[1] ? b : a));
  const sincePeak = live.history.filter(([day]) => day > peak[0]);
  const cuts = sincePeak.filter(([, rate], i) => rate < (i ? sincePeak[i - 1][1] : peak[1])).length;
  const real = rateThen - last[1];
  const ul = el("ul", "watch-list");
  ul.append(el("li", "", fill(t.pol_chart_note_real, { rate: rateThen, inflation: last[1].toFixed(1), month: monthText(last[0], t), real: `${real < 0 ? "−" : "+"}${Math.abs(real).toFixed(1)}` })));
  const atPeak = inflation.get(peak[0].slice(0, 7)); // inflation in the month of the highest rate
  ul.append(el("li", "", fill(t.pol_chart_note_path, { peak: peak[1], peak_date: dayText(peak[0], t), peak_inflation: atPeak === undefined ? "—" : atPeak.toFixed(1), cuts, now: live.rate.rate, date: dayText(live.rate.date, t) })));
  if (inf.from === "bol") ul.append(el("li", "", fill(t.pol_chart_note_bol, { month: monthText(last[0], t), imf_month: monthText(inf.imfLast, t) })));
  c.append(ul, sourcesFoot(t, [staticSource(e, "bol_rate"), ...[...inf.sources].reverse()]));
  return c;
}

// ---------- one area of policy ----------
// Sentences that come from a file which updates itself (not typed in): [text, source] pairs put before the facts
function liveLines(e, area, live, fuel) {
  const { t } = e;
  const lines = [];
  if (area.id === "money" && live.reserves) {
    const rows = live.reserves.rows;
    const now = lastOf(rows);
    const prev = rows[rows.length - 2];
    const year = rows.slice(-13);
    const peak = year.reduce((a, b) => (b[1] > a[1] ? b : a));
    const low = year.reduce((a, b) => (b[1] < a[1] ? b : a));
    lines.push({
      text: fill(t.pol_money_reserves_live, { usd_bn: billions(now[1]), month: monthText(now[0], t), prev_bn: billions(prev[1]), prev_month: monthText(prev[0], t), peak_bn: billions(peak[1]), peak_month: monthText(peak[0], t), low_bn: billions(low[1]), low_month: monthText(low[0], t), swap_month: live.reserves.swap ? monthText(live.reserves.swap, t) : "—" }),
      source: live.sources.bol_reserves,
      stale: live.reserves.stale,
    });
  }
  if (area.id === "fuel" && fuel) {
    const n = fuel.now;
    const where = n.from === "notice" && n.notice ? fill(t.pol_fuel_now_notice, { no: n.notice.no, date: dayText(n.notice.date, t) }) : fill(t.pol_fuel_now_company, { date: dayText(n.date, t) });
    let text = fill(t.pol_fuel_now, { where, regular: whole(n.regular), diesel: whole(n.diesel), premium: n.premium ? whole(n.premium) : "—" });
    if (fuel.before && fuel.peak) {
      const change = ((n.diesel - fuel.before[3]) / fuel.before[3]) * 100;
      text += " " + fill(t.pol_fuel_now_compare, { before_date: dayText(fuel.before[0], t), before_regular: whole(fuel.before[2]), before_diesel: whole(fuel.before[3]), peak_date: dayText(fuel.peak[0], t), peak_regular: whole(fuel.peak[2]), peak_diesel: whole(fuel.peak[3]), pct: `${change >= 0 ? "+" : "−"}${Math.abs(change).toFixed(0)}%` });
    }
    if (fuel.waiting) text += " " + fill(t.pol_fuel_now_waiting, { no: fuel.waiting.no, date: dayText(fuel.waiting.date, t) });
    lines.push({ text, source: fuel.sources[n.from === "notice" ? "dit" : "lsf"], stale: fuel.stale });
  }
  return lines;
}

function areaCard(e, area, live, fuel) {
  const { t } = e;
  const c = card("official", "policy-card");
  c.append(cardHead(fill(t["pol_area_" + area.id], area), "official", false, t));
  // what it moves
  const moves = el("div", "policy-affects");
  moves.append(el("span", "policy-affects-label", t.pol_affects));
  for (const a of area.affects) moves.append(el("span", "tag", t["pol_aff_" + a]));
  c.append(moves);
  // what was decided, one fact per line (the central bank's two rules: the bank's own page when it was read)
  const ul = el("ul", "watch-list policy-list");
  const used = new Set();
  const more = []; // sources that are not in data/invest-static.json (the files that update themselves)
  let failed = false;
  for (const line of liveLines(e, area, live, fuel)) {
    const li = el("li", "", line.text);
    li.append(" ", el("span", "tag tag-auto", t.pol_tag_auto));
    ul.append(li);
    if (line.source) more.push(line.source);
    if (line.stale) failed = true;
  }
  for (const raw of area.items) {
    const fromBank = area.id === "money" && (raw.id === "rate" || raw.id === "reserve") ? live[raw.id] : null;
    const item = fromBank ? { ...raw, ...fromBank } : raw;
    if (fromBank && fromBank.stale) failed = true;
    // the sentence may name the report the fact was read in ({edition}, {source_year}) - never a typed year
    const li = el("li", "", fill(t[`pol_${area.id}_${item.id}`], { ...sourceWords(e, item.source), ...words(item, t) }));
    if (fromBank) li.append(" ", el("span", "tag tag-auto", t.pol_tag_auto));
    ul.append(li);
    used.add(item.source);
    for (const id of item.sources || []) used.add(id);
  }
  c.append(ul);
  // where the effect can be watched
  const go = el("div", "watch-links");
  if (area.tab === "living") {
    const a = el("a", "btn", `${t.pol_see} ${t.page_living}`);
    a.href = "#/living";
    go.append(a);
  } else {
    const b = el("button", "btn", `${t.pol_see} ${t["inv_tab_" + area.tab]}`);
    b.type = "button";
    b.addEventListener("click", () => e.go(area.tab));
    go.append(b);
  }
  c.append(go);
  const fresh = el("div", "card-foot");
  fresh.append(freshness(t, { checked: e.stat.policy.checked || e.stat.checked, stale: failed }));
  c.append(fresh, sourcesFoot(t, [...more, ...[...used].map((id) => staticSource(e, id))]));
  return c;
}

// ---------- the World Bank's forecast next to the targets of the plan ----------
const TARGET_OF = { growth: "growth", inflation: "inflation", debt: "debt", fiscal: "budget" };
function outlookCard(e) {
  const { t } = e;
  const o = e.stat.policy.outlook;
  if (!o) return null;
  const targets = new Map(((e.stat.plan && e.stat.plan.targets) || []).map((x) => [x.id, x]));
  const targetText = (id) => {
    const x = targets.get(TARGET_OF[id]);
    return x ? `${x.op === ">=" ? "≥" : "≤"} ${x.target}` : "—";
  };
  const rows = Object.entries(o.rows).map(([id, values]) => [t["pol_out_" + id], ...values.map((v) => v.toFixed(1)), targetText(id)]);
  const c = card("official");
  c.append(cardHead(t.pol_outlook_title, "official", false, t));
  const tb = table([t.pol_out_what, ...o.years.map((y) => (y >= o.first_forecast ? `${y}*` : String(y))), t.pol_out_target], rows);
  tb.classList.add("wrap-first");
  c.append(tb, el("p", "note", fill(t.pol_out_note, { ...sourceWords(e, o.source), ...planYears(e) })));
  const fresh = el("div", "card-foot");
  fresh.append(freshness(t, { checked: e.stat.policy.checked || e.stat.checked }));
  c.append(fresh, sourcesFoot(t, [staticSource(e, o.source), staticSource(e, e.stat.plan && e.stat.plan.source)]));
  return c;
}

// ---------- dates to watch ----------
// Numbers named in the calendar lines come from the facts above and from the plan, never typed twice
function calendarValues(e) {
  const P = e.stat.policy;
  const target = (id) => {
    const x = e.stat.plan && e.stat.plan.targets.find((v) => v.id === id);
    return x ? x.target : "—";
  };
  const review = findItem(P, "wages", "review");
  const service = findItem(P, "debt", "service");
  const offers = review ? [review.labour, review.government, review.employers] : [];
  const census = e.stat.population && e.stat.population.census;
  return {
    ...planYears(e),
    census_no: census ? census.number : "—",
    census_said: census ? monthText(census.status.slice(0, 7), e.t) : "—",
    low: offers.length ? (Math.min(...offers) / 1e6).toFixed(1) : "—",
    high: offers.length ? (Math.max(...offers) / 1e6).toFixed(1) : "—",
    service: service ? service.usd_bn : "—",
    growth: target("growth"),
    inflation: target("inflation"),
    debt: target("debt"),
  };
}

function calendarCard(e) {
  const { t } = e;
  const today = todayVientiane();
  const values = calendarValues(e);
  const list = [...e.stat.policy.calendar].sort((a, b) => (lastDay(a.when) < lastDay(b.when) ? -1 : lastDay(a.when) > lastDay(b.when) ? 1 : 0));
  const c = card("estimated");
  c.append(cardHead(t.pol_cal_title, null, false, t));
  const ul = el("ul", "calendar-list");
  const used = new Set();
  for (const item of list) {
    const past = lastDay(item.when) < today;
    const li = el("li", past ? "past" : "");
    li.append(el("span", "cal-when", whenText(item.when, t)));
    const what = el("span", "cal-what", fill(t["pol_cal_" + item.id], values));
    if (past) what.append(el("span", "cal-past", ` (${t.pol_cal_past})`)); // said in words, not only by the grey colour
    li.append(what);
    ul.append(li);
    used.add(item.source);
  }
  c.append(ul);
  const fresh = el("div", "card-foot");
  fresh.append(freshness(t, { checked: e.stat.policy.checked || e.stat.checked }));
  c.append(fresh, sourcesFoot(t, [...used].map((id) => staticSource(e, id))));
  return c;
}

// ---------- what the World Bank says should come next ----------
function adviceCard(e) {
  const { t } = e;
  const a = e.stat.policy.advice;
  if (!a) return null;
  const c = card("estimated");
  c.append(cardHead(fill(t.pol_advice_title, sourceWords(e, a.source)), null, false, t));
  const ul = el("ul", "watch-list");
  for (const id of a.items) ul.append(el("li", "", t["pol_advice_" + id]));
  c.append(ul, el("p", "note", t.pol_advice_note));
  c.append(sourcesFoot(t, [staticSource(e, a.source)]));
  return c;
}

export function policyTab(panel, e) {
  const { t } = e;
  panel.append(el("p", "muted tab-intro", t.pol_intro));
  const bank = { state: e.bankState, data: e.bank }; // loaded by the page for every tab (economy.js)
  const fuelFile = lazyJson("data/fuel-lao.json", e.rerender);
  const watch = lazyJson("data/report-watch.json", e.rerender);
  if (!ready(panel, e, ["stat"])) return;
  if (!e.stat.policy) {
    panel.append(el("p", "muted", t.inv_load_error));
    return;
  }
  if ([bank, fuelFile, watch].some((f) => f.state === "loading")) {
    const sk = el("div", "skeleton");
    sk.append(el("div"), el("div"), el("div"));
    panel.append(sk);
    return;
  }
  const live = liveLevers(bank); // a file that failed to load -> the hand-checked values
  const fuelArea = e.stat.policy.areas.find((a) => a.id === "fuel");
  const fuel = fuelNow(fuelFile, (fuelArea && fuelArea.crisis_from) || "2026-03-01");
  panel.append(tiles(e, live, fuel), howCard(t));
  const chart = rateChart(e, live);
  if (chart) panel.append(chart);
  panel.append(el("h2", "section-title", t.pol_sec_rules));
  const read = readCard(e, watch);
  if (read) panel.append(read);
  const grid = el("div", "grid grid-2");
  for (const area of e.stat.policy.areas) grid.append(areaCard(e, area, live, fuel));
  panel.append(grid);
  panel.append(el("h2", "section-title", t.pol_sec_ahead));
  const ahead = el("div", "grid grid-2");
  for (const node of [calendarCard(e), outlookCard(e)]) if (node) ahead.append(node);
  panel.append(ahead);
  const advice = adviceCard(e);
  if (advice) panel.append(advice);
}
