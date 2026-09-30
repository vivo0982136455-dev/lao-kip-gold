// Economy tab 4: foreign direct investment - money coming in each year (World Bank) and who has invested,
// by country (IMF Direct Investment Positions, reported by the investor countries themselves).

import { el, card, cardHead } from "../ui.js";
import {
  indicator, latest, usdText, usdParts, pctText, freshness, sourcesFoot, invTile, barTable, yearChart, ready, staticSource, fill,
} from "./eco-common.js";

export function fdiTab(panel, e) {
  const { t } = e;
  panel.append(el("p", "muted tab-intro", t.inv_fdi_intro));
  if (!ready(panel, e)) return;
  const inv = e.invest;

  // Key numbers
  const stats = el("div", "stats");
  const flow = indicator(e, "wb.BX.KLT.DINV.CD.WD");
  const flowL = latest(flow);
  if (flowL) stats.append(invTile(t, t.inv_k_fdi, usdParts(flowL[1], t), "World Bank", freshness(t, { year: flowL[0], stale: flow.stale })));
  const flowGdp = indicator(e, "wb.BX.KLT.DINV.WD.GD.ZS");
  const flowGdpL = latest(flowGdp);
  if (flowGdpL) stats.append(invTile(t, t.inv_k_fdi_gdp, pctText(flowGdpL[1]), `${t.inv_of_gdp} · World Bank`, freshness(t, { year: flowGdpL[0], stale: flowGdp.stale })));
  const fp = inv.parts.fdi_positions;
  if (fp && fp.total) stats.append(invTile(t, t.inv_k_fdi_stock, usdParts(fp.total, t), `IMF · ${t.inv_fdi_reported_only}`, freshness(t, { year: fp.year, stale: fp.stale })));
  panel.append(stats);

  const grid = el("div", "grid grid-2");
  const chart = yearChart(e, { actual: "wb.BX.KLT.DINV.CD.WD" }, { title: t.inv_fdi_chart, firstYear: 2000 });
  if (chart) grid.append(chart);

  // Who has invested (stock at the end of the year)
  if (fp && fp.list && fp.list.length) {
    const c = card("official");
    c.append(cardHead(`${t.inv_fdi_who} (${t.year} ${fp.year})`, "official", fp.stale, t));
    const rows = fp.list.map(([code, name, v]) => ({
      label: t.countries[code] || name,
      value: v,
      text: usdText(v, t),
      share: pctText((v / fp.total) * 100, 0),
    }));
    c.append(barTable([t.inv_col_country, t.inv_col_amount, t.inv_col_share], rows));
    c.append(el("p", "note", t.inv_fdi_who_note));
    c.append(el("p", "note", t.inv_fdi_missing));
    const fresh = el("div", "card-foot");
    fresh.append(freshness(t, { year: fp.year, stale: fp.stale }));
    c.append(fresh, sourcesFoot(t, [inv.sources.imf_dip]));
    grid.append(c);
  }
  panel.append(grid);

  // What the World Bank says about where investment goes
  const f = e.stat.facts.fdi_2025;
  if (f) {
    const d = card("official");
    d.append(cardHead(t.inv_fdi_where_title, "official", false, t));
    const ul = el("ul", "watch-list");
    for (const k of ["inv_fdi_where_1", "inv_fdi_where_2", "inv_fdi_where_3"]) ul.append(el("li", "", fill(t[k], f)));
    d.append(ul);
    d.append(sourcesFoot(t, [staticSource(e, f.source)]));
    panel.append(d);
  }
}
