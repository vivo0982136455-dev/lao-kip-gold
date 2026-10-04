// Settings page: EVERY source of the site in one list (audit 2026-10-02, P2-8: "about 20 economy sources are
// missing from Settings, health is invisible").
//   - the daily sources (rates, gold, fuel in Thailand ...) keep their own list above (data/summary.json)
//   - here: every other data file with the sources it names - which edition, when the source itself last changed
//     its data, when the site last read it, and whether the last reading worked
//   - and the reports, laws and notices that were read by hand (data/invest-static.json): when each was published
//     and when the facts were last compared with it
// Nothing is typed in here: the list is read from the "sources" block of each data file, so a source that a fetcher
// adds appears by itself.

import { el, card, sourceLink, statusBadge } from "../ui.js";
import { formatDate } from "../format.js";
import { lazyJson } from "../lazy.js";
import { fill, monthText } from "./eco-common.js";

// [data file, text key of what the file is for] - in the order of the pages that use them
export const SOURCE_FILES = [
  ["economy.json", "srcf_economy"],
  ["invest.json", "srcf_invest"],
  ["compare.json", "srcf_compare"],
  ["population.json", "srcf_population"],
  ["bol-policy.json", "srcf_bol_policy"],
  ["wages.json", "srcf_wages"],
  ["prices.json", "srcf_prices"],
  ["thai-prices.json", "srcf_thai_prices"],
  ["fuel-lao.json", "srcf_fuel"],
  ["rubber-daily.json", "srcf_rubber_daily"],
  ["rubber-borders.json", "srcf_rubber_borders"],
  ["rubber-world.json", "srcf_rubber_world"],
  ["land.json", "srcf_land"],
  ["report-watch.json", "srcf_report_watch"],
];
const HAND_FILE = "invest-static.json";

// One data file -> its sources, each with the state of the parts that name it:
//   [{ id, src, retrieved: "2026-10-04" | null, parts, failed, error: first message | null }]
// A part = any object of the file that carries "stale" (true = its last download failed and the old numbers are
// shown). A part names its source with "source"; in a file whose parts name none (one source for the whole file),
// every part counts for every source. retrieved = the day the source was last read: its own stamp, else the day the
// file as a whole was last checked ("checked_at").
export function sourcesOf(data) {
  if (!data || typeof data !== "object") return [];
  const sources = data.sources && typeof data.sources === "object" ? data.sources : data.source && typeof data.source === "object" ? { main: data.source } : {};
  const parts = [];
  const visit = (node, depth) => {
    if (!node || typeof node !== "object" || Array.isArray(node) || depth > 3) return;
    if (typeof node.stale === "boolean") parts.push({ source: typeof node.source === "string" ? node.source : null, stale: node.stale, error: (node.last_error && node.last_error.message) || null });
    for (const [key, value] of Object.entries(node)) if (key !== "sources" && key !== "source") visit(value, depth + 1);
  };
  visit(data, 0);
  const named = parts.some((p) => p.source && sources[p.source]);
  const checked = typeof data.checked_at === "string" ? data.checked_at.slice(0, 10) : null;
  return Object.entries(sources).map(([id, src]) => {
    const mine = named ? parts.filter((p) => p.source === id) : parts;
    const bad = mine.filter((p) => p.stale);
    return { id, src, retrieved: src.retrieved || checked, parts: mine.length, failed: bad.length, error: bad.length ? bad.find((p) => p.error)?.error || null : null };
  });
}

// "ฉบับ เม.ย. 2026 · แหล่งปรับปรุง 15 เม.ย. · ดึงข้อมูล 4 ต.ค."
function metaLine(t, row) {
  const { src } = row;
  const parts = [];
  if (src.edition) parts.push(fill(t.src_edition, { date: /^\d{4}-\d{2}$/.test(src.edition) ? monthText(src.edition, t) : src.edition }));
  if (src.updated) parts.push(fill(t.src_updated, { date: formatDate(src.updated, t) }));
  if (row.retrieved) parts.push(fill(t.src_retrieved, { date: formatDate(row.retrieved, t) }));
  return parts.join(" · ");
}

function sourceItem(t, row) {
  const li = el("li", "src-item");
  const name = el("div", "src-name");
  name.append(sourceLink(row.src));
  li.append(name);
  const meta = metaLine(t, row);
  if (meta) li.append(el("div", "src-meta", meta));
  if (row.src.license) li.append(el("div", "src-meta", `${t.src_licence}: ${row.src.license}`));
  if (row.failed) li.append(el("div", "error-text", `${fill(t.src_part_failed, { failed: row.failed, parts: row.parts })}${row.error ? " — " + row.error : ""}`));
  return li;
}

// One group that opens on a tap: what the data is for, how many sources, and the state - visible without opening
function group(t, title, count, badge, body) {
  const d = el("details", "src-group");
  const s = el("summary");
  const text = el("span", "src-group-title", title);
  text.append(el("span", "src-group-count", fill(t.src_group_count, { n: count })));
  s.append(text, badge);
  d.append(s, body);
  return d;
}

// "2026-02-26" / "2025-12" / "2022" -> words
const publishedText = (t, p) => (/^\d{4}$/.test(p) ? p : /^\d{4}-\d{2}$/.test(p) ? monthText(p, t) : formatDate(p, t));

// Every "checked" day of the hand-read facts -> [oldest, newest] (null when the file names none)
export function checkedDays(data) {
  const days = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.checked === "string" && /^\d{4}-\d{2}-\d{2}$/.test(node.checked)) days.push(node.checked);
    for (const value of Object.values(node)) visit(value);
  };
  visit(data);
  days.sort();
  return days.length ? [days[0], days[days.length - 1]] : null;
}
function checkedRange(t, data) {
  const range = checkedDays(data);
  if (!range) return "—";
  return range[0] === range[1] ? formatDate(range[0], t) : `${formatDate(range[0], t)} – ${formatDate(range[1], t)}`;
}

// The card for the Settings page. Loads the files on the first visit (they are small and stay in memory).
let waiting = false;
export function allSourcesCard(ctx) {
  const { t } = ctx;
  // several files arrive within a moment of each other: redraw once for all of them
  const soon = () => {
    if (waiting) return;
    waiting = true;
    setTimeout(() => {
      waiting = false;
      ctx.rerender();
    }, 150);
  };
  const files = [...SOURCE_FILES.map(([f]) => f), HAND_FILE].map((f) => [f, f === "economy.json" && ctx.economy ? { state: "ok", data: ctx.economy } : lazyJson("data/" + f, soon)]);
  const c = card(null, "sources-card");
  if (files.some(([, f]) => f.state === "loading")) {
    c.append(el("p", "muted", t.loading));
    return c;
  }
  const byFile = new Map(files);
  const groups = SOURCE_FILES.map(([file, key]) => ({ key, file: byFile.get(file), rows: byFile.get(file).state === "ok" ? sourcesOf(byFile.get(file).data) : [] }));
  const auto = groups.reduce((n, g) => n + g.rows.length, 0);
  const bad = groups.reduce((n, g) => n + g.rows.filter((r) => r.failed).length, 0) + groups.filter((g) => g.file.state !== "ok").length;
  const hand = byFile.get(HAND_FILE);
  const handSources = hand.state === "ok" ? Object.values(hand.data.sources || {}) : [];
  // when the hand-read facts were last compared with their sources: every "checked" day in the file, oldest to
  // newest (a single day would claim that everything was re-read on the newest one)
  const checked = hand.state === "ok" ? checkedRange(t, hand.data) : "—";

  c.append(el("p", "src-summary", fill(t.src_all_summary, { auto, files: groups.length, bad, hand: handSources.length, checked })));
  for (const g of groups) {
    const list = el("ul", "src-list");
    for (const row of g.rows) list.append(sourceItem(t, row));
    const failed = g.file.state !== "ok" || g.rows.some((r) => r.failed);
    if (g.file.state !== "ok") list.append(el("li", "error-text", t.src_load_failed));
    c.append(group(t, t[g.key], g.rows.length, statusBadge(failed ? "error" : "ok", t), list));
  }
  // read by hand: published + checked, no "download" state
  const list = el("ul", "src-list");
  for (const src of handSources) {
    const li = el("li", "src-item");
    const name = el("div", "src-name");
    name.append(sourceLink(src));
    li.append(name, el("div", "src-meta", src.published ? fill(t.src_published, { date: publishedText(t, src.published) }) : t.src_no_date));
    list.append(li);
  }
  if (hand.state !== "ok") list.append(el("li", "error-text", t.src_load_failed));
  const badge = el("span", "badge badge-muted", fill(t.src_checked, { date: checked }));
  c.append(group(t, t.srcf_hand, handSources.length, badge, list));
  c.append(el("p", "note", t.src_all_note));
  return c;
}
