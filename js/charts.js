// Line charts (Chart.js, loaded from CDN in index.html) + their data tables.
// Colours follow the KIND of number: official = blue, market = orange, estimated = aqua, shop = violet.
// Every chart has a "show as table" twin, so no value depends on hover or colour alone.

import { formatNumber, formatAxis, formatDate, todayVientiane, addDays } from "./format.js";
import { el, card } from "./ui.js";

let activeCharts = []; // destroyed before every page change / redraw

export function destroyCharts() {
  activeCharts.forEach((c) => c.destroy());
  activeCharts = [];
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// ---------- Helpers for daily data ----------
// Calendar days in the range (Vientiane dates), oldest first
export function dayRange(rangeDays) {
  const today = todayVientiane();
  const days = [];
  for (let i = rangeDays - 1; i >= 0; i--) days.push(addDays(today, -i));
  return days;
}

// daily [[day, value]] -> values for each day in `days` (null when missing)
export function valuesFor(daily, days) {
  const byDay = new Map(daily || []);
  return days.map((d) => (byDay.has(d) ? byDay.get(d) : null));
}

// Draws a thin vertical line at the hovered point (the "crosshair")
const crosshair = {
  id: "crosshair",
  afterDatasetsDraw(chart) {
    const active = chart.tooltip && chart.tooltip.getActiveElements();
    if (!active || !active.length) return;
    const x = active[0].element.x;
    const { top, bottom } = chart.chartArea;
    const ctx = chart.ctx;
    ctx.save();
    ctx.strokeStyle = cssVar("--axis");
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.restore();
  },
};

function drawChart(canvas, { labels, series, unit, t }) {
  const surface = cssVar("--surface");
  const datasets = series.map((s) => {
    // s.color (e.g. "--cat-2") is for charts whose lines are all the SAME kind (inflation categories, savings)
    const color = cssVar(s.color || "--kind-" + s.kind);
    const count = s.values.filter((v) => v !== null).length;
    return {
      label: s.label,
      data: s.values,
      borderColor: color,
      backgroundColor: color,
      borderWidth: 2,
      borderDash: s.dashed ? [6, 4] : [],
      pointRadius: count <= 20 ? 4 : 0, // dots only when there are few points
      pointHoverRadius: 5,
      pointBorderColor: surface, // 2px ring in the surface colour
      pointBorderWidth: 2,
      spanGaps: true,
      tension: 0,
    };
  });

  return new Chart(canvas, {
    type: "line",
    data: { labels, datasets },
    plugins: [crosshair],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          display: series.length > 1, // one series: the chart title already names it
          position: "bottom",
          align: "start",
          labels: {
            usePointStyle: true,
            pointStyle: "line",
            color: cssVar("--text-2"),
            boxWidth: 16,
            // Chart.js takes the key colour from the point ring (surface colour); use the line colour instead
            generateLabels: (chart) =>
              Chart.defaults.plugins.legend.labels.generateLabels(chart).map((item) => {
                const ds = chart.data.datasets[item.datasetIndex];
                return { ...item, strokeStyle: ds.borderColor, fillStyle: ds.borderColor, lineWidth: 2, lineDash: ds.borderDash };
              }),
          },
        },
        tooltip: {
          backgroundColor: cssVar("--surface-2"),
          titleColor: cssVar("--text-2"),
          bodyColor: cssVar("--text"),
          borderColor: cssVar("--border-strong"),
          borderWidth: 1,
          usePointStyle: true,
          callbacks: {
            // value first, then the series name
            label: (ctx) => ` ${formatNumber(ctx.parsed.y, unit)}  ${ctx.dataset.label}`,
            labelPointStyle: () => ({ pointStyle: "line", rotation: 0 }),
            labelColor: (ctx) => ({ borderColor: ctx.dataset.borderColor, backgroundColor: ctx.dataset.borderColor, borderWidth: 2 }),
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: cssVar("--axis") },
          ticks: { color: cssVar("--muted"), maxTicksLimit: 6, maxRotation: 0, autoSkip: true },
        },
        y: {
          grid: { color: cssVar("--grid") },
          border: { display: false },
          ticks: { color: cssVar("--muted"), maxTicksLimit: 6, callback: (v) => formatAxis(v, unit, t) },
        },
      },
    },
  });
}

// Table twin: newest first, only rows that have a value
function dataTable(labels, series, unit, t, firstColTitle) {
  const tbl = el("table");
  const head = el("tr");
  head.append(el("th", "", firstColTitle));
  for (const s of series) head.append(el("th", "", s.label));
  tbl.appendChild(el("thead")).append(head);
  const body = tbl.appendChild(el("tbody"));
  for (let i = labels.length - 1; i >= 0; i--) {
    if (series.every((s) => s.values[i] === null)) continue;
    const tr = el("tr");
    tr.append(el("td", "", labels[i]));
    for (const s of series) tr.append(el("td", "", s.values[i] === null ? "—" : formatNumber(s.values[i], unit)));
    body.append(tr);
  }
  const wrap = el("div", "table-wrap");
  wrap.append(tbl);
  return wrap;
}

// A chart card. options: { title, subtitle, labels, series:[{label, values, kind, dashed}], unit, t, firstColTitle }
// Call mountCharts(container) after the card is in the page.
export function chartCard({ title, subtitle, labels, series, unit, t, firstColTitle, extraClass = "" }) {
  const c = card(null, "chart-card " + extraClass);
  c.append(el("h3", "", title));
  if (subtitle) c.append(el("p", "chart-sub", subtitle));
  const box = el("div", "chart-box");
  c.append(box);

  const enoughData = series.some((s) => s.values.filter((v) => v !== null).length >= 2);
  if (!enoughData || typeof Chart === "undefined") {
    box.append(el("div", "chart-empty", t.chart_no_data));
  } else {
    const canvas = el("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", title);
    box.append(canvas);
    c._draw = () => activeCharts.push(drawChart(canvas, { labels, series, unit, t }));
  }
  if (series.length) {
    const details = el("details");
    details.append(el("summary", "", t.show_table), dataTable(labels, series, unit, t, firstColTitle || t.col_date));
    c.append(details);
  }
  return c;
}

// Daily chart card from summary metrics. seriesDefs: [{ metric | daily, label, kind, dashed }]
export function dailyChartCard({ title, subtitle, summary, seriesDefs, rangeDays, t, unit }) {
  const days = dayRange(rangeDays);
  const series = seriesDefs
    .map((s) => {
      const daily = s.daily || (summary.metrics[s.metric] && summary.metrics[s.metric].daily);
      if (!daily) return null;
      return { label: s.label, kind: s.kind, dashed: s.dashed, values: valuesFor(daily, days) };
    })
    .filter(Boolean);
  const firstMetric = seriesDefs.map((s) => s.metric && summary.metrics[s.metric]).find(Boolean);
  return chartCard({
    title,
    subtitle,
    labels: days.map((d) => formatDate(d, t)),
    series,
    unit: unit || (firstMetric ? firstMetric.unit : "LAK"),
    t,
  });
}

// Draw every chart card inside `root` (must already be in the page so Chart.js knows the size)
export function mountCharts(root) {
  if (typeof Chart !== "undefined") Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  root.querySelectorAll(".chart-card").forEach((c) => c._draw && c._draw());
}
