// Economy tab: Laos next to its five neighbours (audit 2026-10-02, P1-6).
//   data/compare.json (scripts/fetch-compare.js, weekly): for every indicator the SAME code of the SAME source for
//   all six countries, the last years of each.
// The rule of this tab: one row of numbers = one year. The year of a card is the newest year Laos has. A country
// without a number for that year shows its newest earlier one, with its own year and a mark - never silently.
// Every row names its year. A rank is counted only among the countries that have the card's year.
// Past data only; a number that is the IMF's own estimate is called one. Never advice.

import { el, card, cardHead } from "../ui.js";
import { formatNumber } from "../format.js";
import { lazyJson } from "../lazy.js";
import { THIS_YEAR, freshness, sourcesFoot, barTable, fill, countryName, unitName, usdText, pctText } from "./eco-common.js";

const HOME = "LAO";

// The newest [year, value] of a country's list at or before a year
const upTo = (list, year) => (list || []).filter(([y]) => y <= year).pop() || null;
const valueOf = (list, year) => {
  const hit = (list || []).find(([y]) => y === year);
  return hit ? hit[1] : null;
};

// One indicator -> { year, cells: [{ iso, value, year, same }] }
//   year  = the newest finished year Laos has (null: nothing to compare)
//   cells = every country in the file's order; value null = no number at or before that year
//   same  = the cell's number is from the card's year (false: an older year, to be marked)
export function compareRow(ind, countries, lastYear = THIS_YEAR - 1) {
  const home = upTo(ind && ind.rows && ind.rows[HOME], lastYear);
  if (!home) return { year: null, cells: [] };
  const year = home[0];
  const cells = countries.map((iso) => {
    const hit = upTo(ind.rows[iso], year);
    return hit ? { iso, value: hit[1], year: hit[0], same: hit[0] === year } : { iso, value: null, year: null, same: false };
  });
  return { year, cells };
}

// Where Laos stands among the countries that have the card's year: { rank, of } (1 = the highest value)
export function rankOf(row) {
  const same = row.cells.filter((c) => c.same && c.value !== null);
  const home = same.find((c) => c.iso === HOME);
  if (!home || same.length < 2) return null;
  return { rank: 1 + same.filter((c) => c.value > home.value).length, of: same.length };
}

// The cards: [id, title key, how to write the value, (optional) the line under a country's name]
const money = (unit) => (v) => formatNumber(v, unit);
const pct = (v) => pctText(v);
const CARDS = [
  ["gdp", "cmp_gdp", money("USD bn")],
  ["gdp_pc", "cmp_gdp_pc", money("USD per person")],
  ["gdp_pc_ppp", "cmp_gdp_pc_ppp", money("intl$ per person")],
  ["growth", "cmp_growth", pct],
  ["inflation", "cmp_inflation", pct],
  ["debt", "cmp_debt", pct],
  ["ext_debt", "cmp_ext_debt", pct],
  ["reserves", "cmp_reserves", (v) => v.toFixed(1)],
  // the share of GDP is what can be compared between a big and a small economy; the amount of the same year under it
  ["fdi_gdp", "cmp_fdi", pct, (c, file, t) => { const usd = valueOf(file.indicators.fdi && file.indicators.fdi.rows[c.iso], c.year); return usd === null ? null : usdText(usd * 1000, t); }],
  // exports of goods in dollars, and - same year, same two codes - as a share of the country's GDP
  ["exports", "cmp_exports", money("USD bn"), (c, file, t) => { const gdp = valueOf(file.indicators.gdp && file.indicators.gdp.rows[c.iso], c.year); return gdp ? fill(t.cmp_exports_sub, { pct: pctText((c.value / gdp) * 100, 0) }) : null; }],
  ["urban", "cmp_urban", pct],
];

function indicatorCard(e, file, [id, titleKey, text, under]) {
  const { t } = e;
  const ind = file.indicators[id];
  if (!ind || !ind.rows) return null;
  const row = compareRow(ind, file.countries);
  if (row.year === null) return null;
  const c = card("official", "compare-card");
  c.dataset.indicator = id;
  c.dataset.year = row.year;
  c.append(cardHead(t[titleKey], "official", !!ind.stale, t));
  const source = file.sources[ind.source];
  c.append(el("p", "chart-sub", [`${t.unit}: ${unitName(ind.unit, t)}`, `${t.year} ${row.year}`, ind.source === "imf" ? t.cmp_imf_estimate : null].filter(Boolean).join(" · ")));

  // the countries of the card's year first, highest value first; then the marked ones (another year); a country
  // without a number last. Laos is set in bold.
  const group = (cell) => (cell.value === null ? 2 : cell.same ? 0 : 1);
  const sorted = [...row.cells].sort((a, b) => group(a) - group(b) || b.value - a.value);
  const rows = sorted.map((cell) => {
    const year = el("span", cell.same ? "cmp-year" : "cmp-year cmp-year-off", cell.value === null ? "" : cell.same ? String(cell.year) : `⚠ ${cell.year}`);
    return {
      label: countryName(t, null, cell.iso),
      cls: cell.iso === HOME ? "focus-name" : "",
      sub: cell.value !== null && under ? under(cell, file, t) : null,
      value: cell.value,
      text: cell.value === null ? "—" : text(cell.value),
      share: year,
    };
  });
  c.append(barTable([t.rw_col_country, unitName(ind.unit, t), t.year], rows));

  const notes = [];
  const rank = rankOf(row);
  if (rank) notes.push(fill(t.cmp_rank, { rank: rank.rank, n: rank.of, year: row.year }));
  if (row.cells.some((cell) => cell.value !== null && !cell.same)) notes.push(fill(t.cmp_off_note, { year: row.year }));
  if (row.cells.some((cell) => cell.value === null)) notes.push(t.cmp_none_note);
  if (t[titleKey + "_note"]) notes.push(t[titleKey + "_note"]);
  for (const note of notes) c.append(el("p", "note", note));

  const foot = el("div", "card-foot");
  foot.append(freshness(t, { year: row.year, stale: ind.stale }));
  c.append(foot, sourcesFoot(t, [source]));
  return c;
}

export function compareTab(panel, e) {
  const { t } = e;
  const file = lazyJson("data/compare.json", e.rerender);
  if (file.state !== "ok") {
    panel.append(el("p", "muted tab-intro", fill(t.cmp_intro, { n: "…" })));
    if (file.state === "error") panel.append(el("p", "muted", t.inv_load_error));
    else {
      const sk = el("div", "skeleton");
      sk.append(el("div"), el("div"), el("div"));
      panel.append(sk);
    }
    return;
  }
  const data = file.data;
  panel.append(el("p", "muted tab-intro", fill(t.cmp_intro, { n: data.countries.length - 1 })));

  const how = card("estimated", "watch-card");
  how.append(cardHead(t.cmp_how_title, null, false, t));
  const ul = el("ul", "watch-list");
  for (const k of ["cmp_how_1", "cmp_how_2", "cmp_how_3", "cmp_how_4"]) ul.append(el("li", "", t[k]));
  how.append(ul);
  panel.append(how);

  const grid = el("div", "grid grid-2");
  for (const def of CARDS) {
    const c = indicatorCard(e, data, def);
    if (c) grid.append(c);
  }
  if (grid.childNodes.length) panel.append(grid);
  else panel.append(el("p", "muted", t.inv_load_error));
}
