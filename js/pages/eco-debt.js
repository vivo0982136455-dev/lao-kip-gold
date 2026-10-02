// Economy tab 5: public debt - how much, owed to whom (by creditor), when it must be repaid (schedule of today's
// debt, World Bank IDS), and why / effects / the government's plan / can it work (World Bank + IMF reports).

import { el, card, cardHead } from "../ui.js";
import { chartCard } from "../charts.js";
import {
  THIS_YEAR, indicator, latest, valueIn, usdText, usdParts, pctText, freshness, sourcesFoot, invTile, factsCard, barTable,
  yearChart, ready, staticSource, fill, monthText,
} from "./eco-common.js";

const TOP = 10; // creditors shown one by one; the rest are added up

export function debtTab(panel, e) {
  const { t } = e;
  panel.append(el("p", "muted tab-intro", t.inv_debt_intro));
  if (!ready(panel, e)) return;
  const inv = e.invest;
  const F = e.stat.facts;
  const cr = inv.parts.debt_creditors;
  const ds = inv.parts.debt_service;
  const target = e.stat.plan.targets.find((x) => x.id === "debt");

  // ---------- Key numbers ----------
  const stats = el("div", "stats");
  const debt = indicator(e, "imf.GGXWDG_NGDP");
  const debtL = latest(debt, THIS_YEAR);
  if (debtL) stats.append(invTile(t, t.inv_k_debt, pctText(debtL[1]), `IMF · ${t.inv_estimate}`, freshness(t, { year: debtL[0], stale: debt.stale })));
  if (cr && cr.total) stats.append(invTile(t, t.inv_k_debt_ext_gov, usdParts(cr.total, t), "World Bank IDS", freshness(t, { year: cr.year, stale: cr.stale })));
  const ext = indicator(e, "wb.DT.DOD.DECT.CD");
  const extL = latest(ext);
  const extGni = latest(indicator(e, "wb.DT.DOD.DECT.GN.ZS"));
  if (extL) stats.append(invTile(t, t.inv_k_debt_ext_all, usdParts(extL[1] * 1000, t), extGni ? `${pctText(extGni[1])} ${t.inv_of_gni} · World Bank` : "World Bank", freshness(t, { year: extL[0], stale: ext.stale })));
  const svc = indicator(e, "wb.DT.TDS.DECT.EX.ZS");
  const svcL = latest(svc);
  if (svcL) stats.append(invTile(t, t.inv_k_debt_service_exports, pctText(svcL[1]), `${t.inv_of_exports} · World Bank`, freshness(t, { year: svcL[0], stale: svc.stale })));
  panel.append(stats);

  const grid = el("div", "grid grid-2");
  // Debt as % of GDP, with the plan's goal
  const chart = yearChart(e, { forecast: "imf.GGXWDG_NGDP" }, { title: t.eco_debt, target: target && { value: target.target, label: t.inv_plan_target_line } });
  if (chart) grid.append(chart);

  // ---------- Owed to whom ----------
  if (cr && cr.list && cr.list.length) {
    const c = card("official");
    c.append(cardHead(`${t.inv_debt_who} (${t.year} ${cr.year})`, "official", cr.stale, t));
    const top = cr.list.slice(0, TOP);
    const rest = cr.list.slice(TOP);
    const rows = top.map(([name, v]) => ({ label: t.creditors[name] || name, value: v, text: usdText(v, t), share: pctText((v / cr.total) * 100, 0) }));
    if (rest.length) {
      const sum = rest.reduce((a, [, v]) => a + v, 0);
      rows.push({ label: fill(t.inv_debt_others, { n: rest.length }), value: sum, text: usdText(sum, t), share: pctText((sum / cr.total) * 100, 0) });
    }
    c.append(barTable([t.inv_col_creditor, t.inv_col_amount, t.inv_col_share], rows));
    c.append(el("p", "note", t.inv_debt_who_note));
    const fresh = el("div", "card-foot");
    fresh.append(freshness(t, { year: cr.year, stale: cr.stale }));
    c.append(fresh, sourcesFoot(t, [inv.sources.wb_ids]));
    grid.append(c);
  }

  // ---------- When it must be repaid ----------
  if (ds && ds.years && ds.years.length) {
    const stockYear = ds.first_projected - 1;
    const total = ds.years.map((y, i) => (ds.principal[i] === null ? null : Math.round((ds.principal[i] + (ds.interest[i] || 0)) * 10) / 10));
    const actual = ds.years.map((y, i) => (y <= stockYear ? total[i] : null));
    const due = ds.years.map((y, i) => (y >= stockYear ? total[i] : null)); // starts at the last real year so the lines meet
    const dueOnly = ds.years.map((y, i) => (y > stockYear ? total[i] : null)); // what the table shows as "due"
    grid.append(
      chartCard({
        title: t.inv_debt_schedule,
        subtitle: fill(t.inv_debt_schedule_sub, { year: stockYear }),
        labels: ds.years.map(String),
        series: [
          { label: t.inv_debt_paid, kind: "official", values: actual },
          { label: t.inv_debt_due, kind: "official", dashed: true, soft: true, values: due, shown: dueOnly },
          { label: t.inv_debt_china, kind: "official", color: "--cat-3", values: ds.china },
        ],
        unit: "USD m",
        t,
        firstColTitle: t.year,
      })
    );
  }
  panel.append(grid);

  // ---------- Facts computed from the schedule ----------
  if (ds && ds.years && ds.years.length && cr && cr.total) {
    const facts = [];
    const stockYear = ds.first_projected - 1;
    const totalOf = (i) => ds.principal[i] + (ds.interest[i] || 0);
    const future = ds.years.map((y, i) => [y, i]).filter(([y, i]) => y >= ds.first_projected && ds.principal[i] !== null);
    if (future.length) {
      const [peakYear, pi] = future.reduce((best, cur) => (totalOf(cur[1]) > totalOf(best[1]) ? cur : best));
      facts.push([fill(t.inv_debt_f_peak, { year: peakYear, amount: usdText(totalOf(pi), t), china: pctText((ds.china[pi] / totalOf(pi)) * 100, 0), stock: stockYear }), null]);
      const now = future.find(([y]) => y === THIS_YEAR);
      if (now) facts.push([fill(t.inv_debt_f_now, { year: THIS_YEAR, amount: usdText(totalOf(now[1]), t), china: pctText((ds.china[now[1]] / totalOf(now[1])) * 100, 0) }), null]);
      const principal = future.reduce((a, [, i]) => a + ds.principal[i], 0);
      const last = future[future.length - 1][0];
      facts.push([fill(t.inv_debt_f_principal, { from: ds.first_projected, to: last, amount: usdText(principal, t), share: pctText((principal / cr.total) * 100, 0), stock: stockYear }), null]);
      const res = latest(indicator(e, "wb.FI.RES.TOTL.CD"));
      if (res && now) facts.push([fill(t.inv_debt_f_reserves, { reserves: usdText(res[1] * 1000, t), year: res[0] }), null]);
    }
    // Payments to China were very small while repayments were postponed
    const paid = ds.years.map((y, i) => [y, ds.china[i]]).filter(([y, v]) => y >= 2020 && y < stockYear && v !== null);
    if (paid.length) facts.push([fill(t.inv_debt_f_china_paid, { from: paid[0][0], to: paid[paid.length - 1][0], amount: usdText(paid.reduce((a, [, v]) => a + v, 0), t) }), null]);
    panel.append(factsCard(t, t.inv_debt_facts_title, facts, t.inv_debt_facts_note, "official"));
  }

  // ---------- Why · effects · plan · can it work (quoted from the reports) ----------
  const imfBelow = debt && target ? debt.values.find(([y, v]) => y >= THIS_YEAR && v <= target.target) : null;
  // The same year's debt counted in three ways (Ministry of Finance, World Bank, IMF): shown side by side, with
  // what each one counts, so that the different numbers on this page can be told apart
  const sameYear = F.debt_mof && F.debt_peak && F.imf_unsustainable && F.debt_mof.year === F.debt_peak.now_year && F.debt_mof.year === F.imf_unsustainable.year;
  const counted = sameYear ? { ...F.debt_mof, wb: F.debt_peak.now, imf: F.imf_unsustainable.debt, sources: [F.imf_unsustainable.source] } : null;
  const blocks = [
    ["inv_debt_why", [["inv_debt_why_1", F.debt_peak], ["inv_debt_why_defs", counted], ["inv_debt_why_2", F.debt_edl], ["inv_debt_why_3", F.debt_china_half], ["inv_debt_why_4", { source: "wb_lem" }]]],
    ["inv_debt_effects", [["inv_debt_effect_1", F.debt_crowd_out], ["inv_debt_effect_2", F.reserves_wb], ["inv_debt_effect_3", F.debt_deferred]]],
    ["inv_debt_plan", [["inv_debt_plan_1", F.debt_decree], ["inv_debt_plan_2", target ? { target: target.target, source: "kpl_plan" } : null], ["inv_debt_plan_3", F.debt_bond], ["inv_debt_plan_4", F.debt_restructure]]],
    ["inv_debt_can", [["inv_debt_can_1", F.imf_unsustainable], ["inv_debt_can_2", imfBelow ? { year: imfBelow[0], value: pctText(imfBelow[1]), source: "imf" } : null], ["inv_debt_can_3", F.imf_advice], ["inv_debt_can_4", F.debt_service_avg], ["inv_debt_can_5", F.debt_service_year]]],
  ];
  panel.append(el("h2", "section-title", t.inv_debt_story));
  const g2 = el("div", "grid grid-2");
  for (const [title, items] of blocks) {
    const c = card("official");
    c.append(cardHead(t[title], null, false, t));
    const ul = el("ul", "watch-list");
    const used = new Set();
    for (const [key, f] of items) {
      if (!t[key] || !f) continue;
      const values = { ...(f || {}) };
      if (values.month) values.month = monthText(values.month, t);
      if (values.date) values.date = monthText(values.date.slice(0, 7), t);
      ul.append(el("li", "", fill(t[key], values)));
      if (f && f.source) used.add(f.source);
      for (const id of (f && f.sources) || []) used.add(id); // a fact put together from two editions of a report
    }
    c.append(ul);
    const srcs = [...used].map((id) => (id === "imf" ? inv.sources.imf : staticSource(e, id)));
    c.append(sourcesFoot(t, srcs));
    g2.append(c);
  }
  panel.append(g2);
}

export { valueIn };
