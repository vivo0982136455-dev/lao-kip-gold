// Economy tab: policy - what the State has decided, since when, which numbers it moves, and where on this site
// the effect can be watched.
//   data/invest-static.json "policy": hand-checked facts from named reports, laws and official news (the numbers
//       and dates there, the sentences in i18n "pol_*")
//   data/bol-policy.json (weekly, scripts/fetch-bol-policy.js): the central bank's policy rate and reserve
//       requirement, every change with its date, read from the bank's own website
//   data/economy.json: the newest monthly inflation (IMF) - drawn next to the policy rate
// A fact without a source and a date does not belong on this tab, and nothing here is advice.

import { el, card, cardHead, table } from "../ui.js";
import { chartCard } from "../charts.js";
import { lazyJson } from "../lazy.js";
import { lastOf, monthText, monthShort, dayFull as dayText, freshness, sourcesFoot, invTile, fill, staticSource, ready, whole } from "./eco-common.js";
import { todayVientiane } from "../format.js";

const isDay = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isMonth = (v) => typeof v === "string" && /^\d{4}-\d{2}$/.test(v);
const nextMonth = (m) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1)).toISOString().slice(0, 7);
const CHART_FROM = "2021-01"; // the chart starts before the 2022-2023 inflation wave

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
// The rate and the reserve rule now in force, from the bank's page (read every week). When that file could not
// be loaded, the hand-checked values of data/invest-static.json are used and labelled with their check date.
//   -> { rate: { rate, date, old, old_date, stale } | null, reserve: { kip, foreign, date, stale } | null, history: rows | null }
function liveLevers(file) {
  const d = file.state === "ok" ? file.data : null;
  const rateRows = d && d.policy_rate && d.policy_rate.rows && d.policy_rate.rows.length >= 2 ? d.policy_rate.rows : null;
  const reserveRows = d && d.reserve && d.reserve.rows && d.reserve.rows.length ? d.reserve.rows : null;
  const out = { rate: null, reserve: null, history: rateRows };
  if (rateRows) {
    const now = rateRows[rateRows.length - 1];
    const before = rateRows[rateRows.length - 2];
    out.rate = { rate: now[1], date: now[0], old: before[1], old_date: before[0], stale: !!d.policy_rate.stale };
  }
  if (reserveRows) {
    const now = lastOf(reserveRows);
    out.reserve = { kip: now[1], foreign: now[2], date: now[0], stale: !!d.reserve.stale };
  }
  return out;
}

// ---------- the levers and where they stand ----------
// A rule (a tax rate, a band) is labelled with the day it was last checked; a measured value (reserves) with
// its month, so that it turns into "old data" by itself when no newer report was read.
function tiles(e, live) {
  const { t } = e;
  const P = e.stat.policy;
  const checked = e.stat.checked;
  const stats = el("div", "stats");
  const add = (label, value, sub, when) => stats.append(invTile(t, label, value, sub, freshness(t, when), "official"));
  const rate = live.rate || findItem(P, "money", "rate");
  if (rate) add(t.pol_k_rate, `${rate.rate}%`, fill(t.pol_k_rate_sub, { date: dayText(rate.date, t), old: rate.old }), live.rate ? { stale: live.rate.stale } : { checked });
  const fx = findItem(P, "money", "fx");
  if (fx) add(t.pol_k_band, `±${fx.band}%`, fill(t.pol_k_band_sub, { old: fx.old_band, date: dayText(fx.date, t) }), { checked });
  // the newest inflation next to the ceiling of the plan
  const cpi = e.economy.monthly && e.economy.monthly.cpi_yoy;
  const target = e.stat.plan && e.stat.plan.targets.find((x) => x.id === "inflation");
  if (cpi && cpi.values.length) {
    const last = lastOf(cpi.values);
    add(t.pol_k_inflation, `${last[1].toFixed(1)}%`, target ? fill(t.pol_k_inflation_sub, { target: target.target }) : "IMF", { month: last[0], stale: cpi.stale });
  }
  const res = findItem(P, "money", "reserves");
  if (res) add(t.pol_k_reserves, { num: String(res.months), unit: t.unit_names.months }, fill(t.pol_k_reserves_sub, { usd_bn: res.usd_bn }), { month: res.month, checked });
  const vat = findItem(P, "tax", "vat");
  if (vat) add(t.pol_k_vat, `${vat.rate}%`, fill(t.pol_k_vat_sub, { old: vat.old, year: vat.year }), { checked });
  const cut = findItem(P, "fuel", "cut");
  if (cut) add(t.pol_k_diesel, `${cut.diesel_new}%`, fill(t.pol_k_diesel_sub, { old: cut.diesel, month: monthText(cut.month, t) }), { checked });
  const wage = findItem(P, "wages", "min");
  if (wage) add(t.pol_k_wage, { num: (wage.lak / 1e6).toFixed(1), unit: t.pol_unit_mkip }, fill(t.pol_k_wage_sub, { old: (wage.old / 1e6).toFixed(1), date: dayText(wage.date, t) }), { checked });
  const service = findItem(P, "debt", "service");
  if (service) add(t.pol_k_service, `${service.gdp}%`, t.pol_k_service_sub, { year: service.year, checked });
  return stats;
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
  const cpi = e.economy.monthly && e.economy.monthly.cpi_yoy;
  if (!live.history || !cpi || !cpi.values.length) return null;
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
  const inflation = new Map(cpi.values);
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
  const last = lastOf(cpi.values);
  const rateThen = rateAt(last[0]);
  const peak = live.history.reduce((a, b) => (b[1] > a[1] ? b : a));
  const sincePeak = live.history.filter(([day]) => day > peak[0]);
  const cuts = sincePeak.filter(([, rate], i) => rate < (i ? sincePeak[i - 1][1] : peak[1])).length;
  const real = rateThen - last[1];
  const ul = el("ul", "watch-list");
  ul.append(el("li", "", fill(t.pol_chart_note_real, { rate: rateThen, inflation: last[1].toFixed(1), month: monthText(last[0], t), real: `${real < 0 ? "−" : "+"}${Math.abs(real).toFixed(1)}` })));
  const atPeak = inflation.get(peak[0].slice(0, 7)); // inflation in the month of the highest rate
  ul.append(el("li", "", fill(t.pol_chart_note_path, { peak: peak[1], peak_date: dayText(peak[0], t), peak_inflation: atPeak === undefined ? "—" : atPeak.toFixed(1), cuts, now: live.rate.rate, date: dayText(live.rate.date, t) })));
  c.append(ul, sourcesFoot(t, [staticSource(e, "bol_rate"), e.economy.sources && e.economy.sources[cpi.source]]));
  return c;
}

// ---------- one area of policy ----------
function areaCard(e, area, live) {
  const { t } = e;
  const c = card("official", "policy-card");
  c.append(cardHead(t["pol_area_" + area.id], "official", false, t));
  // what it moves
  const moves = el("div", "policy-affects");
  moves.append(el("span", "policy-affects-label", t.pol_affects));
  for (const a of area.affects) moves.append(el("span", "tag", t["pol_aff_" + a]));
  c.append(moves);
  // what was decided, one fact per line (the central bank's two rules: the bank's own page when it was read)
  const ul = el("ul", "watch-list policy-list");
  const used = new Set();
  let failed = false;
  for (const raw of area.items) {
    const fromBank = area.id === "money" ? live[raw.id] : null;
    const item = fromBank ? { ...raw, ...fromBank } : raw;
    if (fromBank && fromBank.stale) failed = true;
    ul.append(el("li", "", fill(t[`pol_${area.id}_${item.id}`], words(item, t))));
    used.add(item.source);
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
  fresh.append(freshness(t, { checked: e.stat.checked, stale: failed }));
  c.append(fresh, sourcesFoot(t, [...used].map((id) => staticSource(e, id))));
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
  c.append(tb, el("p", "note", t.pol_out_note));
  const fresh = el("div", "card-foot");
  fresh.append(freshness(t, { checked: e.stat.checked }));
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
  return {
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
  fresh.append(freshness(t, { checked: e.stat.checked }));
  c.append(fresh, sourcesFoot(t, [...used].map((id) => staticSource(e, id))));
  return c;
}

// ---------- what the World Bank says should come next ----------
function adviceCard(e) {
  const { t } = e;
  const a = e.stat.policy.advice;
  if (!a) return null;
  const c = card("estimated");
  c.append(cardHead(t.pol_advice_title, null, false, t));
  const ul = el("ul", "watch-list");
  for (const id of a.items) ul.append(el("li", "", t["pol_advice_" + id]));
  c.append(ul, el("p", "note", t.pol_advice_note));
  c.append(sourcesFoot(t, [staticSource(e, a.source)]));
  return c;
}

export function policyTab(panel, e) {
  const { t } = e;
  panel.append(el("p", "muted tab-intro", t.pol_intro));
  const bank = lazyJson("data/bol-policy.json", e.rerender);
  if (!ready(panel, e, ["stat"])) return;
  if (!e.stat.policy) {
    panel.append(el("p", "muted", t.inv_load_error));
    return;
  }
  if (bank.state === "loading") {
    const sk = el("div", "skeleton");
    sk.append(el("div"), el("div"), el("div"));
    panel.append(sk);
    return;
  }
  const live = liveLevers(bank); // a file that failed to load -> the hand-checked values
  panel.append(tiles(e, live), howCard(t));
  const chart = rateChart(e, live);
  if (chart) panel.append(chart);
  panel.append(el("h2", "section-title", t.pol_sec_rules));
  const grid = el("div", "grid grid-2");
  for (const area of e.stat.policy.areas) grid.append(areaCard(e, area, live));
  panel.append(grid);
  panel.append(el("h2", "section-title", t.pol_sec_ahead));
  const ahead = el("div", "grid grid-2");
  for (const node of [calendarCard(e), outlookCard(e)]) if (node) ahead.append(node);
  panel.append(ahead);
  const advice = adviceCard(e);
  if (advice) panel.append(advice);
}
