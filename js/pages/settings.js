// Page 6: Data & settings - language, theme, and the status of every data source.

import { el, card, cardHead, kindChip, statusBadge, sourceStatus, sourceLink, sectionTitle } from "../ui.js";
import { formatDate, toMs } from "../format.js";
import { installState, askInstall } from "../pwa.js";
import { fill } from "./eco-common.js";
import { allSourcesCard } from "./sources.js";

function settingRow(label, options, current, onPick) {
  const row = el("div", "setting-row");
  row.append(el("span", "", label));
  const group = el("div", "segmented");
  for (const [value, text] of options) {
    const b = el("button", "", text);
    b.type = "button";
    b.setAttribute("aria-pressed", String(value === current));
    b.addEventListener("click", () => onPick(value));
    group.append(b);
  }
  row.append(group);
  return row;
}

// A source with two routes (the official rate: the bank's own page, or the public mirror as the backup) says which
// one gave the numbers on show, and whether the two agreed (scripts/fetch-bol.js writes route / cross_check)
function routeLine(src, t) {
  if (!src.route) return null;
  const parts = [t["route_" + src.route] || src.route];
  if (src.route === "direct") {
    const c = src.cross_check;
    parts.push(!c ? t.route_check_none : !c.same_day ? fill(t.route_check_wait, { date: formatDate(c.mirror_date, t) }) : c.agree ? t.route_check_ok : fill(t.route_check_diff, { pct: c.max_diff_pct }));
  }
  const line = el("div", "status-route", parts.join(" · "));
  if (src.route !== "direct" && src.route_note) line.append(el("div", "error-text", src.route_note));
  return line;
}

// One status row per DAILY source: name, kind, status, newest data time, error.
// (The yearly and monthly sources - World Bank, IMF and all the others - are in the full list below: sources.js)
function statusRows(summary, hints, t) {
  const rows = [];
  for (const [id, src] of Object.entries(summary.sources)) {
    const status = sourceStatus(id, summary);
    const name = el("div");
    name.append(sourceLink(src));
    if (src.last_error && src.stale) name.append(el("div", "error-text", src.last_error.message));
    const route = routeLine(src, t);
    if (route) name.append(route);
    // "shown_as": the label of a source whose stored kind is kept for older copies of the app (the API rate)
    rows.push([name, kindChip(src.shown_as || src.kind, t), statusBadge(status, t), src.latest_source_date ? formatDate(src.latest_source_date, t) : "—"]);
  }
  const n = hints && hints.hints ? hints.hints.length : 0;
  rows.push([t.forecast_store, kindChip("estimated", t), statusBadge(hints ? "ok" : "stale", t), `${n} ${t.hints_stored}`]);
  return rows;
}

// Install as an app: one tap where the browser offers it (Chrome / Edge), the steps for the browser's own menu otherwise
function installCard(ctx) {
  const { t } = ctx;
  const state = installState();
  const c = card(null, "install-card");
  c.append(cardHead(t.pwa_title, null, false, t));
  if (state === "app" || state === "installed") {
    c.append(el("p", "up-save-status ok", state === "app" ? t.pwa_running : t.pwa_installed));
    c.append(el("p", "note", t.pwa_offline_note));
    return c;
  }
  c.append(el("p", "note", t.pwa_intro));
  if (state === "ready") {
    const actions = el("div", "up-actions");
    const b = el("button", "btn-primary", "📲 " + t.pwa_install);
    b.type = "button";
    b.addEventListener("click", () => askInstall());
    actions.append(b);
    c.append(actions);
  }
  c.append(el("h4", "up-subtitle", state === "ready" ? t.pwa_manual_or : t.pwa_manual_title));
  const steps = el("ul", "watch-list");
  for (const k of ["pwa_step_android", "pwa_step_iphone", "pwa_step_pc"]) steps.append(el("li", "", t[k]));
  c.append(steps);
  c.append(el("p", "note", t.pwa_offline_note));
  return c;
}

export function render(view, ctx) {
  const { t, summary, hints } = ctx;
  const grid = el("div", "grid grid-2");

  const prefs = card(null);
  prefs.append(cardHead(t.settings_display, null, false, t));
  prefs.append(settingRow(t.setting_language, [["th", "ไทย"], ["lo", "ລາວ"]], ctx.lang, ctx.setLang));
  prefs.append(settingRow(t.setting_theme, [["dark", t.theme_dark], ["light", t.theme_light]], ctx.theme, ctx.setTheme));
  prefs.append(el("p", "note", t.settings_saved_note));

  const times = Object.values(summary.sources).map((s) => s.last_success_at).filter(Boolean);
  const newest = times.sort((a, b) => toMs(a) - toMs(b)).pop();
  const upd = card(null);
  upd.append(cardHead(t.last_update_title, null, false, t));
  upd.append(el("div", "stat-value", newest ? formatDate(newest, t) : "—"));
  upd.append(el("p", "note", t.last_update_note));
  grid.append(prefs, upd);
  view.append(grid);
  view.append(installCard(ctx));

  view.append(sectionTitle(t.source_status_title));
  const c = card(null);
  // A stacked list (not a table) so it also fits on a narrow phone
  const list = el("ul", "status-list");
  for (const [name, chip, badge, latest] of statusRows(summary, hints, t)) {
    const li = el("li", "status-item");
    const top = el("div", "status-top");
    top.append(typeof name === "string" ? el("strong", "", name) : name, badge);
    const meta = el("div", "status-meta");
    meta.append(chip, el("span", "", `${t.col_latest_data}: ${latest}`));
    li.append(top, meta);
    list.append(li);
  }
  c.append(list);
  c.append(el("p", "note", t.source_status_note));
  view.append(c);

  // Every other source of the site: the yearly and monthly data files and the reports read by hand
  view.append(sectionTitle(t.src_all_title));
  view.append(allSourcesCard(ctx));
  const how = el("div", "watch-links");
  const toMethod = el("a", "btn", t.src_to_method);
  toMethod.href = "#/method";
  how.append(toMethod);
  view.append(how);

  view.append(sectionTitle(t.manual_title));
  const m = card("shop");
  m.append(el("p", "note", t.manual_text));
  const steps = el("ol", "steps");
  for (const k of ["setup_step_1", "setup_step_2", "setup_step_3", "setup_step_4"]) steps.append(el("li", "", t[k]));
  m.append(steps);
  view.append(m);
}
