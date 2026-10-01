// Rubber tab, the views beyond Laos' own prices (data/rubber-world.json, made by scripts/fetch-rubber-world.js):
//   ASEAN + China  - exports and imports of the 10 ASEAN countries and China, by form of rubber, with the average
//                    price at the border; production, tapped area and the price received by producers (FAO)
//   World + top 10 - world prices by month (TSR20, RSS3), the 10 biggest sellers and buyers
//   Who buys Lao rubber - what the buyers' customs report (used on the "Laos" view)
// Trade numbers are what each country's customs reported to the UN. A country that has not reported a year yet
// is shown with what its partners reported, marked "≈". Prices here are border prices, never farm prices.

import { el, card, cardHead, pctPill, table } from "../ui.js";
import { chartCard } from "../charts.js";
import { formatNumber } from "../format.js";
import { lastOf, pct, freshness, sourcesFoot, invTile, fill, monthText, monthShort, choice, countryName } from "./eco-common.js";

const ASEAN = ["LAO", "THA", "VNM", "KHM", "MMR", "MYS", "IDN", "PHL", "SGP", "BRN"];

// thousands of tonnes: 2,669 · 57.4 · 0.26 · <0.01
function kt(tonnes) {
  if (tonnes === null || tonnes === undefined) return "—";
  const v = tonnes / 1000;
  if (v >= 100) return Math.round(v).toLocaleString("en-US");
  if (v < 0.005) return "<0.01";
  return v.toLocaleString("en-US", { maximumFractionDigits: v >= 1 ? 1 : 2 });
}
// USD thousands -> millions: 5,013 · 97.1 · 0.04
function usdM(thousands) {
  const v = thousands / 1000;
  if (v >= 100) return Math.round(v).toLocaleString("en-US");
  return v.toLocaleString("en-US", { maximumFractionDigits: v >= 1 ? 1 : 2 });
}
// share of a total: 53% · 4.2% · <0.1%
function shareText(part, total) {
  if (!total) return "—";
  const p = (part / total) * 100;
  if (p >= 10) return `${p.toFixed(0)}%`;
  return p < 0.05 ? "<0.1%" : `${p.toFixed(1)}%`;
}
// USD thousands / tonnes = USD per kg. Under 10 tonnes the "price" of a few sample parcels means nothing: no price.
const perKg = (usdK, tonnes) => (tonnes >= 10 && usdK ? (usdK / tonnes).toFixed(2) : "—");

// What one country traded in a year: its own report, else its partners' reports (mirror). Null when neither exists.
function tradeOf(y, flow, code, iso) {
  const row = y[flow][code].rows.find((r) => r[0] === iso);
  if (row) return { tonnes: row[1], usd: row[2], usdWeighed: row[1] === null ? 0 : row[2], mirror: false };
  const m = y.mirror[flow][iso] && y.mirror[flow][iso][code];
  if (m) return { tonnes: m[0] || null, usd: m[1], usdWeighed: m[2], mirror: true };
  return null;
}
const approx = (x, text) => (x && x.mirror && text !== "—" ? "≈ " + text : text);

// Year and form of rubber, chosen with buttons (shared by every view of the tab).
// The newest years are not complete: big traders report late. The year shown first is the newest one in which the
// six big ASEAN / China traders have all reported; the others are marked "not complete".
const BIG = ["THA", "VNM", "IDN", "MYS", "KHM", "CHN"];
function yearChoice(r) {
  const all = r.world.trade.years;
  const years = Object.keys(all).sort((a, b) => b - a);
  const complete = (y) => !BIG.some((iso) => all[y].missing.X.includes(iso) || all[y].missing.M.includes(iso));
  return choice(r, "rubber_year", years.map((y) => [y, complete(y) ? y : `${y} · ${r.t.rw_incomplete}`]), years.find(complete) || years[0]);
}
function codeChoice(r) {
  return choice(r, "rubber_form", r.world.trade.codes.map((c) => [c, r.t["rw_code_" + c]]), "4001");
}
function controls(r, ...parts) {
  const box = el("div", "choices");
  for (const [label, c] of parts) {
    const row = el("div", "choice-row");
    row.append(el("span", "choice-label", label), c.bar);
    box.append(row);
  }
  return box;
}

// "2025: 80 countries have reported exports ... Not yet: Viet Nam, Cambodia"
function coverageNote(r, year, y) {
  const { t } = r;
  const missing = [...new Set([...y.missing.X, ...y.missing.M])].map((iso) => countryName(t, r.world.names, iso));
  const p = el("p", "note", fill(t.rw_coverage, { year, x: y.reporters.X, m: y.reporters.M }));
  if (missing.length) p.append(" · ", fill(t.rw_missing, { list: missing.join(", ") }));
  return p;
}

function tradeFoot(r, y, year) {
  const { t } = r;
  const fresh = el("div", "card-foot");
  fresh.append(freshness(t, { year: Number(year), stale: r.world.trade.stale }));
  const frag = document.createDocumentFragment();
  frag.append(fresh, sourcesFoot(t, [r.world.sources.comtrade]));
  return frag;
}

// ---------- ASEAN + China ----------
export function aseanView(panel, r) {
  const { t } = r;
  const w = r.world;
  const trade = w.trade;
  if (!trade || !Object.keys(trade.years || {}).length) {
    panel.append(el("p", "muted", t.inv_load_error));
    return;
  }
  const yc = yearChoice(r);
  const cc = codeChoice(r);
  const year = yc.current;
  const code = cc.current;
  const y = trade.years[year];

  // Laos first, the other ASEAN countries by the size of their exports, then China
  const size = (iso) => {
    const x = tradeOf(y, "X", code, iso);
    return x ? x.usd : -1;
  };
  const order = ["LAO", ...ASEAN.filter((c) => c !== "LAO").sort((a, b) => size(b) - size(a)), "CHN"];
  const rows = order.map((iso) => {
    const x = tradeOf(y, "X", code, iso);
    const m = tradeOf(y, "M", code, iso);
    return [
      countryName(t, w.names, iso),
      x ? approx(x, kt(x.tonnes)) : "—",
      x ? approx(x, perKg(x.usdWeighed, x.tonnes)) : "—",
      m ? approx(m, kt(m.tonnes)) : "—",
      m ? approx(m, perKg(m.usdWeighed, m.tonnes)) : "—",
    ];
  });
  const wx = y.X[code].world;
  const wm = y.M[code].world;
  rows.push([t.rw_world_row, kt(wx[0]), perKg(wx[2], wx[0]), kt(wm[0]), perKg(wm[2], wm[0])]);

  const c = card("official");
  c.append(cardHead(`${t.rw_asean_trade_title} (${year})`, "official", !!trade.stale, t));
  c.append(controls(r, [t.year, yc], [t.rw_form_label, cc]));
  const tb = table([t.rw_col_country, t.rw_col_exp_kt, t.rw_col_price, t.rw_col_imp_kt, t.rw_col_price], rows);
  tb.classList.add("wrap-all", "total-last");
  c.append(tb);
  c.append(coverageNote(r, year, y), el("p", "note", t.rw_price_note), el("p", "note", t.rw_codes_note));
  c.append(tradeFoot(r, y, year));
  panel.append(c);

  // Production, tapped area and the price received by producers (FAO)
  const prod = w.production;
  if (prod && prod.rows && prod.rows.length) {
    const farm = (w.farm_price && w.farm_price.rows) || {};
    const prodOf = (iso) => prod.rows.find((x) => x[0] === iso);
    const farmText = (iso) => {
      const last = lastOf(farm[iso] || []);
      return last ? `${(last[1] / 1000).toFixed(2)} (${last[0]})` : "—";
    };
    const list = [...ASEAN, "CHN"].map((iso) => [iso, prodOf(iso)]).sort((a, b) => (b[1] ? b[1][1] : -1) - (a[1] ? a[1][1] : -1));
    const lao = list.findIndex(([iso]) => iso === "LAO");
    list.unshift(...list.splice(lao, 1)); // Laos first
    const prows = list.map(([iso, p]) => [
      countryName(t, w.names, iso),
      p ? (p[3] === "A" ? "" : "≈ ") + kt(p[1]) : "—",
      p && p[2] ? kt(p[2]) : "—",
      farmText(iso),
    ]);
    prows.push([t.rw_world_all, kt(prod.world[0]), prod.world[1] ? kt(prod.world[1]) : "—", "—"]);
    const pc = card("official");
    pc.append(cardHead(fill(t.rw_prod_title, { year: prod.year }), "official", !!prod.stale, t));
    const ptb = table([t.rw_col_country, t.rw_col_prod_kt, t.rw_col_area_kha, t.rw_col_farm], prows);
    ptb.classList.add("wrap-all", "total-last");
    pc.append(ptb);
    pc.append(el("p", "note", t.rw_prod_note));
    const fresh = el("div", "card-foot");
    fresh.append(freshness(t, { year: prod.year, stale: prod.stale }));
    pc.append(fresh, sourcesFoot(t, [w.sources.faostat], prod.updated));
    panel.append(pc);
  }
}

// ---------- World: prices by month, the 10 biggest sellers and buyers ----------
export function worldView(panel, r) {
  const { t } = r;
  const w = r.world;
  const usdMonthly = r.economy.monthly && r.economy.monthly.bol_usd_mid;
  const rateOf = (month) => (usdMonthly ? new Map(usdMonthly.values).get(month) || lastOf(usdMonthly.values)[1] : null);

  // Key numbers
  const stats = el("div", "stats");
  const wp = w.world_prices;
  if (wp && wp.tsr20 && wp.tsr20.length > 12) {
    for (const [id, key] of [["tsr20", "rw_k_tsr20"], ["rss3", "rw_k_rss3"]]) {
      const now = lastOf(wp[id]);
      const ago = wp[id][wp[id].length - 13];
      const rate = rateOf(now[0]);
      const sub = rate ? `≈ ${formatNumber(now[1] * rate, "LAK")} ${t.inv_rub_lak_kg}` : "World Bank";
      const tile = invTile(t, t[key], { num: now[1].toFixed(2), unit: t.inv_rub_usd_kg }, sub, freshness(t, { month: now[0], stale: wp.stale }), "market");
      tile.querySelector(".stat-sub").append(" ", pctPill(pct(ago[1], now[1]), { decimals: 1 }));
      stats.append(tile);
    }
  }
  const prod = w.production;
  if (prod && prod.world) stats.append(invTile(t, t.rw_k_world_prod, { num: (prod.world[0] / 1e6).toFixed(2), unit: t.rw_unit_mt }, "FAO", freshness(t, { year: prod.year, stale: prod.stale }), "official"));
  panel.append(stats);

  // World prices by month: block rubber (made from cup lump) and smoked sheet
  if (wp && wp.tsr20 && wp.tsr20.length) {
    const months = [...new Set([...wp.tsr20, ...wp.rss3].map(([m]) => m))].filter((m) => m >= "2015-01").sort();
    const on = (list) => {
      const map = new Map(list);
      return months.map((m) => (map.has(m) ? map.get(m) : null));
    };
    panel.append(
      chartCard({
        title: t.rw_world_chart,
        subtitle: `${t.unit}: ${t.inv_rub_usd_kg} · ${t.source}: World Bank · ${t.rw_world_chart_sub}`,
        labels: months.map((m) => monthText(m, t)),
        tickLabels: months.map((m) => monthShort(m, t)),
        series: [
          { label: t.rw_tsr20, kind: "market", color: "--cat-3", values: on(wp.tsr20) },
          { label: t.rw_rss3, kind: "market", color: "--cat-1", values: on(wp.rss3) },
        ],
        unit: "USD per kg",
        t,
        firstColTitle: t.month,
      })
    );
  }

  // Top 10 sellers / buyers
  const trade = w.trade;
  if (!trade || !Object.keys(trade.years || {}).length) return;
  const fc = choice(r, "rubber_flow", [["X", t.rw_flow_X], ["M", t.rw_flow_M]], "X");
  const yc = yearChoice(r);
  const cc = codeChoice(r);
  const flow = fc.current;
  const year = yc.current;
  const code = cc.current;
  const y = trade.years[year];
  // reported rows + ASEAN / China countries that have not reported (their partners' numbers, marked ≈)
  const list = y[flow][code].rows.map(([iso, tonnes, usd]) => ({ iso, tonnes, usd, usdWeighed: tonnes === null ? 0 : usd, mirror: false }));
  for (const iso of y.missing[flow]) {
    const m = tradeOf(y, flow, code, iso);
    if (m && m.mirror) list.push({ iso, ...m });
  }
  list.sort((a, b) => b.usd - a.usd);
  const worldUsd = y[flow][code].world[1] + list.filter((x) => x.mirror).reduce((n, x) => n + x.usd, 0);
  const row = (x, i) => [
    `${i + 1}. ${countryName(t, w.names, x.iso)}`,
    approx(x, kt(x.tonnes)),
    approx(x, usdM(x.usd)),
    approx(x, perKg(x.usdWeighed, x.tonnes)),
    shareText(x.usd, worldUsd),
  ];
  const rows = list.slice(0, 10).map(row);
  const laoAt = list.findIndex((x) => x.iso === "LAO");
  if (laoAt >= 10) rows.push(row(list[laoAt], laoAt)); // Laos is always shown, with its own rank
  const tot = y[flow][code].world;
  rows.push([t.rw_world_row, kt(tot[0]), usdM(tot[1]), perKg(tot[2], tot[0]), ""]);

  const c = card("official");
  c.append(cardHead(`${fill(t.rw_top_title, { flow: t["rw_flow_short_" + flow] })} (${year})`, "official", !!trade.stale, t));
  c.append(controls(r, [t.rw_flow_label, fc], [t.year, yc], [t.rw_form_label, cc]));
  const tb = table([t.rw_col_country, t.rw_col_kt, t.rw_col_usd_m, t.rw_col_price, t.rw_col_share], rows);
  tb.classList.add("wrap-all", "total-last");
  c.append(tb);
  c.append(coverageNote(r, year, y), el("p", "note", t.rw_price_note), el("p", "note", t.rw_codes_note));
  c.append(tradeFoot(r, y, year));
  panel.append(c);

  // The world's biggest producers (FAO)
  if (prod && prod.rows && prod.rows.length) {
    const prows = prod.rows.slice(0, 10).map(([iso, tonnes, , flag], i) => [`${i + 1}. ${countryName(t, w.names, iso)}`, (flag === "A" ? "" : "≈ ") + kt(tonnes), `${((tonnes / prod.world[0]) * 100).toFixed(1)}%`]);
    const laoAt2 = prod.rows.findIndex((x) => x[0] === "LAO");
    if (laoAt2 >= 10) prows.push([`${laoAt2 + 1}. ${countryName(t, w.names, "LAO")}`, (prod.rows[laoAt2][3] === "A" ? "" : "≈ ") + kt(prod.rows[laoAt2][1]), `${((prod.rows[laoAt2][1] / prod.world[0]) * 100).toFixed(1)}%`]);
    prows.push([t.rw_world_all, kt(prod.world[0]), "100%"]);
    const pc = card("official");
    pc.append(cardHead(fill(t.rw_top_prod_title, { year: prod.year }), "official", !!prod.stale, t));
    const ptb = table([t.rw_col_country, t.rw_col_prod_kt, t.rw_col_share], prows);
    ptb.classList.add("wrap-first", "total-last");
    pc.append(ptb);
    pc.append(el("p", "note", t.rw_top_prod_note));
    const fresh = el("div", "card-foot");
    fresh.append(freshness(t, { year: prod.year, stale: prod.stale }));
    pc.append(fresh, sourcesFoot(t, [w.sources.faostat], prod.updated));
    panel.append(pc);
  }
}

// ---------- Who buys rubber from Laos (used on the "Laos" view) ----------
export function laoBuyersCard(r) {
  const { t } = r;
  const w = r.world;
  const trade = w && w.trade;
  if (!trade || !Object.keys(trade.years || {}).length) return null;
  const yc = yearChoice(r);
  const year = yc.current;
  const y = trade.years[year];
  const all = y.lao_buyers && y.lao_buyers["4001"];
  const c = card("official");
  c.append(cardHead(`${t.rw_buyers_title} (${year})`, "official", !!trade.stale, t));
  c.append(controls(r, [t.year, yc]));
  if (!all || !all.rows.length) {
    c.append(el("p", "muted", t.rw_buyers_none));
    return c;
  }
  const total = all.total;
  const rows = all.rows.map(([iso, tonnes, usd]) => [countryName(t, w.names, iso), kt(tonnes), usdM(usd), perKg(tonnes === null ? 0 : usd, tonnes), shareText(usd, total[1])]);
  rows.push([t.rw_buyers_total, kt(total[0]), usdM(total[1]), perKg(total[2], total[0]), ""]);
  const tb = table([t.rw_col_buyer, t.rw_col_kt, t.rw_col_usd_m, t.rw_col_price, t.rw_col_share], rows);
  tb.classList.add("wrap-all", "total-last");
  c.append(tb);

  // The forms Lao rubber was bought in, and what Laos itself reported (when it did)
  const forms = trade.codes.filter((code) => code !== "4001" && y.lao_buyers[code]).map((code) => `${t["rw_code_" + code]} ${kt(y.lao_buyers[code].total[0])}`);
  if (forms.length) c.append(el("p", "note", fill(t.rw_buyers_forms, { list: forms.join(" · ") })));
  const own = y.X["4001"].rows.find((x) => x[0] === "LAO");
  if (own) c.append(el("p", "note", fill(t.rw_lao_self, { kt: kt(own[1]), usd: usdM(own[2]), price: perKg(own[1] === null ? 0 : own[2], own[1]) })));
  c.append(el("p", "note", t.rw_buyers_note));
  const silent = y.missing.M.filter((iso) => iso !== "LAO"); // ASEAN / China buyers that have not reported this year
  if (silent.length) c.append(el("p", "note", fill(t.rw_buyers_missing, { list: silent.map((iso) => countryName(t, w.names, iso)).join(", ") })));
  c.append(tradeFoot(r, y, year));
  return c;
}

// Laos' own production by year (FAO: an estimate, not an official Lao figure)
export function laoProductionChart(r) {
  const { t } = r;
  const prod = r.world && r.world.production;
  const hist = prod && prod.history && prod.history.LAO;
  if (!hist || hist.length < 2) return null;
  return chartCard({
    title: t.rw_lao_prod_chart,
    subtitle: `${t.unit}: ${t.unit_names.tonnes} · ${t.source}: FAO · ${t.rw_lao_prod_sub}`,
    labels: hist.map(([yr]) => String(yr)),
    series: [{ label: t.rw_lao_prod_line, kind: "estimated", values: hist.map(([, v]) => v) }],
    unit: "tonnes",
    t,
    firstColTitle: t.year,
  });
}
