// Save shop prices into the owner's Google Form - from the page, no server.
// Question IDs come from data/manual-form.json (made by scripts/fetch-form-entries.js on every data run).
//
// Two ways (research 2026-09-30):
//   1) direct: POST to the form's formResponse in "no-cors" mode (one tap). The browser cannot see
//      Google's answer, so a short random tag is put in the Note and the Sheet is read back until
//      the tag appears -> "saved" is only shown when the row is really in the Sheet.
//   2) fallback: the form opened already filled in (official "pre-filled link"); the owner presses Submit.
// Numbers are sent as plain digits; the date as YYYY-MM-DD (Google ignores other date formats).
//
// A third way, used as soon as data/manual-form.json names a "save_url" (the owner's own Apps Script,
// apps-script/save-prices.gs): the values go there together with the owner's key, the script writes the row and
// ANSWERS, so the page knows at once whether the price is saved. Without the key nobody can add a row - the Form
// itself is closed then. The key is typed once on each device and kept in this browser only; it is sent to the
// script and nowhere else, and it is in no file of this site.

import { el } from "./ui.js";

let formConfig = null;

export async function loadFormConfig() {
  if (formConfig) return formConfig;
  const res = await fetch("data/manual-form.json", { cache: "no-cache" });
  if (!res.ok) throw new Error("no form config");
  formConfig = await res.json();
  return formConfig;
}

// values: { date, sell, buy, bar_sell, bar_buy, silver_sell, silver_buy, note } -> entry fields
function fields(config, values) {
  const out = [];
  for (const [role, value] of Object.entries(values)) {
    const id = config.entries[role];
    if (!id || value === null || value === undefined || value === "") continue;
    out.push([`entry.${id}`, typeof value === "number" ? String(Math.round(value)) : String(value)]);
  }
  return out;
}

// Which prices the form can take (e.g. silver only after the owner added those questions)
export function formHas(config, role) {
  return !!(config && config.entries && config.entries[role]);
}

// The form opened with everything filled in; the owner only presses Submit
export function prefilledUrl(config, values) {
  const q = new URLSearchParams([["usp", "pp_url"], ...fields(config, values)]);
  return `https://docs.google.com/forms/d/e/${config.form_id}/viewform?${q}`;
}

// A short random tag, e.g. "#k3f9x2"
export function newTag() {
  return "#" + Math.random().toString(36).slice(2, 8);
}

// Direct save. Resolves true when the tagged row is seen in the Sheet, false when not seen in time.
// onStage("send" | "check")
export async function saveDirect(config, values, tag, onStage = () => {}) {
  const body = new URLSearchParams([...fields(config, values), ["fvv", "1"], ["pageHistory", "0"]]);
  onStage("send");
  // no-cors: the request is sent, but its answer is hidden from us (it is always "opaque")
  await fetch(`https://docs.google.com/forms/d/e/${config.form_id}/formResponse`, { method: "POST", mode: "no-cors", body });
  if (!config.sheet_id) return false;
  onStage("check");
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    try {
      const url = `https://docs.google.com/spreadsheets/d/${config.sheet_id}/gviz/tq?tqx=out:csv&_=${Date.now()}`;
      const text = await (await fetch(url, { cache: "no-store" })).text();
      if (text.includes(tag)) return true;
    } catch {
      /* try again */
    }
  }
  return false;
}

// ---------- the road with the owner's key ----------
const KEY_STORE = "save_key";
let typedKey = ""; // typed but not yet proven right; kept while the page is redrawn

export const usesKey = (config) => !!(config && config.save_url);
function storedKey() {
  try {
    return localStorage.getItem(KEY_STORE) || "";
  } catch {
    return "";
  }
}
function storeKey(key) {
  try {
    if (key) localStorage.setItem(KEY_STORE, key);
    else localStorage.removeItem(KEY_STORE);
  } catch {
    /* private mode: the key is asked for again next time */
  }
}
// Can Save be pressed? (no key is needed on the Form's road)
export const keyReady = (config) => !usesKey(config) || !!(storedKey() || typedKey.trim());

// The key's place in an entry form: the field to type it into, or - once a save has proven it - one line with a
// button that removes it from this device. null on the Form's road. onChange(redraw): the form must look again.
export function keyBox(t, config, onChange) {
  if (!usesKey(config)) return null;
  const box = el("div", "up-key");
  if (storedKey()) {
    const line = el("p", "note", t.up_key_stored + " ");
    const forget = el("button", "up-key-forget", t.up_key_forget);
    forget.type = "button";
    forget.addEventListener("click", () => {
      storeKey("");
      typedKey = "";
      onChange(true);
    });
    line.append(forget);
    box.append(line);
    return box;
  }
  const wrap = el("label", "up-field");
  const input = el("input");
  input.type = "password";
  input.autocomplete = "off";
  input.value = typedKey;
  input.addEventListener("input", () => {
    typedKey = input.value;
    onChange(false);
  });
  wrap.append(el("span", "", t.up_key_label), input);
  box.append(wrap, el("p", "note", t.up_key_note));
  return box;
}

// Save through the owner's script. -> "saved" | "key" (wrong key) | "refused" (the script did not take the
// values) | "failed" (no answer). A key that worked is kept on this device; a wrong one is forgotten.
export async function saveWithKey(config, values) {
  const key = storedKey() || typedKey.trim();
  const sent = {};
  for (const [role, value] of Object.entries(values)) {
    if (!config.entries[role] || value === null || value === undefined || value === "") continue;
    sent[role] = typeof value === "number" ? Math.round(value) : String(value);
  }
  try {
    // text/plain: a "simple" request, which the browser sends without asking the script for permission first
    const res = await fetch(config.save_url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ key, values: sent }), cache: "no-store" });
    const answer = await res.json();
    if (answer && answer.ok === true) {
      storeKey(key);
      typedKey = "";
      return "saved";
    }
    if (answer && answer.error === "key") {
      storeKey("");
      return "key";
    }
    return "refused";
  } catch {
    return "failed";
  }
}
