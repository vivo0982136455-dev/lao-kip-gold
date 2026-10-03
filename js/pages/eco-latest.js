// Economy page: ONE answer per indicator. Every tab asks here for "the newest inflation", "the reserves",
// "the public debt" ..., so two tabs can no longer show two different "latest" numbers (audit 2026-10-02, P1-1).
//   - where one source is simply newer than another, the newest one wins (inflation: the central bank's page is a
//     month ahead of the IMF's series; reserves: the central bank's monthly figure, not a yearly series of 2024)
//   - where sources really count different things (public debt: three ways of counting the same year), the
//     resolver returns every one of them, the tiles show the range, and differCard() says what each one counts
// e = what a tab gets: { t, economy (data/economy.json), invest (data/invest.json), stat (data/invest-static.json),
//     bank (data/bol-policy.json or null) }. Nothing here changes a source value.

import { el, card, cardHead } from "../ui.js";
import { formatDate } from "../format.js";
import {
  THIS_YEAR, lastOf, indicator, latest, valueIn, newest, usdText, pctText, fill, monthText, sourcesFoot, staticSource, sourceOf,
} from "./eco-common.js";

const facts = (e) => (e.stat && e.stat.facts) || {};
const checkedDay = (e) => facts(e).checked || (e.stat && e.stat.checked) || null;
const bankPart = (e, id) => (e.bank && e.bank[id] && Array.isArray(e.bank[id].rows) && e.bank[id].rows.length ? e.bank[id] : null);

// ---------- inflation (monthly, compared with the same month a year before) ----------
// The IMF's series, continued with the months the central bank has already published on its own page.
//   -> { values: [[month, %]], last: [month, %], from: "imf" | "bol", imfLast: month, stale, sources: [...] } | null
export function inflationSeries(e) {
  const cpi = e.economy && e.economy.monthly && e.economy.monthly.cpi_yoy;
  if (!cpi || !cpi.values || !cpi.values.length) return null;
  const imfLast = lastOf(cpi.values)[0];
  const bol = bankPart(e, "inflation");
  const more = bol ? bol.rows.filter(([m]) => m > imfLast) : [];
  const values = [...cpi.values, ...more];
  return {
    values,
    last: lastOf(values),
    from: more.length ? "bol" : "imf",
    imfLast,
    stale: more.length ? !!bol.stale : !!cpi.stale,
    sources: [e.economy.sources && e.economy.sources[cpi.source], more.length ? e.bank.sources.bol_inflation : null].filter(Boolean),
  };
}
//   -> { value, when: { month }, src: "IMF" | "BOL", stale, series } | null
export function latestInflation(e) {
  const s = inflationSeries(e);
  return s ? { value: s.last[1], when: { month: s.last[0] }, src: s.from === "bol" ? "BOL" : "IMF", stale: s.stale, series: s } : null;
}

// ---------- foreign-exchange reserves ----------
// In months of imports: the number of the newest World Bank report (hand-read, with the Bank of the Lao PDR's own
// count of the same reserves next to it) or the yearly World Bank series, whichever is newer.
//   -> { value, bol: months in the central bank's count | null, usd_bn | null, when, src, stale, checked, source } | null
export function reservesMonths(e) {
  const f = facts(e).reserves_wb;
  const ind = indicator(e, "wb.FI.RES.TOTL.MO");
  const l = latest(ind);
  return newest(
    f ? { value: f.months, bol: f.months_bol === undefined ? null : f.months_bol, usd_bn: f.usd_bn, when: { month: f.month }, src: "World Bank", stale: false, checked: checkedDay(e), source: f.source } : null,
    l ? { value: l[1], bol: null, usd_bn: null, when: { year: l[0] }, src: "World Bank", stale: ind.stale, checked: null, source: null } : null
  );
}
// In dollars: the central bank's monthly figure, or the yearly World Bank series when that file is not there.
//   -> { usd: { value (US$ bn), when, src, stale, rows: [[month, US$ m]] | null, swap: month | null } | null, months: reservesMonths() }
export function latestReserves(e) {
  const bank = bankPart(e, "reserves");
  const ind = indicator(e, "wb.FI.RES.TOTL.CD");
  const l = latest(ind);
  const usd = newest(
    bank ? { value: lastOf(bank.rows)[1] / 1000, when: { month: lastOf(bank.rows)[0] }, src: "BOL", stale: !!bank.stale, rows: bank.rows, swap: bank.includes_swap_since || null, source: e.bank.sources.bol_reserves } : null,
    l ? { value: l[1], when: { year: l[0] }, src: "World Bank", stale: ind.stale, rows: null, swap: null, source: sourceOf(e, "worldbank") } : null
  );
  return { usd, months: reservesMonths(e) };
}

// ---------- numbers that several sources give for the same year ----------
// -> { year, list: [{ who, value, ... }] (the sources that have that year), low, high } | null
function sameYear(list) {
  const have = list.filter((x) => x && x.value !== null && x.value !== undefined);
  if (!have.length) return null;
  const year = Math.max(...have.map((x) => x.year));
  const same = have.filter((x) => x.year === year);
  const values = same.map((x) => x.value);
  return { year, list: same, low: Math.min(...values), high: Math.max(...values) };
}
// "80.6–87.1%" (or "4.8%" when every source says the same to one decimal)
export function rangeText(r, decimals = 1) {
  const low = r.low.toFixed(decimals);
  const high = r.high.toFixed(decimals);
  return low === high ? `${low}%` : `${low}–${high}%`;
}

// Public debt in % of GDP, newest year that is not a forecast: IMF (yearly series), Ministry of Finance and World
// Bank (both hand-read from the World Bank's report). who: "imf" | "mof" | "wb"
export function publicDebt(e) {
  const F = facts(e);
  const ind = indicator(e, "imf.GGXWDG_NGDP");
  const l = latest(ind, THIS_YEAR);
  return sameYear([
    l ? { who: "imf", value: l[1], year: l[0], stale: ind.stale, estimate: true } : null,
    F.debt_mof ? { who: "mof", value: F.debt_mof.pct, year: F.debt_mof.year, source: F.debt_mof.source, fact: F.debt_mof } : null,
    F.debt_peak ? { who: "wb", value: F.debt_peak.now, year: F.debt_peak.now_year, source: F.debt_peak.source } : null,
  ]);
}

// Economic growth of the newest finished year: the World Bank's database, the World Bank's report on Laos
// (hand-read) and the IMF. who: "wdi" | "lem" | "imf"
export function growthNow(e) {
  const F = facts(e);
  const wdi = indicator(e, "wb.NY.GDP.MKTP.KD.ZG");
  const l = latest(wdi);
  const imf = indicator(e, "imf.NGDP_RPCH");
  const year = l ? l[0] : F.growth_drivers ? F.growth_drivers.year : null;
  const imfValue = year ? valueIn(imf, year) : null;
  return sameYear([
    l ? { who: "wdi", value: l[1], year: l[0], stale: wdi.stale } : null,
    F.growth_drivers ? { who: "lem", value: F.growth_drivers.growth, year: F.growth_drivers.year, source: F.growth_drivers.source } : null,
    imfValue !== null && year < THIS_YEAR ? { who: "imf", value: imfValue, year, stale: imf.stale, estimate: true } : null,
  ]);
}

// What the State must pay on its foreign debt: the schedule of the debt that exists (World Bank IDS, automatic)
// and what the World Bank's report on Laos says (hand-read). -> { ids: { year, total (US$ m), china, stock } | null,
// avg: fact | null, year: fact | null }
export function debtServiceNow(e) {
  const F = facts(e);
  const ds = e.invest && e.invest.parts && e.invest.parts.debt_service;
  let ids = null;
  if (ds && ds.years && ds.years.length) {
    const i = ds.years.indexOf(Math.max(THIS_YEAR, ds.first_projected));
    if (i >= 0 && ds.principal[i] !== null) {
      const total = ds.principal[i] + (ds.interest[i] || 0);
      ids = { year: ds.years[i], total, china: ds.china[i] !== null ? (ds.china[i] / total) * 100 : null, stock: ds.first_projected - 1, stale: !!ds.stale };
    }
  }
  return { ids, avg: F.debt_service_avg || null, year: F.debt_service_year || null };
}

// ---------- "why the numbers differ" ----------
// One line per source: its number and what it counts. The sentences are in i18n ("dif_<topic>_<who>"), every
// number comes from the resolvers above. topics: "inflation" | "reserves" | "debt" | "growth" | "debt_service"
export function differCard(e, topics) {
  const { t } = e;
  const day = (d) => (d ? formatDate(d, t) : "—");
  const month = (m) => (m ? monthText(m, t) : "—");
  const imfSource = sourceOf(e, "imf") || {};
  const wbSource = sourceOf(e, "worldbank") || {};
  const report = e.stat && e.stat.policy && e.stat.policy.read ? month(e.stat.policy.read.date.slice(0, 7)) : "—";
  const used = new Set();
  const more = [];
  const blocks = [];
  const add = (topic, lines) => {
    const list = lines.filter(Boolean);
    if (list.length > 1) blocks.push([t["dif_" + topic], list]);
  };
  const edition = imfSource.edition ? month(imfSource.edition) : "—";

  if (topics.includes("inflation")) {
    const s = inflationSeries(e);
    const cpi = e.economy.monthly && e.economy.monthly.cpi_yoy;
    const imfLast = cpi && lastOf(cpi.values);
    const yearly = latest(indicator(e, "wb.FP.CPI.TOTL.ZG"));
    const imfYear = valueIn(indicator(e, "imf.PCPIPCH"), THIS_YEAR);
    // the months both sources have: said to agree only when every one of them really does
    const imfMap = new Map(cpi ? cpi.values : []);
    const both = (bankPart(e, "inflation") || { rows: [] }).rows.filter(([m]) => imfMap.has(m));
    const agree = both.length > 0 && both.every(([m, v]) => Math.abs(imfMap.get(m) - v) < 0.051);
    add("inflation", [
      imfLast && fill(t.dif_inflation_imf, { value: pctText(imfLast[1]), month: month(imfLast[0]) }),
      s && s.from === "bol" && fill(t.dif_inflation_bol, { value: pctText(s.last[1]), month: month(s.last[0]) }) + (agree ? ` · ${fill(t.dif_inflation_same, { n: both.length })}` : ""),
      yearly && imfYear !== null && fill(t.dif_inflation_year, { wb: pctText(yearly[1]), year: yearly[0], imf: pctText(imfYear), this_year: THIS_YEAR }),
    ]);
    if (s) for (const src of s.sources) more.push(src);
  }
  if (topics.includes("reserves")) {
    const r = latestReserves(e);
    const wdi = latest(indicator(e, "wb.FI.RES.TOTL.MO"));
    const m = r.months;
    add("reserves", [
      r.usd && r.usd.src === "BOL" && fill(t.dif_reserves_bol_usd, { usd: r.usd.value.toFixed(2), month: month(r.usd.when.month), swap: month(r.usd.swap) }),
      m && m.when.month && fill(t.dif_reserves_wb, { months: m.value.toFixed(1), month: month(m.when.month), usd_bn: m.usd_bn }),
      m && m.bol !== null && fill(t.dif_reserves_bol, { months: m.bol.toFixed(1), month: month(m.when.month) }),
      wdi && fill(t.dif_reserves_wdi, { months: wdi[1].toFixed(1), year: wdi[0] }),
    ]);
    if (r.usd && r.usd.source) more.push(r.usd.source);
    if (m && m.source) used.add(m.source);
  }
  if (topics.includes("debt")) {
    const d = publicDebt(e);
    const by = (who) => d && d.list.find((x) => x.who === who);
    const mof = by("mof");
    add("debt", [
      by("imf") && fill(t.dif_debt_imf, { value: pctText(by("imf").value), year: d.year, edition }),
      mof && fill(t.dif_debt_mof, { value: pctText(mof.value, mof.value % 1 ? 1 : 0), year: d.year, deferred_bn: mof.fact.deferred_bn, from: mof.fact.from, to: mof.fact.to }),
      by("wb") && fill(t.dif_debt_wb, { value: pctText(by("wb").value), year: d.year }),
    ]);
    if (d) for (const x of d.list) if (x.source) used.add(x.source);
    if (by("imf")) more.push(imfSource);
  }
  if (topics.includes("growth")) {
    const g = growthNow(e);
    const by = (who) => g && g.list.find((x) => x.who === who);
    add("growth", [
      by("wdi") && fill(t.dif_growth_wdi, { value: pctText(by("wdi").value), year: g.year, updated: day(wbSource.updated) }),
      by("lem") && fill(t.dif_growth_lem, { value: pctText(by("lem").value), year: g.year, report }),
      by("imf") && fill(t.dif_growth_imf, { value: pctText(by("imf").value), year: g.year, edition }),
    ]);
    if (g) for (const x of g.list) if (x.source) used.add(x.source);
    if (by("wdi")) more.push(wbSource);
    if (by("imf")) more.push(imfSource);
  }
  if (topics.includes("debt_service")) {
    const s = debtServiceNow(e);
    add("debt_service", [
      s.ids && fill(t.dif_service_ids, { amount: usdText(s.ids.total, t), year: s.ids.year, stock: s.ids.stock }),
      s.avg && fill(t.dif_service_avg, { ...s.avg, report }),
      s.year && fill(t.dif_service_year, { ...s.year, report }),
    ]);
    for (const f of [s.avg, s.year]) if (f && f.source) used.add(f.source);
    if (s.ids) more.push(sourceOf(e, "wb_ids"));
  }
  if (!blocks.length) return null;

  const c = card("estimated", "differ-card");
  c.append(cardHead(t.dif_title, null, false, t));
  c.append(el("p", "note", t.dif_intro));
  for (const [title, lines] of blocks) {
    c.append(el("h4", "differ-topic", title));
    const ul = el("ul", "watch-list");
    for (const line of lines) ul.append(el("li", "", line));
    c.append(ul);
  }
  const seen = new Set();
  const sources = [...more, ...[...used].map((id) => staticSource(e, id))].filter((src) => src && !seen.has(src.source_name) && seen.add(src.source_name));
  if (sources.length) c.append(sourcesFoot(t, sources));
  return c;
}
