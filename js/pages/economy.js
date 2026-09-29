// Page 4: Lao economy (Phase 4). Yearly data: World Bank (actual) + IMF (forecast, dashed line).
// Monthly CPI comes from the owner's Google Sheet.

import { el, card, sectionTitle, statTile, emptyState } from "../ui.js";
import { formatNumber } from "../format.js";
import { chartCard, mountCharts } from "../charts.js";

const FIRST_YEAR = 2010;

// actual: indicator id for actual data (World Bank). forecast: IMF indicator.
// If there is no World Bank series, IMF years before this year count as "actual/estimate".
const CHARTS = [
  { title: "eco_gdp", actual: "wb.NY.GDP.MKTP.CD", forecast: "imf.NGDPD" },
  { title: "eco_growth", actual: "wb.NY.GDP.MKTP.KD.ZG", forecast: "imf.NGDP_RPCH" },
  { title: "eco_inflation", actual: "wb.FP.CPI.TOTL.ZG", forecast: "imf.PCPIPCH" },
  { title: "eco_debt", forecast: "imf.GGXWDG_NGDP" },
  { title: "eco_current_account", forecast: "imf.BCA_NGDPD" },
  { title: "eco_fdi", actual: "wb.BX.KLT.DINV.CD.WD" },
  { title: "eco_fx_avg", actual: "wb.PA.NUS.FCRF" },
];

const SOURCE_LABEL = { worldbank: "World Bank", imf: "IMF" };
const UNIT_KEYS = { "%": "unit_pct", "% of GDP": "unit_pct_gdp", "USD bn": "unit_usd_bn", "USD m": "unit_usd_m", "LAK per USD": "unit_lak_usd" };
const unitName = (unit, t) => t[UNIT_KEYS[unit]] || unit;

// "4.5%" or "18.30 USD bn"
function valueWithUnit(v, unit, t) {
  return unit.startsWith("%") ? `${formatNumber(v, unit)}%` : `${formatNumber(v, unit)} ${unitName(unit, t)}`;
}

// Split one chart into "actual" and "forecast" values for each year label
function buildSeries(def, eco) {
  const thisYear = new Date().getFullYear();
  const act = def.actual && eco.indicators[def.actual];
  const fc = def.forecast && eco.indicators[def.forecast];
  let actualPoints;
  let forecastPoints = [];

  if (act && act.values.length) {
    actualPoints = act.values;
    const lastActual = actualPoints[actualPoints.length - 1][0];
    if (fc) forecastPoints = fc.values.filter(([y]) => y > lastActual);
  } else if (fc) {
    // IMF only: years before this year = actual/estimate, this year onwards = forecast
    actualPoints = fc.values.filter(([y]) => y < thisYear);
    forecastPoints = fc.values.filter(([y]) => y >= thisYear);
  } else {
    return null;
  }
  // Start the dashed line at the last actual point so the two lines connect
  const last = actualPoints[actualPoints.length - 1];
  if (forecastPoints.length && last) forecastPoints = [last, ...forecastPoints];

  const allYears = [...actualPoints, ...forecastPoints].map(([y]) => y).filter((y) => y >= FIRST_YEAR);
  const maxYear = Math.max(...allYears);
  const years = [];
  for (let y = FIRST_YEAR; y <= maxYear; y++) years.push(y);
  const pick = (points) => {
    const m = new Map(points);
    return years.map((y) => (m.has(y) ? m.get(y) : null));
  };
  const unit = (act || fc).unit;
  const sources = [act && act.source, forecastPoints.length && fc && fc.source].filter(Boolean);
  return {
    years,
    unit,
    lastActual: last ? last[0] : null,
    lastValue: last ? last[1] : null,
    actual: pick(actualPoints),
    forecast: forecastPoints.length ? pick(forecastPoints) : null,
    sources: [...new Set(sources)],
    stale: [act, fc].some((x) => x && x.stale),
  };
}

export function render(view, ctx) {
  const { t, economy: eco } = ctx;
  if (!eco || !eco.indicators) {
    view.append(emptyState(t.eco_missing_title, t.eco_missing_text));
    return;
  }
  view.append(el("p", "lead", t.economy_lead));

  // Stat tiles: newest actual value of 4 key numbers
  const stats = el("div", "stats");
  for (const key of ["eco_growth", "eco_inflation", "eco_debt", "eco_gdp"]) {
    const def = CHARTS.find((c) => c.title === key);
    const s = buildSeries(def, eco);
    if (!s || s.lastValue === null) continue;
    stats.append(statTile(t[key], valueWithUnit(s.lastValue, s.unit, t), `${t.year} ${s.lastActual} · ${s.sources.map((x) => SOURCE_LABEL[x]).join(" + ")}`, "official"));
  }
  view.append(stats);

  view.append(sectionTitle(t.eco_charts_title));
  const grid = el("div", "grid grid-2");
  for (const def of CHARTS) {
    const s = buildSeries(def, eco);
    if (!s) continue;
    const series = [{ label: t.series_actual, kind: "official", values: s.actual }];
    if (s.forecast) series.push({ label: t.series_imf_forecast, kind: "official", dashed: true, values: s.forecast });
    const subtitle = [
      `${t.unit}: ${unitName(s.unit, t)}`,
      `${t.source}: ${s.sources.map((x) => SOURCE_LABEL[x]).join(" + ")}`,
      `${def.actual ? t.latest_actual_year : t.latest_estimate_year} ${s.lastActual}`,
      s.forecast ? t.dashed_is_forecast : null,
      s.stale ? "⚠ " + t.stale_badge : null,
    ].filter(Boolean).join(" · ");
    grid.append(chartCard({ title: t[def.title], subtitle, labels: s.years.map(String), series, unit: s.unit, t, firstColTitle: t.year }));
  }

  // Monthly CPI (manual)
  const cpi = eco.cpi_monthly;
  if (cpi && cpi.configured && cpi.values.length) {
    const labels = cpi.values.map(([m]) => m);
    grid.append(
      chartCard({
        title: t.eco_cpi_monthly,
        subtitle: `${t.source}: ${t.cpi_source} · ${t.latest_month} ${labels[labels.length - 1]}${cpi.stale ? " · ⚠ " + t.stale_badge : ""}`,
        labels,
        series: [{ label: t.eco_cpi_monthly, kind: "official", values: cpi.values.map(([, v]) => v) }],
        unit: "%",
        t,
        firstColTitle: t.month,
      })
    );
  } else {
    const c = card(null);
    c.append(el("h3", "", t.eco_cpi_monthly));
    c.append(emptyState(t.cpi_not_setup_title, t.cpi_not_setup_text));
    grid.append(c);
  }
  view.append(grid);

  // Sources
  const src = el("p", "note");
  src.style.marginTop = "12px";
  src.textContent = `${t.footer_sources}: ` + Object.values(eco.sources).map((s) => `${s.source_name} (${s.license})`).join(" · ");
  view.append(src);
  mountCharts(view);
}
