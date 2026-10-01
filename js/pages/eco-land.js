// Economy tab 8: land. Every province is shown, Vientiane Capital and Luang Prabang first (the owner's focus).
//   - official ASSESSED prices (base for land tax and fees - not market prices):
//       Vientiane Capital: Decision 142 of 26 Feb 2024, summarised per district and road class (data/invest-static.json)
//       other provinces: which one has a decision, its date and the link (data/land.json, Lao Official Gazette);
//       the decisions are scans in Lao, so the prices inside cannot be read by a script
//   - prices the owner sees or is offered: entry form + list (own-entry.js -> the owner's Google Form)
//   - real sale prices: no open data exists (re-checked 2026-10-01); listing sites show asking prices only
// A decision older than the legal re-valuation period (3 years) is marked.

import { el, card, cardHead, table } from "../ui.js";
import { formatDate } from "../format.js";
import { lazyJson } from "../lazy.js";
import { freshness, sourcesFoot, ready, fill, staticSource, choice, whole, PROVINCES, FOCUS_PROVINCES } from "./eco-common.js";
import { landEntryCard, landEntriesCard, landByProvince } from "./own-entry.js";

// always with the year: the rows span many years
const dayText = (day, t) => `${Number(day.slice(8, 10))} ${t.months[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;
const link = (text, href) => {
  const a = el("a", "", text);
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener";
  return a;
};

// Newest official decision of every province: Map(province -> { decided, href, note })
function decisions(e, data) {
  const map = new Map();
  if (data) for (const [name, p] of Object.entries(data.provinces)) if (p.decisions[0]) map.set(name, { decided: p.decisions[0].decided, href: p.decisions[0].pdf || p.decisions[0].url, note: null });
  // decisions that are not in the Gazette list (Vientiane Capital): from the hand-checked file
  for (const x of e.stat.land.official_extra || []) if (!map.has(x.province)) map.set(x.province, { decided: x.decided, href: x.pdf, note: e.t[x.note] });
  return map;
}

function tooOld(day, years) {
  const limit = new Date();
  limit.setFullYear(limit.getFullYear() - years);
  return new Date(day + "T00:00:00Z") < limit;
}

// "12 ก.พ. 2026" (+ "older than 3 years") for a decision
function decisionText(e, d) {
  const { t } = e;
  const span = el("span", "", dayText(d.decided, t));
  const years = e.stat.land.revaluation_years;
  if (tooOld(d.decided, years)) span.append(" ", el("span", "fresh-old", fill(t.inv_land_older, { years })));
  return span;
}

// One line "label: value" inside a focus card
function infoRow(label, value) {
  const row = el("div", "row");
  row.append(el("span", "row-label", label));
  const right = el("div", "row-right");
  if (value instanceof Node) right.append(value);
  else right.append(el("span", "", value));
  row.append(right);
  return row;
}

// The owner's own entries for one province, as a short list (newest first)
function ownLines(e, own, province) {
  const { t } = e;
  const list = ((own && own.land && own.land.entries) || []).filter((x) => x.province === province);
  if (!list.length) return el("p", "note", t.land_own_none);
  const ul = el("ul", "watch-list");
  for (const x of list.slice(0, 5)) {
    ul.append(el("li", "", `${formatDate(x.date, t)} · ${x.place || "—"} · ${whole(x.area)} ${t.own_unit_sqm} · ${whole(x.per_sqm)} ${t.land_kip_sqm}`));
  }
  return ul;
}

function listingLinks(e, province) {
  const list = (e.stat.land.listings || []).filter((s) => !s.province || s.province === province);
  const ul = el("ul", "watch-list");
  for (const src of list) {
    const li = el("li");
    li.append(link(src.source_name, src.source_url));
    ul.append(li);
  }
  return ul;
}

// ---------- Focus 1: Vientiane Capital - the official table, per district and road class ----------
function vientianeCard(e, own) {
  const { t } = e;
  const v = e.stat.land.vientiane;
  const c = card("official");
  c.append(cardHead(t.provinces["Vientiane Capital"], "official", false, t));
  if (!v) return c;
  c.append(el("p", "note", fill(t.land_vte_intro, { date: dayText(v.decided, t), villages: v.districts.reduce((n, d) => n + d.villages, 0) })));
  const road = choice(e, "land_road", v.classes.map((id) => [id, t["land_road_" + id]]), "main");
  road.bar.setAttribute("aria-label", t.land_road_label);
  c.append(road.bar);
  // thousand kip per square metre: 6,800 = 6.8 million kip
  const k = (n) => (n / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 });
  const rows = v.districts.map((d) => {
    const x = d[road.current];
    const name = el("span", "", t.vte_districts[d.key] || d.key);
    const sub = el("span", "sub-line", fill(t.land_villages, { n: d.villages }));
    // where this district starts in the source document: the way to one village's own price
    if (d.page) sub.append(" · ", link(fill(t.land_vte_page, { n: d.page }), `${v.pdf}#page=${d.page}`));
    name.append(sub);
    return [name, x ? k(x[0]) : "—", x ? k(x[1]) : "—", x ? k(x[2]) : "—"];
  });
  const tb = table([t.land_col_district, t.land_col_low, t.land_col_mid, t.land_col_high], rows);
  tb.classList.add("wrap-first");
  c.append(el("p", "note", t.land_vte_unit), tb);
  c.append(el("p", "note", t.land_vte_note));
  if (v.districts.some((d) => d.page)) c.append(el("p", "note", t.land_vte_find));
  c.append(infoRow(t.land_full_table, link(t.inv_land_thai_translation + " (PDF)", v.pdf)));
  c.append(el("h4", "up-subtitle", t.land_own_title), ownLines(e, own, "Vientiane Capital"));
  c.append(el("h4", "up-subtitle", t.land_asking_title), listingLinks(e, "Vientiane Capital"));
  const fresh = el("div", "card-foot");
  fresh.append(freshness(t, { date: v.decided, checked: e.stat.checked }));
  c.append(fresh, sourcesFoot(t, [staticSource(e, v.source), staticSource(e, e.stat.land.revaluation_source)]));
  return c;
}

// ---------- Focus 2: Luang Prabang - no official table is online; show what exists ----------
function luangPrabangCard(e, own, decided) {
  const { t } = e;
  const c = card("official");
  c.append(cardHead(t.provinces.Louangphabang, "official", false, t));
  const d = decided.get("Louangphabang");
  if (d) c.append(infoRow(t.land_official_doc, decisionText(e, d)), infoRow(t.inv_land_col_doc, link(t.inv_land_open_doc, d.href)));
  else c.append(el("p", "note", t.land_lpb_none));
  const ul = el("ul", "watch-list");
  for (const key of ["land_lpb_1", "land_lpb_2"]) ul.append(el("li", "", t[key]));
  c.append(ul);
  c.append(el("h4", "up-subtitle", t.land_own_title), ownLines(e, own, "Louangphabang"));
  c.append(el("h4", "up-subtitle", t.land_asking_title), listingLinks(e, "Louangphabang"));
  const fresh = el("div", "card-foot");
  fresh.append(freshness(t, { checked: e.stat.checked }));
  c.append(fresh);
  return c;
}

// ---------- Every province: official decision + the owner's own prices ----------
function allProvincesCard(e, file, own, decided) {
  const { t } = e;
  const data = file.state === "ok" ? file.data : null;
  const c = card("official");
  c.append(cardHead(t.inv_land_official_title, "official", !!(data && data.stale), t));
  const ul = el("ul", "watch-list");
  for (const key of ["inv_land_official_1", "inv_land_official_2", "inv_land_official_3"]) ul.append(el("li", "", fill(t[key], { years: e.stat.land.revaluation_years })));
  c.append(ul);
  if (!data) c.append(el("p", "muted", file.state === "error" ? t.inv_load_error : t.loading));

  const mine = landByProvince(own);
  c.append(el("p", "note", fill(t.inv_land_official_count, { have: PROVINCES.filter((p) => decided.has(p)).length, total: PROVINCES.length })));
  const rows = PROVINCES.map((name) => {
    const label = el("span", FOCUS_PROVINCES.includes(name) ? "focus-name" : "", t.provinces[name] || name);
    const d = decided.get(name);
    const when = d ? decisionText(e, d) : el("span", "muted", t.inv_land_none);
    if (d && d.note) when.append(el("span", "sub-line", d.note));
    const m = mine.get(name);
    if (m) when.append(el("span", "sub-line", fill(t.land_own_line, { n: m.n, price: whole(m.latest.per_sqm), date: formatDate(m.latest.date, t) })));
    return [label, when, d ? link(t.inv_land_open_doc, d.href) : "—"];
  });
  const tb = table([t.inv_land_col_province, t.inv_land_col_decided, t.inv_land_col_doc], rows);
  tb.classList.add("wrap-first", "land-table");
  c.append(tb);
  const fresh = el("div", "card-foot");
  if (data) fresh.append(freshness(t, { checked: data.checked_at.slice(0, 10), stale: data.stale }));
  c.append(fresh, sourcesFoot(t, [data && data.source, staticSource(e, "thaipublica_land"), staticSource(e, e.stat.land.revaluation_source)].filter(Boolean)));
  return c;
}

export function landTab(panel, e) {
  const { t } = e;
  panel.append(el("p", "muted tab-intro", t.inv_land_intro));
  if (!ready(panel, e, ["stat"])) return;
  const file = lazyJson("data/land.json", e.rerender);
  const ownFile = lazyJson("data/own-prices.json", e.rerender);
  const own = ownFile.state === "ok" ? ownFile.data : null;
  const decided = decisions(e, file.state === "ok" ? file.data : null);

  // The two provinces the owner follows most
  panel.append(el("h2", "section-title", t.land_focus_title));
  const focus = el("div", "grid grid-2");
  focus.append(vientianeCard(e, own), luangPrabangCard(e, own, decided));
  panel.append(focus);

  // Every province
  panel.append(el("h2", "section-title", t.land_all_title));
  panel.append(allProvincesCard(e, file, own, decided));

  // The owner's own prices
  panel.append(el("h2", "section-title", t.land_mine_title));
  panel.append(landEntryCard(e), landEntriesCard(e, own, null));

  // Real sale prices: there is no open data
  const c = card("estimated");
  c.append(cardHead(t.inv_land_title, null, false, t));
  const ul = el("ul", "watch-list");
  for (const key of ["inv_land_1", "inv_land_2", "inv_land_3"]) ul.append(el("li", "", t[key]));
  c.append(ul);
  c.append(el("p", "note", t.inv_land_listings));
  const links = el("ul", "watch-list");
  for (const src of e.stat.land.listings) {
    const li = el("li");
    li.append(link(src.source_name, src.source_url));
    links.append(li);
  }
  c.append(links);
  const fresh = el("div", "card-foot");
  fresh.append(freshness(t, { checked: e.stat.checked }));
  c.append(fresh);
  panel.append(c);

  // Numbers on this site that move land values
  const w = card("official");
  w.append(cardHead(t.inv_land_watch_title, null, false, t));
  const wl = el("ul", "watch-list");
  for (const key of ["inv_land_watch_1", "inv_land_watch_2", "inv_land_watch_3", "inv_land_watch_4"]) wl.append(el("li", "", t[key]));
  w.append(wl);
  const row = el("div", "watch-links");
  for (const [to, label] of [["gdp", "inv_tab_gdp"], ["inflation", "inv_tab_inflation"], ["fdi", "inv_tab_fdi"], ["debt", "inv_tab_debt"]]) {
    const b = el("button", "btn", t[label]);
    b.type = "button";
    b.addEventListener("click", () => e.go(to));
    row.append(b);
  }
  const a = el("a", "btn", t.page_living);
  a.href = "#/living";
  row.append(a);
  w.append(row);
  panel.append(w);
}
