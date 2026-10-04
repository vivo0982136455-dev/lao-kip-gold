// Economy tab: population - the people behind the economy. How many, how old, where they live, what work they do,
// who leaves, and what the next 25 years look like.
//   data/population.json (scripts/fetch-population.js, weekly): World Bank yearly numbers + projections to 2050,
//       the neighbours' newest values, Lao Statistics Bureau / UNFPA population by province and age group
//   data/invest-static.json "population": facts quoted from reports (work, median age, household size) and the
//       state of the census
// A head count is never called a market (audit 2026-10-02, P1-8): what people can spend has its own section -
// income per person at purchasing power, household consumption, poverty, household size, each with its own year.
// Two different counts of the same people are shown, each with its source: the World Bank estimate (7.9 m, 2025)
// and the Lao Statistics Bureau / UNFPA projection by province (7.6 m, 2024). The 2025 census will replace both.

import { el, card, cardHead, table } from "../ui.js";
import { chartCard } from "../charts.js";
import { formatNumber } from "../format.js";
import { lazyJson } from "../lazy.js";
import { lastOf, dayFull, freshness, sourcesFoot, invTile, factsCard, barTable, fill, staticSource, countryName, whole, FOCUS_PROVINCES, sourceWords, THIS_YEAR } from "./eco-common.js";

const million = (v) => (v / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct1 = (v) => `${v.toFixed(1)}%`;
const valueIn = (ind, year) => {
  const hit = ind && ind.values.find(([y]) => y === year);
  return hit ? hit[1] : null;
};

// ---------- key numbers ----------
function tiles(p, t) {
  const I = p.indicators;
  const stats = el("div", "stats");
  const tile = (ind, label, value, sub) => {
    if (!ind || !ind.values.length) return;
    const last = lastOf(ind.values);
    stats.append(invTile(t, label, value(last[1]), sub ? sub(last) : "World Bank", freshness(t, { year: last[0], stale: ind.stale }), "official"));
  };
  const pop = I.pop && lastOf(I.pop.values);
  tile(I.pop, t.pop_k_total, (v) => ({ num: million(v), unit: t.pop_unit_million }), (last) => {
    const before = valueIn(I.pop, last[0] - 1);
    return before ? fill(t.pop_k_total_sub, { n: whole(last[1] - before) }) : "World Bank";
  });
  tile(I.working, t.pop_k_working, (v) => pct1(v), (last) => (pop ? fill(t.pop_k_people, { n: million((pop[1] * last[1]) / 100) }) : ""));
  tile(I.young, t.pop_k_young, (v) => pct1(v), (last) => (pop ? fill(t.pop_k_people, { n: million((pop[1] * last[1]) / 100) }) : ""));
  tile(I.old, t.pop_k_old, (v) => pct1(v), (last) => (pop ? fill(t.pop_k_people, { n: million((pop[1] * last[1]) / 100) }) : ""));
  tile(I.urban, t.pop_k_urban, (v) => pct1(v), () => {
    const u = I.urban_pop && lastOf(I.urban_pop.values);
    return u ? fill(t.pop_k_people, { n: million(u[1]) }) : "";
  });
  tile(I.fertility, t.pop_k_fertility, (v) => ({ num: v.toFixed(2), unit: t.pop_unit_children }), () => t.pop_k_fertility_sub);
  tile(I.life, t.pop_k_life, (v) => ({ num: v.toFixed(1), unit: t.pop_unit_years }), () => "World Bank");
  tile(I.labour, t.pop_k_labour, (v) => ({ num: million(v), unit: t.pop_unit_million }), () => {
    const part = I.participation && lastOf(I.participation.values);
    return part ? fill(t.pop_k_labour_sub, { pct: part[1].toFixed(0) }) : "";
  });
  return stats;
}

// ---------- population: counted so far and expected to 2050 ----------
function populationChart(p, t) {
  const actual = p.indicators.pop;
  const proj = p.projections && p.projections.series && p.projections.series.pop;
  if (!actual || !actual.values.length) return null;
  const lastYear = lastOf(actual.values)[0];
  const lastProj = proj && proj.length ? lastOf(proj)[0] : lastYear;
  const years = [];
  for (let y = actual.values[0][0]; y <= lastProj; y++) years.push(y);
  const am = new Map(actual.values);
  const pm = new Map(proj || []);
  const m = (v) => (v === undefined || v === null ? null : Math.round(v / 1e4) / 100); // people -> millions, 2 decimals
  const series = [{ label: t.pop_line_actual, kind: "official", values: years.map((y) => (y <= lastYear ? m(am.get(y)) : null)) }];
  if (proj && lastProj > lastYear) {
    series.push({
      label: t.pop_line_projection, kind: "official", dashed: true, soft: true,
      values: years.map((y) => (y >= lastYear ? m(y === lastYear ? am.get(y) : pm.get(y)) : null)), // the dashed line starts at the last counted year
      shown: years.map((y) => (y > lastYear ? m(pm.get(y)) : null)),
    });
  }
  return chartCard({
    title: t.pop_chart_total,
    subtitle: `${t.unit}: ${t.pop_unit_million} · ${t.source}: World Bank · ${fill(t.pop_chart_total_sub, { year: lastYear })}${actual.stale ? " · ⚠ " + t.inv_fetch_failed : ""}`,
    labels: years.map(String),
    series,
    unit: "million people",
    unitLabel: t.pop_unit_million,
    t,
    firstColTitle: t.year,
    nowLabel: String(THIS_YEAR), // at rest the projection shows this year, not its last year (2050)
  });
}

// ---------- age groups: every fifth year, the future from the projection ----------
function agesCard(p, t) {
  const s = p.projections && p.projections.series;
  const I = p.indicators;
  if (!s || !s.pop || !I.pop) return null;
  const lastYear = lastOf(I.pop.values)[0];
  const end = lastOf(s.pop)[0];
  const years = [2000, 2010, 2020, lastYear];
  for (let y = Math.ceil((lastYear + 1) / 5) * 5; y <= end; y += 5) years.push(y);
  const at = (list, y) => {
    const hit = list.find(([yr]) => yr === y);
    return hit ? hit[1] : null;
  };
  const rows = [...new Set(years)].sort((a, b) => a - b).map((y) => {
    const future = y > lastYear;
    const pick = (id) => (future ? at(s[id], y) : valueIn(I[id], y) ?? at(s[id], y));
    const pop = pick("pop");
    const cells = ["young", "working", "old"].map((id) => (pick(id) === null ? "—" : pct1(pick(id))));
    return [future ? `${y}*` : String(y), pop === null ? "—" : million(pop), ...cells];
  });
  const c = card("official");
  c.append(cardHead(t.pop_ages_title, "official", !!p.projections.stale, t));
  const tb = table([t.year, t.pop_col_people_m, t.pop_col_young, t.pop_col_working, t.pop_col_old], rows);
  tb.classList.add("wrap-all");
  c.append(tb);
  const ul = el("ul", "watch-list");
  ul.append(el("li", "", fill(t.pop_ages_note_1, { year: lastYear })));
  // the year in which the working-age share is highest (the "demographic window")
  const peak = s.working.reduce((a, b) => (b[1] > a[1] ? b : a));
  ul.append(el("li", "", fill(t.pop_ages_note_2, { year: peak[0], pct: peak[1].toFixed(1) })));
  c.append(ul);
  const fresh = el("div", "card-foot");
  fresh.append(freshness(t, { year: lastYear, stale: p.projections.stale }));
  c.append(fresh, sourcesFoot(t, [p.sources.worldbank, p.sources.wb_projections], p.projections.source_updated));
  return c;
}

// ---------- age pyramid of the newest Lao Statistics Bureau / UNFPA projection ----------
function pyramidCard(p, e) {
  const { t } = e;
  const pv = p.provinces;
  if (!pv || !pv.ages || !pv.ages.length) return null;
  const max = Math.max(...pv.ages.flatMap(([, f, m]) => [f, m]));
  const c = card("official");
  c.append(cardHead(fill(t.pop_pyramid_title, { year: pv.year }), "official", !!pv.stale, t));
  const box = el("div", "pyramid");
  box.setAttribute("role", "img");
  box.setAttribute("aria-label", fill(t.pop_pyramid_title, { year: pv.year }));
  // heading row: the colour key sits next to each word, so men / women are never told apart by colour alone
  const head = el("div", "pyr-row pyr-head");
  const headLeft = el("span", "pyr-side pyr-left");
  headLeft.append(el("span", "", t.pop_men), el("span", "pyr-key pyr-men"));
  const headRight = el("span", "pyr-side pyr-right");
  headRight.append(el("span", "pyr-key pyr-women"), el("span", "", t.pop_women));
  head.append(headLeft, el("span", "pyr-age", t.pop_age), headRight);
  box.append(head);
  // one row per age group, oldest on top; bars grow from the middle, length = people (from 0, same scale both sides)
  const side = (people, cls, numberFirst) => {
    const s = el("span", `pyr-side ${numberFirst ? "pyr-left" : "pyr-right"}`);
    const track = el("span", "pyr-track");
    const bar = el("span", `pyr-bar ${cls}`);
    bar.style.width = `${(people / max) * 100}%`;
    track.append(bar);
    const num = el("span", "pyr-num", (people / 1000).toFixed(0));
    if (numberFirst) s.append(num, track);
    else s.append(track, num);
    return s;
  };
  for (const [age, women, men] of [...pv.ages].reverse()) {
    const row = el("div", "pyr-row");
    row.append(side(men, "pyr-men", true), el("span", "pyr-age", age), side(women, "pyr-women", false));
    box.append(row);
  }
  c.append(box, el("p", "note", t.pop_pyramid_note));
  const med = e.stat.population && e.stat.population.median_age;
  if (med) c.append(el("p", "note", fill(t.pop_median, { years: med.years, year: med.year })));
  const fresh = el("div", "card-foot");
  fresh.append(freshness(t, { year: pv.year, stale: pv.stale }));
  c.append(fresh, sourcesFoot(t, [p.sources.hdx_codps, med && staticSource(e, med.source)].filter(Boolean)));
  return c;
}

// ---------- every province ----------
// census = the census that will replace both counts (data/invest-static.json), for the note under the table
function provincesCard(p, t, census) {
  const pv = p.provinces;
  if (!pv || !pv.rows || !pv.rows.length) return null;
  const wb = p.indicators.pop && p.indicators.pop.values.length ? lastOf(p.indicators.pop.values) : null;
  const rows = pv.rows.map(([name, total, , , young, , old]) => ({
    label: t.provinces[name] || name,
    cls: FOCUS_PROVINCES.includes(name) ? "focus-name" : "",
    sub: fill(t.pop_prov_sub, { young: ((young / total) * 100).toFixed(0), old: ((old / total) * 100).toFixed(1) }),
    value: total,
    text: whole(total),
    share: pct1((total / pv.total) * 100),
  }));
  rows.push({ label: t.pop_prov_total, sub: null, value: null, text: whole(pv.total), share: "100%" });
  const c = card("official");
  c.append(cardHead(fill(t.pop_prov_title, { year: pv.year }), "official", !!pv.stale, t));
  const tb = barTable([t.inv_land_col_province, t.pop_col_people, t.pop_col_share], rows);
  tb.classList.add("total-last");
  c.append(tb, el("p", "note", t.pop_prov_note));
  // the two counts of the same people, side by side, so that the difference is not a surprise
  if (wb) c.append(el("p", "note", fill(t.pop_prov_two_counts, { lsb: million(pv.total), lsb_year: pv.year, wb: million(wb[1]), wb_year: wb[0], census_year: census ? census.year : "" })));
  const fresh = el("div", "card-foot");
  fresh.append(freshness(t, { year: pv.year, stale: pv.stale }));
  c.append(fresh, sourcesFoot(t, [p.sources.hdx_codps]));
  return c;
}

// ---------- work ----------
function workChart(p, t) {
  const I = p.indicators;
  if (!I.emp_agri || !I.emp_agri.values.length) return null;
  const years = I.emp_agri.values.map(([y]) => y);
  const on = (ind) => {
    const m = new Map(ind ? ind.values : []);
    return years.map((y) => (m.has(y) ? Math.round(m.get(y) * 10) / 10 : null));
  };
  return chartCard({
    title: t.pop_work_chart,
    subtitle: `${t.unit}: ${t.pop_unit_workers} · ${t.source}: World Bank (ILO) · ${t.pop_work_chart_sub}`,
    labels: years.map(String),
    series: [
      { label: t.pop_work_agri, kind: "estimated", color: "--cat-4", values: on(I.emp_agri) },
      { label: t.pop_work_srv, kind: "estimated", color: "--cat-1", values: on(I.emp_srv) },
      { label: t.pop_work_ind, kind: "estimated", color: "--cat-3", values: on(I.emp_ind) },
    ],
    unit: "%",
    unitLabel: t.pop_unit_workers,
    t,
    firstColTitle: t.year,
  });
}

// ---------- money sent home ----------
function remitChart(p, t) {
  const r = p.indicators.remit_usd;
  if (!r || r.values.length < 3) return null;
  return chartCard({
    title: t.pop_remit_chart,
    subtitle: `${t.unit}: ${t.unit_usd_m} · ${t.source}: World Bank · ${t.pop_remit_sub}${r.stale ? " · ⚠ " + t.inv_fetch_failed : ""}`,
    labels: r.values.map(([y]) => String(y)),
    series: [{ label: t.pop_remit_line, kind: "official", values: r.values.map(([, v]) => Math.round(v * 10) / 10) }],
    unit: "USD m",
    noSince: true, // the first years are close to zero
    t,
    firstColTitle: t.year,
  });
}

// ---------- Laos next to its neighbours ----------
function neighboursCard(p, t) {
  const n = p.neighbours;
  if (!n || !n.rows || !n.rows.LAO || !n.rows.LAO.pop) return null;
  const v = (x, d) => (x ? x[1].toFixed(d) : "—");
  const lao = n.rows.LAO;
  // every number says which year it is (each country's newest year can differ): the year under the value, and a
  // mark when it is not the year of Laos' own number in that column (audit 2026-10-02, P2-10)
  let mixed = false;
  const cell = (id, r, text) => {
    if (!r[id]) return "—";
    const off = !!lao[id] && r[id][0] !== lao[id][0];
    if (off) mixed = true;
    const box = el("span", "", text(r[id][1]));
    box.append(el("span", off ? "sub-line cmp-year cmp-year-off" : "sub-line cmp-year", off ? `⚠ ${r[id][0]}` : String(r[id][0])));
    return box;
  };
  const yearOf = (x) => (x ? x[0] : "—");
  const rows = n.countries.map((iso) => {
    const r = n.rows[iso] || {};
    const name = el("span", iso === "LAO" ? "focus-name" : "", countryName(t, null, iso));
    name.append(el("span", "sub-line", fill(t.pop_nb_sub, { growth: v(r.growth, 1), growth_year: yearOf(r.growth), children: v(r.fertility, 1), children_year: yearOf(r.fertility) })));
    return [name, cell("pop", r, million), cell("young", r, pct1), cell("old", r, pct1), cell("urban", r, pct1)];
  });
  const c = card("official");
  c.append(cardHead(t.pop_nb_title, "official", !!n.stale, t));
  const tb = table([t.rw_col_country, t.pop_col_people_m, t.pop_col_young, t.pop_col_old, t.pop_col_urban], rows);
  tb.classList.add("wrap-first");
  c.append(tb, el("p", "note", `${t.pop_nb_note} · ${mixed ? t.pop_nb_years_mixed : t.pop_nb_years}`));
  const fresh = el("div", "card-foot");
  fresh.append(freshness(t, { year: n.rows.LAO.pop[0], stale: n.stale }));
  c.append(fresh, sourcesFoot(t, [p.sources.worldbank]));
  return c;
}

// ---------- what it means: short facts worked out from the numbers above ----------
function meaningCard(p, e) {
  const { t } = e;
  const I = p.indicators;
  const n = p.neighbours && p.neighbours.rows;
  const facts = [];
  const last = (id) => (I[id] && I[id].values.length ? lastOf(I[id].values) : null);
  const pop = last("pop");
  if (pop && n && n.THA && n.THA.pop && n.VNM && n.VNM.pop) {
    facts.push([fill(t.pop_f_size, { n: million(pop[1]), year: pop[0], tha: ((pop[1] / n.THA.pop[1]) * 100).toFixed(0), vnm: ((pop[1] / n.VNM.pop[1]) * 100).toFixed(0) }), null]);
  }
  const working = last("working");
  const s = p.projections && p.projections.series;
  if (working && s && s.working && s.working.length) {
    const peak = s.working.reduce((a, b) => (b[1] > a[1] ? b : a));
    facts.push([fill(t.pop_f_window, { now: working[1].toFixed(1), year: working[0], peak: peak[1].toFixed(1), peak_year: peak[0] }), null]);
  }
  const urb = I.urban_pop;
  if (urb && pop && urb.values.length > 10) {
    const u1 = lastOf(urb.values);
    const u0 = valueIn(urb, u1[0] - 10);
    const p0 = valueIn(I.pop, u1[0] - 10);
    if (u0 && p0) facts.push([fill(t.pop_f_urban, { years: 10, urban: (((u1[1] - u0) / u0) * 100).toFixed(0), all: (((valueIn(I.pop, u1[0]) - p0) / p0) * 100).toFixed(0), n: whole(u1[1] - u0) }), null]);
  }
  const agri = last("emp_agri");
  const wage = last("wage_workers");
  if (agri && wage) facts.push([fill(t.pop_f_work, { agri: agri[1].toFixed(0), wage: wage[1].toFixed(0), year: agri[0] }), null]);
  const w = e.stat.population && e.stat.population.work;
  if (w) facts.push([fill(t.pop_f_survey, { ...sourceWords(e, w.source), from: w.agri_from, to: w.agri_to, period_from: w.period_from, period_to: w.period_to, self: w.self_employed, family: w.family_work }), null]);
  const mig = last("net_migration");
  const rem = last("remit_usd");
  const remGdp = last("remit_gdp");
  if (mig && rem && remGdp) facts.push([fill(t.pop_f_migration, { n: whole(Math.abs(mig[1])), year: mig[0], usd: whole(rem[1]), gdp: remGdp[1].toFixed(1), rem_year: rem[0] }), null]);
  const pv = p.provinces;
  if (pv && pv.rows && pv.rows.length) {
    const of = (name) => pv.rows.find((r) => r[0] === name);
    const [vte, lpb] = [of("Vientiane Capital"), of("Louangphabang")];
    if (vte && lpb) facts.push([fill(t.pop_f_focus, { vte: million(vte[1]), vte_share: ((vte[1] / pv.total) * 100).toFixed(0), lpb: million(lpb[1]), lpb_share: ((lpb[1] / pv.total) * 100).toFixed(0), year: pv.year }), null]);
  }
  if (!facts.length) return null;
  return factsCard(t, t.pop_meaning_title, facts, t.pop_meaning_note);
}

// ---------- what people can spend ----------
const POVERTY_LINE_USD = "3.00"; // World Bank SI.POV.DDAY: people living on less than $3.00 a day (2021 PPP)
function spendingSection(p, e) {
  const { t } = e;
  const I = p.indicators;
  const last = (id) => (I[id] && I[id].values.length ? lastOf(I[id].values) : null);
  const stats = el("div", "stats");
  const sources = [];
  const gni = last("gni_ppp");
  if (gni) stats.append(invTile(t, t.pop_k_income, { num: formatNumber(gni[1], "intl$ per person"), unit: t.inv_unit_intl }, `World Bank · ${t.pop_k_income_sub}`, freshness(t, { year: gni[0], stale: I.gni_ppp.stale })));
  const spent = last("consumption");
  if (spent) {
    const share = valueIn(I.consumption_gdp, spent[0]);
    stats.append(invTile(t, t.pop_k_consumption, { num: spent[1].toFixed(1), unit: t.unit_usd_bn }, share === null ? "World Bank" : `World Bank · ${fill(t.pop_k_consumption_sub, { share: share.toFixed(0) })}`, freshness(t, { year: spent[0], stale: I.consumption.stale })));
  }
  const poor = last("poverty_national");
  if (poor) {
    const world = valueIn(I.poverty_3usd, poor[0]); // the international line only for the same year
    stats.append(invTile(t, t.pop_k_poverty, pct1(poor[1]), world === null ? "World Bank" : `World Bank · ${fill(t.pop_k_poverty_sub, { line: POVERTY_LINE_USD, pct: pct1(world) })}`, freshness(t, { year: poor[0], stale: I.poverty_national.stale })));
  }
  if (stats.childNodes.length) sources.push(p.sources.worldbank);
  const home = e.stat.population && e.stat.population.household;
  if (home) {
    stats.append(invTile(t, t.pop_k_household, { num: home.size.toFixed(1), unit: t.pop_unit_people }, fill(t.pop_k_household_sub, { census: home.census_size.toFixed(1), year: home.census_year }), freshness(t, { year: home.year, checked: home.checked })));
    sources.push(staticSource(e, home.source));
  }
  if (!stats.childNodes.length) return [];
  const foot = el("div", "stats-foot");
  foot.append(el("p", "note", t.pop_spend_note), sourcesFoot(t, sources));
  return [el("h2", "section-title", t.pop_sec_spend), el("p", "muted tab-intro", t.pop_spend_intro), stats, foot];
}

// ---------- the census ----------
function censusCard(e) {
  const { t } = e;
  const cs = e.stat.population && e.stat.population.census;
  if (!cs) return null;
  const c = card("estimated");
  c.append(cardHead(fill(t.pop_census_title, { no: cs.number, year: cs.year }), null, false, t));
  const ul = el("ul", "watch-list");
  ul.append(el("li", "", fill(t.pop_census_1, { start: dayFull(cs.start, t), end: dayFull(cs.end, t) })));
  ul.append(el("li", "", fill(t.pop_census_2, { date: dayFull(cs.status, t) })));
  ul.append(el("li", "", t.pop_census_3));
  c.append(ul);
  const fresh = el("div", "card-foot");
  fresh.append(freshness(t, { checked: e.stat.checked }));
  c.append(fresh, sourcesFoot(t, [staticSource(e, cs.source)]));
  return c;
}

export function populationTab(panel, e) {
  const { t } = e;
  panel.append(el("p", "muted tab-intro", t.pop_intro));
  const file = lazyJson("data/population.json", e.rerender);
  if (file.state !== "ok" || e.statState !== "ok") {
    if (file.state === "error" || e.statState === "error") panel.append(el("p", "muted", t.inv_load_error));
    else {
      const sk = el("div", "skeleton");
      sk.append(el("div"), el("div"), el("div"));
      panel.append(sk);
    }
    return;
  }
  const p = file.data;
  const add = (...nodes) => panel.append(...nodes.filter(Boolean));
  const two = (...nodes) => {
    const grid = el("div", "grid grid-2");
    grid.append(...nodes.filter(Boolean));
    if (grid.childNodes.length) panel.append(grid);
  };

  add(tiles(p, t), meaningCard(p, e));
  add(...spendingSection(p, e));
  panel.append(el("h2", "section-title", t.pop_sec_size));
  two(populationChart(p, t), agesCard(p, t));
  two(pyramidCard(p, e), neighboursCard(p, t));
  panel.append(el("h2", "section-title", t.pop_sec_where));
  add(provincesCard(p, t, e.stat.population && e.stat.population.census));
  panel.append(el("h2", "section-title", t.pop_sec_work));
  two(workChart(p, t), remitChart(p, t));
  add(censusCard(e));
}
