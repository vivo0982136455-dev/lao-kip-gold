// Own prices: the owner records what his buyer really paid for rubber, and what land is offered for.
// No source publishes these numbers for Laos, so his own entries are the only local data.
// Same road as the shop prices on the Gold page: the values go into the owner's Google Form (js/manual-entry.js)
// and come back with the next data run (scripts/fetch-own-prices.js -> data/own-prices.json).
// Nothing is sent until the owner taps Save. The site is public, so the cards ask for no personal details.

import { el, card, cardHead, table, emptyState } from "../ui.js";
import { formatNumber, formatDate, todayVientiane } from "../format.js";
import { loadFormConfig, formHas, prefilledUrl, saveDirect, newTag } from "../manual-entry.js";
import { PROVINCES, fill, whole } from "./eco-common.js";

// Kind of rubber: id -> [text written into the sheet (always Thai: the bot reads these words), Thai market item to compare with]
export const RUBBER_TYPES = {
  cuplump: ["ยางก้อนถ้วย", "rubber_cuplump"],
  latex: ["น้ำยางสด", "rubber_latex"],
  sheet: ["ยางแผ่นดิบ", "rubber_sheet"],
  rss: ["ยางแผ่นรมควัน", null],
  other: ["อื่น ๆ", null],
};
// Same limits as scripts/fetch-own-prices.js (a value outside them would be skipped by the bot)
const RUBBER_MIN = 1000;
const RUBBER_MAX = 200000;
const LAND_SQM_MIN = 50;
const LAND_SQM_MAX = 1000000000;
const AREA_UNITS = { sqm: 1, rai: 1600, ha: 10000 }; // square metres in one unit
const CURRENCIES = { LAK: null, THB: "fx-market.THB_LAK", USD: "fx-market.USD_LAK" }; // -> market rate used to turn the price into kip

// Kept between redraws of the page (the page is rebuilt when a button or the language changes)
const s = {
  rubber: { open: false, values: {}, save: "idle" },
  land: { open: false, values: {}, save: "idle" },
  config: null,
};

// Last choices (kind, province, place ...) so the next entry starts filled in. Only on this device.
function remembered(kind) {
  try {
    return JSON.parse(localStorage.getItem("own_last_" + kind) || "{}") || {};
  } catch {
    return {};
  }
}
function remember(kind, values) {
  try {
    localStorage.setItem("own_last_" + kind, JSON.stringify(values));
  } catch {
    /* private mode */
  }
}

const digits = (text) => {
  const n = Number(String(text || "").replace(/[^\d.]/g, ""));
  return n > 0 ? n : null;
};

// ---------- small form parts ----------
function field(labelText, control, extraClass = "") {
  const wrap = el("label", ("up-field " + extraClass).trim());
  wrap.append(el("span", "", labelText), control);
  return wrap;
}
function numberInput(value, onInput, decimals = false) {
  const input = el("input");
  input.type = "text";
  input.inputMode = decimals ? "decimal" : "numeric";
  input.autocomplete = "off";
  input.placeholder = "0";
  const show = () => (value() ? value().toLocaleString("en-US", { maximumFractionDigits: 2 }) : "");
  input.value = show();
  input.addEventListener("input", () => onInput(digits(input.value)));
  input.addEventListener("blur", () => {
    input.value = show();
  });
  return input;
}
function selectInput(options, value, onChange) {
  const sel = el("select");
  for (const [v, text] of options) {
    const o = el("option", "", text);
    o.value = v;
    if (v === value) o.selected = true;
    sel.append(o);
  }
  sel.addEventListener("change", () => onChange(sel.value));
  return sel;
}
function textInput(value, onInput) {
  const input = el("input");
  input.type = "text";
  input.autocomplete = "off";
  input.maxLength = 60;
  input.value = value || "";
  input.addEventListener("input", () => onInput(input.value.trim()));
  return input;
}
function dateInput(value, onChange) {
  const input = el("input");
  input.type = "date";
  input.value = value || "";
  input.max = todayVientiane();
  input.addEventListener("change", () => onChange(input.value || null));
  return input;
}
const provinceOptions = (t) => PROVINCES.map((p) => [p, t.provinces[p] || p]);
// "Louangnamtha | ເມືອງສິງ": the bot splits it again (scripts/fetch-own-prices.js)
const placeText = (province, place) => (place ? `${province} | ${place}` : `${province} |`);

// Value of `metricId` on `day` (or its newest value): used for THB / USD -> LAK
function rateOn(summary, metricId, day) {
  const m = summary.metrics[metricId];
  if (!m) return null;
  const v = new Map(m.daily).get(day);
  return v !== undefined ? v : m.latest.value;
}

// Thai market price of the same kind of rubber on that day, in kip per kg (null when we have none)
export function thaiPriceLak(thai, summary, type, day) {
  const itemId = RUBBER_TYPES[type] && RUBBER_TYPES[type][1];
  const item = itemId && thai && thai.items && thai.items[itemId];
  if (!item) return null;
  const onDay = new Map(item.days || []).get(day);
  const thb = onDay !== undefined ? onDay : item.latest ? item.latest.value : null;
  const rate = rateOn(summary, "fx-market.THB_LAK", day);
  if (!thb || !rate) return null;
  return { lak: thb * rate, thb, exact: onDay !== undefined, date: onDay !== undefined ? day : item.latest.date };
}

// ---------- the shared card frame: checks, save buttons, status ----------
// spec: { kind, title, intro, addLabel, build(panel, refresh) , checks() -> [[level, text]], formValues(tag) , analysis() -> Node | null, needs: role }
function entryCard(ctx, spec) {
  const { t, rerender } = ctx;
  const st = s[spec.kind];
  const c = card("own", "upload-card");
  c.append(cardHead(spec.title, "own", false, t));
  c.append(el("p", "note", spec.intro));

  const actions = el("div", "up-actions");
  const add = el("button", "btn-primary", "✍️ " + spec.addLabel);
  add.type = "button";
  add.addEventListener("click", () => {
    st.open = true;
    st.save = "idle";
    spec.start();
    rerender();
  });
  actions.append(add);
  if (!st.open) c.append(actions); // while the form is open its own Save button is the only primary button
  c.classList.add("own-" + spec.kind);
  // After a confirmed save the form closes (so the same entry is not sent twice); the result stays visible
  if (!st.open && st.save === "saved") c.append(el("p", "up-save-status ok", t.own_saved));
  if (!st.open) {
    c.append(el("p", "note", t.own_public_note));
    return c;
  }

  if (!s.config) {
    loadFormConfig()
      .then((cfg) => {
        s.config = cfg;
        rerender();
      })
      .catch(() => {});
  }

  const panel = el("div", "up-panel");
  const grid = el("div", "up-grid");
  const checksBox = el("ul", "up-checks");
  let analysisBox = el("div");
  const saveBtn = el("button", "btn-primary", "💾 " + t.up_save);
  saveBtn.type = "button";
  const link = el("a", "btn", "📝 " + t.up_open_form);
  link.target = "_blank";
  link.rel = "noopener";

  const allChecks = () => {
    const list = spec.checks();
    if (s.config && !formHas(s.config, spec.needs)) list.push(["bad", t.own_check_no_question]);
    if (!list.length) list.push(["ok", t.up_check_ok]);
    return list;
  };
  const refresh = () => {
    const list = allChecks();
    checksBox.replaceChildren(...list.map(([level, text]) => el("li", "up-check " + level, (level === "ok" ? "✓ " : level === "bad" ? "✕ " : "⚠ ") + text)));
    const fresh = spec.analysis() || el("div");
    analysisBox.replaceWith(fresh);
    analysisBox = fresh;
    saveBtn.disabled = list.some(([level]) => level === "bad") || !s.config || st.save === "send" || st.save === "check";
    link.href = s.config ? prefilledUrl(s.config, spec.formValues()) : "#";
  };
  spec.build(grid, refresh);
  panel.append(grid, checksBox, analysisBox);

  const cancel = el("button", "", t.up_cancel);
  cancel.type = "button";
  cancel.addEventListener("click", () => {
    Object.assign(st, { open: false, values: {}, save: "idle" });
    rerender();
  });
  saveBtn.addEventListener("click", async () => {
    spec.remember();
    // A form that needs sign-in / e-mail cannot be filled silently: open it filled in instead
    if (!s.config.direct_submit_ok) {
      window.open(prefilledUrl(s.config, spec.formValues()), "_blank", "noopener");
      st.save = "manual";
      rerender();
      return;
    }
    const tag = newTag();
    st.save = "send";
    rerender();
    try {
      const ok = await saveDirect(s.config, spec.formValues(tag), tag, (stage) => {
        st.save = stage;
        const line = document.querySelector(`.own-${spec.kind} .up-save-status`);
        if (line) line.textContent = t["up_save_" + stage];
      });
      st.save = ok ? "saved" : "unconfirmed";
      if (ok) st.open = false;
    } catch {
      st.save = "error";
    }
    rerender();
  });
  const saveRow = el("div", "up-actions");
  saveRow.append(saveBtn, link, cancel);
  panel.append(saveRow);
  if (st.save !== "idle") {
    const cls = st.save === "manual" ? "ok" : st.save === "unconfirmed" || st.save === "error" ? "warn" : "";
    panel.append(el("p", "up-save-status " + cls, t["up_save_" + st.save]));
  }
  panel.append(el("p", "note", t.own_public_note));
  refresh();
  c.append(panel);
  return c;
}

// ---------- Rubber: the price the buyer paid ----------
export function rubberEntryCard(ctx, thai) {
  const { t, summary } = ctx;
  const v = s.rubber.values;
  const note = (tag) => `${t.up_form_note} (${t.own_note_rubber})${tag ? " " + tag : ""}`;
  return entryCard(ctx, {
    kind: "rubber",
    title: t.own_rubber_title,
    intro: t.own_rubber_intro,
    addLabel: t.own_rubber_add,
    needs: "rubber_price",
    start() {
      const last = remembered("rubber");
      Object.assign(v, { date: todayVientiane(), type: last.type || "cuplump", price: null, province: last.province || PROVINCES[0], place: last.place || "" });
    },
    remember: () => remember("rubber", { type: v.type, province: v.province, place: v.place }),
    build(grid, refresh) {
      const set = (key) => (value) => {
        v[key] = value;
        refresh();
      };
      grid.append(
        field(t.col_date, dateInput(v.date, set("date")), "up-date"),
        field(t.own_rubber_type, selectInput(Object.keys(RUBBER_TYPES).map((id) => [id, t["own_type_" + id]]), v.type, set("type"))),
        field(t.own_rubber_price, numberInput(() => v.price, set("price"))),
        field(t.own_province, selectInput(provinceOptions(t), v.province, set("province"))),
        field(t.own_place, textInput(v.place, set("place")))
      );
    },
    checks() {
      const out = [];
      if (!v.date) out.push(["bad", t.up_check_date]);
      if (!v.price) out.push(["bad", t.own_check_price]);
      else if (v.price < RUBBER_MIN || v.price > RUBBER_MAX) out.push(["bad", fill(t.own_check_rubber_range, { min: whole(RUBBER_MIN), max: whole(RUBBER_MAX) })]);
      return out;
    },
    analysis() {
      if (!v.price) return null;
      const ref = thaiPriceLak(thai, summary, v.type, v.date);
      if (!ref) return null;
      const box = el("div", "up-analysis");
      const row = el("div", "row");
      row.append(el("span", "row-label", `${t.own_an_thai} ${t["own_type_" + v.type]} (${formatDate(ref.date, t)})`));
      const right = el("div", "row-right");
      right.append(el("div", "value small-value", `${whole(ref.lak)} ${t.inv_rub_lak_kg}`));
      const line = el("div", "change wrap");
      line.append(el("span", "vs", fill(t.own_an_share, { pct: ((v.price / ref.lak) * 100).toFixed(0) })));
      right.append(line);
      row.append(right);
      box.append(row);
      if (v.type === "cuplump") box.append(el("p", "note", t.own_an_cuplump_note));
      return box;
    },
    formValues: (tag) => ({ date: v.date, rubber_price: v.price, rubber_type: RUBBER_TYPES[v.type][0], rubber_place: placeText(v.province, v.place), note: note(tag) }),
  });
}

// ---------- Land: a price seen or offered ----------
export function landEntryCard(ctx) {
  const { t, summary } = ctx;
  const v = s.land.values;
  const rate = () => (CURRENCIES[v.currency] ? rateOn(summary, CURRENCIES[v.currency], v.date) : 1);
  const totalLak = () => (v.total && rate() ? Math.round(v.total * rate()) : null);
  const areaSqm = () => (v.area ? Math.round(v.area * AREA_UNITS[v.unit] * 100) / 100 : null);
  const perSqm = () => (totalLak() && areaSqm() ? totalLak() / areaSqm() : null);
  // what was typed, kept in the note so the original numbers are never lost
  const typed = () => `${whole(v.total || 0)} ${v.currency}; ${v.area || 0} ${v.unit}`;
  const note = (tag) => `${t.up_form_note} (${t.own_note_land}: ${typed()})${tag ? " " + tag : ""}`;
  return entryCard(ctx, {
    kind: "land",
    title: t.own_land_title,
    intro: t.own_land_intro,
    addLabel: t.own_land_add,
    needs: "land_total",
    start() {
      const last = remembered("land");
      Object.assign(v, { date: todayVientiane(), province: last.province || PROVINCES[0], place: "", total: null, currency: last.currency || "LAK", area: null, unit: last.unit || "sqm" });
    },
    remember: () => remember("land", { province: v.province, currency: v.currency, unit: v.unit }),
    build(grid, refresh) {
      const set = (key) => (value) => {
        v[key] = value;
        refresh();
      };
      grid.append(
        field(t.col_date, dateInput(v.date, set("date")), "up-date"),
        field(t.own_province, selectInput(provinceOptions(t), v.province, set("province"))),
        field(t.own_land_place, textInput(v.place, set("place"))),
        field(t.own_land_total, numberInput(() => v.total, set("total"))),
        field(t.own_land_currency, selectInput(Object.keys(CURRENCIES).map((c) => [c, c === "LAK" ? t.own_cur_lak : c]), v.currency, set("currency"))),
        field(t.own_land_area, numberInput(() => v.area, set("area"), true)),
        field(t.own_land_unit, selectInput(Object.keys(AREA_UNITS).map((u) => [u, t["own_unit_" + u]]), v.unit, set("unit")))
      );
    },
    checks() {
      const out = [];
      if (!v.date) out.push(["bad", t.up_check_date]);
      if (!v.total) out.push(["bad", t.own_check_land_total]);
      if (!v.area) out.push(["bad", t.own_check_land_area]);
      if (v.total && v.currency !== "LAK" && !rate()) out.push(["bad", t.own_check_no_rate]);
      const p = perSqm();
      if (p && (p < LAND_SQM_MIN || p > LAND_SQM_MAX)) out.push(["bad", t.own_check_land_range]);
      return out;
    },
    analysis() {
      const p = perSqm();
      if (!p) return null;
      const box = el("div", "up-analysis");
      const row = (label, value, sub) => {
        const r = el("div", "row");
        r.append(el("span", "row-label", label));
        const right = el("div", "row-right");
        right.append(el("div", "value small-value", value));
        if (sub) right.append(el("div", "change wrap", sub));
        r.append(right);
        box.append(r);
      };
      const thb = rateOn(summary, "fx-market.THB_LAK", v.date);
      const usd = rateOn(summary, "fx-market.USD_LAK", v.date);
      const also = [thb && `${formatNumber(p / thb, "THB")} THB`, usd && `${formatNumber(p / usd, "USD")} USD`].filter(Boolean).join(" · ");
      row(t.own_land_per_sqm, `${whole(p)} ${t.own_cur_lak}`, also ? `≈ ${also} ${t.own_per_sqm_short}` : null);
      if (v.currency !== "LAK" || v.unit !== "sqm") row(t.own_land_saved_as, `${whole(totalLak())} ${t.own_cur_lak} · ${whole(areaSqm())} ${t.own_unit_sqm}`, v.currency !== "LAK" ? `1 ${v.currency} = ${formatNumber(rate(), "LAK")} ${t.own_cur_lak} (${t.kind_market})` : null);
      return box;
    },
    formValues: (tag) => ({ date: v.date, land_place: placeText(v.province, v.place), land_total: totalLak(), land_area: areaSqm(), note: note(tag) }),
  });
}

// ---------- Lists of what was recorded ----------
const placeLabel = (t, e) => [e.province ? t.provinces[e.province] || e.province : null, e.place].filter(Boolean).join(" · ") || "—";

// own = data/own-prices.json (or null while loading). Returns a card with every rubber entry, newest first.
export function rubberEntriesCard(ctx, own, thai) {
  const { t, summary } = ctx;
  const c = card("own");
  c.append(cardHead(t.own_rubber_list, "own", !!(own && own.stale), t));
  const entries = own && own.rubber ? own.rubber.entries : [];
  if (!entries.length) {
    c.append(emptyState(t.own_empty_title, t.own_rubber_empty));
    return c;
  }
  const rows = entries.map((e) => {
    const ref = thaiPriceLak(thai, summary, e.type, e.date);
    return [
      formatDate(e.date, t),
      t["own_type_" + e.type] || e.type_text,
      whole(e.price),
      placeLabel(t, e),
      ref && ref.exact ? `${((e.price / ref.lak) * 100).toFixed(0)}%` : "—",
    ];
  });
  const tb = table([t.col_date, t.own_rubber_type, t.inv_rub_lak_kg, t.own_col_place, t.own_col_vs_thai], rows);
  tb.classList.add("wrap-all", "scroll-y");
  c.append(tb);
  c.append(el("p", "note", t.own_vs_thai_note));
  return c;
}

export function landEntriesCard(ctx, own, province) {
  const { t } = ctx;
  const all = own && own.land ? own.land.entries : [];
  const entries = province ? all.filter((e) => e.province === province) : all;
  const c = card("own");
  c.append(cardHead(t.own_land_list, "own", !!(own && own.stale), t));
  if (!entries.length) {
    c.append(emptyState(t.own_empty_title, t.own_land_empty));
    return c;
  }
  const rows = entries.map((e) => [formatDate(e.date, t), placeLabel(t, e), whole(e.area), (e.total / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1 }), whole(e.per_sqm)]);
  const tb = table([t.col_date, t.own_col_place, t.own_col_area, t.own_col_total_m, t.own_col_per_sqm], rows);
  tb.classList.add("wrap-all", "scroll-y");
  c.append(tb);
  return c;
}

// Newest own land price of each province: Map(province -> { n, latest entry })
export function landByProvince(own) {
  const map = new Map();
  for (const e of (own && own.land && own.land.entries) || []) {
    if (!e.province) continue;
    const cur = map.get(e.province);
    if (cur) cur.n++;
    else map.set(e.province, { n: 1, latest: e }); // entries are newest first
  }
  return map;
}
// Newest own rubber price of each province: Map(province -> entry)
export function rubberByProvince(own) {
  const map = new Map();
  for (const e of (own && own.rubber && own.rubber.entries) || []) if (e.province && !map.has(e.province)) map.set(e.province, e);
  return map;
}
