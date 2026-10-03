// Economy tab 1: overview for investors - the key numbers, short facts computed from the data,
// "what to watch" for the owner's own situations (savings, rubber farm, land/business), and a note on why two
// sources can give two numbers for the same thing. Never advice.
// Every number that another tab also shows comes from eco-latest.js, so the tabs cannot disagree.

import { el, card, cardHead, pctPill } from "../ui.js";
import { formatNumber } from "../format.js";
import { usdPerKg as perKg } from "../calc.js"; // US cents per pound -> USD per kg
import {
  THIS_YEAR, lastOf, pct, indicator, latest, valueIn, usdText, pctText, freshness, invTile, factsCard,
  statusBadge, targetStatus, fill, ready, monthText, usdParts,
} from "./eco-common.js";
import { latestInflation, latestReserves, publicDebt, growthNow, debtServiceNow, rangeText, differCard } from "./eco-latest.js";

export function overviewTab(panel, e) {
  const { t, economy: eco } = e;
  panel.append(el("p", "muted tab-intro", t.inv_overview_intro));
  if (!ready(panel, e, ["invest", "stat", "bank"])) return;
  const inv = e.invest;
  const target = (id) => e.stat.plan.targets.find((x) => x.id === id);
  // A number is compared with a target of the plan only when it comes from inside the plan's years (see eco-plan.js)
  const judge = (value, tg, when) => targetStatus(value, tg.target, tg.op, { when, from: e.stat.plan.period[0] });
  // several sources for the same year: one status only when all of them give the same answer
  const judgeAll = (values, tg, when) => {
    const each = values.map((v) => judge(v, tg, when));
    return each.every((s) => s === each[0]) ? each[0] : "split";
  };
  // one source: its name · several: "range of n sources" (who they are and what each counts is in the card at the end)
  const who = (list) => (list.length > 1 ? fill(t.inv_n_sources, { n: list.length }) : t["dif_who_" + list[0].who]);

  // ---------- Key numbers ----------
  const stats = el("div", "stats");
  const gdp = indicator(e, "wb.NY.GDP.MKTP.CD");
  const gdpL = latest(gdp);
  if (gdpL) stats.append(invTile(t, t.inv_k_gdp, { num: gdpL[1].toFixed(2), unit: t.unit_usd_bn }, `World Bank · ${t.inv_current_prices}`, freshness(t, { year: gdpL[0], stale: gdp.stale })));

  const growth = growthNow(e);
  const imfGrowth = valueIn(indicator(e, "imf.NGDP_RPCH"), THIS_YEAR);
  if (growth) {
    const sub = [who(growth.list), imfGrowth !== null ? `${t.inv_imf_expects} ${THIS_YEAR}: ${pctText(imfGrowth)}` : null].filter(Boolean).join(" · ");
    stats.append(invTile(t, t.inv_k_growth, rangeText(growth), sub, freshness(t, { year: growth.year, stale: growth.list.some((x) => x.stale) })));
  }

  const gdppc = indicator(e, "wb.NY.GDP.PCAP.CD");
  const gdppcL = latest(gdppc);
  if (gdppcL) stats.append(invTile(t, t.inv_k_gdppc, { num: formatNumber(gdppcL[1], "USD per person"), unit: "USD" }, `World Bank · ${t.inv_current_prices}`, freshness(t, { year: gdppcL[0], stale: gdppc.stale })));

  const inflation = latestInflation(e);
  if (inflation) stats.append(invTile(t, t.inv_k_inflation, pctText(inflation.value), `${inflation.src} · ${t.inv_vs_last_year}`, freshness(t, { ...inflation.when, stale: inflation.stale })));

  const debt = publicDebt(e);
  if (debt) stats.append(invTile(t, t.inv_k_debt, rangeText(debt), debt.list.length > 1 ? who(debt.list) : `${who(debt.list)} · ${t.inv_estimate}`, freshness(t, { year: debt.year, stale: debt.list.some((x) => x.stale) })));

  // reserves in months of imports: the newest number the app has (the World Bank's report, else its yearly series)
  const res = latestReserves(e).months;
  if (res) {
    const sub = res.bol === null ? `${res.src} · ${t.inv_of_imports}` : `${res.src} · ${t.inv_def_bol}: ${res.bol.toFixed(1)} ${t.inv_unit_months}`;
    stats.append(invTile(t, t.inv_k_reserves, { num: res.value.toFixed(1), unit: t.inv_unit_months }, sub, freshness(t, { ...res.when, stale: res.stale, checked: res.checked })));
  }

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
  if (growth && gT) facts.push([fill(t.inv_fact_growth, { value: rangeText(growth), year: growth.year, target: pctText(gT.target, 0) }), statusBadge(t, judgeAll(growth.list.map((x) => x.value), gT, { year: growth.year }))]);
  const iT = target("inflation");
  if (inflation && iT) facts.push([fill(t.inv_fact_inflation, { value: pctText(inflation.value), month: monthText(inflation.when.month, t), target: pctText(iT.target, 0) }), statusBadge(t, judge(inflation.value, iT, inflation.when))]);

  const due = debtServiceNow(e).ids;
  if (due) facts.push([fill(t.inv_fact_debt_due, { year: due.year, amount: usdText(due.total, t), china: due.china === null ? "—" : pctText(due.china, 0), stock: due.stock }), null]);

  // reserves: counted in two ways when the report gives both - one status only when both give the same answer
  const rT = target("reserves");
  if (res && rT) {
    const when = res.when.month ? monthText(res.when.month, t) : `${t.year} ${res.when.year}`;
    if (res.bol === null) facts.push([fill(t.inv_fact_reserves, { value: res.value.toFixed(1), when, target: rT.target }), statusBadge(t, judge(res.value, rT, res.when))]);
    else facts.push([fill(t.inv_fact_reserves_two, { wb: res.value.toFixed(1), bol: res.bol.toFixed(1), when, target: rT.target }), statusBadge(t, judgeAll([res.bol, res.value], rT, res.when))]);
  }

  // who invests: the World Bank's share of the year's inflow, and - said as what it is - the share inside the
  // amounts that a few investor countries report to the IMF (not a share of all investment: see eco-fdi.js)
  const fp = inv.parts.fdi_positions;
  const wbFdi = e.stat.facts.fdi_2025;
  if (fp && fp.list && fp.list.length >= 2 && fp.total) {
    const top2 = fp.list.slice(0, 2);
    const values = { a: t.countries[top2[0][0]] || top2[0][1], b: t.countries[top2[1][0]] || top2[1][1], share: pctText(((top2[0][2] + top2[1][2]) / fp.total) * 100, 0), year: fp.year, n: fp.list.length };
    facts.push([(wbFdi ? fill(t.inv_fact_fdi_wb, wbFdi) + " · " : "") + fill(t.inv_fact_fdi_top, values), null]);
  }

  const rub = inv.monthly.rubber_usd;
  if (rub && rub.values.length > 12) {
    const now = lastOf(rub.values);
    const ago = rub.values[rub.values.length - 13];
    facts.push([fill(t.inv_fact_rubber, { value: perKg(now[1]).toFixed(2), month: monthText(now[0], t) }), pctPill(pct(ago[1], now[1]), { decimals: 1 })]);
  }
  const [planFrom, planTo] = e.stat.plan.period;
  if (facts.length) panel.append(factsCard(t, t.inv_facts_title, facts, fill(t.inv_facts_note, { from: planFrom, to: planTo, span: planTo - planFrom + 1 })));

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

  // ---------- Why two sources give two numbers ----------
  const differ = differCard(e, ["growth", "inflation", "debt", "reserves", "debt_service"]);
  if (differ) {
    panel.append(el("h2", "section-title", t.dif_section));
    panel.append(differ);
  }
}
