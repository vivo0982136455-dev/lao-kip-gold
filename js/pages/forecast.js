// Page 5: Forecast & accuracy (Phase 5).
// Everything here is calculated from stored files (data/forecast/hints.json and data/summary.json).
// Nothing is hard-coded.

import { el, card, cardHead, sectionTitle, statTile, table, emptyState } from "../ui.js";
import { formatDate, formatNumber, formatPct, todayVientiane, addDays } from "../format.js";

const ARROW = { up: "▲", down: "▼", flat: "▬" };
const WINDOW_DAYS = 30;

// ---------- Shared helpers (also used by the Overview page) ----------

// Accuracy over the last 30 days: { usd: {correct, total}, thb: {...} }
export function hintAccuracy(hints) {
  const from = addDays(todayVientiane(), -(WINDOW_DAYS - 1));
  const done = ((hints && hints.hints) || []).filter((h) => h.status === "resolved" && h.target_date >= from);
  const count = (cur) => ({ correct: done.filter((h) => h.correct[cur]).length, total: done.length });
  return { usd: count("usd"), thb: count("thb") };
}

function pctText(acc, t) {
  return acc.total ? `${Math.round((acc.correct / acc.total) * 100)}%` : t.not_enough_data;
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
      row.append(el("div", "hint-arrow", ARROW[h.hint[cur]]));
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
  c.append(el("p", "note", `${t.hint_estimate_only} ${t.accuracy_30d}: USD ${pctText(acc.usd, t)} · THB ${pctText(acc.thb, t)}`));
  if (withLink) {
    const a = el("a", "card-link", t.see_details + " →");
    a.href = "#/forecast";
    c.append(a);
  }
  return c;
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
    statTile(`${t.accuracy_usd} (${t.days_30})`, pctText(acc.usd, t), `${t.hints_checked}: ${acc.usd.total}`, "estimated"),
    statTile(`${t.accuracy_thb} (${t.days_30})`, pctText(acc.thb, t), `${t.hints_checked}: ${acc.thb.total}`, "estimated"),
    statTile(t.gold_error_adj, adjErr === null ? t.not_enough_data : `±${adjErr.toFixed(2)}%`, `${t.days_compared}: ${errs.filter((e) => e.adjErr !== null).length}`, "estimated"),
    statTile(t.gold_error_raw, rawErr === null ? t.not_enough_data : `±${rawErr.toFixed(2)}%`, `${t.days_compared}: ${errs.length}`, "estimated")
  );
  top.append(stats);
  view.append(top);

  // How it works
  const how = card(null);
  how.append(cardHead(t.method_title, null, false, t));
  const steps = el("ol", "steps");
  for (const key of ["method_1", "method_2", "method_3", "method_4"]) steps.append(el("li", "", t[key].replace("{pct}", (hints && hints.flat_threshold_pct) || 0.02)));
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
      table(
        [t.col_date, `USD ${t.col_hint}`, `USD ${t.col_actual}`, `THB ${t.col_hint}`, `THB ${t.col_actual}`],
        list.map((h) => [formatDate(h.target_date, t), ARROW[h.hint.usd], mark(h, "usd"), ARROW[h.hint.thb], mark(h, "thb")])
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
    const unit = "LAK";
    c.append(
      table(
        [t.col_date, t.col_lbb, t.col_estimate, t.col_error, t.col_adjusted, t.col_error],
        errs
          .slice()
          .reverse()
          .map((e) => [
            formatDate(e.day, t),
            formatNumber(e.actual, unit),
            formatNumber(e.raw, unit),
            formatPct(e.rawErr),
            e.adj === null ? "—" : formatNumber(e.adj, unit),
            e.adjErr === null ? "—" : formatPct(e.adjErr),
          ])
      )
    );
    view.append(c);
  }
}
