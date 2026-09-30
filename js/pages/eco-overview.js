// Economy tab 1: overview for investors - the key numbers, short facts computed from the data,
// and "what to watch" for the owner's own situations (savings, rubber farm, land/business). Never advice.

import { el, card, cardHead, pctPill } from "../ui.js";
import { formatNumber } from "../format.js";
import {
  THIS_YEAR, lastOf, pct, indicator, latest, valueIn, usdText, pctText, freshness, invTile, factsCard,
  statusBadge, targetStatus, fill, ready, monthText, usdParts,
} from "./eco-common.js";

export function overviewTab(panel, e) {
  const { t, economy: eco } = e;
  panel.append(el("p", "muted tab-intro", t.inv_overview_intro));
  if (!ready(panel, e)) return;
  const inv = e.invest;
  const target = (id) => e.stat.plan.targets.find((x) => x.id === id);

  // ---------- Key numbers ----------
  const stats = el("div", "stats");
  const gdp = indicator(e, "wb.NY.GDP.MKTP.CD");
  const gdpL = latest(gdp);
  if (gdpL) stats.append(invTile(t, t.inv_k_gdp, { num: gdpL[1].toFixed(2), unit: t.unit_usd_bn }, "World Bank", freshness(t, { year: gdpL[0], stale: gdp.stale })));

  const growth = indicator(e, "wb.NY.GDP.MKTP.KD.ZG");
  const growthL = latest(growth);
  const imfGrowth = valueIn(indicator(e, "imf.NGDP_RPCH"), THIS_YEAR);
  if (growthL) {
    const sub = imfGrowth !== null ? `${t.inv_imf_expects} ${THIS_YEAR}: ${pctText(imfGrowth)}` : "World Bank";
    stats.append(invTile(t, t.inv_k_growth, pctText(growthL[1]), sub, freshness(t, { year: growthL[0], stale: growth.stale })));
  }

  const gdppc = indicator(e, "wb.NY.GDP.PCAP.CD");
  const gdppcL = latest(gdppc);
  if (gdppcL) stats.append(invTile(t, t.inv_k_gdppc, { num: formatNumber(gdppcL[1], "USD per person"), unit: "USD" }, "World Bank", freshness(t, { year: gdppcL[0], stale: gdppc.stale })));

  const cpi = eco.monthly && eco.monthly.cpi_yoy;
  const cpiL = cpi && lastOf(cpi.values);
  if (cpiL) stats.append(invTile(t, t.inv_k_inflation, pctText(cpiL[1]), `IMF · ${t.inv_vs_last_year}`, freshness(t, { month: cpiL[0], stale: cpi.stale })));

  const debt = indicator(e, "imf.GGXWDG_NGDP");
  const debtL = latest(debt, THIS_YEAR);
  if (debtL) stats.append(invTile(t, t.inv_k_debt, pctText(debtL[1]), `IMF · ${t.inv_estimate}`, freshness(t, { year: debtL[0], stale: debt.stale })));

  const resMo = indicator(e, "wb.FI.RES.TOTL.MO");
  const resL = latest(resMo);
  if (resL) stats.append(invTile(t, t.inv_k_reserves, { num: resL[1].toFixed(1), unit: t.inv_unit_months }, `World Bank · ${t.inv_of_imports}`, freshness(t, { year: resL[0], stale: resMo.stale })));

  const fdi = indicator(e, "wb.BX.KLT.DINV.CD.WD");
  const fdiL = latest(fdi);
  const fdiGdp = latest(indicator(e, "wb.BX.KLT.DINV.WD.GD.ZS"));
  if (fdiL) stats.append(invTile(t, t.inv_k_fdi, usdParts(fdiL[1], t), fdiGdp ? `${pctText(fdiGdp[1])} ${t.inv_of_gdp} · World Bank` : "World Bank", freshness(t, { year: fdiL[0], stale: fdi.stale })));

  // Kip vs USD over 12 months (BOL monthly averages): up = more kip per dollar = weaker kip
  const usd = eco.monthly && eco.monthly.bol_usd_mid;
  const usdNow = usd && lastOf(usd.values);
  const usdAgo = usd && usd.values.length > 12 ? usd.values[usd.values.length - 13] : null;
  if (usdNow && usdAgo) {
    const tile = invTile(t, t.inv_k_kip, { num: formatNumber(usdNow[1], "LAK"), unit: t.inv_kip_per_usd }, `BOL · ${t.inv_12m_change}`, freshness(t, { month: usdNow[0], stale: usd.stale }));
    tile.querySelector(".stat-sub").append(" ", pctPill(pct(usdAgo[1], usdNow[1]), { decimals: 1 }));
    stats.append(tile);
  }
  panel.append(stats);

  // ---------- Short facts computed from the data ----------
  const facts = [];
  const gT = target("growth");
  if (growthL && gT) facts.push([fill(t.inv_fact_growth, { value: pctText(growthL[1]), year: growthL[0], target: pctText(gT.target, 0) }), statusBadge(t, targetStatus(growthL[1], gT.target, gT.op))]);
  const iT = target("inflation");
  if (cpiL && iT) facts.push([fill(t.inv_fact_inflation, { value: pctText(cpiL[1]), month: monthText(cpiL[0], t), target: pctText(iT.target, 0) }), statusBadge(t, targetStatus(cpiL[1], iT.target, iT.op))]);

  const ds = inv.parts.debt_service;
  if (ds && ds.years && ds.years.length) {
    const i = ds.years.indexOf(Math.max(THIS_YEAR, ds.first_projected));
    if (i >= 0 && ds.principal[i] !== null) {
      const total = ds.principal[i] + (ds.interest[i] || 0);
      const china = ds.china[i] !== null ? (ds.china[i] / total) * 100 : null;
      facts.push([fill(t.inv_fact_debt_due, { year: ds.years[i], amount: usdText(total, t), china: china === null ? "—" : pctText(china, 0), stock: ds.first_projected - 1 }), null]);
    }
  }
  const rT = target("reserves");
  if (resL && rT) facts.push([fill(t.inv_fact_reserves, { value: resL[1].toFixed(1), year: resL[0], target: rT.target }), statusBadge(t, targetStatus(resL[1], rT.target, rT.op))]);

  const fp = inv.parts.fdi_positions;
  if (fp && fp.list && fp.list.length >= 2 && fp.total) {
    const top2 = fp.list.slice(0, 2);
    facts.push([fill(t.inv_fact_fdi_top, { a: t.countries[top2[0][0]] || top2[0][1], b: t.countries[top2[1][0]] || top2[1][1], share: pctText(((top2[0][2] + top2[1][2]) / fp.total) * 100, 0), year: fp.year }), null]);
  }

  const rub = inv.monthly.rubber_usd;
  if (rub && rub.values.length > 12) {
    const now = lastOf(rub.values);
    const ago = rub.values[rub.values.length - 13];
    const perKg = (cents) => (cents * 2.20462) / 100; // US cents per pound -> USD per kg
    facts.push([fill(t.inv_fact_rubber, { value: perKg(now[1]).toFixed(2), month: monthText(now[0], t) }), pctPill(pct(ago[1], now[1]), { decimals: 1 })]);
  }
  if (facts.length) panel.append(factsCard(t, t.inv_facts_title, facts, t.inv_facts_note));

  // ---------- What to watch (for the owner's own situations) ----------
  panel.append(el("h2", "section-title", t.inv_watch_title));
  panel.append(el("p", "muted tab-intro", t.inv_watch_intro));
  const grid = el("div", "grid grid-3");
  const watch = [
    ["inv_watch_savings", ["inv_watch_savings_1", "inv_watch_savings_2", "inv_watch_savings_3"], [["inflation", "inv_tab_inflation"], ["#/living", "page_living"]]],
    ["inv_watch_rubber", ["inv_watch_rubber_1", "inv_watch_rubber_2", "inv_watch_rubber_3"], [["rubber", "inv_tab_rubber"]]],
    ["inv_watch_land", ["inv_watch_land_1", "inv_watch_land_2", "inv_watch_land_3"], [["gdp", "inv_tab_gdp"], ["debt", "inv_tab_debt"], ["land", "inv_tab_land"]]],
  ];
  for (const [title, items, links] of watch) {
    const c = card("estimated", "watch-card");
    c.append(cardHead(t[title], null, false, t));
    const ul = el("ul", "watch-list");
    for (const k of items) ul.append(el("li", "", t[k]));
    c.append(ul);
    const row = el("div", "watch-links");
    for (const [to, label] of links) {
      if (to.startsWith("#/")) {
        const a = el("a", "btn", t[label]);
        a.href = to;
        row.append(a);
      } else {
        const b = el("button", "btn", t[label]);
        b.type = "button";
        b.addEventListener("click", () => e.go(to));
        row.append(b);
      }
    }
    c.append(row);
    grid.append(c);
  }
  panel.append(grid);
}
