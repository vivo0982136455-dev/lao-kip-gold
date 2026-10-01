// Shared parts of the economy tabs: finding values, "latest or old" labels, source links, bar tables, status badges.
// Every number on these tabs is shown with where it comes from and which year/month it is.

import { el, card, cardHead, statTile, sourceLink } from "../ui.js";
import { formatNumber, formatDate, todayVientiane, unitText } from "../format.js";
import { chartCard } from "../charts.js";

export const THIS_YEAR = Number(todayVientiane().slice(0, 4));
export const lastOf = (a) => (a && a.length ? a[a.length - 1] : null);
export const pct = (from, to) => ((to - from) / from) * 100;
export const monthText = (m, t) => `${t.months[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`; // "2026-08" -> "ส.ค. 2026"
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

// USD millions -> "10.02 พันล้าน USD" / "886.8 ล้าน USD"
export function usdText(millions, t) {
  if (Math.abs(millions) >= 1000) return `${(millions / 1000).toFixed(2)} ${t.unit_usd_bn}`;
  return `${millions.toLocaleString("en-US", { maximumFractionDigits: 1 })} ${t.unit_usd_m}`;
}
export const pctText = (v, d = 1) => `${v.toFixed(d)}%`;
// 688 -> "688", 35493 -> "35,493" (counts, hectares, square metres, kip prices: never decimals)
export const whole = (v) => Math.round(v).toLocaleString("en-US");

// "Latest or old" label for one number.
//   period: { year } | { month: "2026-08" } | { date: "2026-02-26" } ; stale = our last download failed (old copy kept)
//   Yearly data is "old" when it is more than 2 years behind, monthly data when more than 6 months behind.
// compact: in table rows, say nothing more when the number is fine (only "old" / "failed" are shown)
export function freshness(t, { year, month, date, stale, checked, compact }) {
  const box = el("span", "fresh");
  let period = "";
  let old = false;
  if (year !== undefined && year !== null) {
    period = `${t.year} ${year}`;
    old = year < THIS_YEAR - 2;
  } else if (month) {
    period = monthText(month, t);
    old = monthsAgo(month) > 6;
  } else if (date) {
    period = `${t.inv_as_of} ${formatDate(date, t)}`;
  }
  if (period) box.append(el("span", "", period));
  let status;
  if (stale) status = el("span", "fresh-stale", `⚠ ${t.inv_fetch_failed}`);
  else if (old) status = el("span", "fresh-old", t.inv_old_data);
  else if (checked) status = el("span", "fresh-ok", `✓ ${t.inv_checked} ${formatDate(checked, t)}`);
  else if (!compact) status = el("span", "fresh-ok", `✓ ${t.inv_latest}`);
  if (status) box.append(status);
  return box;
}

// "Source: link, link · updated at the source 13 ก.ค. 2026"
export function sourcesFoot(t, sources, sourceUpdated) {
  const foot = el("div", "card-foot");
  foot.append(`${t.source}: `);
  sources.filter(Boolean).forEach((src, i) => {
    if (i > 0) foot.append(", ");
    foot.append(sourceLink(src));
  });
  if (sourceUpdated) foot.append(` · ${t.inv_source_updated} ${formatDate(sourceUpdated, t)}`);
  return foot;
}

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

// Table with a bar per row. rows: [{ label, sub, value, text, share }]; bar length = value / max (from 0).
// value: null = a row without a bar (e.g. a total)
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
    name.append(el("span", "", r.label));
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
    tr.append(name, cell, el("td", "", r.share === undefined ? "" : r.share));
    body.append(tr);
  }
  const box = el("div", "table-wrap wrap-first");
  box.append(tbl);
  return box;
}

// Target status: "met" | "near" | "far" | "none" -> badge with an icon (never colour alone)
export function statusBadge(t, status) {
  const icon = { met: "✓", near: "≈", far: "✗", none: "—" }[status];
  return el("span", `status status-${status}`, `${icon} ${t["inv_status_" + status]}`);
}

// Compare an actual value with a target. op: ">=" (at least) or "<=" (at most). near = within 10% of the target.
export function targetStatus(actual, target, op) {
  if (actual === null || actual === undefined) return "none";
  const ok = op === ">=" ? actual >= target : actual <= target;
  if (ok) return "met";
  const gap = Math.abs(actual - target) / Math.abs(target);
  return gap <= 0.1 ? "near" : "far";
}

// Are the lazily loaded files there? If not, show a placeholder (loading) or a message (failed) and return false.
// keys: "invest" (data/invest.json), "stat" (data/invest-static.json)
export function ready(panel, e, keys = ["invest", "stat"]) {
  const states = keys.map((k) => e[k + "State"]);
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
  const src = e.stat && e.stat.sources && e.stat.sources[id];
  if (!src) return null;
  if (!src.published) return src;
  // "2025-12" = only the month is known; "2026-02-26" = the day
  const when = /^\d{4}-\d{2}$/.test(src.published) ? monthText(src.published, e.t) : formatDate(src.published, e.t);
  return { ...src, source_name: `${src.source_name} (${when})` };
}

// Replace {name} placeholders
export function fill(text, values) {
  return text.replace(/\{(\w+)\}/g, (m, k) => (values[k] === undefined ? m : values[k]));
}

// ---------- Yearly chart: actual (World Bank) + forecast (IMF, dashed) ----------
const FIRST_YEAR = 2010;
const SOURCE_LABEL = { worldbank: "World Bank", imf: "IMF" };
export const unitName = unitText; // unit in words (i18n unit_names)
export const sourceLabel = (id) => SOURCE_LABEL[id] || id;

// "4.5%" or "18.30 พันล้าน USD"
export function valueWithUnit(v, unit, t) {
  return unit.startsWith("%") ? `${formatNumber(v, unit)}%` : `${formatNumber(v, unit)} ${unitName(unit, t)}`;
}

// def: { actual: indicator id (World Bank), forecast: indicator id (IMF), unit?: override } -> one value per year
export function buildSeries(e, def, firstYear = FIRST_YEAR) {
  const act = def.actual && indicator(e, def.actual);
  const fc = def.forecast && indicator(e, def.forecast);
  let actualPoints;
  let forecastPoints = [];
  if (act && act.values.length) {
    actualPoints = act.values;
    const lastActual = actualPoints[actualPoints.length - 1][0];
    if (fc) forecastPoints = fc.values.filter(([y]) => y > lastActual);
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
  };
}

// Chart card for a yearly indicator. target: { value, label, year? } draws a grey dashed line (a goal, not data).
// The line crosses the whole chart so every year can be compared with it, but the read-out and the table show
// the goal only where it applies: the years of the plan, or the one year it must be reached by (target.year).
// unitLabel: the unit in words when the plain unit says too little (e.g. "% ต่อปี" instead of "%")
export function yearChart(e, def, { title, target, firstYear, unitLabel } = {}) {
  const { t } = e;
  const s = buildSeries(e, def, firstYear);
  if (!s) return null;
  const series = [{ label: t.series_actual, kind: "official", values: s.actual }];
  if (s.forecast) series.push({ label: t.series_imf_forecast, kind: "official", dashed: true, soft: true, values: s.forecast, shown: s.forecastOnly });
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
    s.forecast ? t.dashed_is_forecast : null,
    s.stale ? "⚠ " + t.inv_fetch_failed : null,
  ].filter(Boolean).join(" · ");
  return chartCard({ title, subtitle, labels: s.years.map(String), series, unit: s.unit, unitLabel, t, firstColTitle: t.year });
}

export { formatNumber };
