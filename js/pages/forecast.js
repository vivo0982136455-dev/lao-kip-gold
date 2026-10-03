// Page 5: Forecast & accuracy (Phase 5).
// Everything here is calculated from stored files (data/forecast/hints.json and data/summary.json).
// Nothing is hard-coded.

import { el, card, cardHead, sectionTitle, statTile, table, emptyState } from "../ui.js";
import { formatDate, formatPct, todayVientiane, addDays, formatAxis } from "../format.js";
import { fill } from "./eco-common.js";

const ARROW = { up: "▲", down: "▼", flat: "▬" };
const WINDOW_DAYS = 30; // gold estimate against the real price
const HINT_WINDOW_DAYS = 90; // checked hints that count for the accuracy
// Fewer checked hints than this: words, never a percentage. "2 of 2 = 100%" reads like a trading signal and is
// only noise (audit 2026-10-02, P1-9).
export const MIN_CASES = 20;

// Table whose cells may wrap (status words are long, especially in Lao) so it fits a phone
const wrapTable = (headers, rows) => {
  const w = table(headers, rows);
  w.classList.add("wrap-all");
  return w;
};

// ---------- Shared helpers (also used by the Overview page) ----------

// Accuracy of the hints checked in the last 90 days: { usd: { correct, total, naive, enough }, thb: {...} }
//   naive  = how often "the same direction every day" would have been right, with the direction that came most
//            often - the best a guess without any information can do. A hint is worth something only above it.
//   enough = there are at least MIN_CASES checked hints
export function hintAccuracy(hints) {
  const from = addDays(todayVientiane(), -(HINT_WINDOW_DAYS - 1));
  const done = ((hints && hints.hints) || []).filter((h) => h.status === "resolved" && h.target_date >= from);
  const count = (cur) => {
    const seen = { up: 0, down: 0, flat: 0 };
    for (const h of done) seen[h.actual[cur]]++;
    return { correct: done.filter((h) => h.correct[cur]).length, total: done.length, naive: Math.max(seen.up, seen.down, seen.flat), enough: done.length >= MIN_CASES };
  };
  return { usd: count("usd"), thb: count("thb") };
}

const share = (part, total) => `${Math.round((part / total) * 100)}%`;
// "62%" - or words when there are too few checked hints for a percentage to mean anything
function pctText(acc, t) {
  return acc.enough ? share(acc.correct, acc.total) : t.hint_few_cases;
}
// The line under a hint: the accuracy next to the naive guess, or why there is no percentage yet
function accuracyNote(acc, t) {
  if (!acc.usd.enough) return fill(t.hint_few_note, { n: acc.usd.total, min: MIN_CASES });
  return fill(t.hint_acc_note, { days: HINT_WINDOW_DAYS, n: acc.usd.total, usd: share(acc.usd.correct, acc.usd.total), usd_naive: share(acc.usd.naive, acc.usd.total), thb: share(acc.thb.correct, acc.thb.total), thb_naive: share(acc.thb.naive, acc.thb.total) });
}

// Gold estimate error vs the real Lao price (Lao Bullion Bank sell per 15 g), last 30 days
export function goldErrors(summary) {
  const actual = summary.metrics["calc.lbb_sell_baht"];
  const adj = summary.metrics["calc.lao_gold_adj_sell"];
  const raw = summary.metrics["calc.lao_gold_est_sell"];
  if (!actual) return [];
  const from = addDays(todayVientiane(), -(WINDOW_DAYS - 1));
  const adjMap = new Map(adj ? adj.daily : []);
  const rawMap = new Map(raw ? raw.daily : []);
  return actual.daily
    .filter(([d]) => d >= from && rawMap.has(d))
    .map(([d, v]) => ({
      day: d,
      actual: v,
      raw: rawMap.get(d),
      rawErr: ((rawMap.get(d) - v) / v) * 100,
      adj: adjMap.has(d) ? adjMap.get(d) : null,
      adjErr: adjMap.has(d) ? ((adjMap.get(d) - v) / v) * 100 : null,
    }));
}

const meanAbs = (list) => (list.length ? list.reduce((s, v) => s + Math.abs(v), 0) / list.length : null);

// The big "today's kip direction" card
export function todayHintCard(hints, t, withLink) {
  const c = card("estimated", "hint-card");
  c.append(cardHead(t.hint_title, "estimated", false, t));
  const today = todayVientiane();
  const list = (hints && hints.hints) || [];
  const h = list.find((x) => x.target_date === today);

  if (!h) {
    c.append(el("p", "note", t.hint_none_today));
  } else {
    for (const cur of ["usd", "thb"]) {
      const row = el("div", "hint-row");
      row.append(el("div", "hint-arrow " + h.hint[cur], ARROW[h.hint[cur]]));
      const text = el("div", "hint-text");
      text.append(el("strong", "", `${t["hint_cur_" + cur]}: ${t["dir_" + h.hint[cur]]}`));
      let status = t.hint_waiting;
      if (h.status === "resolved") status = h.correct[cur] ? t.hint_was_right : t.hint_was_wrong;
      text.append(el("span", "", `${t.hint_basis} ${formatPct(h.basis[cur + "_pct"])} · ${status}`));
      row.append(text);
      c.append(row);
    }
  }
  const acc = hintAccuracy(hints);
  c.append(el("p", "note", `${t.hint_estimate_only} ${accuracyNote(acc, t)}`));
  if (withLink) {
    const a = el("a", "card-link", t.see_details + " →");
    a.href = "#/forecast";
    c.append(a);
  }
  return c;
}

// One accuracy tile: the share of right hints with the naive guess under it - or, with too few checked hints,
// words and how many are still missing
function accuracyTile(title, acc, t) {
  const sub = acc.enough ? `${t.hints_checked}: ${acc.total} · ${t.hint_naive}: ${share(acc.naive, acc.total)}` : fill(t.hint_few_sub, { n: acc.total, min: MIN_CASES });
  return statTile(`${title} (${fill(t.days_n, { days: HINT_WINDOW_DAYS })})`, pctText(acc, t), sub, "estimated");
}

// ---------- Page ----------
export function render(view, ctx) {
  const { t, summary, hints } = ctx;
  view.append(el("p", "lead", t.forecast_lead));

  const top = el("div", "grid grid-2");
  top.append(todayHintCard(hints, t, false));

  // Stat tiles: accuracy + gold error
  const acc = hintAccuracy(hints);
  const errs = goldErrors(summary);
  const adjErr = meanAbs(errs.map((e) => e.adjErr).filter((v) => v !== null));
  const rawErr = meanAbs(errs.map((e) => e.rawErr));
  const stats = el("div", "stats");
  stats.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
  stats.append(
    accuracyTile(t.accuracy_usd, acc.usd, t),
    accuracyTile(t.accuracy_thb, acc.thb, t),
    statTile(t.gold_error_adj, adjErr === null ? t.not_enough_data : `±${adjErr.toFixed(2)}%`, `${t.days_compared}: ${errs.filter((e) => e.adjErr !== null).length}`, "estimated"),
    statTile(t.gold_error_raw, rawErr === null ? t.not_enough_data : `±${rawErr.toFixed(2)}%`, `${t.days_compared}: ${errs.length}`, "estimated")
  );
  top.append(stats);
  view.append(top);

  // How it works
  const how = card(null);
  how.append(cardHead(t.method_title, null, false, t));
  const steps = el("ol", "steps");
  for (const key of ["method_1", "method_2", "method_3", "method_4", "method_5"]) steps.append(el("li", "", fill(t[key], { pct: (hints && hints.flat_threshold_pct) || 0.02, days: HINT_WINDOW_DAYS, min: MIN_CASES })));
  how.append(steps);
  how.style.marginTop = "12px";
  view.append(how);

  // History of hints
  view.append(sectionTitle(t.hint_history));
  const list = ((hints && hints.hints) || []).slice().reverse().slice(0, 30);
  if (!list.length) {
    view.append(emptyState(t.not_enough_data, t.hint_history_empty));
  } else {
    const mark = (h, cur) => {
      if (h.status === "pending") return t.status_waiting;
      if (h.status === "no_publication") return t.status_no_bol;
      return el("span", h.correct[cur] ? "ok-text" : "bad-text", `${ARROW[h.actual[cur]]} ${h.correct[cur] ? "✓" : "✕"}`);
    };
    const c = card(null);
    c.append(
      wrapTable(
        [t.col_date, `USD ${t.col_hint}`, `USD ${t.col_actual}`, `THB ${t.col_hint}`, `THB ${t.col_actual}`],
        list.map((h) => [formatDate(h.target_date, t), el("span", "dir-" + h.hint.usd, ARROW[h.hint.usd]), mark(h, "usd"), el("span", "dir-" + h.hint.thb, ARROW[h.hint.thb]), mark(h, "thb")])
      )
    );
    view.append(c);
  }

  // Gold estimate vs Lao Bullion Bank
  view.append(sectionTitle(t.gold_error_title));
  if (!errs.length) {
    view.append(emptyState(t.not_enough_data, t.gold_error_empty));
  } else {
    const c = card(null);
    // Values in millions ("46.31 ล้าน") so 6 columns fit a phone; the unit is in the section title
    const m = (v) => formatAxis(v, "LAK", t);
    c.append(
      wrapTable(
        [t.col_date, t.col_lbb, t.col_estimate, t.col_error, t.col_adjusted, t.col_error],
        errs
          .slice()
          .reverse()
          .map((e) => [
            formatDate(e.day, t),
            m(e.actual),
            m(e.raw),
            formatPct(e.rawErr),
            e.adj === null ? "—" : m(e.adj),
            e.adjErr === null ? "—" : formatPct(e.adjErr),
          ])
      )
    );
    view.append(c);
  }
}
