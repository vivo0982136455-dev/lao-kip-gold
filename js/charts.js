// Line charts (Chart.js, loaded from CDN in index.html) + their read-outs and data tables.
// Style (finance-app standard): smooth monotone lines, a soft colour wash under the FIRST line,
// latest-value tags on the right axis, a crosshair, and the change over the shown period
// as a green ▲ / red ▼ pill in the card header.
// The values of the touched / hovered point are shown in a READ-OUT above the plot (never in a box on top of
// the lines, which covered the data on a phone). The read-out is also the legend.
// Line colours follow the KIND of number: official = blue, market = orange, estimated = aqua (dashed
// when mixed with other lines), bank = pink, shop = violet. Green/red is used for up/down ONLY.
// Every chart has a "show as table" twin, so no value depends on hover or colour alone.

import { formatNumber, formatAxis, formatDate, formatPct, todayVientiane, addDays, unitText } from "./format.js";
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

const has = (v) => v !== null && v !== undefined;
const isPct = (unit) => String(unit).startsWith("%");
// "4.5%" / "680.95": percent values carry their sign, every other unit is named once (read-out head, table caption)
const valueText = (v, unit) => formatNumber(v, unit) + (isPct(unit) ? "%" : "");
// What the read-out and the table show for a line. `shown` leaves out helper points that are only there to make
// the drawing right (e.g. the last real year repeated on a forecast line so the two lines meet).
const shownOf = (s) => s.shown || s.values;

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
  const list = values.filter(has);
  if (list.length < 2 || !list[0]) return null;
  return ((list[list.length - 1] - list[0]) / list[0]) * 100;
}

// ---------- Draw-in: the first time a chart is shown, its lines appear from left to right ----------
// Only once per chart per page visit: a page redraws itself often (a button, new data) and must not replay it.
const REVEAL_MS = 700;
let seenPage = null;
const seenCharts = new Set();
function firstTime(key) {
  const page = location.hash.split("?")[0];
  if (page !== seenPage) {
    seenPage = page;
    seenCharts.clear();
  }
  if (seenCharts.has(key)) return false;
  seenCharts.add(key);
  return true;
}
const motionOk = () => !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

function playReveal(chart) {
  const start = performance.now();
  const step = (now) => {
    if (!chart.ctx || chart.$reveal >= 1) return; // destroyed, or already finished
    const x = Math.min(1, (now - start) / REVEAL_MS);
    chart.$reveal = 1 - Math.pow(1 - x, 3); // ease-out: quick start, soft landing
    chart.draw();
    if (x < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  // A hidden browser tab pauses animation frames: never leave a chart half drawn
  setTimeout(() => {
    if (chart.ctx && chart.$reveal < 1) {
      chart.$reveal = 1;
      chart.draw();
    }
  }, REVEAL_MS + 500);
}

// ---------- Chart.js plugins ----------
const reveal = {
  id: "reveal",
  beforeInit(chart, _args, opts) {
    if (opts.play) chart.$reveal = 0;
  },
  beforeDatasetsDraw(chart) {
    if (chart.$reveal === undefined || chart.$reveal >= 1) return;
    const { left, right, top, bottom } = chart.chartArea;
    chart.ctx.save();
    chart.ctx.beginPath();
    chart.ctx.rect(left - 8, top - 8, (right - left + 16) * chart.$reveal, bottom - top + 16);
    chart.ctx.clip();
    chart.$clipped = true;
  },
  afterDatasetsDraw(chart) {
    if (!chart.$clipped) return;
    chart.ctx.restore();
    chart.$clipped = false;
  },
};

// Thin vertical line at the touched / hovered point (the "crosshair")
const crosshair = {
  id: "crosshair",
  afterDatasetsDraw(chart) {
    const active = chart.getActiveElements();
    if (!active.length) return;
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

// Tells the read-out which point is touched (null = none -> it shows the latest values again)
const readoutLink = {
  id: "readoutLink",
  afterDraw(chart, _args, opts) {
    const active = chart.getActiveElements();
    const index = active.length ? active[0].index : null;
    if (index === chart.$shownIndex) return;
    chart.$shownIndex = index;
    opts.onActive(index);
  },
};

// Latest-value tag of every line, drawn on the right axis (like trading platforms). Tags never overlap.
// A line that stops well before the right edge (e.g. "actual" before a forecast) gets no tag: its value would
// look like the value at the end of the chart. A few missing points at the end (weekends) are fine.
const lastValueTags = {
  id: "lastValueTags",
  afterDraw(chart, _args, opts) {
    if (chart.$reveal !== undefined && chart.$reveal < 1) return; // the tags arrive when the lines have arrived
    const { ctx, chartArea } = chart;
    const tags = [];
    chart.data.datasets.forEach((ds, i) => {
      const meta = chart.getDatasetMeta(i);
      if (meta.hidden || !chart.isDatasetVisible(i)) return;
      const minK = ds.data.length - 1 - Math.max(2, Math.floor(ds.data.length * 0.1));
      for (let k = ds.data.length - 1; k >= 0; k--) {
        if (has(ds.data[k])) {
          if (k >= minK) tags.push({ y: meta.data[k].y, text: opts.format(ds.data[k]), color: ds.borderColor });
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
    // 3) an axis number that a tag would sit on is taken out (half-covered numbers look broken)
    const axis = chart.scales.y;
    ctx.fillStyle = cssVar("--surface");
    axis.ticks.forEach((_tick, i) => {
      const y = axis.getPixelForTick(i);
      if (tags.some((tag) => Math.abs(tag.y - y) < h / 2 + 7)) ctx.fillRect(chartArea.right + 1, y - 8, chart.width - chartArea.right - 1, 16);
    });
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

// A touch leaves the crosshair on the chart (a phone has no "mouse out"): a tap anywhere else clears it
document.addEventListener("pointerdown", (event) => {
  for (const chart of activeCharts) {
    if (chart.canvas && event.target !== chart.canvas && chart.getActiveElements().length) {
      chart.setActiveElements([]);
      chart.update("none");
    }
  }
});

// A turned phone / resized window changes how the read-out wraps: measure its rows again
let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => activeCharts.forEach((chart) => chart.$relock && chart.$relock()), 200);
});

function drawChart(canvas, { labels, tickLabels, series, unit, t, onActive, animate }) {
  const surface = cssVar("--surface");
  const datasets = series.map((s, i) => {
    // s.color (e.g. "--cat-2") is for charts whose lines are all the SAME kind (inflation categories, savings)
    const color = cssVar(s.color || "--kind-" + s.kind);
    const count = s.values.filter(has).length;
    const firstIndex = s.values.findIndex(has);
    const lastIndex = s.values.reduce((acc, v, k) => (has(v) ? k : acc), -1);
    // A line with only a few real points far apart (prices typed in by hand) shows every point, so nobody reads
    // the stretch between two points as data. A dense line is drawn clean: one dot, at its latest value.
    const sparse = count <= 3 || count / (lastIndex - firstIndex + 1) < 0.5;
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
      borderJoinStyle: "round",
      borderCapStyle: "round",
      // Smooth but honest: "monotone" never invents peaks or dips between real points
      cubicInterpolationMode: "monotone",
      pointRadius: (ctx) => (ctx.dataIndex === lastIndex ? 4 : sparse ? 3 : 0),
      pointHoverRadius: 5,
      pointBorderColor: surface, // 2px ring in the surface colour
      pointBorderWidth: 2,
      spanGaps: true,
    };
  });

  const chart = new Chart(canvas, {
    type: "line",
    data: { labels, datasets },
    plugins: [reveal, crosshair, lastValueTags, readoutLink],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      layout: { padding: { top: 6 } },
      plugins: {
        reveal: { play: animate },
        lastValueTags: { format: (v) => formatAxis(v, unit, t) },
        readoutLink: { onActive },
        filler: { propagate: false },
        legend: { display: false }, // the read-out above the plot is the legend
        tooltip: { enabled: false }, // ... and the tooltip
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: cssVar("--axis") },
          // tickLabels: short axis text (e.g. "ม.ค. 21") while the read-out keeps the full date
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
  if (chart.$reveal === 0) playReveal(chart);
  return chart;
}

// Read-out above the plot: one row per line = colour key, name, value, change since the start of the period.
// It shows the latest value of every line; while a point is touched / hovered it shows that point instead.
// With two or more lines a row is also a button that hides / shows its line (as a legend does).
function buildReadout({ labels, series, unit, t, whenPrefix }) {
  const box = el("div", "readout");
  const head = el("div", "readout-head");
  const when = el("span", "readout-when");
  head.append(when);
  const showSince = !isPct(unit) && unit !== "index"; // a % of a % (or of an index) would only confuse
  if (showSince) head.append(el("span", "readout-note", `▲▼ % = ${t.since_start}`));
  box.append(head);

  const firstIndex = series.map((s) => s.values.findIndex(has));
  const first = series.map((s, i) => (firstIndex[i] >= 0 ? s.values[firstIndex[i]] : null));
  const lastIndex = series.map((s) => shownOf(s).reduce((acc, v, k) => (has(v) ? k : acc), -1));
  const sameEnd = lastIndex.every((k) => k === lastIndex[0]);
  const many = series.length > 1;
  // The widest value any point can show: the value column keeps this width, so the names never re-wrap
  const widest = Math.max(1, ...series.flatMap((s) => shownOf(s).filter(has).map((v) => valueText(v, unit).length)));
  const rows = series.map((s) => {
    const row = el(many ? "button" : "div", "readout-row");
    if (many) {
      row.type = "button";
      row.title = t.readout_toggle;
      row.setAttribute("aria-pressed", "true");
    }
    const key = el("span", "readout-key" + (s.dashed ? " dashed" : ""));
    key.style.borderTopColor = `var(${s.color || "--kind-" + s.kind})`;
    const label = el("span", "readout-label", s.label);
    const at = el("span", "readout-at");
    label.append(at);
    const value = el("span", "readout-value");
    value.style.minWidth = `${widest}ch`;
    const since = el("span", "readout-since");
    row.append(key, label, value);
    if (showSince) row.append(since);
    box.append(row);
    return { row, at, value, since };
  });

  // index = the touched point, or null = the latest value of every line
  const show = (index) => {
    if (index !== null) when.textContent = `${whenPrefix}${labels[index]}`;
    else when.textContent = sameEnd && lastIndex[0] >= 0 ? `${t.readout_latest} · ${whenPrefix}${labels[lastIndex[0]]}` : t.readout_latest;
    series.forEach((s, i) => {
      const k = index === null ? lastIndex[i] : index;
      const v = k >= 0 ? shownOf(s)[k] : null;
      rows[i].value.textContent = has(v) ? valueText(v, unit) : "—";
      // lines that end on different days: say which day each "latest" is
      rows[i].at.textContent = index === null && !sameEnd && has(v) ? ` · ${whenPrefix}${labels[k]}` : "";
      // Change since the first point of the line (the first point itself has nothing to be compared with)
      if (has(v) && first[i] && k > firstIndex[i]) {
        const change = ((v - first[i]) / first[i]) * 100;
        rows[i].since.replaceChildren(pctPill(Math.abs(change) < 0.005 ? 0 : change, { plain: true })); // too small to show = "0.00%", not "+0.00%"
      } else {
        rows[i].since.replaceChildren();
      }
    });
  };
  show(null);
  // Call when the read-out is in the page: every row keeps the height of the "latest" view (its tallest),
  // so the plot below does not move while a finger is on it
  const lock = () => {
    const parts = [head, ...rows.map((r) => r.row)];
    for (const part of parts) part.style.minHeight = "";
    for (const part of parts) part.style.minHeight = `${part.getBoundingClientRect().height}px`;
  };
  return { box, show, rows, lock };
}

// Table twin: newest first, only rows that have a value. Its first header line says what the numbers are and
// in which unit, and stays visible while the table scrolls.
function dataTable({ labels, series, unit, unitLabel, t, firstColTitle, title }) {
  // Many columns of kip in the millions (gold): show millions with 3 decimals (46,259,000 -> 46.259)
  // and say so in the caption, so the table still fits a phone screen
  const all = series.flatMap((s) => shownOf(s).filter(has));
  const million = String(unit).startsWith("LAK") && series.length >= 4 && all.length > 0 && all.every((v) => v >= 1e6);
  const show = (v) => (!has(v) ? "—" : million ? (v / 1e6).toFixed(3) : valueText(v, unit));
  const tbl = el("table", series.length <= 3 ? "few-cols" : ""); // few columns: the date stays on one line, even on a phone
  const thead = tbl.appendChild(el("thead"));
  const capRow = el("tr");
  const cap = el("th", "table-cap");
  cap.colSpan = series.length + 1;
  cap.append(el("strong", "", title), el("span", "", `${t.unit}: ${million ? t.million : ""}${unitLabel}`));
  capRow.append(cap);
  const head = el("tr");
  head.append(el("th", "", firstColTitle));
  for (const s of series) head.append(el("th", "", s.label));
  thead.append(capRow, head);
  const body = tbl.appendChild(el("tbody"));
  for (let i = labels.length - 1; i >= 0; i--) {
    if (series.every((s) => !has(shownOf(s)[i]))) continue;
    const tr = el("tr");
    tr.append(el("td", "", labels[i]));
    // soft = not a measured number (forecast, target, amount still to be paid): shown a little quieter
    for (const s of series) tr.append(el("td", s.soft ? "soft" : "", show(shownOf(s)[i])));
    body.append(tr);
  }
  const wrap = el("div", "table-wrap scroll-y");
  wrap.append(tbl);
  return wrap;
}

// A chart card. options: { title, subtitle, labels, tickLabels, series, unit, unitLabel, t, firstColTitle, periodText }
//   series: [{ label, values, kind, color, dashed, shown, soft }]
//     shown = what the read-out and the table show, when it differs from the drawn values (see shownOf)
//     soft  = forecast / target / not yet paid: quieter numbers in the table
//   unitLabel: the unit in words; left out = from the unit code (format.js unitText)
//   periodText (e.g. "30 วัน"): shows the change of the FIRST line over the period as a ▲/▼ pill.
// Call mountCharts(container) after the card is in the page.
export function chartCard({ title, subtitle, labels, tickLabels, series, unit, unitLabel, t, firstColTitle, extraClass = "", periodText }) {
  const c = card(null, "chart-card " + extraClass);
  const head = el("div", "chart-head");
  head.append(el("h3", "", title));
  const change = series.length && !isPct(unit) ? periodChange(series[0].values) : null;
  if (change !== null && periodText) head.append(pctPill(change, { text: `${formatPct(change)} · ${periodText}` }));
  c.append(head);
  if (subtitle) c.append(el("p", "chart-sub", subtitle));
  const colTitle = firstColTitle || t.col_date;

  const enoughData = series.some((s) => s.values.filter(has).length >= 2);
  const box = el("div", "chart-box");
  if (!enoughData || typeof Chart === "undefined") {
    box.append(el("div", "chart-empty", t.chart_no_data));
    c.append(box);
  } else {
    // "ปี 2025" for yearly charts; dates and months already read well on their own
    const readout = buildReadout({ labels, series, unit, t, whenPrefix: colTitle === t.year ? `${t.year} ` : "" });
    c.append(readout.box, box);
    const canvas = el("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", title);
    box.append(canvas);
    c._draw = () => {
      readout.lock();
      const animate = motionOk() && firstTime(`${title}|${labels.length}|${labels[0]}`);
      const chart = drawChart(canvas, { labels, tickLabels, series, unit, t, onActive: readout.show, animate });
      chart.$relock = readout.lock;
      activeCharts.push(chart);
      if (series.length > 1) {
        readout.rows.forEach(({ row }, i) =>
          row.addEventListener("click", () => {
            if (!chart.ctx) return;
            const visible = !chart.isDatasetVisible(i);
            chart.setDatasetVisibility(i, visible);
            chart.update("none");
            row.setAttribute("aria-pressed", String(visible));
          })
        );
      }
    };
  }
  if (series.length) {
    const details = el("details");
    details.append(el("summary", "", t.show_table), dataTable({ labels, series, unit, unitLabel: unitLabel || unitText(unit, t), t, firstColTitle: colTitle, title }));
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
        let points = fromLong || (daily ? toWeekly(daily) : null);
        // The long file can end earlier (e.g. monthly IMF values): add the newer weeks from the daily summary
        if (fromLong && daily) {
          const lastLong = fromLong[fromLong.length - 1][0];
          points = [...fromLong, ...toWeekly(daily).filter(([w]) => w > lastLong)];
        }
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
