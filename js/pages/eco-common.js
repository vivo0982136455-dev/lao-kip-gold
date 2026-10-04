// Shared parts of the economy tabs: finding values, "latest or old" labels, source links, bar tables, status badges.
// Every number on these tabs is shown with where it comes from and which year/month it is.

import { el, card, cardHead, statTile, sourceLink } from "../ui.js";
import { formatNumber, formatDate, todayVientiane, unitText } from "../format.js";
import { chartCard } from "../charts.js";

export const THIS_YEAR = Number(todayVientiane().slice(0, 4));
export const lastOf = (a) => (a && a.length ? a[a.length - 1] : null);
export const pct = (from, to) => ((to - from) / from) * 100;
export const monthText = (m, t) => `${t.months[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`; // "2026-08" -> "ส.ค. 2026"
// "2026-04-10" -> "10 เม.ย. 2026": always with the year (formatDate leaves the year out when it is this year,
// which is wrong for the date of a rule or of an event that stays on the page for years)
export const dayFull = (day, t) => `${Number(day.slice(8, 10))} ${t.months[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;
export const monthShort = (m, t) => `${t.months[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`; // "ส.ค. 26"
const monthsAgo = (m) => {
  const now = todayVientiane();
  return (Number(now.slice(0, 4)) - Number(m.slice(0, 4))) * 12 + Number(now.slice(5, 7)) - Number(m.slice(5, 7));
};

// The 18 provinces (names as in "provinces" of i18n/*.json). Order asked for by the owner: Vientiane Capital and
// Luang Prabang first (his focus), then the others from north to south.
export const PROVINCES = [
  "Vientiane Capital", "Louangphabang", "Phongsaly", "Louangnamtha", "Bokeo", "Oudomxai", "Houaphan", "Xaignabouly", "Xiengkhouang",
  "Vientiane", "Xaisomboun", "Bolikhamxai", "Khammouan", "Savannakhet", "Salavan", "Sekong", "Champasack", "Attapeu",
];
export const FOCUS_PROVINCES = ["Vientiane Capital", "Louangphabang"];

// Country name: our translation, else the English name that came with the data, else the code
export const countryName = (t, names, iso) => (t.countries && t.countries[iso]) || (names && names[iso]) || iso;

// Choices inside one tab (sub-views, year, kind of rubber ...): a row of buttons; the choice is remembered on
// this device. items: [[id, text]]. Returns { current, bar }.
const picked = new Map();
export function choice(e, key, items, fallback) {
  if (!picked.has(key)) {
    let saved = null;
    try {
      saved = localStorage.getItem("eco_" + key);
    } catch {
      /* private mode */
    }
    picked.set(key, saved);
  }
  const ids = items.map(([id]) => String(id));
  const current = ids.includes(String(picked.get(key))) ? String(picked.get(key)) : String(fallback !== undefined ? fallback : ids[0]);
  const bar = el("div", "choice");
  bar.setAttribute("role", "group");
  for (const [id, text] of items) {
    const b = el("button", "", text);
    b.type = "button";
    b.setAttribute("aria-pressed", String(String(id) === current));
    b.addEventListener("click", () => {
      if (String(id) === current) return;
      picked.set(key, String(id));
      try {
        localStorage.setItem("eco_" + key, String(id));
      } catch {
        /* private mode */
      }
      e.rerender();
    });
    bar.append(b);
  }
  return { current, bar };
}
// Set a choice from outside its row of buttons (the search of the economy page opens one view of a tab)
export function pick(key, id) {
  picked.set(key, String(id));
  try {
    localStorage.setItem("eco_" + key, String(id));
  } catch {
    /* private mode */
  }
}

// Yearly indicator from economy.json or invest.json
export function indicator(e, id) {
  return (e.economy && e.economy.indicators && e.economy.indicators[id]) || (e.invest && e.invest.indicators && e.invest.indicators[id]) || null;
}
// Newest [year, value]; before = only years before it (IMF: this year onwards is a forecast)
export function latest(ind, before) {
  if (!ind || !ind.values || !ind.values.length) return null;
  return lastOf(before ? ind.values.filter(([y]) => y < before) : ind.values);
}
export function valueIn(ind, year) {
  if (!ind || !ind.values) return null;
  const hit = ind.values.find(([y]) => y === year);
  return hit ? hit[1] : null;
}

// ---------- The newest number the app has: an automatic series or a hand-read fact, whichever is newer ----------
// A candidate is { value, when: { year } | { month }, ... } (or null). A year counts as its last month.
const periodKey = (when) => (when.month ? when.month : `${when.year}-12`);
export const periodYear = (when) => (when.month ? Number(when.month.slice(0, 4)) : when.year);
export function newest(...candidates) {
  return candidates.filter(Boolean).reduce((best, c) => (!best || periodKey(c.when) > periodKey(best.when) ? c : best), null);
}
// One hand-read policy fact of data/invest-static.json ("policy" > area > item)
export function policyItem(e, area, id) {
  const a = e.stat && e.stat.policy && e.stat.policy.areas.find((x) => x.id === area);
  return (a && a.items.find((x) => x.id === id)) || null;
}
// (the resolvers that answer "what is the newest inflation / reserves / debt" are in eco-latest.js)

// USD millions -> "10.02 พันล้าน USD" / "886.8 ล้าน USD"
export function usdText(millions, t) {
  if (Math.abs(millions) >= 1000) return `${(millions / 1000).toFixed(2)} ${t.unit_usd_bn}`;
  return `${millions.toLocaleString("en-US", { maximumFractionDigits: 1 })} ${t.unit_usd_m}`;
}
export const pctText = (v, d = 1) => `${v.toFixed(d)}%`;
// 688 -> "688", 35493 -> "35,493" (counts, hectares, square metres, kip prices: never decimals)
export const whole = (v) => Math.round(v).toLocaleString("en-US");

// Is a number too old to be called current? Yearly data: more than 2 years behind; monthly data: more than 6 months.
export const OLD_AFTER = { years: 2, months: 6 };
export function isOld({ year, month }) {
  if (year !== undefined && year !== null) return year < THIS_YEAR - OLD_AFTER.years;
  return month ? monthsAgo(month) > OLD_AFTER.months : false;
}

// How many months the END of a period lies behind this month. A year ends in December (2024 seen in October 2026
// = 22 months); a month is itself. Never negative: the running year or month counts as 0.
export function monthsBehind({ year, month }) {
  const now = todayVientiane();
  if (year !== undefined && year !== null) return Math.max(0, (Number(now.slice(0, 4)) - year - 1) * 12 + Number(now.slice(5, 7)));
  return month ? Math.max(0, monthsAgo(month)) : 0;
}
// Up to here a number is simply "the newest the source has"; beyond it the label says how far behind it is
export const FRESH_MONTHS = { year: 12, month: 3 };

// "Latest or old" label for one number.
//   period: { year } | { month: "2026-08" } | { date: "2026-02-26" } ; stale = our last download failed (old copy kept)
//   A tick ("the newest the source has") only for a number that is not behind: the year that ended not more than
//   12 months ago, a month not more than 3 months back. Otherwise the label says how many months behind it is -
//   "the newest the source has" is not the same as "current" (audit 2026-10-02: 2024 was called "latest" in
//   October 2026). Yearly data more than 2 years behind, monthly data more than 6 months behind: "old".
//   checked = a hand-read fact: the day it was last compared with its source (said next to its age).
// compact: in table rows, say nothing when the number is fine
export function freshness(t, { year, month, date, stale, checked, compact }) {
  const box = el("span", "fresh");
  let period = "";
  const yearly = year !== undefined && year !== null;
  const old = isOld({ year, month });
  const behind = yearly || month ? monthsBehind({ year, month }) : 0;
  const late = behind > (yearly ? FRESH_MONTHS.year : FRESH_MONTHS.month);
  if (yearly) period = `${t.year} ${year}`;
  else if (month) period = monthText(month, t);
  else if (date) period = `${t.inv_as_of} ${formatDate(date, t)}`;
  if (period) box.append(el("span", "", period));
  const age = fill(t.inv_behind, { n: behind });
  if (stale) box.append(el("span", "fresh-stale", `⚠ ${t.inv_fetch_failed}`));
  else if (old) box.append(el("span", "fresh-old", `${t.inv_old_data} · ${age}`));
  else {
    if (late) box.append(el("span", "fresh-behind", age));
    if (checked) box.append(el("span", "fresh-ok", `✓ ${t.inv_checked} ${formatDate(checked, t)}`));
    else if (!late && !compact) box.append(el("span", "fresh-ok", `✓ ${t.inv_latest}`));
  }
  return box;
}

// What a source says about itself, when the fetcher stored it: its edition (IMF: the month the World Economic
// Outlook was published), the day the source last changed its data, and the day we read it
function sourceMeta(t, src) {
  const parts = [];
  if (src.edition) parts.push(fill(t.src_edition, { date: /^\d{4}-\d{2}$/.test(src.edition) ? monthText(src.edition, t) : src.edition }));
  if (src.updated) parts.push(fill(t.src_updated, { date: formatDate(src.updated, t) }));
  if (src.retrieved) parts.push(fill(t.src_retrieved, { date: formatDate(src.retrieved, t) }));
  return parts.length ? ` (${parts.join(" · ")})` : "";
}

// "Source: link (edition April 2026 · read 2 Oct), link · updated at the source 13 ก.ค. 2026"
export function sourcesFoot(t, sources, sourceUpdated) {
  const foot = el("div", "card-foot");
  foot.append(`${t.source}: `);
  sources.filter(Boolean).forEach((src, i) => {
    if (i > 0) foot.append(", ");
    foot.append(sourceLink(src), sourceMeta(t, src));
  });
  if (sourceUpdated) foot.append(` · ${t.inv_source_updated} ${formatDate(sourceUpdated, t)}`);
  return foot;
}
// A source of the yearly numbers by its id ("worldbank", "imf" ...), from whichever data file holds it
export const sourceOf = (e, id) => (e.economy && e.economy.sources && e.economy.sources[id]) || (e.invest && e.invest.sources && e.invest.sources[id]) || null;

// USD millions -> { num: "10.02", unit: "พันล้าน USD" } (for tiles: big number, small unit)
export function usdParts(millions, t) {
  if (Math.abs(millions) >= 1000) return { num: (millions / 1000).toFixed(2), unit: t.unit_usd_bn };
  return { num: millions.toLocaleString("en-US", { maximumFractionDigits: 1 }), unit: t.unit_usd_m };
}

// Stat tile with a "latest or old" label under it. value: "4.5%" or { num: "18.30", unit: "พันล้าน USD" }
export function invTile(t, label, value, subText, fresh, kind = "official") {
  const tile = statTile(label, typeof value === "string" ? value : value.num, subText, kind);
  if (typeof value !== "string" && value.unit) tile.querySelector(".stat-value").append(el("span", "stat-unit", value.unit));
  if (fresh) tile.append(fresh);
  return tile;
}

// Card with a list of short facts (text + optional ▲▼ pill or badge)
export function factsCard(t, title, facts, note, kind = "estimated") {
  const c = card(kind, "facts-card");
  c.append(cardHead(title, kind, false, t));
  const ul = el("ul", "facts");
  for (const [text, extra] of facts) {
    const li = el("li");
    li.append(el("span", "", text));
    if (extra) li.append(extra);
    ul.append(li);
  }
  c.append(ul);
  if (note) c.append(el("p", "note", note));
  return c;
}

// Table with a bar per row. rows: [{ label, cls, sub, value, text, share }]; bar length = value / max (from 0).
// value: null = a row without a bar (e.g. a total); a value below zero has no bar either (its text says it);
// cls = class of the name (e.g. "focus-name"); share = text or an element for the last column
export function barTable(headers, rows) {
  const max = Math.max(...rows.map((r) => r.value || 0), 0) || 1;
  const tbl = el("table");
  const head = el("tr");
  for (const h of headers) head.append(el("th", "", h));
  tbl.appendChild(el("thead")).append(head);
  const body = tbl.appendChild(el("tbody"));
  for (const r of rows) {
    const tr = el("tr");
    const name = el("td");
    name.append(el("span", r.cls || "", r.label));
    if (r.sub) name.append(el("span", "sub-line", r.sub));
    const cell = el("td");
    const wrap = el("div", "bar-cell");
    wrap.append(el("span", "", r.text));
    const track = el("div", "bar-track");
    if (r.value === null) track.classList.add("no-bar");
    else {
      const fill = el("div", "bar-fill");
      fill.style.width = `${Math.max(0, (r.value / max) * 100)}%`;
      track.append(fill);
    }
    wrap.append(track);
    cell.append(wrap);
    const last = el("td");
    if (r.share instanceof Node) last.append(r.share);
    else last.textContent = r.share === undefined ? "" : r.share;
    tr.append(name, cell, last);
    body.append(tr);
  }
  const box = el("div", "table-wrap wrap-first");
  box.append(tbl);
  return box;
}

// Target status -> badge with an icon (never colour alone).
//   met / near / far = a judgement · baseline = a number from before the plan starts (no judgement) ·
//   old = too old to compare · split = two ways of counting give different answers · none = no number
export function statusBadge(t, status) {
  const icon = { met: "✓", near: "≈", far: "✗", none: "—", baseline: "○", old: "—", split: "±" }[status];
  return el("span", `status status-${status}`, `${icon} ${t["inv_status_" + status]}`);
}

export const NEAR_GAP = 0.1; // "near" = not more than 10% of the target away from it
// ... and for a target of 0 (a budget in balance), where a share of the target does not exist: not more than half
// a point of the target's own unit away (0.5% of GDP - what 10% of an inflation target of 5% comes to as well)
export const NEAR_POINTS = 0.5;
// Compare an actual value with a target. op: ">=" (at least) or "<=" (at most).
// period = { when: { year } | { month }, from: first year of the plan } (optional). With it, only a number from
// inside the plan is judged: an earlier one is the "baseline" (where the plan starts from, not a result), and a
// number that is too old to be called current is not compared at all ("old").
export function targetStatus(actual, target, op, period) {
  if (actual === null || actual === undefined) return "none";
  if (period && period.when) {
    if (isOld(period.when)) return "old";
    if (periodYear(period.when) < period.from) return "baseline";
  }
  const ok = op === ">=" ? actual >= target : actual <= target;
  if (ok) return "met";
  // A target of 0 has no "percent of the target": the division gave Infinity, so a deficit of 0.1% of GDP was as
  // "far" as one of 8% (audit 2026-10-02, P3-4). The distance is then counted in points.
  const miss = Math.abs(actual - target);
  const near = target === 0 ? miss <= NEAR_POINTS : miss / Math.abs(target) <= NEAR_GAP;
  return near ? "near" : "far";
}

// Are the lazily loaded files there? If not, show a placeholder (loading) or a message (failed) and return false.
// keys: "invest" (data/invest.json), "stat" (data/invest-static.json), "bank" (data/bol-policy.json: the central
// bank's own newest numbers - a tab waits for it so that a number does not change under the reader's eyes, but
// does not need it: when that file fails, the resolvers of eco-latest.js fall back to the older series)
export function ready(panel, e, keys = ["invest", "stat"]) {
  const states = keys.map((k) => (k === "bank" && e.bankState === "error" ? "ok" : e[k + "State"]));
  if (states.every((s) => s === "ok")) return true;
  if (states.some((s) => s === "error")) panel.append(el("p", "muted", e.t.inv_load_error));
  else {
    const sk = el("div", "skeleton");
    sk.append(el("div"), el("div"), el("div"));
    panel.append(sk);
  }
  return false;
}

// A source from data/invest-static.json with its publish date: "KPL ... (26 ก.พ. 2026)"
export function staticSource(e, id) {
  const all = e.stat && e.stat.sources && e.stat.sources[id];
  if (!all) return null;
  // "edition" (the month in a report's own name) is for sentences (sourceWords); the footer shows the name of the
  // report, which already says it, and the day it was published
  const { edition, ...src } = all;
  if (!src.published) return src;
  // "2022" = only the year is known; "2025-12" = the month; "2026-02-26" = the day
  const when = /^\d{4}$/.test(src.published) ? src.published : /^\d{4}-\d{2}$/.test(src.published) ? monthText(src.published, e.t) : formatDate(src.published, e.t);
  return { ...src, source_name: `${src.source_name} (${when})` };
}

// Replace {name} placeholders
export function fill(text, values) {
  return text.replace(/\{(\w+)\}/g, (m, k) => (values[k] === undefined ? m : values[k]));
}

// No year and no number is typed inside a sentence (audit 2026-10-02, P2-4): the sentences name them with
// placeholders, and the values come from data/invest-static.json through these two helpers.
// The five-year plan: { from, to, span (years), no (which plan it is) } - "แผน {span} ปี ครั้งที่ {no} ({from}–{to})"
export function planYears(e) {
  const plan = (e.stat && e.stat.plan) || {};
  const [from, to] = plan.period || [];
  return { from, to, span: to - from + 1, no: plan.number };
}
export const planLabel = (e) => fill(e.t.inv_plan_target_line, planYears(e));
// The report a fact was read in: { edition: "มิ.ย. 2026" (the month in the report's own name; else the month it
// was published), published: the month it was published, source_year: "2020" }
export function sourceWords(e, id) {
  const src = e.stat && e.stat.sources && e.stat.sources[id];
  if (!src) return {};
  const month = (v) => (/^\d{4}-\d{2}/.test(v || "") ? monthText(v.slice(0, 7), e.t) : v || "");
  return { edition: month(src.edition || src.published), published: month(src.published), source_year: String(src.published || "").slice(0, 4) };
}

// ---------- Yearly chart: actual (World Bank) + forecast (IMF, dashed) ----------
const FIRST_YEAR = 2010;
const SOURCE_LABEL = { worldbank: "World Bank", imf: "IMF" };
export const unitName = unitText; // unit in words (i18n unit_names)
export const sourceLabel = (id) => SOURCE_LABEL[id] || id;

// A rate (%, % of GDP ...) can be compared across sources as it is; a level (dollars, people) cannot
const isRate = (unit) => String(unit || "").startsWith("%");
const round3 = (v) => Math.round(v * 1000) / 1000;

// def: { actual: indicator id (World Bank), forecast: indicator id (IMF), unit?: override } -> one value per year
// When the two sources measure a LEVEL differently (GDP 2025: World Bank 18.30, IMF 17.82 billion dollars), the
// IMF's forecast LEVELS must not be glued to the World Bank's last value - the first forecast year would show a
// jump that nobody forecast. The forecast keeps the IMF's own path of change and starts from the last real value:
//   forecast(year) = last real value x IMF(year) / IMF(last real year)          ("rebased": true in the result)
// Without an IMF value for the last real year there is no forecast line at all. Rates are joined as they are.
export function buildSeries(e, def, firstYear = FIRST_YEAR) {
  const act = def.actual && indicator(e, def.actual);
  const fc = def.forecast && indicator(e, def.forecast);
  let actualPoints;
  let forecastPoints = [];
  let rebased = false;
  if (act && act.values.length) {
    actualPoints = act.values;
    const [lastActual, lastValue] = actualPoints[actualPoints.length - 1];
    if (fc) forecastPoints = fc.values.filter(([y]) => y > lastActual);
    if (forecastPoints.length && !isRate(def.unit || act.unit)) {
      const base = valueIn(fc, lastActual);
      forecastPoints = base ? forecastPoints.map(([y, v]) => [y, round3((lastValue * v) / base)]) : [];
      rebased = forecastPoints.length > 0;
    }
  } else if (fc && fc.values.length) {
    // IMF only: years before this year = actual/estimate, this year onwards = forecast
    actualPoints = fc.values.filter(([y]) => y < THIS_YEAR);
    forecastPoints = fc.values.filter(([y]) => y >= THIS_YEAR);
  } else {
    return null;
  }
  const last = actualPoints[actualPoints.length - 1];
  if (forecastPoints.length && last) forecastPoints = [last, ...forecastPoints]; // the dashed line starts at the last real point
  const allYears = [...actualPoints, ...forecastPoints].map(([y]) => y).filter((y) => y >= firstYear);
  if (!allYears.length) return null;
  const years = [];
  for (let y = firstYear; y <= Math.max(...allYears); y++) years.push(y);
  const pick = (points) => {
    const m = new Map(points);
    return years.map((y) => (m.has(y) ? m.get(y) : null));
  };
  return {
    years,
    unit: def.unit || (act || fc).unit,
    lastActual: last ? last[0] : null,
    lastValue: last ? last[1] : null,
    actual: pick(actualPoints),
    forecast: forecastPoints.length ? pick(forecastPoints) : null,
    // without the repeated last real year: what the read-out and the table show as "forecast"
    forecastOnly: forecastPoints.length ? pick(last ? forecastPoints.slice(1) : forecastPoints) : null,
    sources: [...new Set([act && act.source, forecastPoints.length && fc && fc.source].filter(Boolean))],
    stale: [act, fc].some((x) => x && x.stale),
    isEstimate: !act,
    rebased,
  };
}

// Chart card for a yearly indicator. target: { value, label, year? } draws a grey dashed line (a goal, not data).
// The line crosses the whole chart so every year can be compared with it, but the read-out and the table show
// the goal only where it applies: the years of the plan, or the one year it must be reached by (target.year).
// unitLabel: the unit in words when the plain unit says too little (e.g. "% ต่อปี" instead of "%")
// more: (years) => [series] - further lines of the same unit (e.g. the same thing as another source counts it);
//       moreSources = their sources for the footer, moreNote = one more piece of the subtitle
export function yearChart(e, def, { title, target, firstYear, unitLabel, more, moreSources = [], moreNote } = {}) {
  const { t } = e;
  const s = buildSeries(e, def, firstYear);
  if (!s) return null;
  // the IMF's numbers for past years are its own estimates until a country's final data arrive: never "actual"
  const series = [{ label: s.isEstimate ? t.series_imf_estimate : t.series_actual, kind: "official", values: s.actual }];
  if (s.forecast) series.push({ label: t.series_imf_forecast, kind: "official", dashed: true, soft: true, values: s.forecast, shown: s.forecastOnly });
  if (more) series.push(...more(s.years));
  if (target) {
    const period = e.stat && e.stat.plan && e.stat.plan.period;
    const applies = (y) => (target.year ? y === target.year : !period || (y >= period[0] && y <= period[1]));
    const shown = s.years.map((y) => (applies(y) ? target.value : null));
    series.push({
      label: target.label, kind: "official", color: "--muted", dashed: true, soft: true,
      values: s.years.map(() => target.value),
      shown: shown.some((v) => v !== null) ? shown : undefined,
    });
  }
  const subtitle = [
    `${t.unit}: ${unitLabel || unitName(s.unit, t)}`,
    `${t.source}: ${s.sources.map(sourceLabel).join(" + ")}`,
    `${s.isEstimate ? t.latest_estimate_year : t.latest_actual_year} ${s.lastActual}`,
    s.forecast ? (s.rebased ? t.forecast_rebased : t.dashed_is_forecast) : null,
    moreNote || null,
    s.stale ? "⚠ " + t.inv_fetch_failed : null,
  ].filter(Boolean).join(" · ");
  // nowLabel: a chart with a forecast shows this year's values at rest, not the last forecast year (charts.js restPoint)
  const c = chartCard({ title, subtitle, labels: s.years.map(String), series, unit: s.unit, unitLabel, t, firstColTitle: t.year, nowLabel: String(THIS_YEAR) });
  // every chart names its sources with their edition and the day they were read
  const sources = [...s.sources.map((id) => sourceOf(e, id)), ...moreSources].filter(Boolean);
  if (sources.length) c.append(sourcesFoot(t, sources));
  return c;
}

export { formatNumber };
