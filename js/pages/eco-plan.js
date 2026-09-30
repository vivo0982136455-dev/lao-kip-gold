// Economy tab 3: the government's 5-year plan (10th NSEDP 2026-2030) - each target next to the newest real number
// and the IMF forecast, with a status computed here (met / close / far / no data). Targets: data/invest-static.json.

import { el, card, cardHead } from "../ui.js";
import { formatNumber } from "../format.js";
import {
  THIS_YEAR, lastOf, indicator, latest, valueIn, pctText, freshness, sourcesFoot, statusBadge, targetStatus, fill,
  ready, staticSource, monthText,
} from "./eco-common.js";

// Newest real number for a target: { value, when: {year|month}, src, stale }
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
    case "reserves":
      return yearly("wb.FI.RES.TOTL.MO", "World Bank");
    case "revenue":
      return yearly("wb.GC.REV.XGRT.GD.ZS", "World Bank");
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
const actualText = (tg, a, t) => {
  if (tg.unit === "USD") return `${formatNumber(a.value, "USD per person")} USD`;
  if (tg.unit === "months") return `${a.value.toFixed(1)} ${t.inv_unit_months}`;
  if (tg.id === "budget") return `${a.value > 0 ? "+" : ""}${pctText(a.value)}`; // the target column already says "of GDP"
  return pctText(a.value);
};

export function planTab(panel, e) {
  const { t } = e;
  panel.append(el("p", "muted tab-intro", t.inv_plan_intro));
  if (!ready(panel, e)) return;
  const plan = e.stat.plan;

  const c = card("official");
  c.append(cardHead(t.inv_plan_title, "official", false, t));
  const tbl = el("table");
  const head = el("tr");
  for (const h of [t.inv_col_goal, t.inv_col_target, t.inv_col_latest]) head.append(el("th", "", h));
  tbl.appendChild(el("thead")).append(head);
  const body = tbl.appendChild(el("tbody"));
  const counts = { met: 0, near: 0, far: 0, none: 0 };
  for (const tg of plan.targets) {
    const a = tg.actual ? actualOf(e, tg.actual) : null;
    const fc = tg.actual ? forecastOf(e, tg) : null;
    // A goal for a later year (GDP per person 2030) is judged by the IMF forecast for that year
    const judged = fc && fc.decides ? fc.value : a ? a.value : null;
    const status = targetStatus(judged, tg.target, tg.op);
    counts[status]++;

    const tr = el("tr");
    const name = el("td");
    name.append(el("span", "", t["inv_plan_" + tg.id]));
    if (fc) name.append(el("span", "sub-line", fc.text));
    const tgt = el("td", "", targetText(tg, t));
    const act = el("td", "plan-actual");
    if (a) {
      act.append(el("div", "plan-value", actualText(tg, a, t)));
      const when = el("div", "sub-line");
      when.append(`${a.src} · `, freshness(t, { ...a.when, stale: a.stale, compact: true }));
      act.append(when);
    } else {
      act.append(el("div", "sub-line", t.inv_plan_no_data));
    }
    act.append(statusBadge(t, status));
    tr.append(name, tgt, act);
    body.append(tr);
  }
  const wrap = el("div", "table-wrap wrap-all plan-table");
  wrap.append(tbl);
  c.append(wrap);
  c.append(el("p", "note", fill(t.inv_plan_summary, counts)));
  c.append(el("p", "note", t.inv_plan_how));
  if (plan.projects) c.append(el("p", "note", fill(t.inv_plan_projects, plan.projects)));
  c.append(sourcesFoot(t, [staticSource(e, "kpl_plan"), staticSource(e, "kpl_plan2"), e.invest.sources.worldbank, e.invest.sources.imf]));
  const fresh = el("div", "card-foot");
  fresh.append(freshness(t, { checked: e.stat.checked }));
  c.append(fresh);
  panel.append(c);
}

export { monthText };
