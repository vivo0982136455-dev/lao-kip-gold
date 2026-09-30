// App shell: loads texts + data, builds the sidebar menu, and shows one page at a time.
// Pages are chosen by the address "hash": #/overview, #/rates, #/gold, #/living, #/economy, #/forecast, #/settings
// No build step - plain ES modules.

import { icon } from "./icons.js";
import { el, RANGES } from "./ui.js";
import { destroyCharts, setLongData, needsLong } from "./charts.js";
import { formatDate, toMs } from "./format.js";
import * as overview from "./pages/overview.js";
import * as rates from "./pages/rates.js";
import * as gold from "./pages/gold.js";
import * as economy from "./pages/economy.js";
import * as living from "./pages/living.js";
import * as forecast from "./pages/forecast.js";
import * as settings from "./pages/settings.js";

// Menu: grouped into sections. "title" and "group" are keys in i18n/*.json
const ROUTES = [
  { path: "overview", title: "page_overview", icon: "dashboard", group: "nav_group_main", page: overview },
  { path: "rates", title: "page_rates", icon: "exchange", group: "nav_group_markets", page: rates },
  { path: "gold", title: "page_gold", icon: "gold", group: "nav_group_markets", page: gold },
  { path: "living", title: "page_living", icon: "coin", group: "nav_group_analysis", page: living },
  { path: "economy", title: "page_economy", icon: "economy", group: "nav_group_analysis", page: economy },
  { path: "forecast", title: "page_forecast", icon: "forecast", group: "nav_group_analysis", page: forecast },
  { path: "settings", title: "page_settings", icon: "settings", group: "nav_group_system", page: settings },
];
// Phone bottom tab bar: the 4 most used pages + "more" (opens the full menu). Labels are i18n keys.
const BOTTOM_TABS = [
  { path: "overview", label: "tab_overview", icon: "dashboard" },
  { path: "rates", label: "tab_rates", icon: "exchange" },
  { path: "gold", label: "tab_gold", icon: "gold" },
  { path: "living", label: "tab_living", icon: "coin" },
];

const state = {
  lang: "th",
  theme: "dark",
  range: 30,
  t: null,
  summary: null,
  economy: null,
  hints: null,
  long: null, // data/long.json, loaded only when a 1-year / all range is chosen
  loadError: null,
  lastPath: null, // page shown last time (fade only when the page really changes)
};

// ---------- Remembered choices (localStorage can fail in private mode) ----------
function load(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

async function getJson(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

// ---------- Theme ----------
function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = state.theme === "dark" ? "#0f1115" : "#f6f6f4";
}

// ---------- Sidebar ----------
const sidebar = document.getElementById("sidebar");
const backdrop = document.getElementById("backdrop");
const menuBtn = document.getElementById("menu-btn");

function openMenu(open) {
  sidebar.classList.toggle("open", open);
  backdrop.classList.toggle("show", open);
  menuBtn.setAttribute("aria-expanded", String(open));
  menuBtn.replaceChildren(icon(open ? "close" : "menu", 22));
  menuBtn.setAttribute("aria-label", open ? state.t.menu_close : state.t.menu_open);
}

function buildSidebar(currentPath) {
  const t = state.t;
  const nav = document.getElementById("nav");
  nav.replaceChildren();
  let group = null;
  let list = null;
  for (const r of ROUTES) {
    if (r.group !== group) {
      group = r.group;
      nav.append(el("div", "nav-group", t[group]));
      list = el("ul", "nav-list");
      nav.append(list);
    }
    const a = el("a", "nav-link");
    a.href = "#/" + r.path;
    if (r.path === currentPath) a.setAttribute("aria-current", "page");
    a.append(icon(r.icon), el("span", "", t[r.title]));
    const li = el("li");
    li.append(a);
    list.append(li);
  }

  // Quick language switch at the bottom of the sidebar
  const langBox = document.getElementById("sidebar-lang");
  langBox.replaceChildren();
  for (const [code, label] of [["th", "ไทย"], ["lo", "ລາວ"]]) {
    const b = el("button", "", label);
    b.type = "button";
    b.setAttribute("aria-pressed", String(state.lang === code));
    b.addEventListener("click", () => setLang(code));
    langBox.append(b);
  }
}

// ---------- Phone bottom tab bar ----------
function buildBottomNav(currentPath) {
  const t = state.t;
  const nav = document.getElementById("bottom-nav");
  nav.replaceChildren();
  for (const tab of BOTTOM_TABS) {
    const a = el("a");
    a.href = "#/" + tab.path;
    if (tab.path === currentPath) a.setAttribute("aria-current", "page");
    a.append(icon(tab.icon, 22), el("span", "", t[tab.label]));
    nav.append(a);
  }
  // "More": the other pages live in the side menu
  const more = el("a");
  more.href = "#";
  more.setAttribute("role", "button");
  if (!BOTTOM_TABS.some((x) => x.path === currentPath)) more.setAttribute("aria-current", "page");
  more.append(icon("menu", 22), el("span", "", t.tab_more));
  more.addEventListener("click", (e) => {
    e.preventDefault();
    openMenu(true);
  });
  nav.append(more);
}

// ---------- Top bar ----------
function renderTopbar(route) {
  const t = state.t;
  document.getElementById("page-title").textContent = t[route.title];
  document.title = `${t[route.title]} · ${t.site_title}`;
  const updated = document.getElementById("topbar-updated");
  updated.textContent = "";
  if (state.summary) {
    const times = Object.values(state.summary.sources).map((s) => s.last_success_at).filter(Boolean);
    const newest = times.sort((a, b) => toMs(a) - toMs(b)).pop();
    if (newest) updated.textContent = `${t.updated_label} ${formatDate(newest, t)}`;
  }
}

// ---------- Page drawing ----------
function currentRoute() {
  const path = location.hash.replace(/^#\/?/, "").split("?")[0];
  return ROUTES.find((r) => r.path === path) || ROUTES[0];
}

function render() {
  const route = currentRoute();
  const t = state.t;
  document.documentElement.lang = state.lang;
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t[node.dataset.i18n] ?? node.dataset.i18n;
  });
  buildSidebar(route.path);
  buildBottomNav(route.path);
  renderTopbar(route);

  destroyCharts();
  const view = document.getElementById("view");
  const samePage = state.lastPath === route.path;
  const keepScroll = samePage ? window.scrollY : 0; // a redraw on the same page must not jump to the top
  view.replaceChildren();
  // Short fade only when the page changes (not when a filter redraws it)
  view.classList.remove("enter");
  if (!samePage) {
    void view.offsetWidth; // restart the animation
    view.classList.add("enter");
  }
  state.lastPath = route.path;
  if (!state.summary) {
    if (state.loadError) view.append(el("p", "muted", t.load_error));
    else {
      const sk = el("div", "skeleton");
      sk.append(el("div"), el("div"), el("div"));
      view.append(sk);
    }
    return;
  }
  route.page.render(view, {
    t,
    summary: state.summary,
    economy: state.economy,
    hints: state.hints,
    lang: state.lang,
    theme: state.theme,
    range: state.range,
    setRange,
    setLang,
    setTheme,
    rerender: render,
  });
  view.focus({ preventScroll: true });
  if (samePage && keepScroll) window.scrollTo(0, keepScroll);
}

// ---------- Settings that re-draw the page ----------
async function setLang(lang) {
  state.lang = lang;
  save("lang", lang);
  state.t = await getJson(`i18n/${lang}.json`);
  render();
}
function setTheme(theme) {
  state.theme = theme;
  save("theme", theme);
  applyTheme();
  render(); // charts read colours from CSS, so redraw
}
async function setRange(days) {
  state.range = days;
  save("range", String(days));
  await ensureLong();
  render();
}

// 1 year / all ranges need the weekly history file (loaded once, only when asked for)
async function ensureLong() {
  if (!needsLong(state.range) || state.long) return;
  try {
    state.long = await getJson("data/long.json");
    setLongData(state.long);
  } catch {
    /* no long file: charts fall back to the ~100 days in summary.json */
  }
}

// ---------- Start ----------
async function start() {
  state.lang = load("lang", "th") === "lo" ? "lo" : "th";
  state.theme = load("theme", "dark") === "light" ? "light" : "dark";
  const savedRange = Number(load("range", "30"));
  state.range = RANGES.includes(savedRange) ? savedRange : 30;
  applyTheme();

  // Load texts and all data at the same time (faster). Economy / forecast are optional.
  const [texts, summary, eco, hints] = await Promise.allSettled([
    getJson(`i18n/${state.lang}.json`),
    getJson("data/summary.json"),
    getJson("data/economy.json"),
    getJson("data/forecast/hints.json"),
  ]);
  if (texts.status !== "fulfilled") {
    document.getElementById("view").textContent = "Error: " + texts.reason.message;
    return;
  }
  state.t = texts.value;
  if (summary.status === "fulfilled") state.summary = summary.value;
  else state.loadError = summary.reason;
  state.economy = eco.status === "fulfilled" ? eco.value : null;
  state.hints = hints.status === "fulfilled" ? hints.value : null;
  await ensureLong();

  openMenu(false);
  render();
}

menuBtn.addEventListener("click", () => openMenu(!sidebar.classList.contains("open")));
backdrop.addEventListener("click", () => openMenu(false));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") openMenu(false);
});
// Chart.js arrived late from the backup CDN (see index.html) → redraw so the charts appear
window.addEventListener("chartjs-ready", () => {
  if (state.t) render();
});
window.addEventListener("hashchange", () => {
  openMenu(false);
  window.scrollTo(0, 0);
  render();
});

start();
