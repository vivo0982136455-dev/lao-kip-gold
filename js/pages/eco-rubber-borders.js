// Rubber tab: where Lao rubber is sold and at what price, the Thai markets next to Laos, and the newest price in
// every ASEAN country + China + the world.
//   data/rubber-borders.json (weekly, scripts/fetch-rubber-borders.js): buyers of Lao rubber per year (UN Comtrade),
//       what Laos itself declared, the kinds of rubber bought, Viet Nam Customs by month, Philippine farm-gate prices
//   data/rubber-daily.json (every run, scripts/fetch-rubber-daily.js): Thai central markets Nong Khai / Chiang Rai,
//       Malaysia (LGM), China (Shanghai futures), market exchange rates
// Facts the page must say plainly: Lao rubber goes to China and Viet Nam; Thailand buys almost none, so the Thai
// border markets are REFERENCE prices. A price at a border, on a futures market or at a farm gate are different
// things - every row says which one it is.

import { el, card, cardHead, pctPill, table } from "../ui.js";
import { chartCard } from "../charts.js";
import { formatNumber, formatDate, formatPct } from "../format.js";
import { lastOf, pct, freshness, sourcesFoot, invTile, fill, monthText, monthShort, choice, countryName, whole } from "./eco-common.js";

const ASEAN = ["THA", "MYS", "VNM", "IDN", "KHM", "MMR", "PHL", "SGP", "BRN"];
// Lao provinces whose nearest Thai central market is Chiang Rai (north-west); the others look at Nong Khai
const NEAR_CHIANGRAI = ["Bokeo", "Louangnamtha", "Oudomxai", "Phongsaly", "Xaignabouly", "Louangphabang"];
// kind of rubber in the owner's own entries -> kind in the Thai market report
const RAOT_KIND = { cuplump: "cuplump", latex: "latex", sheet: "uss", rss: "rss3" };
const KINDS = ["cuplump", "uss", "rss3", "latex"];

const kt = (tonnes) => {
  if (tonnes === null || tonnes === undefined) return "—";
  const v = tonnes / 1000;
  if (v >= 100) return Math.round(v).toLocaleString("en-US");
  if (v < 0.005) return "<0.01";
  return v.toLocaleString("en-US", { maximumFractionDigits: v >= 1 ? 1 : 2 });
};
// USD per kg from tonnes + USD (under 10 tonnes a "price" means nothing)
const priceOf = (tonnes, usd) => (tonnes >= 10 && usd > 0 ? usd / tonnes / 1000 : null);
const usd2 = (v) => (v === null || v === undefined ? "—" : v.toFixed(2));
const lakRate = (r) => {
  const m = r.summary.metrics["fx-market.USD_LAK"];
  return m ? m.latest.value : null;
};
const lakLine = (r, usdPerKg) => {
  const rate = lakRate(r);
  return rate && usdPerKg ? `≈ ${formatNumber(usdPerKg * rate, "LAK")} ${r.t.inv_rub_lak_kg}` : "";
};

// ---------- numbers shared by the cards ----------
// One buyer's imports from Laos in one year, as that buyer's customs recorded them: { tonnes, usd, price } | null
function boughtBy(borders, iso, year) {
  const y = borders.buyers && borders.buyers.years && borders.buyers.years[year];
  const row = y && y.rows.find((x) => x[0] === iso);
  return row ? { tonnes: row[1], usd: row[2] * 1000, price: priceOf(row[1], row[2] * 1000) } : null;
}
// Viet Nam Customs: [[month, tonnes, usd] ...] of rubber imported from Laos (months with a number), and the year totals
function vnImports(borders) {
  const rows = (borders.vietnam && borders.vietnam.imports_lao) || {};
  const months = Object.entries(rows).filter(([, v]) => v.month).map(([m, v]) => [m, v.month[0], v.month[1]]);
  const years = new Map(); // year -> { tonnes, usd, upTo: "2026-08" } from the newest file of that year
  for (const [m, v] of Object.entries(rows)) {
    if (!v.ytd) continue; // a month whose file could not be read
    const y = Number(m.slice(0, 4));
    if (!years.has(y) || years.get(y).upTo < m) years.set(y, { tonnes: v.ytd[0], usd: v.ytd[1], upTo: m });
  }
  return { months, years };
}
function vnExports(borders) {
  const rows = (borders.vietnam && borders.vietnam.exports) || {};
  return Object.entries(rows).filter(([, v]) => v.month).map(([m, v]) => [m, v.month[0], v.month[1]]);
}

// What the two big buyers recorded as bought from Laos, next to what the FAO gives as Laos' production, for the
// newest year that has all three numbers (Viet Nam: Comtrade, else a FULL year of its own customs).
// More was "sold" than "produced" in most years (audit 2026-10-02, P2-10) - the two are weighed differently, and
// the page must say so instead of leaving the two numbers side by side:
//   customs record the weight of the goods as shipped; nearly all of what China buys from Laos is recorded as
//   "other forms" (HS 400129: raw cup lump, unsmoked sheet), which still holds water
//   the FAO counts production as dried rubber, and its number for Laos is not an official Lao figure
// -> { year, production, official, bought, raw: { share (%), year } | null } | null   (tonnes)
export function soldAgainstProduced(borders, world) {
  const hist = world && world.production && world.production.history && world.production.history.LAO;
  if (!borders || !hist || !hist.length) return null;
  const vn = vnImports(borders);
  const vietnam = (y) => boughtBy(borders, "VNM", y) || (vn.years.has(y) && vn.years.get(y).upTo.endsWith("-12") ? vn.years.get(y) : null);
  const hit = [...hist].reverse().find(([y]) => boughtBy(borders, "CHN", y) && vietnam(y));
  if (!hit) return null;
  const [year, production] = hit;
  const row = (world.production.rows || []).find((x) => x[0] === "LAO");
  const forms = borders.forms && borders.forms.buyers && borders.forms.buyers.CHN;
  const rawYear = forms ? Object.keys(forms).sort().pop() : null;
  const kinds = rawYear ? Object.values(forms[rawYear]) : [];
  const all = kinds.reduce((sum, v) => sum + v[0], 0);
  return {
    year,
    production,
    official: !!row && row[3] === "A", // the FAO's flag: A = an official figure of the country
    bought: boughtBy(borders, "CHN", year).tonnes + vietnam(year).tonnes,
    raw: all && forms[rawYear]["400129"] ? { share: (forms[rawYear]["400129"][0] / all) * 100, year: Number(rawYear) } : null,
  };
}

// ---------- View "who buys": tiles ----------
function buyerTiles(r) {
  const { t } = r;
  const b = r.borders;
  const stats = el("div", "stats");
  const years = Object.keys((b.buyers && b.buyers.years) || {}).map(Number).sort((x, y) => x - y);
  const lastYear = years.filter((y) => boughtBy(b, "CHN", y)).pop();
  const vn = vnImports(b);
  if (lastYear) {
    const c = boughtBy(b, "CHN", lastYear);
    const before = boughtBy(b, "CHN", lastYear - 1);
    const tile = invTile(t, t.rb_k_china, { num: kt(c.tonnes), unit: t.rb_unit_kt }, `${usd2(c.price)} ${t.inv_rub_usd_kg} · ${t.rb_at_buyer_border}`, freshness(t, { year: lastYear, stale: b.buyers.stale }), "official");
    if (before && before.tonnes) {
      const change = pct(before.tonnes, c.tonnes); // tonnes against the year before - said in words on the pill
      tile.querySelector(".stat-sub").append(" ", pctPill(change, { text: fill(t.rb_pill_vs_year, { pct: formatPct(change, 0), year: lastYear - 1 }) }));
    }
    stats.append(tile);
  }
  // Viet Nam: the newest full year of its customs, else Comtrade
  const fullYears = [...vn.years].filter(([, v]) => v.upTo.endsWith("-12")).map(([y]) => y).sort((x, y) => x - y);
  const vnYear = fullYears.pop();
  if (vnYear) {
    const v = vn.years.get(vnYear);
    stats.append(invTile(t, t.rb_k_vietnam, { num: kt(v.tonnes), unit: t.rb_unit_kt }, `${usd2(priceOf(v.tonnes, v.usd))} ${t.inv_rub_usd_kg} · ${t.rb_at_buyer_border}`, freshness(t, { year: vnYear, stale: b.vietnam.stale }), "official"));
  }
  // newest month at the Vietnamese border
  const lastMonth = lastOf(vn.months);
  if (lastMonth) {
    const price = priceOf(lastMonth[1], lastMonth[2]);
    const tile = invTile(t, t.rb_k_vn_month, { num: usd2(price), unit: t.inv_rub_usd_kg }, lakLine(r, price), freshness(t, { month: lastMonth[0], stale: b.vietnam.stale }), "official");
    const yearAgo = vn.months.find(([m]) => m === `${Number(lastMonth[0].slice(0, 4)) - 1}${lastMonth[0].slice(4)}`);
    if (yearAgo && priceOf(yearAgo[1], yearAgo[2])) {
      const change = pct(priceOf(yearAgo[1], yearAgo[2]), price); // price against the same month a year earlier
      tile.querySelector(".stat-sub").append(" ", pctPill(change, { text: fill(t.rb_pill_vs_month, { pct: formatPct(change, 1), month: monthText(yearAgo[0], t) }) }));
    }
    stats.append(tile);
  }
  // Thailand: the newest year in which Thai customs recorded any rubber from Laos
  const thaiYear = years.filter((y) => boughtBy(b, "THA", y)).pop();
  const latest = years[years.length - 1];
  if (latest) {
    const th = thaiYear ? boughtBy(b, "THA", thaiYear) : null;
    stats.append(invTile(t, t.rb_k_thailand, thaiYear === latest && th ? { num: kt(th.tonnes), unit: t.rb_unit_kt } : t.rb_thailand_none, thaiYear ? fill(t.rb_thailand_last, { year: thaiYear, kt: kt(th.tonnes) }) : t.rb_thailand_never, freshness(t, { year: latest, stale: b.buyers.stale }), "official"));
  }
  return stats;
}

// ---------- View "who buys": the table year by year ----------
function whoBuysCard(r) {
  const { t } = r;
  const b = r.borders;
  const vn = vnImports(b);
  const years = [...new Set([...Object.keys((b.buyers && b.buyers.years) || {}).map(Number), ...vn.years.keys()])].sort((x, y) => y - x);
  let usedCustoms = false;
  const rows = years.map((y) => {
    const c = boughtBy(b, "CHN", y);
    let v = boughtBy(b, "VNM", y);
    let mark = "";
    let label = String(y);
    if (!v && vn.years.has(y)) {
      const x = vn.years.get(y);
      v = { tonnes: x.tonnes, price: priceOf(x.tonnes, x.usd) };
      mark = " ᵛ";
      usedCustoms = true;
      if (!x.upTo.endsWith("-12")) label = `${y} (${t.months[0]}–${t.months[Number(x.upTo.slice(5, 7)) - 1]})`; // the year so far
    }
    return [label, c ? kt(c.tonnes) : "—", c ? usd2(c.price) : "—", v ? kt(v.tonnes) + mark : "—", v ? usd2(v.price) : "—"];
  });
  const c = card("official");
  c.append(cardHead(t.rb_who_title, "official", !!(b.buyers.stale || (b.vietnam && b.vietnam.stale)), t));
  c.append(el("p", "note", t.rb_who_intro));
  const tb = table([t.year, t.rb_col_cn_kt, t.rb_col_cn_price, t.rb_col_vn_kt, t.rb_col_vn_price], rows);
  tb.classList.add("wrap-all", "scroll-y", "tall");
  c.append(tb);
  if (usedCustoms) c.append(el("p", "note", t.rb_vn_customs_note));

  // Thailand and everyone else, in words (the numbers are tiny)
  const thai = Object.keys(b.buyers.years).map(Number).sort((x, y) => x - y).map((y) => [y, boughtBy(b, "THA", y)]).filter(([, v]) => v && v.tonnes);
  const ul = el("ul", "watch-list");
  ul.append(el("li", "", thai.length ? fill(t.rb_thai_line, { list: thai.map(([y, v]) => `${y}: ${kt(v.tonnes)}`).join(" · ") }) : t.rb_thai_line_none));
  const lastYear = Math.max(...Object.keys(b.buyers.years).map(Number).filter((y) => b.buyers.years[y].rows.length));
  const others = b.buyers.years[lastYear].rows.filter(([iso]) => iso !== "CHN" && iso !== "VNM");
  if (others.length) ul.append(el("li", "", fill(t.rb_others_line, { year: lastYear, list: others.slice(0, 5).map(([iso, tonnes]) => `${countryName(t, r.world && r.world.names, iso)} ${kt(tonnes)}`).join(" · ") })));
  ul.append(el("li", "", t.rb_who_note_price));
  c.append(ul);
  const fresh = el("div", "card-foot");
  fresh.append(freshness(t, { year: lastYear, stale: b.buyers.stale }));
  c.append(fresh, sourcesFoot(t, [b.sources.comtrade, usedCustoms && b.sources.vn_customs].filter(Boolean)));
  return c;
}

// ---------- View "who buys": price at the Vietnamese border, month by month ----------
function vietnamChart(r) {
  const { t } = r;
  const b = r.borders;
  const lao = vnImports(b).months;
  if (lao.length < 3) return null;
  const months = lao.map(([m]) => m);
  const on = (pairs) => {
    const map = new Map(pairs);
    return months.map((m) => (map.has(m) && map.get(m) !== null ? Math.round(map.get(m) * 100) / 100 : null));
  };
  const series = [{ label: t.rb_line_lao_vn, kind: "official", values: on(lao.map(([m, tonnes, usd]) => [m, priceOf(tonnes, usd)])) }];
  const exp = vnExports(b);
  if (exp.length) series.push({ label: t.rb_line_vn_export, kind: "official", color: "--cat-4", values: on(exp.map(([m, tonnes, usd]) => [m, priceOf(tonnes, usd)])) });
  const tsr = r.world && r.world.world_prices && r.world.world_prices.tsr20;
  if (tsr && tsr.length) series.push({ label: t.rw_tsr20, kind: "market", values: on(tsr) });
  return chartCard({
    title: t.rb_vn_chart,
    subtitle: `${t.unit}: ${t.inv_rub_usd_kg} · ${t.source}: ${t.rb_vn_chart_source}${b.vietnam.stale ? " · ⚠ " + t.inv_fetch_failed : ""}`,
    labels: months.map((m) => monthText(m, t)),
    tickLabels: months.map((m) => monthShort(m, t)),
    series,
    unit: "USD per kg",
    t,
    firstColTitle: t.month,
  });
}

// ---------- View "who buys": what kind of rubber, and what Laos itself declared ----------
function kindsCard(r) {
  const { t } = r;
  const b = r.borders;
  const f = b.forms && b.forms.buyers;
  if (!f) return null;
  const rows = [];
  for (const iso of ["CHN", "VNM"]) {
    const year = Object.keys(f[iso] || {}).sort().pop();
    if (!year) continue;
    const kinds = Object.entries(f[iso][year]).filter(([code, v]) => code !== "4001" && v[0] >= 100).sort((x, y) => y[1][0] - x[1][0]);
    kinds.forEach(([code, v], i) => {
      const name = el("span", "", i === 0 ? `${countryName(t, null, iso)} (${year})` : "");
      name.append(el("span", "sub-line", t["rw_code_" + code]));
      rows.push([name, kt(v[0]), usd2(priceOf(v[0], v[1] * 1000))]);
    });
  }
  if (!rows.length) return null;
  const c = card("official");
  c.append(cardHead(t.rb_kinds_title, "official", !!b.forms.stale, t));
  const tb = table([t.rb_col_buyer_kind, t.rw_col_kt, t.rw_col_price], rows);
  tb.classList.add("wrap-first");
  c.append(tb);
  const ul = el("ul", "watch-list");
  ul.append(el("li", "", t.rb_kinds_note_1));
  // Viet Nam buys both block rubber and raw forms: say what each fetched (numbers from the data, not typed in)
  const vy = Object.keys(f.VNM || {}).sort().pop();
  const vk = vy ? f.VNM[vy] : null;
  if (vk && vk["400122"] && vk["400129"]) {
    const [block, other] = [vk["400122"], vk["400129"]].map((v) => priceOf(v[0], v[1] * 1000));
    if (block && other) ul.append(el("li", "", fill(t.rb_kinds_vn, { year: vy, block: usd2(block), other: usd2(other) })));
  }
  c.append(ul);

  // The newest year Laos itself reported: its declared price next to the buyer's recorded price
  const d = b.declared && b.declared.years;
  const year = d && Object.keys(d).filter((y) => d[y].rows.length).sort().pop();
  if (year) {
    const cmp = ["CHN", "VNM"].map((iso) => {
      const own = d[year].rows.find((x) => x[0] === iso);
      const seen = boughtBy(b, iso, Number(year));
      return own && seen ? [countryName(t, null, iso), kt(own[1]), usd2(priceOf(own[1], own[2] * 1000)), kt(seen.tonnes), usd2(seen.price)] : null;
    }).filter(Boolean);
    if (cmp.length) {
      c.append(el("h4", "up-subtitle", fill(t.rb_declared_title, { year })));
      const tb2 = table([t.rw_col_buyer, t.rb_col_lao_kt, t.rb_col_lao_price, t.rb_col_seen_kt, t.rb_col_seen_price], cmp);
      tb2.classList.add("wrap-all");
      c.append(tb2, el("p", "note", t.rb_declared_note));
    }
  }
  const fresh = el("div", "card-foot");
  fresh.append(freshness(t, { year: Number(Object.keys(f.CHN || {}).sort().pop() || year), stale: b.forms.stale }));
  c.append(fresh, sourcesFoot(t, [b.sources.comtrade]));
  return c;
}

// ---------- Thai central markets next to Laos (reference prices) ----------
// -> [card with the newest prices and the notes, card with the daily chart] or null
function thaiBorderCard(r) {
  const { t } = r;
  const d = r.daily && r.daily.thai_border;
  if (!d || !d.kinds || !d.kinds.cuplump) return null;
  const kc = choice(r, "rubber_border_kind", KINDS.filter((k) => d.kinds[k] && d.kinds[k].days.length).map((k) => [k, t["rb_kind_" + k]]), "cuplump");
  const kind = d.kinds[kc.current];
  const thb = r.daily.fx && r.daily.fx.rates ? r.daily.fx.rates.THB : null;
  const thbLak = r.summary.metrics["fx-market.THB_LAK"];
  const c = card("market");
  c.append(cardHead(t.rb_thai_title, "market", !!d.stale, t));
  c.append(el("p", "note", t.rb_thai_intro));
  kc.bar.setAttribute("aria-label", t.rw_form_label);
  c.append(kc.bar);

  // newest price of each market (a market does not trade every day: its own newest day)
  const stats = el("div", "stats");
  for (const [i, key] of [[1, "rb_m_nongkhai"], [2, "rb_m_chiangrai"], [3, "rb_m_all"]]) {
    const row = [...kind.days].reverse().find((x) => x[i] !== null);
    if (!row) {
      stats.append(invTile(t, t[key], "—", t.rb_no_trade, null, "market"));
      continue;
    }
    const sub = [thbLak ? `≈ ${formatNumber(row[i] * thbLak.latest.value, "LAK")} ${t.inv_rub_lak_kg}` : "", thb ? `${(row[i] / thb).toFixed(2)} ${t.inv_rub_usd_kg}` : ""].filter(Boolean).join(" · ");
    stats.append(invTile(t, t[key], { num: row[i].toFixed(2), unit: t.inv_rub_thb_kg }, sub, freshness(t, { date: row[0], stale: d.stale }), "market"));
  }
  c.append(stats);
  let chart = null;
  const days = kind.days.slice(-90);
  if (days.length > 2) {
    const series = [
      { label: t.rb_m_nongkhai, kind: "market", values: days.map((x) => x[1]) },
      { label: t.rb_m_chiangrai, kind: "market", color: "--cat-1", values: days.map((x) => x[2]) },
      { label: t.rb_m_all, kind: "market", color: "--cat-4", values: days.map((x) => x[3]) },
    ].filter((s) => s.values.some((v) => v !== null));
    chart = chartCard({
      title: `${t.rb_thai_chart} · ${t["rb_kind_" + kc.current]}`,
      subtitle: `${t.unit}: ${t.inv_rub_thb_kg} · ${t.source}: ${t.rb_thai_source}`,
      labels: days.map((x) => formatDate(x[0], t)),
      series,
      unit: "THB per kg",
      t,
    });
  }
  if (chart) {
    // the same buttons once more, right above the chart (the first row sits above the tiles, a screen higher on a phone)
    const again = choice(r, "rubber_border_kind", KINDS.filter((k) => d.kinds[k] && d.kinds[k].days.length).map((k) => [k, t["rb_kind_" + k]]), "cuplump").bar;
    again.setAttribute("aria-label", t.rw_form_label);
    const sub = chart.querySelector(".chart-sub");
    if (sub) sub.after(again);
  }
  const ul = el("ul", "watch-list");
  for (const k of ["rb_thai_note_1", "rb_thai_note_2"]) ul.append(el("li", "", t[k]));
  const last = lastOf(kind.days);
  if (last && last[3] !== null && last[4] !== null) ul.append(el("li", "", fill(t.rb_thai_note_eudr, { date: formatDate(last[0], t), eudr: last[4].toFixed(2), plain: last[3].toFixed(2) })));
  c.append(ul);
  const fresh = el("div", "card-foot");
  fresh.append(freshness(t, { date: d.latest_day, stale: d.stale }));
  c.append(fresh, sourcesFoot(t, [r.daily.sources.raot]));
  return chart ? [c, chart] : [c];
}

export function buyersView(panel, r) {
  const { t } = r;
  if (!r.borders) {
    panel.append(el("p", "muted", r.bordersState === "error" ? t.inv_load_error : t.loading));
    return;
  }
  panel.append(buyerTiles(r), whoBuysCard(r));
  const grid = el("div", "grid grid-2");
  const chart = vietnamChart(r);
  if (chart) grid.append(chart);
  const kinds = kindsCard(r);
  if (kinds) grid.append(kinds);
  if (grid.childNodes.length) panel.append(grid);
  const thai = thaiBorderCard(r);
  if (thai) panel.append(...thai);
  else panel.append(el("p", "muted", r.dailyState === "loading" ? t.loading : t.inv_load_error));
}

// ---------- ASEAN view: the newest price in every country ----------
// Each row: a country, what kind of price it is, the price in its own money, in USD per kg, and its date.
export function countryPricesCard(r) {
  const { t } = r;
  const daily = r.daily;
  const b = r.borders;
  const w = r.world;
  if (!daily && !b) return null;
  const fx = daily && daily.fx && daily.fx.rates ? daily.fx.rates : {};
  const rows = [];
  const add = (iso, kindText, localText, usdPerKg, when, stale) => {
    const name = el("span", "", countryName(t, w && w.names, iso));
    name.append(el("span", "sub-line", kindText));
    rows.push([name, localText, usd2(usdPerKg), freshness(t, { ...when, stale, compact: true })]);
  };

  // Laos: the owner's own newest price, then the two borders
  const mine = r.own && r.own.rubber && r.own.rubber.entries && r.own.rubber.entries[0];
  const lak = lakRate(r);
  if (mine) add("LAO", `${t.own_mine} · ${t["own_type_" + mine.type] || mine.type_text}`, `${whole(mine.price)} ${t.rb_lak}`, lak ? mine.price / lak : null, { date: mine.date }, false);
  if (b) {
    const vn = lastOf(vnImports(b).months);
    if (vn) add("LAO", t.rb_p_lao_vn, "—", priceOf(vn[1], vn[2]), { month: vn[0] }, b.vietnam.stale);
    const years = Object.keys(b.buyers.years).map(Number).filter((y) => boughtBy(b, "CHN", y)).sort((x, y) => x - y);
    const cy = years.pop();
    if (cy) add("LAO", t.rb_p_lao_cn, "—", boughtBy(b, "CHN", cy).price, { year: cy }, b.buyers.stale);
  }
  // Thailand: central markets, all 8 together
  const th = daily && daily.thai_border;
  if (th && th.kinds) {
    for (const k of ["cuplump", "latex", "uss"]) {
      const row = th.kinds[k] && [...th.kinds[k].days].reverse().find((x) => x[3] !== null);
      if (row) add("THA", `${t["rb_kind_" + k]} · ${t.rb_p_market}`, `${row[3].toFixed(2)} ${t.rb_thb}`, fx.THB ? row[3] / fx.THB : null, { date: row[0] }, th.stale);
    }
  }
  // Malaysia: official daily prices
  const my = daily && daily.malaysia;
  if (my && my.days && my.days.length) {
    const smr = [...my.days].reverse().find((x) => x[1] !== null);
    if (smr) add("MYS", `SMR 20 · ${t.rb_p_official}`, `${(smr[1] * (fx.MYR || 0)).toFixed(2)} ${t.rb_myr}`.replace(/^0\.00 .*/, "—"), smr[1], { date: smr[0] }, my.stale);
    const latex = [...my.days].reverse().find((x) => x[2] !== null);
    if (latex) add("MYS", `${t.rb_p_latex_bulk} · ${t.rb_p_official}`, `${latex[2].toFixed(2)} ${t.rb_myr}`, fx.MYR ? latex[2] / fx.MYR : null, { date: latex[0] }, my.stale);
  }
  // Viet Nam: average price of its rubber exports (customs)
  if (b) {
    const ve = lastOf(vnExports(b));
    if (ve) add("VNM", t.rb_p_export_month, "—", priceOf(ve[1], ve[2]), { month: ve[0] }, b.vietnam.stale);
  }
  // Countries without a daily or monthly source: average export price of the newest year they reported (Comtrade)
  const exportYear = (iso) => {
    if (!w || !w.trade) return null;
    for (const year of Object.keys(w.trade.years).sort((x, y) => y - x)) {
      const row = w.trade.years[year].X["4001"].rows.find((x) => x[0] === iso);
      if (row && priceOf(row[1], row[2] * 1000)) return { year: Number(year), price: priceOf(row[1], row[2] * 1000) };
    }
    return null;
  };
  for (const iso of ["IDN", "KHM", "MMR"]) {
    const x = exportYear(iso);
    if (x) add(iso, t.rb_p_export_year, "—", x.price, { year: x.year }, w.trade.stale);
  }
  // Philippines: farm gate
  if (b && b.philippines && b.philippines.months && b.philippines.months.length) {
    const p = lastOf(b.philippines.months);
    add("PHL", `${t.rb_kind_cuplump} · ${t.rb_p_farm}`, `${p[1].toFixed(2)} ${t.rb_php}`, fx.PHP ? p[1] / fx.PHP : null, { month: p[0] }, b.philippines.stale);
  }
  // China: futures
  const cn = daily && daily.china;
  if (cn && cn.days && cn.days.length) {
    const row = lastOf(cn.days);
    const perKg = (yuanPerTonne) => (fx.CNY ? yuanPerTonne / fx.CNY / 1000 : null);
    if (row[1] !== null) add("CHN", `${t.rb_p_ru} · ${t.rb_p_futures}`, `${whole(row[1])} ${t.rb_cny_t}`, perKg(row[1]), { date: row[0] }, cn.stale);
    if (row[3] !== null) add("CHN", `${t.rb_p_nr} · ${t.rb_p_futures}`, `${whole(row[3])} ${t.rb_cny_t}`, perKg(row[3]), { date: row[0] }, cn.stale);
  }
  // World
  const wp = w && w.world_prices;
  if (wp && wp.tsr20 && wp.tsr20.length) {
    const a = lastOf(wp.tsr20);
    const s = lastOf(wp.rss3);
    rows.push([worldName(t, t.rw_tsr20), "—", usd2(a[1]), freshness(t, { month: a[0], stale: wp.stale, compact: true })]);
    if (s) rows.push([worldName(t, t.rw_rss3), "—", usd2(s[1]), freshness(t, { month: s[0], stale: wp.stale, compact: true })]);
  }
  if (!rows.length) return null;

  const c = card("market");
  c.append(cardHead(t.rb_prices_title, "market", false, t));
  c.append(el("p", "note", t.rb_prices_intro));
  const tb = table([t.rb_col_country_kind, t.rb_col_local, t.rw_col_price, t.rb_col_when], rows);
  tb.classList.add("wrap-first", "prices-table");
  c.append(tb);
  const ul = el("ul", "watch-list");
  for (const k of ["rb_prices_note_1", "rb_prices_note_2", "rb_prices_note_3"]) ul.append(el("li", "", t[k]));
  ul.append(el("li", "", fill(t.rb_prices_none, { list: ["SGP", "BRN"].map((iso) => countryName(t, w && w.names, iso)).join(", ") })));
  c.append(ul);
  if (fx.THB && daily.fx.date) c.append(el("p", "note", fill(t.rb_fx_note, { date: formatDate(daily.fx.date, t), thb: fx.THB.toFixed(2), myr: fx.MYR.toFixed(2), cny: fx.CNY.toFixed(2), php: fx.PHP.toFixed(2) })));
  c.append(sourcesFoot(t, [daily && daily.sources.raot, daily && daily.sources.lgm, daily && daily.sources.shfe, b && b.sources.vn_customs, b && b.sources.psa, b && b.sources.comtrade, w && w.sources.wb_pink, daily && daily.sources.fx].filter(Boolean)));
  return c;
}
function worldName(t, kindText) {
  const name = el("span", "", t.rw_world_all);
  name.append(el("span", "sub-line", `${kindText} · ${t.rb_p_world_month}`));
  return name;
}
export { ASEAN };

// ---------- for the owner's own prices: the Thai market nearest to his province ----------
export const nearestMarket = (province) => (NEAR_CHIANGRAI.includes(province) ? "chiangrai" : "nongkhai");

// Price of the same kind of rubber on that day (or the newest day before it) in the nearest Thai central market,
// in kip per kg. Falls back to the closing price of all markets when that market had no trade.
// -> { lak, thb, market: "nongkhai" | "chiangrai" | "all", date, exact } | null
export function borderPriceLak(daily, summary, type, province, day) {
  const kind = daily && daily.thai_border && daily.thai_border.kinds && daily.thai_border.kinds[RAOT_KIND[type]];
  const rate = summary.metrics["fx-market.THB_LAK"];
  if (!kind || !rate) return null;
  const market = nearestMarket(province);
  const col = market === "chiangrai" ? 2 : 1;
  const upTo = kind.days.filter((x) => x[0] <= day);
  const near = [...upTo].reverse().find((x) => x[col] !== null);
  const any = [...upTo].reverse().find((x) => x[3] !== null);
  // the nearest market's own price when it traded in the 7 days before; else all markets together
  const fresh = (x) => x && (new Date(day) - new Date(x[0])) / 86400e3 <= 7;
  const pick = fresh(near) ? [near, col, market] : fresh(any) ? [any, 3, "all"] : null;
  if (!pick) return null;
  const [row, i, where] = pick;
  const onDay = new Map(rate.daily).get(row[0]);
  const thbLak = onDay !== undefined ? onDay : rate.latest.value;
  return { lak: row[i] * thbLak, thb: row[i], market: where, date: row[0], exact: row[0] === day };
}
