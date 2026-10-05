// Economy tab: money and banks - how much money there is, how much of it is foreign currency, what banks lend
// and at what price, and how sound the banks say they are (audit 2026-10-02, P1-7).
// Every number is the Bank of the Lao PDR's own (data/bol-money.json, scripts/fetch-bol-money.js): the files it
// publishes and reports to the IMF. Nothing here is an estimate of another institution.
// Two things the page says next to the numbers, because the numbers alone mislead:
//   - most of the money is foreign currency counted in kip, so the total grows when the kip falls - without anybody
//     owning one dollar more;
//   - the share of bad loans is what the banks report to the central bank, not an outside audit.

import { el, card, cardHead } from "../ui.js";
import { chartCard } from "../charts.js";
import { realRate } from "../calc.js";
import { lazyJson } from "../lazy.js";
import { lastOf, pct, monthText, monthShort, pctText, freshness, sourcesFoot, invTile, barTable, fill } from "./eco-common.js";
import { inflationSeries } from "./eco-latest.js";

const addMonths = (m, n) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7);
const QUARTER_END = { 1: "03", 2: "06", 3: "09", 4: "12" };
// "2026-Q2" -> "2026-06" (its last month: for "how old is this number")
export const quarterMonth = (q) => `${q.slice(0, 4)}-${QUARTER_END[q.slice(6)]}`;
const quarterText = (q, t) => fill(t.bank_quarter, { q: q.slice(6), year: q.slice(0, 4) });
const quarterShort = (q) => `Q${q.slice(6)}/${q.slice(2, 4)}`;
// billions of kip -> { num: "383.2", unit: "ล้านล้านกีบ" }
const kipParts = (billions, t) => ({ num: (billions / 1000).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }), unit: t.bank_unit_tn });
const signed = (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + pctText(Math.abs(v));
const kipText = (billions, t) => `${kipParts(billions, t).num} ${t.bank_unit_tn}`;

// Change against the same month a year before, for every month that has both: [[month, %]]
export function yearOnYear(rows) {
  const map = new Map(rows);
  return rows.filter(([m]) => map.has(addMonths(m, -12))).map(([m, v]) => [m, Math.round(pct(map.get(addMonths(m, -12)), v) * 10) / 10]);
}
// Foreign-currency deposits as a share of broad money, month by month: [[month, %]]
export function fxShare(money) {
  const m2 = new Map(money.rows.m2);
  return money.rows.fx_deposits.filter(([m]) => m2.get(m) > 0).map(([m, v]) => [m, Math.round((v / m2.get(m)) * 1000) / 10]);
}

const foot = (t, part, when, src) => {
  const box = el("div", "card-foot");
  box.append(freshness(t, { month: when, stale: part.stale }));
  return [box, sourcesFoot(t, [src])];
};

function tiles(e, d) {
  const { t } = e;
  const stats = el("div", "stats");
  const { money, rates, soundness: sound } = d;
  const m2 = lastOf(money.rows.m2);
  if (m2) {
    const growth = lastOf(yearOnYear(money.rows.m2));
    stats.append(invTile(t, t.bank_k_m2, kipParts(m2[1], t), growth ? fill(t.bank_k_growth, { pct: signed(growth[1]) }) : "BOL", freshness(t, { month: m2[0], stale: money.stale })));
    const share = lastOf(fxShare(money));
    if (share) stats.append(invTile(t, t.bank_k_fx, pctText(share[1]), t.bank_k_fx_sub, freshness(t, { month: share[0], stale: money.stale })));
  }
  const credit = lastOf(money.rows.credit_private);
  if (credit) {
    const growth = lastOf(yearOnYear(money.rows.credit_private));
    stats.append(invTile(t, t.bank_k_credit, kipParts(credit[1], t), growth ? fill(t.bank_k_growth, { pct: signed(growth[1]) }) : "BOL", freshness(t, { month: credit[0], stale: money.stale })));
  }
  const loan = lastOf(rates.rows.loan_lak);
  if (loan) stats.append(invTile(t, t.bank_k_loan, pctText(loan[1], 2), t.bank_k_loan_sub, freshness(t, { month: loan[0], stale: rates.stale })));
  const dep = lastOf(rates.rows.dep12_lak);
  if (dep) stats.append(invTile(t, t.bank_k_deposit, pctText(dep[1], 2), t.bank_k_deposit_sub, freshness(t, { month: dep[0], stale: rates.stale })));
  const npl = lastOf(sound.rows.npl);
  if (npl) stats.append(invTile(t, t.bank_k_npl, pctText(npl[1], 2), t.bank_k_npl_sub, freshness(t, { month: quarterMonth(npl[0]), stale: sound.stale })));
  const capital = lastOf(sound.rows.capital);
  if (capital) stats.append(invTile(t, t.bank_k_capital, pctText(capital[1]), t.bank_k_capital_sub, freshness(t, { month: quarterMonth(capital[0]), stale: sound.stale })));
  return stats;
}

// How much of the money is foreign currency
function fxCard(e, d) {
  const { t } = e;
  const rows = fxShare(d.money);
  if (rows.length < 2) return null;
  const c = chartCard({
    title: t.bank_fx_title,
    subtitle: t.bank_fx_sub,
    labels: rows.map(([m]) => monthText(m, t)),
    tickLabels: rows.map(([m]) => monthShort(m, t)),
    series: [{ label: t.bank_fx_line, kind: "official", values: rows.map((r) => r[1]) }],
    unit: "%",
    unitLabel: t.bank_unit_share,
    t,
    firstColTitle: t.month,
  });
  c.append(el("p", "note", t.bank_fx_note), ...foot(t, d.money, lastOf(rows)[0], d.sources.bol_dcs));
  return c;
}

// Where the money is: the four parts of broad money in the newest month
function partsCard(e, d) {
  const { t } = e;
  const m2 = lastOf(d.money.rows.m2);
  if (!m2) return null;
  const at = (id) => (d.money.rows[id].find((r) => r[0] === m2[0]) || [])[1];
  const list = [["fx_deposits", t.bank_part_fx], ["kip_deposits", t.bank_part_kip], ["demand", t.bank_part_demand], ["cash", t.bank_part_cash]].filter(([id]) => at(id) !== undefined);
  if (list.length < 4) return null;
  const c = card("official");
  c.append(cardHead(fill(t.bank_parts_title, { month: monthText(m2[0], t) }), "official", d.money.stale, t));
  c.append(barTable([t.bank_col_part, t.bank_col_amount, t.bank_col_share], list.map(([id, label]) => ({ label, value: at(id), text: kipText(at(id), t), share: pctText((at(id) / m2[1]) * 100) }))));
  c.append(el("p", "note", fill(t.bank_parts_note, { total: kipText(m2[1], t) })), ...foot(t, d.money, m2[0], d.sources.bol_dcs));
  return c;
}

// Money and credit: growth against a year before
function growthCard(e, d) {
  const { t } = e;
  const m2 = new Map(yearOnYear(d.money.rows.m2));
  const credit = new Map(yearOnYear(d.money.rows.credit_private));
  const months = [...new Set([...m2.keys(), ...credit.keys()])].sort();
  if (months.length < 2) return null;
  const c = chartCard({
    title: t.bank_growth_title,
    subtitle: t.bank_growth_sub,
    labels: months.map((m) => monthText(m, t)),
    tickLabels: months.map((m) => monthShort(m, t)),
    series: [
      { label: t.bank_line_m2, kind: "official", values: months.map((m) => (m2.has(m) ? m2.get(m) : null)) },
      { label: t.bank_line_credit, kind: "official", color: "--cat-3", values: months.map((m) => (credit.has(m) ? credit.get(m) : null)) },
    ],
    unit: "%",
    unitLabel: t.unit_pct_yoy,
    t,
    firstColTitle: t.month,
  });
  c.append(el("p", "note", t.bank_growth_note), ...foot(t, d.money, lastOf(months), d.sources.bol_dcs));
  return c;
}

// What banks pay and charge in kip, and the same rates in baht and dollars
function ratesCard(e, d) {
  const { t } = e;
  const { rates } = d;
  const dep = new Map(rates.rows.dep12_lak);
  const loan = new Map(rates.rows.loan_lak);
  const months = [...new Set([...dep.keys(), ...loan.keys()])].sort();
  if (months.length < 2) return null;
  const c = chartCard({
    title: t.bank_rates_title,
    subtitle: t.bank_rates_sub,
    labels: months.map((m) => monthText(m, t)),
    tickLabels: months.map((m) => monthShort(m, t)),
    series: [
      { label: t.bank_line_loan, kind: "official", values: months.map((m) => (loan.has(m) ? loan.get(m) : null)) },
      { label: t.bank_line_deposit, kind: "official", color: "--cat-3", values: months.map((m) => (dep.has(m) ? dep.get(m) : null)) },
    ],
    unit: "%",
    unitLabel: t.unit_pct_year,
    t,
    firstColTitle: t.month,
  });
  // the newest month, by currency
  const last = lastOf(months);
  const cell = (id) => {
    const row = rates.rows[id].find((r) => r[0] === last);
    return row ? pctText(row[1], 2) : "—";
  };
  const tbl = el("table");
  const head = el("tr");
  for (const h of [t.bank_col_currency, t.bank_col_save, t.bank_col_dep12, t.bank_col_loan]) head.append(el("th", "", h));
  tbl.appendChild(el("thead")).append(head);
  const body = tbl.appendChild(el("tbody"));
  for (const cur of ["lak", "thb", "usd"]) {
    const tr = el("tr");
    tr.append(el("td", "", t["bank_cur_" + cur]), el("td", "", cell("save_" + cur)), el("td", "", cell("dep12_" + cur)), el("td", "", cell("loan_" + cur)));
    body.append(tr);
  }
  const wrap = el("div", "table-wrap wrap-first");
  wrap.append(tbl);
  c.append(el("h4", "up-subtitle", fill(t.bank_rates_table, { month: monthText(last, t) })), wrap);
  // the deposit rate against the inflation of the very same month (one formula for the whole site: js/calc.js)
  const cpi = inflationSeries(e);
  const depLast = lastOf(rates.rows.dep12_lak);
  const infl = cpi && depLast ? cpi.values.find(([m]) => m === depLast[0]) : null;
  if (infl) {
    const real = realRate(depLast[1], infl[1]);
    const realText = Math.abs(real).toFixed(1);
    c.append(el("p", "note", fill(t.bank_rates_real, { month: monthText(depLast[0], t), rate: depLast[1].toFixed(2), inflation: infl[1].toFixed(1), real: (Number(realText) === 0 ? "" : real > 0 ? "+" : "−") + realText })));
  }
  c.append(el("p", "note", t.bank_rates_note), ...foot(t, rates, last, d.sources.bol_rates));
  return c;
}

// How sound the banks report themselves to be
function soundCard(e, d) {
  const { t } = e;
  const { soundness: s } = d;
  const npl = new Map(s.rows.npl);
  const capital = new Map(s.rows.capital);
  const quarters = [...new Set([...npl.keys(), ...capital.keys()])].sort();
  if (quarters.length < 2) return null;
  const c = chartCard({
    title: t.bank_sound_title,
    subtitle: t.bank_sound_sub,
    labels: quarters.map((q) => quarterText(q, t)),
    tickLabels: quarters.map(quarterShort),
    series: [
      { label: t.bank_line_capital, kind: "official", values: quarters.map((q) => (capital.has(q) ? capital.get(q) : null)) },
      { label: t.bank_line_npl, kind: "official", color: "--cat-3", values: quarters.map((q) => (npl.has(q) ? npl.get(q) : null)) },
    ],
    unit: "%",
    unitLabel: t.bank_pct_unit,
    t,
    firstColTitle: t.bank_col_quarter,
  });
  const last = lastOf(quarters);
  const more = [["loans_to_deposits", t.bank_more_ltd], ["liquid", t.bank_more_liquid], ["roe", t.bank_more_roe]]
    .map(([id, label]) => {
      const row = lastOf(s.rows[id] || []);
      return row ? `${label} ${pctText(row[1])}` : null;
    })
    .filter(Boolean);
  if (more.length) c.append(el("p", "note", `${quarterText(last, t)}: ${more.join(" · ")}`));
  c.append(el("p", "note", t.bank_sound_note), ...foot(t, s, quarterMonth(last), d.sources.bol_fsi));
  return c;
}

// Who the banks lend to
function sectorsCard(e, d) {
  const { t } = e;
  const sec = d.soundness.sectors;
  if (!sec || !sec.shares) return null;
  const rows = Object.entries(sec.shares)
    .sort((a, b) => b[1] - a[1])
    .map(([id, v]) => ({ label: t["bank_sector_" + id] || id, value: v, text: pctText(v), share: "" }));
  const c = card("official");
  c.append(cardHead(fill(t.bank_sectors_title, { quarter: quarterText(sec.quarter, t) }), "official", d.soundness.stale, t));
  c.append(barTable([t.bank_col_sector, t.bank_col_loans_share, ""], rows));
  c.append(el("p", "note", t.bank_sectors_note), ...foot(t, d.soundness, quarterMonth(sec.quarter), d.sources.bol_fsi));
  return c;
}

export function bankTab(panel, e) {
  const { t } = e;
  panel.append(el("p", "muted tab-intro", t.bank_intro));
  const file = lazyJson("data/bol-money.json", e.rerender);
  if (file.state !== "ok") {
    if (file.state === "error") panel.append(el("p", "muted", t.inv_load_error));
    else {
      const sk = el("div", "skeleton");
      sk.append(el("div"), el("div"), el("div"));
      panel.append(sk);
    }
    return;
  }
  const d = file.data;
  panel.append(tiles(e, d));
  const grid = el("div", "grid grid-2");
  for (const make of [fxCard, partsCard, growthCard, ratesCard, soundCard, sectorsCard]) {
    const c = make(e, d);
    if (c) grid.append(c);
  }
  panel.append(grid);
  // how to read these numbers
  const read = card("official");
  read.append(cardHead(t.bank_read_title, null, false, t));
  const ul = el("ul", "watch-list");
  for (const k of ["bank_read_1", "bank_read_2", "bank_read_3", "bank_read_4"]) ul.append(el("li", "", t[k]));
  read.append(ul);
  panel.append(read);
}
