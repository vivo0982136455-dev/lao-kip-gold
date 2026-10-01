// Economy tab 2: GDP & structure - size, growth, GDP per person (vs the 2030 goal), which sectors make the
// economy and how fast each grows, trade, and what drove growth (World Bank report).

import { el, card, cardHead } from "../ui.js";
import { chartCard } from "../charts.js";
import {
  indicator, latest, valueIn, usdText, pctText, freshness, sourcesFoot, barTable, yearChart, ready, staticSource, fill,
} from "./eco-common.js";

const SECTORS = [
  // [share indicator, growth indicator, text key, sub-line key]
  ["wb.NV.SRV.TOTL.ZS", "wb.NV.SRV.TOTL.KD.ZG", "inv_sector_services", null],
  ["wb.NV.IND.TOTL.ZS", "wb.NV.IND.TOTL.KD.ZG", "inv_sector_industry", "inv_sector_industry_sub"],
  ["wb.NV.AGR.TOTL.ZS", "wb.NV.AGR.TOTL.KD.ZG", "inv_sector_agri", null],
];

export function gdpTab(panel, e) {
  const { t } = e;
  panel.append(el("p", "muted tab-intro", t.inv_gdp_intro));
  if (!ready(panel, e)) return;
  const target = (id) => e.stat.plan.targets.find((x) => x.id === id);
  const wb = e.invest.sources.worldbank;

  // ---------- Size, growth, per person ----------
  const grid = el("div", "grid grid-2");
  const charts = [
    yearChart(e, { actual: "wb.NY.GDP.MKTP.CD", forecast: "imf.NGDPD" }, { title: t.eco_gdp }),
    yearChart(e, { actual: "wb.NY.GDP.MKTP.KD.ZG", forecast: "imf.NGDP_RPCH" }, { title: t.eco_growth, unitLabel: t.unit_pct_year, target: target("growth") && { value: target("growth").target, label: t.inv_plan_target_line } }),
    yearChart(e, { actual: "wb.NY.GDP.PCAP.CD", forecast: "imf.NGDPDPC" }, { title: t.inv_gdppc_title, target: target("gdp_pc") && { value: target("gdp_pc").target, year: target("gdp_pc").by, label: fill(t.inv_plan_target_by, { year: target("gdp_pc").by }) } }),
  ];
  for (const c of charts) if (c) grid.append(c);

  // ---------- Structure: share of GDP + growth per sector (latest year) ----------
  const shares = SECTORS.map(([sId, gId, key, sub]) => {
    const s = indicator(e, sId);
    const sl = latest(s);
    const g = sl ? valueIn(indicator(e, gId), sl[0]) : null;
    return { key, sub, share: sl ? sl[1] : null, year: sl ? sl[0] : null, growth: g, stale: s && s.stale };
  }).filter((x) => x.share !== null);
  if (shares.length) {
    const year = shares[0].year;
    const manu = valueIn(indicator(e, "wb.NV.IND.MANF.ZS"), year);
    const rest = 100 - shares.reduce((a, x) => a + x.share, 0); // taxes on products minus subsidies
    const rows = shares.map((x) => ({
      label: t[x.key],
      sub: x.sub && manu !== null ? fill(t[x.sub], { manu: pctText(manu) }) : null,
      value: x.share,
      text: pctText(x.share),
      share: x.growth === null ? "—" : pctText(x.growth),
    }));
    if (rest > 0.5) rows.push({ label: t.inv_sector_taxes, sub: t.inv_sector_taxes_sub, value: rest, text: pctText(rest), share: "—" });
    const c = card("official");
    c.append(cardHead(`${t.inv_structure_title} (${t.year} ${year})`, "official", shares.some((x) => x.stale), t));
    c.append(barTable([t.inv_col_sector, t.inv_col_share_gdp, t.inv_col_growth], rows));
    const plan = ["growth_srv", "growth_ind", "growth_agri"].map((id) => target(id)).filter(Boolean);
    if (plan.length) c.append(el("p", "note", fill(t.inv_structure_plan_note, { srv: plan[0].target, ind: plan[1].target, agri: plan[2].target })));
    c.append(el("p", "note", t.inv_structure_note));
    const fresh = el("div", "card-foot");
    fresh.append(freshness(t, { year, stale: shares.some((x) => x.stale) }));
    c.append(fresh, sourcesFoot(t, [wb, staticSource(e, "kpl_plan")]));
    grid.append(c);
  }

  // Share of each sector over time (all the same kind of number -> category colours)
  const years = [];
  const agri = indicator(e, "wb.NV.AGR.TOTL.ZS");
  if (agri && agri.values.length) {
    for (let y = agri.values[0][0]; y <= agri.values[agri.values.length - 1][0]; y++) years.push(y);
    const line = (id) => years.map((y) => valueIn(indicator(e, id), y));
    grid.append(
      chartCard({
        title: t.inv_structure_chart,
        subtitle: `${t.unit}: ${t.unit_pct_gdp} · ${t.source}: World Bank`,
        labels: years.map(String),
        series: [
          { label: t.inv_sector_services, kind: "official", color: "--cat-1", values: line("wb.NV.SRV.TOTL.ZS") },
          { label: t.inv_sector_industry, kind: "official", color: "--cat-3", values: line("wb.NV.IND.TOTL.ZS") },
          { label: t.inv_sector_agri, kind: "official", color: "--cat-4", values: line("wb.NV.AGR.TOTL.ZS") },
        ],
        unit: "%",
        unitLabel: t.unit_pct_gdp,
        t,
        firstColTitle: t.year,
      })
    );
  }
  panel.append(grid);

  // ---------- Trade + money from abroad ----------
  const ex = indicator(e, "wb.TX.VAL.MRCH.CD.WT");
  const im = indicator(e, "wb.TM.VAL.MRCH.CD.WT");
  const exL = latest(ex);
  const imV = exL ? valueIn(im, exL[0]) : null;
  const rem = indicator(e, "wb.BX.TRF.PWKR.CD.DT");
  const remL = latest(rem);
  if (exL && imV !== null) {
    const c = card("official");
    c.append(cardHead(`${t.inv_trade_title} (${t.year} ${exL[0]})`, "official", ex.stale || im.stale, t));
    const rows = [
      [t.inv_trade_exports, usdText(exL[1] * 1000, t)],
      [t.inv_trade_imports, usdText(imV * 1000, t)],
      [t.inv_trade_balance, `${exL[1] - imV >= 0 ? "+" : "−"}${usdText(Math.abs(exL[1] - imV) * 1000, t)}`],
    ];
    if (remL) rows.push([fill(t.inv_trade_remit, { year: remL[0] }), usdText(remL[1], t)]);
    for (const [label, value] of rows) {
      const row = el("div", "row");
      row.append(el("span", "row-label", label), el("span", "value small-value", value));
      c.append(row);
    }
    c.append(el("p", "note", t.inv_trade_note));
    const fresh = el("div", "card-foot");
    fresh.append(freshness(t, { year: exL[0], stale: ex.stale || im.stale }));
    c.append(fresh, sourcesFoot(t, [wb], ex.source_updated));
    panel.append(el("h2", "section-title", t.inv_trade_section));
    const g2 = el("div", "grid grid-2");
    g2.append(c);
    // Current account (trade + services + income): IMF, with forecast
    const ca = yearChart(e, { forecast: "imf.BCA_NGDPD" }, { title: t.eco_current_account });
    if (ca) g2.append(ca);

    // What drove growth (World Bank report, quoted numbers)
    const f = e.stat.facts.growth_drivers;
    if (f) {
      const d = card("official");
      d.append(cardHead(t.inv_drivers_title, "official", false, t));
      const ul = el("ul", "watch-list");
      for (const k of ["inv_drivers_1", "inv_drivers_2", "inv_drivers_3", "inv_drivers_4"]) ul.append(el("li", "", fill(t[k], f)));
      d.append(ul);
      d.append(sourcesFoot(t, [staticSource(e, f.source)]));
      g2.append(d);
    }
    panel.append(g2);
  }

  // Honest note: the detailed list of sectors is not open data
  const n = el("p", "note");
  n.append(`${t.inv_top_sectors_note} `);
  const lsb = e.stat.sources.lsb;
  const a = el("a", "", lsb.source_name);
  a.href = lsb.source_url;
  a.target = "_blank";
  a.rel = "noopener";
  n.append(a);
  panel.append(n);
}
