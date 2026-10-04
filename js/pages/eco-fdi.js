// Economy tab 4: foreign direct investment - money coming in each year (World Bank) and who has invested,
// by country (IMF Direct Investment Positions, reported by the investor countries themselves).
// Two totals that do not measure the same thing are kept apart:
//   - "reported" = what the few investor countries that report to the IMF say they hold in Laos (mirror data)
//   - UNCTAD's stock for all investors together = the running total of the yearly inflows recorded on the Lao side
// The reported amounts can be larger than UNCTAD's total (2024: 17.3 against 15.4 billion US dollars), and
// countries that do not report (Viet Nam ...) are missing. So a share in the table is a share of the REPORTED
// amounts only, and the page says so - never "x% of all investment".

import { el, card, cardHead } from "../ui.js";
import {
  indicator, latest, usdText, usdParts, pctText, freshness, sourcesFoot, invTile, barTable, yearChart, ready, staticSource, fill, monthText, sourceWords,
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
  const n = fp && fp.list ? fp.list.length : 0;
  if (fp && fp.total) stats.append(invTile(t, fill(t.inv_k_fdi_stock, { n }), usdParts(fp.total, t), `IMF · ${t.inv_fdi_reported_only}`, freshness(t, { year: fp.year, stale: fp.stale })));
  // all investors together (UNCTAD): the newest year it has
  const all = inv.parts.fdi_total;
  const allL = all && all.values && all.values.length ? all.values[all.values.length - 1] : null;
  if (allL) stats.append(invTile(t, t.inv_k_fdi_total, usdParts(allL[1], t), `UNCTAD · ${t.inv_fdi_total_sub}`, freshness(t, { year: allL[0], stale: all.stale })));
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
    c.append(barTable([t.inv_col_country, t.inv_col_amount, t.inv_col_share_reported], rows));
    c.append(el("p", "note", fill(t.inv_fdi_who_note, { n })));
    // how the reported amounts compare with UNCTAD's total for the same year
    const same = all && all.values ? all.values.find(([y]) => y === fp.year) : null;
    if (same) {
      const cover = (fp.total / same[1]) * 100;
      c.append(el("p", "note", fill(cover > 100 ? t.inv_fdi_cover_over : t.inv_fdi_cover_under, { n, year: fp.year, total: usdText(same[1], t), reported: usdText(fp.total, t), cover: pctText(cover, 0) })));
    }
    // which country is missing most: named by the World Bank's report (hand-read, with the months it speaks of)
    const vn = e.stat.facts.fdi_vietnam;
    if (vn) c.append(el("p", "note", fill(t.inv_fdi_missing, { ...sourceWords(e, vn.source), rank: vn.rank, from: monthText(vn.from, t), to: monthText(vn.to, t) })));
    const fresh = el("div", "card-foot");
    fresh.append(freshness(t, { year: fp.year, stale: fp.stale || !!(same && all.stale) }));
    c.append(fresh, sourcesFoot(t, [inv.sources.imf_dip, same ? inv.sources.unctad : null]));
    grid.append(c);
  }
  panel.append(grid);

  // What the World Bank says about where investment goes
  const f = e.stat.facts.fdi_2025;
  if (f) {
    const d = card("official");
    d.append(cardHead(fill(t.inv_fdi_where_title, f), "official", false, t));
    const ul = el("ul", "watch-list");
    for (const k of ["inv_fdi_where_1", "inv_fdi_where_2", "inv_fdi_where_3"]) ul.append(el("li", "", fill(t[k], f)));
    d.append(ul);
    d.append(sourcesFoot(t, [staticSource(e, f.source)]));
    panel.append(d);
  }
}
