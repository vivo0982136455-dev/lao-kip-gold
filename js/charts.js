// Line charts (Chart.js, loaded from CDN in index.html) + their data tables.
// Style (finance-app standard): smooth monotone lines, a soft colour wash under the FIRST line,
// latest-value tags on the right axis, crosshair + tooltip, and the change over the shown period
// as a green ▲ / red ▼ pill in the card header.
// Line colours follow the KIND of number: official = blue, market = orange, estimated = aqua (dashed
// when mixed with other lines), bank = pink, shop = violet. Green/red is used for up/down ONLY.
// Every chart has a "show as table" twin, so no value depends on hover or colour alone.

import { formatNumber, formatAxis, formatDate, formatPct, todayVientiane, addDays } from "./format.js";
import { el, card, pctPill } from "./ui.js";

let activeCharts = []; // destroyed before every page change / redraw

export function destroyCharts() {
  activeCharts.forEach((c) => c.destroy());
  activeCharts = [];
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// "#3987e5" + 0.2 -> "rgba(57,135,229,0.2)"
function withAlpha(hex, alpha) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// Black or white text on a coloured tag, whichever reads better
function inkOn(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#0b0b0b" : "#ffffff";
}

// ---------- Long ranges (1 year / all): weekly points from data/long.json ----------
let longData = null;
export function setLongData(data) {
  longData = data;
}
// 0 = all history; anything above 90 days needs the weekly file
export const needsLong = (rangeDays) => rangeDays === 0 || rangeDays > 90;

// Monday that starts the week of `day` ("2026-09-30" -> "2026-09-28"): the label of a weekly point (never in the future)
export function weekStart(day) {
  const d = new Date(day + "T00:00:00Z");
  return addDays(day, -((d.getUTCDay() + 6) % 7));
}
// Daily [[day, value]] -> weekly [[weekStart, last value of that week]]
function toWeekly(daily) {
  const m = new Map();
  for (const [d, v] of daily || []) m.set(weekStart(d), v); // rows are oldest first, so the last one wins
  return [...m.entries()];
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

// First and last non-null value of a list -> % change (null if fewer than 2 values)
function periodChange(values) {
  const list = values.filter((v) => v !== null && v !== undefined);
  if (list.length < 2 || !list[0]) return null;
  return ((list[list.length - 1] - list[0]) / list[0]) * 100;
}

// ---------- Chart.js plugins ----------
// Thin vertical line at the hovered point (the "crosshair")
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
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.restore();
  },
};

// Latest-value tag of every line, drawn on the right axis (like trading platforms). Tags never overlap.
const lastValueTags = {
  id: "lastValueTags",
  afterDraw(chart, _args, opts) {
    const { ctx, chartArea } = chart;
    const tags = [];
    chart.data.datasets.forEach((ds, i) => {
      const meta = chart.getDatasetMeta(i);
      if (meta.hidden) return;
      for (let k = ds.data.length - 1; k >= 0; k--) {
        if (ds.data[k] !== null && ds.data[k] !== undefined) {
          tags.push({ y: meta.data[k].y, text: opts.format(ds.data[k]), color: ds.borderColor });
          break;
        }
      }
    });
    if (!tags.length) return;
    ctx.save();
    ctx.font = `600 11px ${Chart.defaults.font.family}`;
    const h = 18;
    tags.sort((a, b) => a.y - b.y);
    const gap = h + 2;
    const top = chartArea.top + h / 2;
    const bottom = chartArea.bottom - h / 2;
    // 1) push down so tags do not overlap
    for (let i = 0; i < tags.length; i++) {
      tags[i].y = Math.max(tags[i].y, top);
      if (i > 0) tags[i].y = Math.max(tags[i].y, tags[i - 1].y + gap);
    }
    // 2) if the last ones fell below the plot, push the stack back up (still without overlap)
    for (let i = tags.length - 1; i >= 0; i--) {
      tags[i].y = Math.min(tags[i].y, i === tags.length - 1 ? bottom : tags[i + 1].y - gap);
    }
    for (const tag of tags) {
      const w = ctx.measureText(tag.text).width + 10;
      const x = chartArea.right + 4;
      ctx.fillStyle = tag.color;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, tag.y - h / 2, w, h, 4);
      else ctx.rect(x, tag.y - h / 2, w, h);
      ctx.fill();
      ctx.fillStyle = inkOn(tag.color);
      ctx.textBaseline = "middle";
      ctx.fillText(tag.text, x + 5, tag.y + 0.5);
    }
    ctx.restore();
  },
};

function drawChart(canvas, { labels, tickLabels, series, unit, t }) {
  const surface = cssVar("--surface");
  const datasets = series.map((s, i) => {
    // s.color (e.g. "--cat-2") is for charts whose lines are all the SAME kind (inflation categories, savings)
    const color = cssVar(s.color || "--kind-" + s.kind);
    const count = s.values.filter((v) => v !== null).length;
    const lastIndex = s.values.reduce((acc, v, k) => (v !== null ? k : acc), -1);
    return {
      label: s.label,
      data: s.values,
      borderColor: color,
      pointBackgroundColor: color,
      // Soft wash under the FIRST line only (several washes on top of each other would be unreadable)
      fill: i === 0 ? "start" : false,
      backgroundColor: (ctx) => {
        const area = ctx.chart.chartArea;
        if (i !== 0 || !area) return color;
        const g = ctx.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
        g.addColorStop(0, withAlpha(color, 0.24));
        g.addColorStop(1, withAlpha(color, 0));
        return g;
      },
      borderWidth: 2,
      borderDash: s.dashed ? [6, 4] : [],
      // Smooth but honest: "monotone" never invents peaks or dips between real points
      cubicInterpolationMode: "monotone",
      // Dot at the latest point; all dots only when there are few points
      pointRadius: (ctx) => (ctx.dataIndex === lastIndex ? 4 : count <= 20 ? 3 : 0),
      pointHoverRadius: 5,
      pointBorderColor: surface, // 2px ring in the surface colour
      pointBorderWidth: 2,
      spanGaps: true,
    };
  });
  // First value of each line in view -> tooltip shows "% since start of the period"
  const firstValues = series.map((s) => s.values.find((v) => v !== null && v !== undefined));

  return new Chart(canvas, {
    type: "line",
    data: { labels, datasets },
    plugins: [crosshair, lastValueTags],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      layout: { padding: { top: 6 } },
      plugins: {
        lastValueTags: { format: (v) => formatAxis(v, unit, t) },
        filler: { propagate: false },
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
          footerColor: cssVar("--muted"),
          borderColor: cssVar("--border-strong"),
          borderWidth: 1,
          padding: 10,
          usePointStyle: true,
          callbacks: {
            // value first, then the series name, then the change since the start of the period
            label: (ctx) => {
              const first = firstValues[ctx.datasetIndex];
              const since = first && unit !== "%" ? `  (${formatPct(((ctx.parsed.y - first) / first) * 100)})` : "";
              return ` ${formatNumber(ctx.parsed.y, unit)}  ${ctx.dataset.label}${since}`;
            },
            footer: () => (unit !== "%" ? `(%) = ${t.since_start}` : ""),
            labelPointStyle: () => ({ pointStyle: "line", rotation: 0 }),
            labelColor: (ctx) => ({ borderColor: ctx.dataset.borderColor, backgroundColor: ctx.dataset.borderColor, borderWidth: 2 }),
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: cssVar("--axis") },
          // tickLabels: short axis text (e.g. "ม.ค. 21") while the tooltip keeps the full date
          ticks: { color: cssVar("--muted"), maxTicksLimit: 6, maxRotation: 0, autoSkip: true, autoSkipPadding: 14, callback: (_v, i) => (tickLabels ? tickLabels[i] : labels[i]) },
        },
        y: {
          position: "right", // price scale on the right, like trading platforms
          grid: { color: cssVar("--grid") },
          border: { display: false },
          ticks: { color: cssVar("--muted"), maxTicksLimit: 6, padding: 8, callback: (v) => formatAxis(v, unit, t) },
          afterFit: (scale) => {
            scale.width = Math.max(scale.width, 64); // room for the latest-value tags
          },
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
  const wrap = el("div", "table-wrap scroll-y");
  wrap.append(tbl);
  return wrap;
}

// A chart card. options: { title, subtitle, labels, series:[{label, values, kind, color, dashed}], unit, t, firstColTitle, periodText }
// periodText (e.g. "30 วัน"): shows the change of the FIRST line over the period as a ▲/▼ pill.
// Call mountCharts(container) after the card is in the page.
export function chartCard({ title, subtitle, labels, tickLabels, series, unit, t, firstColTitle, extraClass = "", periodText }) {
  const c = card(null, "chart-card " + extraClass);
  const head = el("div", "chart-head");
  head.append(el("h3", "", title));
  const change = series.length && unit !== "%" ? periodChange(series[0].values) : null;
  if (change !== null && periodText) head.append(pctPill(change, { text: `${formatPct(change)} · ${periodText}` }));
  c.append(head);
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
    c._draw = () => activeCharts.push(drawChart(canvas, { labels, tickLabels, series, unit, t }));
  }
  if (series.length) {
    const details = el("details");
    details.append(el("summary", "", t.show_table), dataTable(labels, series, unit, t, firstColTitle || t.col_date));
    c.append(details);
  }
  return c;
}

// Daily chart card from summary metrics. seriesDefs: [{ metric | daily, longId, label, kind, color, dashed }]
// rangeDays 7 / 30 / 90 = daily points; 365 / 0 (all) = weekly points from data/long.json
// (a series with no long history shows what it has, sampled weekly).
export function dailyChartCard({ title, subtitle, summary, seriesDefs, rangeDays, t, unit }) {
  const long = needsLong(rangeDays) && longData;
  let labels;
  let tickLabels = null;
  let series;
  if (!long) {
    const days = dayRange(needsLong(rangeDays) ? 90 : rangeDays); // long file not loaded yet -> 90 days for now
    labels = days.map((d) => formatDate(d, t));
    series = seriesDefs
      .map((s) => {
        const daily = s.daily || (summary.metrics[s.metric] && summary.metrics[s.metric].daily);
        if (!daily) return null;
        return { label: s.label, kind: s.kind, color: s.color, dashed: s.dashed, values: valuesFor(daily, days) };
      })
      .filter(Boolean);
  } else {
    const weekly = seriesDefs
      .map((s) => {
        const fromLong = longData.metrics[s.longId || s.metric];
        const daily = s.daily || (summary.metrics[s.metric] && summary.metrics[s.metric].daily);
        const points = fromLong || (daily ? toWeekly(daily) : null);
        return points ? { s, points } : null;
      })
      .filter(Boolean);
    const from = rangeDays ? weekStart(addDays(todayVientiane(), -rangeDays)) : "0000";
    const weeks = [...new Set(weekly.flatMap((w) => w.points.map(([d]) => d)))].filter((d) => d >= from).sort();
    labels = weeks.map((d) => formatDate(d, t));
    tickLabels = weeks.map((d) => `${t.months[Number(d.slice(5, 7)) - 1]} ${d.slice(2, 4)}`); // "ม.ค. 21"
    series = weekly.map(({ s, points }) => ({ label: s.label, kind: s.kind, color: s.color, dashed: s.dashed, values: valuesFor(points, weeks) }));
  }
  const firstMetric = seriesDefs.map((s) => s.metric && summary.metrics[s.metric]).find(Boolean);
  return chartCard({
    title,
    subtitle,
    labels,
    tickLabels,
    series,
    unit: unit || (firstMetric ? firstMetric.unit : "LAK"),
    t,
    periodText: t["range_" + rangeDays],
  });
}

// Draw every chart card inside `root` (must already be in the page so Chart.js knows the size)
export function mountCharts(root) {
  if (typeof Chart !== "undefined") Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  root.querySelectorAll(".chart-card").forEach((c) => c._draw && c._draw());
}
