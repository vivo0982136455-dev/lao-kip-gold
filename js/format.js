// Number and date formatting. All times are shown in Vientiane time (UTC+7, no daylight saving).

const VIENTIANE_OFFSET_MS = 7 * 3600000;

// Number of decimals for a unit.
// LAK: no decimals, except small rates under 1,000 (THB, JPY, KRW) where BOL itself uses decimals.
// USD / THB: always 2 decimals.
function decimalsFor(value, unit) {
  if (unit.startsWith("LAK")) return Math.abs(value) >= 1000 ? 0 : 2;
  if (unit.startsWith("%")) return 1;
  if (unit === "USD m" || unit === "USD per person") return 0;
  if (unit === "months") return 1;
  if (unit === "ratio") return 4;
  if (unit === "index") return 1; // start of the period = 100
  return 2;
}

// Signed percent: 3.1 -> "+3.10%", -0.5 -> "−0.50%"
export function formatPct(pct, decimals = 2) {
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sign}${Math.abs(pct).toFixed(decimals)}%`;
}

export function formatNumber(value, unit) {
  const d = decimalsFor(value, unit);
  return value.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

// Short unit shown next to a big number
export function unitLabel(unit) {
  if (unit.startsWith("%")) return "%";
  if (unit === "USD bn" || unit === "USD m") return unit;
  return unit.split(" ")[0]; // "LAK per USD" -> "LAK"
}

// Compact axis label: 43,750,027 -> "43.75 ล้าน"
export function formatAxis(value, unit, t) {
  if (Math.abs(value) >= 1e6) return (value / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 }) + " " + t.million;
  if (unit === "index") return value.toLocaleString("en-US", { maximumFractionDigits: 1 }); // 200, 134.8
  return formatNumber(value, unit);
}

// Change vs previous day: { arrow, text, pct, dir } e.g. { arrow: "▲", text: "+12 (+0.05%)", dir: "up" }
export function formatChange(latest, prev, unit) {
  const diff = latest - prev;
  const pct = prev ? (diff / prev) * 100 : 0;
  // Treat tiny changes (rounding noise) as "no change"
  const same = Math.abs(pct) < 0.005;
  const dir = same ? "flat" : diff > 0 ? "up" : "down";
  const arrow = ARROWS[dir];
  const sign = diff > 0 ? "+" : diff < 0 ? "−" : "";
  const diffText = sign + formatNumber(Math.abs(diff), unit);
  const pctText = sign + Math.abs(pct).toFixed(2) + "%";
  return { arrow, text: same ? "0.00%" : `${diffText} (${pctText})`, pct, dir };
}

export const ARROWS = { up: "▲", down: "▼", flat: "▬" };

// Direction of a percent change: below `flatBelow` (in %) counts as flat
export function directionOf(pct, flatBelow = 0.005) {
  if (pct === null || pct === undefined || Number.isNaN(pct) || Math.abs(pct) < flatBelow) return "flat";
  return pct > 0 ? "up" : "down";
}

// "2026-09-28" or an ISO time -> Date object in UTC milliseconds.
// A plain day means the start of that day in Vientiane.
export function toMs(dayOrIso) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dayOrIso)) return Date.parse(dayOrIso + "T00:00:00+07:00");
  return Date.parse(dayOrIso);
}

// Today's date in Vientiane, as "YYYY-MM-DD"
export function todayVientiane() {
  return new Date(Date.now() + VIENTIANE_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(day, n) {
  return new Date(Date.parse(day + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
}

// "2026-09-28" -> "28 ก.ย."  ;  ISO time -> "29 ก.ย. 17:07"
// The year is added only if it is not the current year.
export function formatDate(dayOrIso, t) {
  const hasTime = !/^\d{4}-\d{2}-\d{2}$/.test(dayOrIso);
  // Shift to Vientiane time, then read the parts with getUTC*()
  const local = new Date(toMs(dayOrIso) + VIENTIANE_OFFSET_MS);
  const y = local.getUTCFullYear();
  const text = `${local.getUTCDate()} ${t.months[local.getUTCMonth()]}`;
  const yearText = String(y) === todayVientiane().slice(0, 4) ? "" : ` ${y}`;
  if (!hasTime) return text + yearText;
  const hh = String(local.getUTCHours()).padStart(2, "0");
  const mm = String(local.getUTCMinutes()).padStart(2, "0");
  return `${text}${yearText} ${hh}:${mm}`;
}
