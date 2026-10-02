// Economy tab: the government's 5-year plan (10th NSEDP 2026-2030) - each target next to the newest real number
// and the IMF forecast. Targets: data/invest-static.json "plan".
// A status (met / near / far) is given only to a number from inside the plan period:
//   - a number from before the plan starts is the "baseline": where the plan starts from, not a result
//   - a number that is too old to be called current is not compared at all
//   - a target for one later year (GDP per person in 2030) is judged by the IMF forecast for that year, and the
//     badge says so
//   - the reserves are counted in two ways (World Bank: all imports of goods and services; Bank of the Lao PDR:
//     without the imports of foreign-funded businesses) and the plan does not say which one it means: both numbers
//     are shown, each with its own result
// The number compared is the newest one the app has: an automatic series or a hand-read fact of a report.

import { el, card, cardHead } from "../ui.js";
import { formatNumber } from "../format.js";
import { lazyJson } from "../lazy.js";
import {
  THIS_YEAR, lastOf, indicator, latest, valueIn, pctText, freshness, sourcesFoot, statusBadge, targetStatus, fill,
  ready, staticSource, monthText, newest, policyItem, reservesMonths, NEAR_GAP,
} from "./eco-common.js";

// Newest real number for a target:
//   { value, when: {year|month}, src, stale, source?: id of a hand-read source, parts?: [{ value, def }] }
//   parts = the same thing counted in two ways (def: "bol" | "wb"), newest first in the order they are shown
function actualOf(e, key) {
  const yearly = (id, source, before) => {
    const ind = indicator(e, id);
    const l = latest(ind, before);
    return l ? { value: l[1], when: { year: l[0] }, src: source, stale: ind.stale } : null;
  };
  switch (key) {
    case "gdp_growth":
      return yearly("wb.NY.GDP.MKTP.KD.ZG", "World Bank");
    case "agri_growth":
      return yearly("wb.NV.AGR.TOTL.KD.ZG", "World Bank");
    case "ind_growth":
      return yearly("wb.NV.IND.TOTL.KD.ZG", "World Bank");
    case "srv_growth":
      return yearly("wb.NV.SRV.TOTL.KD.ZG", "World Bank");
    case "gdp_pc":
      return yearly("wb.NY.GDP.PCAP.CD", "World Bank");
    case "inflation": {
      const s = e.economy.monthly && e.economy.monthly.cpi_yoy;
      const l = s && lastOf(s.values);
      return l ? { value: l[1], when: { month: l[0] }, src: "IMF", stale: s.stale } : null;
    }
    case "debt":
      return yearly("imf.GGXWDG_NGDP", "IMF", THIS_YEAR);
    case "reserves": {
      const r = reservesMonths(e);
      if (!r) return null;
      return { value: r.value, when: r.when, src: r.src, stale: r.stale, source: r.source, parts: r.bol === null ? null : [{ value: r.bol, def: "bol" }, { value: r.value, def: "wb" }] };
    }
    case "revenue": {
      // the yearly World Bank series stops years earlier than the bank's own report on Laos
      const read = policyItem(e, "tax", "revenue");
      return newest(read ? { value: read.revenue, when: { year: read.year }, src: "World Bank", stale: false, source: read.source } : null, yearly("wb.GC.REV.XGRT.GD.ZS", "World Bank"));
    }
    case "budget":
      return yearly("imf.GGXCNL_NGDP", "IMF", THIS_YEAR);
    default:
      return null;
  }
}

// IMF forecast sentence for some targets ("IMF expects 4.0% in 2026")
function forecastOf(e, tg) {
  const { t } = e;
  const imf = (id, year) => valueIn(indicator(e, id), year);
  switch (tg.actual) {
    case "gdp_growth": {
      const v = imf("imf.NGDP_RPCH", THIS_YEAR);
      return v === null ? null : { text: fill(t.inv_plan_imf_year, { year: THIS_YEAR, value: pctText(v) }), value: v };
    }
    case "inflation": {
      const v = imf("imf.PCPIPCH", THIS_YEAR);
      return v === null ? null : { text: fill(t.inv_plan_imf_year, { year: THIS_YEAR, value: pctText(v) }), value: v };
    }
    case "gdp_pc": {
      const v = imf("imf.NGDPDPC", tg.by);
      return v === null ? null : { text: fill(t.inv_plan_imf_year, { year: tg.by, value: `${formatNumber(v, "USD per person")} USD` }), value: v, decides: true };
    }
    case "debt": {
      const ind = indicator(e, "imf.GGXWDG_NGDP");
      const first = ind && ind.values.find(([y, v]) => y >= THIS_YEAR && v <= tg.target);
      return first ? { text: fill(t.inv_plan_imf_below, { year: first[0], value: pctText(first[1]) }) } : { text: t.inv_plan_imf_not_below };
    }
    case "budget": {
      const v = imf("imf.GGXCNL_NGDP", THIS_YEAR);
      return v === null ? null : { text: fill(t.inv_plan_imf_year, { year: THIS_YEAR, value: `${v > 0 ? "+" : ""}${pctText(v)}` }), value: v };
    }
    default:
      return null;
  }
}

// The central bank's newest reserves next to the month the "months of imports" were counted for
function reservesNow(e, a, bank) {
  const rows = bank.state === "ok" && bank.data.reserves && bank.data.reserves.rows;
  if (!rows || !rows.length || !a.when.month) return null;
  const now = lastOf(rows);
  const then = rows.find(([m]) => m === a.when.month);
  if (!then || now[0] <= then[0]) return null;
  const bn = (millions) => (millions / 1000).toFixed(2);
  return fill(e.t.inv_plan_reserves_now, { usd_bn: bn(now[1]), month: monthText(now[0], e.t), ref_bn: bn(then[1]), ref_month: monthText(then[0], e.t) }) + (bank.data.reserves.stale ? ` ⚠ ${e.t.inv_fetch_failed}` : "");
}

const targetText = (tg, t) => {
  const sign = tg.op === ">=" ? "≥" : "≤";
  switch (tg.unit) {
    case "%":
      return `${sign} ${pctText(tg.target, tg.target % 1 ? 1 : 0)}`;
    case "% of GDP":
      return tg.id === "budget" ? t.inv_plan_surplus : `${sign} ${pctText(tg.target, tg.target % 1 ? 2 : 0)} ${t.inv_of_gdp}`;
    case "USD":
      return `${formatNumber(tg.target, "USD per person")} USD (${t.year} ${tg.by})`;
    case "months":
      return `${sign} ${tg.target} ${t.inv_unit_months}`;
    default:
      return `${sign} ${tg.target} ${t["inv_plan_unit_" + tg.id] || ""}`.trim();
  }
};
const actualText = (tg, value, t) => {
  if (tg.unit === "USD") return `${formatNumber(value, "USD per person")} USD`;
  if (tg.unit === "months") return `${value.toFixed(1)} ${t.inv_unit_months}`;
  if (tg.id === "budget") return `${value > 0 ? "+" : ""}${pctText(value)}`; // the target column already says "of GDP"
  return pctText(value);
};

// Order of the summary line. The three judgements are always named; the others only when there is one.
const SUMMARY = ["met", "near", "far", "split", "baseline", "old", "none"];
const ALWAYS = ["met", "near", "far"];

export function planTab(panel, e) {
  const { t } = e;
  panel.append(el("p", "muted tab-intro", t.inv_plan_intro));
  const bank = lazyJson("data/bol-policy.json", e.rerender); // the central bank's reserves by month (a line under the target)
  if (!ready(panel, e)) return;
  const plan = e.stat.plan;
  const from = plan.period[0];

  const c = card("official");
  c.append(cardHead(t.inv_plan_title, "official", false, t));
  const tbl = el("table");
  const head = el("tr");
  for (const h of [t.inv_col_goal, t.inv_col_target, t.inv_col_latest]) head.append(el("th", "", h));
  tbl.appendChild(el("thead")).append(head);
  const body = tbl.appendChild(el("tbody"));
  const counts = Object.fromEntries(SUMMARY.map((s) => [s, 0]));
  const read = new Set(); // hand-read sources used by a row
  let twoWays = false;
  for (const tg of plan.targets) {
    const a = tg.actual ? actualOf(e, tg.actual) : null;
    const fc = tg.actual ? forecastOf(e, tg) : null;
    if (a && a.source) read.add(a.source);
    const period = a ? { when: a.when, from } : null;

    const tr = el("tr");
    const name = el("td");
    name.append(el("span", "", t["inv_plan_" + tg.id]));
    if (fc) name.append(el("span", "sub-line", fc.text));
    const tgt = el("td", "", targetText(tg, t));
    const act = el("td", "plan-actual");
    const when = () => {
      const line = el("div", "sub-line");
      line.append(`${a.src} · `, freshness(t, { ...a.when, stale: a.stale, compact: true }));
      return line;
    };
    let status;
    if (!a) {
      status = "none";
      act.append(el("div", "sub-line", t.inv_plan_no_data), statusBadge(t, status));
    } else if (a.parts) {
      // counted in two ways: each number with its own result; one status for the row only when both agree
      const each = a.parts.map((p) => targetStatus(p.value, tg.target, tg.op, period));
      status = each.every((s) => s === each[0]) ? each[0] : "split";
      twoWays = true;
      a.parts.forEach((p, i) => {
        act.append(el("div", "plan-value", actualText(tg, p.value, t)), el("div", "sub-line", t["inv_def_" + p.def]), statusBadge(t, each[i]));
      });
      act.append(when());
      const now = reservesNow(e, a, bank);
      if (now) name.append(el("span", "sub-line", now));
    } else {
      act.append(el("div", "plan-value", actualText(tg, a.value, t)), when());
      if (fc && fc.decides) {
        // a goal for one later year is judged by the forecast for that year - and says so
        status = targetStatus(fc.value, tg.target, tg.op);
        act.append(statusBadge(t, status), el("div", "sub-line", fill(t.inv_plan_by_forecast, { year: tg.by })));
      } else {
        status = targetStatus(a.value, tg.target, tg.op, period);
        act.append(statusBadge(t, status));
      }
    }
    counts[status]++;
    tr.append(name, tgt, act);
    body.append(tr);
  }
  const wrap = el("div", "table-wrap wrap-all plan-table");
  wrap.append(tbl);
  c.append(wrap);
  const parts = SUMMARY.filter((s) => counts[s] || ALWAYS.includes(s)).map((s) => `${t["inv_status_" + s]} ${counts[s]}`);
  c.append(el("p", "note", `${fill(t.inv_plan_summary, { total: plan.targets.length })} ${parts.join(" · ")}`));
  const byTarget = plan.targets.find((x) => x.by);
  c.append(el("p", "note", fill(t.inv_plan_how, { from, to: plan.period[1], span: plan.period[1] - from + 1, near: Math.round(NEAR_GAP * 100), by: byTarget ? byTarget.by : plan.period[1] })));
  const reserves = plan.targets.find((x) => x.id === "reserves");
  if (twoWays && reserves) c.append(el("p", "note", fill(t.inv_plan_two_ways, { target: reserves.target })));
  if (plan.projects) c.append(el("p", "note", fill(t.inv_plan_projects, plan.projects)));
  c.append(sourcesFoot(t, [staticSource(e, "kpl_plan"), staticSource(e, "kpl_plan2"), e.invest.sources.worldbank, e.invest.sources.imf, ...[...read].map((id) => staticSource(e, id))]));
  const fresh = el("div", "card-foot");
  fresh.append(freshness(t, { checked: plan.checked || e.stat.checked }));
  c.append(fresh);
  panel.append(c);
}

export { monthText };
