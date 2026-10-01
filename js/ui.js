// Shared building blocks for all pages: cards, value rows, badges, tables.
// Text from data files is always inserted with textContent (never innerHTML).

import { formatNumber, unitLabel, formatChange, formatDate, formatPct, toMs, ARROWS, directionOf } from "./format.js";

// ---------- DOM helper ----------
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

// ---------- Stale check ----------
// How old (in hours) a source's newest data may be before we show "stale data".
// Generous on purpose: BOL and gold markets do not publish on weekends/holidays.
const MAX_AGE_HOURS = { bol: 5 * 24, "gold-world": 3 * 24, "silver-world": 3 * 24, "silver-lao-manual": 4 * 24, "gold-thai": 3 * 24, "fx-market": 2 * 24, "fuel-thai": 4 * 24, "gold-lbb": 4 * 24, bcel: 4 * 24, "bcel-deposit": 4 * 24, "gold-lao-manual": 4 * 24, "rubber-lao-manual": 45 * 24 }; // own rubber price: entered when the owner sells

// Returns "ok" | "stale" | "error" | "not_configured" | "empty" (a manual source that waits for its first entry)
export function sourceStatus(sourceId, summary) {
  const src = summary.sources[sourceId];
  if (!src) return "stale";
  if (src.configured === false) return "not_configured";
  if (src.empty) return "empty";
  if (src.stale) return "error";
  if (!src.latest_source_date) return "stale";
  const ageHours = (Date.now() - toMs(src.latest_source_date)) / 3600000;
  return ageHours > (MAX_AGE_HOURS[sourceId] || 48) ? "stale" : "ok";
}

export function isStale(sourceId, summary) {
  const s = sourceStatus(sourceId, summary);
  return s === "stale" || s === "error";
}

export function staleBadge(t) {
  const badge = el("span", "badge badge-warn", "⚠ " + t.stale_badge);
  badge.title = t.stale_hint;
  return badge;
}

// Status pill used on the Settings page
export function statusBadge(status, t) {
  const map = { ok: ["badge-ok", "✓ " + t.status_ok], stale: ["badge-warn", "⚠ " + t.status_stale], error: ["badge-bad", "✕ " + t.status_error], not_configured: ["badge-muted", "○ " + t.status_not_configured], empty: ["badge-muted", "○ " + t.status_empty] };
  const [cls, text] = map[status] || map.stale;
  return el("span", "badge " + cls, text);
}

// Kind chip: coloured dot + text (official / market / estimated / shop)
export function kindChip(kind, t) {
  const chip = el("span", "chip", t["kind_" + kind]);
  chip.dataset.kind = kind;
  return chip;
}

// ---------- Cards ----------
export function card(kind, extraClass = "") {
  const c = el("article", ("card " + extraClass).trim());
  if (kind) c.dataset.kind = kind;
  return c;
}

export function cardHead(titleText, kind, stale, t) {
  const head = el("div", "card-head");
  head.append(el("h3", "", titleText));
  if (kind) head.append(kindChip(kind, t));
  if (stale) head.append(staleBadge(t));
  return head;
}

// Footer: "updated <time> · source: <links>"
export function cardFoot(metricIds, summary, t) {
  const metrics = metricIds.map((id) => summary.metrics[id]).filter(Boolean);
  const foot = el("div", "card-foot");
  if (!metrics.length) return foot;

  const newest = metrics.map((m) => m.latest.source_date).sort((a, b) => toMs(a) - toMs(b)).pop();
  foot.append(`${t.updated_at} ${formatDate(newest, t)} · ${t.source}: `);
  const sourceIds = [...new Set(metrics.flatMap((m) => m.sources))];
  sourceIds.forEach((id, i) => {
    const src = summary.sources[id];
    if (!src) return;
    if (i > 0) foot.append(", ");
    foot.append(sourceLink(src));
  });
  return foot;
}

export function sourceLink(src) {
  if (!src.source_url) return document.createTextNode(src.source_name);
  const link = el("a", "", src.source_name);
  link.href = src.source_url;
  link.target = "_blank";
  link.rel = "noopener";
  return link;
}

// ---------- Up / down pills (green ▲ / red ▼ / grey ▬ - colour never without the arrow) ----------

// Pill from a percent: "▲ +3.2%". options: { decimals, plain (no background), text (override label) }
export function pctPill(pct, options = {}) {
  const dir = directionOf(pct, options.flatBelow);
  const pill = el("span", `delta ${dir}${options.plain ? " plain" : ""}`);
  const text = options.text !== undefined ? options.text : formatPct(pct, options.decimals === undefined ? 2 : options.decimals);
  pill.textContent = `${ARROWS[dir]} ${text}`;
  return pill;
}

// Pill from latest vs previous value: "▲ +12 (+0.05%)"
export function deltaPill(latest, prev, unit, options = {}) {
  const c = formatChange(latest, prev, unit);
  return pctPill(c.pct, { ...options, text: options.pctOnly ? formatPct(c.pct, options.decimals === undefined ? 2 : options.decimals) : c.text });
}

// One line: label | big value + change vs previous day
export function valueRow(label, metric, t, options = {}) {
  const row = el("div", "row");
  row.append(el("span", "row-label", label));
  const right = el("div", "row-right");
  if (!metric) {
    right.append(el("div", "value", "—"));
    if (options.emptyText) right.append(el("div", "change", options.emptyText));
    row.append(right);
    return row;
  }
  const value = el("div", "value", formatNumber(metric.latest.value, metric.unit));
  value.append(el("span", "unit", unitLabel(metric.unit)));
  right.append(value);
  if (metric.prev) {
    const line = el("div", "change");
    line.append(deltaPill(metric.latest.value, metric.prev.value, metric.unit), el("span", "vs", `${t.change_vs} ${formatDate(metric.prev.day, t)}`));
    right.append(line);
  } else {
    right.append(el("div", "change", t.no_prev));
  }
  row.append(right);
  return row;
}

// A standard number card: { title, kind, rows: [[labelKey, metricId]], note }
export function metricCard(def, summary, t) {
  const metricIds = def.rows.map(([, id]) => id);
  const sourceIds = new Set(metricIds.flatMap((id) => (summary.metrics[id] ? summary.metrics[id].sources : [])));
  const stale = sourceIds.size === 0 || [...sourceIds].some((id) => isStale(id, summary));
  const c = card(def.kind);
  c.append(cardHead(t[def.title], def.kind, stale, t));
  // A row can have options, e.g. ["row_x", "metric.id", { emptyText: "..." }]
  for (const [labelKey, id, opts] of def.rows) c.append(valueRow(t[labelKey], summary.metrics[id], t, opts || {}));
  if (def.note) c.append(el("p", "note", t[def.note]));
  c.append(cardFoot(metricIds, summary, t));
  return c;
}

// Big single figure used for stat tiles: label, value, small line under it
export function statTile(label, valueText, subText, kind) {
  const tile = el("div", "stat");
  if (kind) tile.dataset.kind = kind;
  tile.append(el("div", "stat-label", label), el("div", "stat-value", valueText));
  if (subText) tile.append(el("div", "stat-sub", subText));
  return tile;
}

// Simple table: headers = [text], rows = [[cell text or Node]]
export function table(headers, rows) {
  const tbl = el("table");
  const headRow = el("tr");
  for (const h of headers) headRow.append(el("th", "", h));
  tbl.appendChild(el("thead")).append(headRow);
  const body = tbl.appendChild(el("tbody"));
  for (const r of rows) {
    const tr = el("tr");
    for (const cell of r) {
      const td = el("td");
      if (cell instanceof Node) td.append(cell);
      else td.textContent = cell;
      tr.append(td);
    }
    body.append(tr);
  }
  const wrap = el("div", "table-wrap");
  wrap.append(tbl);
  return wrap;
}

// Placeholder / empty-state box with a title and explanation
export function emptyState(title, text) {
  const box = el("div", "empty");
  box.append(el("strong", "", title));
  if (text) box.append(el("p", "", text));
  return box;
}

// Page section heading
export function sectionTitle(text) {
  return el("h2", "section-title", text);
}

// Range buttons: 7 days / 1 month / 3 months / 1 year / all (0 = all). onChange(days) is called on click.
// 1 year and "all" use data/long.json (weekly points, loaded only when asked for).
export const RANGES = [7, 30, 90, 365, 0];
export function rangeButtons(current, t, onChange) {
  const group = el("div", "segmented");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", t.range_label);
  for (const days of RANGES) {
    const b = el("button", "", t["range_" + days]);
    b.type = "button";
    b.setAttribute("aria-pressed", String(days === current));
    b.addEventListener("click", () => onChange(days));
    group.append(b);
  }
  return group;
}
