// Gold page: "save a shop price from a picture" card.
// 1) the owner picks the shop's price picture (Phouvong gold / PML silver) or types the prices
// 2) the numbers are read ON THE PHONE (js/ocr.js) and shown in fields to check and correct
// 3) instant analysis vs Lao Bullion Bank, plus checks that flag doubtful numbers
// 4) save: one tap into the owner's Google Form (js/manual-entry.js), with the filled-in form as backup
// The picture never leaves the phone. Nothing is saved until the owner taps Save.

import { el, card, cardHead, pctPill } from "../ui.js";
import { formatNumber, formatPct, todayVientiane } from "../format.js";
import { readImageText, parsePhouvong, parseSilver, guessKind, priceScore } from "../ocr.js";
import { loadFormConfig, formHas, prefilledUrl, saveDirect, newTag, usesKey, keyReady, keyBox, saveWithKey } from "../manual-entry.js";

const GOLD_FIELDS = [
  ["sell", "up_ornament_sell"],
  ["buy", "up_ornament_buy"],
  ["bar_sell", "up_bar_sell"],
  ["bar_buy", "up_bar_buy"],
];
const SILVER_FIELDS = [
  ["silver_sell", "up_silver_sell"],
  ["silver_buy", "up_silver_buy"],
];
const LBB_GAP = 0.1; // warn when a gold price is more than 10% from Lao Bullion Bank

// Kept between redraws of the page (the page is rebuilt when a filter or the language changes)
const s = {
  open: false,
  kind: "gold",
  imageUrl: null,
  text: "", // OCR text, kept so switching gold/silver can re-read it
  status: "idle", // idle | working | done | error
  stage: "load", // load | read (while working)
  progress: 0,
  values: {},
  save: "idle", // idle | send | check | saved | unconfirmed | error
  savedUrl: null,
  config: null,
};

let ocrReady = false; // the OCR files were downloaded before on this device (shows the size notice otherwise)
try {
  ocrReady = localStorage.getItem("ocr_ready") === "1";
} catch {
  /* private mode */
}

const digits = (v) => {
  const n = Number(String(v || "").replace(/[^\d]/g, ""));
  return n > 0 ? n : null;
};

function fillFrom(text) {
  const kind = guessKind(text);
  s.kind = kind;
  applyParse(text, kind);
}
function applyParse(text, kind) {
  const date = s.values.date || todayVientiane();
  if (kind === "gold") {
    const p = parsePhouvong(text);
    s.values = { date: p.date || date, sell: p.ornament.sell, buy: p.ornament.buy, bar_sell: p.bar.sell, bar_buy: p.bar.buy };
  } else {
    const p = parseSilver(text);
    s.values = { date: p.date || date, silver_sell: p.silver.sell, silver_buy: p.silver.buy };
  }
}

async function onFile(file, rerender) {
  if (!file) return;
  if (s.imageUrl) URL.revokeObjectURL(s.imageUrl);
  s.imageUrl = URL.createObjectURL(file);
  s.open = true;
  s.status = "working";
  s.stage = "load";
  s.progress = 0;
  s.save = "idle";
  s.values = { date: todayVientiane() };
  rerender();
  let last = 0;
  try {
    const text = await readImageText(file, {
      score: priceScore,
      enough: 6,
      onProgress: ({ stage, progress }) => {
        s.stage = stage;
        s.progress = progress;
        // update the bar in place (a full redraw on every tick would be wasteful)
        const now = Date.now();
        if (now - last > 150) {
          last = now;
          const bar = document.querySelector(".up-progress > span");
          const label = document.querySelector(".up-progress-label");
          if (bar) bar.style.width = `${Math.round(progress * 100)}%`;
          if (label && stageText) label.textContent = stageText();
        }
      },
    });
    try {
      localStorage.setItem("ocr_ready", "1");
    } catch {
      /* ignore */
    }
    ocrReady = true;
    s.text = text;
    fillFrom(text);
    s.status = "done";
  } catch (err) {
    console.warn("OCR failed:", err);
    s.status = "error";
  }
  rerender();
}
let stageText = null; // set while rendering (needs the i18n texts)

// ---------- checks + analysis ----------
function checks(t, lbbSell) {
  const v = s.values;
  const out = [];
  const fields = s.kind === "gold" ? GOLD_FIELDS : SILVER_FIELDS;
  for (const [role, key] of fields) {
    const x = v[role];
    if (!x) continue;
    if (x % 1000 !== 0) out.push(["warn", `${t[key]}: ${t.up_check_000}`]);
    if (s.kind === "gold" && lbbSell && Math.abs(x / lbbSell - 1) > LBB_GAP) out.push(["warn", `${t[key]}: ${t.up_check_lbb}`]);
  }
  const pairs = s.kind === "gold" ? [["sell", "buy", "up_group_ornament"], ["bar_sell", "bar_buy", "up_group_bar"]] : [["silver_sell", "silver_buy", "up_group_silver"]];
  for (const [a, b, key] of pairs) {
    if (v[a] && v[b] && v[a] < v[b]) out.push(["warn", `${t[key]}: ${t.up_check_order}`]);
  }
  if (!v.date) out.push(["bad", t.up_check_date]);
  const hasPrice = fields.some(([role]) => v[role]);
  if (!hasPrice) out.push(["bad", t.up_check_empty]);
  if (s.kind === "silver" && s.config && !formHas(s.config, "silver_sell")) out.push(["bad", t.up_check_no_silver_q]);
  if (hasPrice && !out.length) out.push(["ok", t.up_check_ok]);
  return out;
}

function lbbFor(summary, day, id) {
  const m = summary.metrics[id];
  if (!m) return null;
  const d = new Map(m.daily).get(day);
  return d !== undefined ? d : m.latest.value;
}

function analysis(t, summary) {
  const v = s.values;
  const box = el("div", "up-analysis");
  const row = (label, right) => {
    const r = el("div", "row");
    r.append(el("span", "row-label", label));
    const rr = el("div", "row-right");
    rr.append(right);
    r.append(rr);
    box.append(r);
  };
  const spread = (sell, buy) => (sell && buy ? formatPct(((sell - buy) / sell) * 100, 2).replace("+", "") : "—");
  if (s.kind === "gold") {
    const lbbSell = lbbFor(summary, v.date, "calc.lbb_sell_baht");
    const lbbBuy = lbbFor(summary, v.date, "calc.lbb_buy_baht");
    const vsLbb = (x) => {
      const line = el("div", "change");
      line.append(el("span", "", `${x > lbbSell ? "+" : x < lbbSell ? "−" : ""}${formatNumber(Math.abs(x - lbbSell), "LAK")} LAK`), pctPill(((x - lbbSell) / lbbSell) * 100));
      return line;
    };
    if (lbbSell && v.bar_sell) row(t.up_an_bar_vs_lbb, vsLbb(v.bar_sell));
    if (lbbSell && v.sell) row(t.up_an_orn_vs_lbb, vsLbb(v.sell));
    const adj = summary.metrics["calc.lao_gold_adj_sell"];
    if (adj && v.sell) {
      const line = el("div", "change");
      line.append(pctPill(((v.sell - adj.latest.value) / adj.latest.value) * 100));
      row(t.up_an_orn_vs_est, line);
    }
    row(t.up_an_spread, el("span", "", `${t.up_group_ornament} ${spread(v.sell, v.buy)} · ${t.up_group_bar} ${spread(v.bar_sell, v.bar_buy)} · LBB ${spread(lbbSell, lbbBuy)}`));
    if (lbbSell) box.append(el("p", "note", `${t.up_an_lbb_ref}: ${formatNumber(lbbSell, "LAK")} LAK`));
  } else {
    row(t.up_an_spread, el("span", "", spread(v.silver_sell, v.silver_buy)));
  }
  return box;
}

// ---------- rendering ----------
function priceInput(role, labelKey, t, onChange) {
  const wrap = el("label", "up-field");
  wrap.append(el("span", "", t[labelKey]));
  const input = el("input");
  input.type = "text";
  input.inputMode = "numeric";
  input.autocomplete = "off";
  input.value = s.values[role] ? formatNumber(s.values[role], "LAK") : "";
  input.placeholder = "0";
  input.addEventListener("input", () => {
    s.values[role] = digits(input.value);
    onChange();
  });
  input.addEventListener("blur", () => {
    input.value = s.values[role] ? formatNumber(s.values[role], "LAK") : "";
  });
  wrap.append(input);
  return wrap;
}

export function uploadCard(ctx) {
  const { t, summary, rerender } = ctx;
  stageText = () => (s.stage === "read" ? t.up_reading : t.up_loading) + ` ${Math.round(s.progress * 100)}%`;
  const c = card("shop", "upload-card");
  c.append(cardHead(t.up_title, "shop", false, t));
  c.append(el("p", "note", t.up_intro));

  // Buttons: pick a picture (camera or gallery) / type the prices
  const actions = el("div", "up-actions");
  const pick = el("label", "btn btn-primary");
  pick.append(el("span", "", "📷 " + t.up_pick));
  const file = el("input");
  file.type = "file";
  file.accept = "image/*";
  file.className = "visually-hidden";
  file.addEventListener("change", () => onFile(file.files && file.files[0], rerender));
  pick.append(file);
  const manual = el("button", "", "✍️ " + t.up_manual);
  manual.type = "button";
  manual.addEventListener("click", () => {
    s.open = true;
    s.status = "done";
    s.save = "idle";
    if (!s.values.date) s.values.date = todayVientiane();
    rerender();
  });
  actions.append(pick, manual);
  c.append(actions);
  if (!ocrReady) c.append(el("p", "note", t.up_first_time));

  if (!s.open) return c;

  // Form question IDs (loaded once; needed for saving and to know if silver can be saved)
  if (!s.config) {
    loadFormConfig()
      .then((cfg) => {
        s.config = cfg;
        rerender();
      })
      .catch(() => {});
  }

  const panel = el("div", "up-panel");
  if (s.status === "working") {
    const bar = el("div", "up-progress");
    const fill = el("span");
    fill.style.width = `${Math.round(s.progress * 100)}%`;
    bar.append(fill);
    panel.append(el("p", "up-progress-label", stageText()), bar);
  }
  if (s.status === "error") {
    const box = el("div", "alert");
    box.append(el("span", "", "⚠"), el("div", "", t.up_error));
    panel.append(box);
  }
  if (s.imageUrl) {
    const img = el("img", "up-preview");
    img.src = s.imageUrl;
    img.alt = t.up_preview_alt;
    panel.append(img);
  }

  if (s.status === "done" || s.status === "error") {
    // Which shop / metal
    const kinds = el("div", "segmented");
    for (const [k, key] of [["gold", "up_kind_gold"], ["silver", "up_kind_silver"]]) {
      const b = el("button", "", t[key]);
      b.type = "button";
      b.setAttribute("aria-pressed", String(s.kind === k));
      b.addEventListener("click", () => {
        if (s.kind === k) return;
        s.kind = k;
        if (s.text) applyParse(s.text, k);
        s.save = "idle";
        rerender();
      });
      kinds.append(b);
    }
    panel.append(kinds);
    if (s.text) panel.append(el("p", "note", t.up_check_hint));

    const grid = el("div", "up-grid");
    const dateWrap = el("label", "up-field up-date");
    dateWrap.append(el("span", "", t.col_date));
    const date = el("input");
    date.type = "date";
    date.value = s.values.date || "";
    date.addEventListener("change", () => {
      s.values.date = date.value || null;
      refresh();
    });
    dateWrap.append(date);
    grid.append(dateWrap);

    const checksBox = el("ul", "up-checks");
    let analysisBox = el("div");
    const refresh = () => {
      const lbbSell = lbbFor(summary, s.values.date, "calc.lbb_sell_baht");
      checksBox.replaceChildren(
        ...checks(t, lbbSell).map(([level, text]) => {
          const li = el("li", "up-check " + level, (level === "ok" ? "✓ " : level === "bad" ? "✕ " : "⚠ ") + text);
          return li;
        })
      );
      const fresh = analysis(t, summary);
      analysisBox.replaceWith(fresh);
      analysisBox = fresh;
      saveBtn.disabled = checks(t, lbbSell).some(([level]) => level === "bad") || !s.config || !keyReady(s.config) || s.save === "send" || s.save === "check";
      link.href = s.config && !usesKey(s.config) ? prefilledUrl(s.config, valuesForForm(t)) : "#";
      link.hidden = usesKey(s.config); // the Form is closed on the road with the owner's key
    };
    for (const [role, key] of s.kind === "gold" ? GOLD_FIELDS : SILVER_FIELDS) grid.append(priceInput(role, key, t, refresh));
    panel.append(grid, checksBox);
    panel.append(el("h4", "up-subtitle", t.up_analysis_title), analysisBox);

    // Save
    const saveRow = el("div", "up-actions");
    const saveBtn = el("button", "btn-primary", "💾 " + t.up_save);
    saveBtn.type = "button";
    const link = el("a", "btn", "📝 " + t.up_open_form);
    link.target = "_blank";
    link.rel = "noopener";
    const cancel = el("button", "", t.up_cancel);
    cancel.type = "button";
    cancel.addEventListener("click", () => {
      if (s.imageUrl) URL.revokeObjectURL(s.imageUrl);
      Object.assign(s, { open: false, imageUrl: null, text: "", status: "idle", values: {}, save: "idle" });
      rerender();
    });
    saveBtn.addEventListener("click", async () => {
      if (usesKey(s.config)) {
        s.save = "send";
        rerender();
        s.save = await saveWithKey(s.config, valuesForForm(t));
        rerender();
        return;
      }
      // Form needs sign-in / e-mail -> a silent save cannot work: open the filled-in form instead
      if (!s.config.direct_submit_ok) {
        window.open(prefilledUrl(s.config, valuesForForm(t)), "_blank", "noopener");
        s.save = "manual";
        rerender();
        return;
      }
      const tag = newTag();
      const values = valuesForForm(t, tag);
      s.save = "send";
      rerender();
      try {
        const ok = await saveDirect(s.config, values, tag, (stage) => {
          s.save = stage;
          const line = document.querySelector(".up-save-status");
          if (line) line.textContent = t["up_save_" + stage];
        });
        s.save = ok ? "saved" : "unconfirmed";
      } catch {
        s.save = "error";
      }
      rerender();
    });
    saveRow.append(saveBtn, link, cancel);
    const key = keyBox(t, s.config, (redraw) => (redraw ? rerender() : refresh()));
    if (key) panel.append(key);
    panel.append(saveRow);
    if (s.save !== "idle") {
      const cls = s.save === "saved" || s.save === "manual" ? "ok" : s.save === "send" || s.save === "check" ? "" : "warn";
      panel.append(el("p", "up-save-status " + cls, t["up_save_" + s.save]));
    }
    panel.append(el("p", "note", t.up_privacy));
    refresh();
  }
  c.append(panel);
  return c;
}

// Values to send: prices of the chosen kind + the note (with the tag for the direct save)
function valuesForForm(t, tag) {
  const v = s.values;
  const note = `${t.up_form_note}${s.imageUrl ? "" : " (" + t.up_manual + ")"}${tag ? " " + tag : ""}`;
  if (s.kind === "gold") return { date: v.date, sell: v.sell, buy: v.buy, bar_sell: v.bar_sell, bar_buy: v.bar_buy, note };
  return { date: v.date, silver_sell: v.silver_sell, silver_buy: v.silver_buy, note };
}
