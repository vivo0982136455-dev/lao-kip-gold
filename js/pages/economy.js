// Page: Lao economy, for investors (12 tabs). Owner request 2026-09-30: "think like an investor".
//   overview · compare · population · wages · GDP & structure · government plan 2026–2030 · policy ·
//   foreign investment · public debt · inflation & kip · rubber · land
// The order follows the questions an investor asks: how Laos stands next to its neighbours (compare: the same
// indicator and the same year for six countries), who lives and works here (population), what their work costs
// (wages, next to 16 other countries), what they produce (GDP), what the State wants (plan) and which rules it has
// set (policy), then money coming in (investment), money owed (debt), prices and the kip, and the two things the
// owner follows closely (rubber, land).
// Above the tab bar: a search box over the names of the tabs and the titles of their cards, and a button that
// opens the index of all twelve tabs with what each holds (js/pages/eco-index.js; audit 2026-10-02, P3-2) - the
// tab bar scrolls sideways on a phone and shows three or four tabs at a time.
// Yearly World Bank + IMF numbers come with the app (data/economy.json). The investor numbers (data/invest.json),
// the hand-checked plan targets, policy facts and report facts (data/invest-static.json), the population numbers
// (data/population.json), the comparison with the neighbours (data/compare.json), the wage numbers
// (data/wages.json), the official fuel prices (data/fuel-lao.json),
// the rubber files (data/thai-prices.json, rubber-world.json, rubber-borders.json,
// rubber-daily.json), the official land price decisions (data/land.json) and the owner's own prices
// (data/own-prices.json) load only when their tab is opened.
// The texts of the twelve tabs are a file of their own (i18n/<lang>/economy.json, audit 2026-10-02, P3-7): two thirds
// of all texts of the site, which the first screen does not need. The page loads the file when it is opened
// and adds it to the texts every other page has (tests/words.js keeps the two files apart).
// Past data and institutions' forecasts only - never investment advice.

import { el, emptyState } from "../ui.js";
import { mountCharts } from "../charts.js";
import { lazyJson } from "../lazy.js";
import { fill, pick } from "./eco-common.js";
import { TAB_HEADS, VIEW_CHOICE, viewName, textOf, isHeading, allHeads, find } from "./eco-index.js";
import { overviewTab } from "./eco-overview.js";
import { gdpTab } from "./eco-gdp.js";
import { planTab } from "./eco-plan.js";
import { fdiTab } from "./eco-fdi.js";
import { debtTab } from "./eco-debt.js";
import { inflationTab } from "./eco-inflation.js";
import { rubberTab } from "./eco-rubber.js";
import { landTab } from "./eco-land.js";
import { populationTab } from "./eco-population.js";
import { policyTab } from "./eco-policy.js";
import { wagesTab } from "./eco-wages.js";
import { compareTab } from "./eco-compare.js";

const TABS = [
  ["overview", overviewTab],
  ["compare", compareTab],
  ["population", populationTab],
  ["wages", wagesTab],
  ["gdp", gdpTab],
  ["plan", planTab],
  ["policy", policyTab],
  ["fdi", fdiTab],
  ["debt", debtTab],
  ["inflation", inflationTab],
  ["rubber", rubberTab],
  ["land", landTab],
];

function savedTab() {
  try {
    const v = localStorage.getItem("eco_tab");
    return TABS.some(([id]) => id === v) ? v : "overview";
  } catch {
    return "overview";
  }
}
let current = savedTab();

// The search box and the index: what is typed, whether the index is open, whether the box holds the cursor, and
// the heading to go to once its tab is drawn ({ tab, key, until: give up looking after this moment, shownAt: when
// it was first found - it stays the target while its mark is shown, because data that arrives redraws the tab })
const finder = { query: "", open: false, typing: false, target: null };
let unmark = null; // the timer that takes the mark away
const INDEX_SHOWS = 4; // titles named per tab in the index; the others are counted ("and 5 more")
const TARGET_WAIT_MS = 8000; // a tab whose data is still loading draws its cards a moment later
const FOUND_MS = 2500; // how long the card that was looked for stays marked
const TOPBAR_PX = 72; // room for the bar that stays at the top of the screen

// the texts of the page = the texts of every page + its own file (put together once per language)
let joined = { app: null, own: null, t: null };
function textsOf(app, own) {
  if (joined.app !== app || joined.own !== own) joined = { app, own, t: { ...app, ...own } };
  return joined.t;
}

export function render(view, page) {
  const words = lazyJson(`i18n/${page.lang}/economy.json`, page.rerender);
  if (words.state !== "ok") {
    if (words.state === "error") view.append(el("p", "muted", page.t.load_error));
    else {
      const sk = el("div", "skeleton");
      sk.append(el("div"), el("div"), el("div"));
      view.append(sk);
    }
    return;
  }
  const t = textsOf(page.t, words.data);
  const ctx = { ...page, t };
  if (!ctx.economy || !ctx.economy.indicators) {
    view.append(emptyState(t.eco_missing_title, t.eco_missing_text));
    return;
  }
  const invest = lazyJson("data/invest.json", ctx.rerender);
  const facts = lazyJson("data/invest-static.json", ctx.rerender);
  // the central bank's own numbers (newest inflation, reserves, policy rate): the resolvers of eco-latest.js use them
  const bank = lazyJson("data/bol-policy.json", ctx.rerender);

  // Switch tab, redraw, and bring the tab bar back into view if the page was scrolled down
  function select(id) {
    if (id === current) return;
    current = id;
    finder.open = false; // the index has done its work
    try {
      localStorage.setItem("eco_tab", id);
    } catch {
      /* private mode */
    }
    ctx.rerender();
    requestAnimationFrame(() => {
      const bar = document.querySelector(".tabbar");
      // (a heading that was looked for is scrolled to instead, see showTarget)
      if (!finder.target && bar && bar.getBoundingClientRect().top < 0) window.scrollTo(0, window.scrollY + bar.getBoundingClientRect().top - TOPBAR_PX);
      const btn = document.getElementById("tab-" + id);
      if (btn) btn.focus({ preventScroll: true });
    });
  }

  // e = everything a tab needs
  const e = {
    ...ctx,
    invest: invest.data,
    investState: invest.state,
    stat: facts.data,
    statState: facts.state,
    bank: bank.state === "ok" ? bank.data : null,
    bankState: bank.state,
    go: select,
  };

  view.append(el("p", "lead", t.inv_lead));

  // ---------- Find: a search box + the index of all tabs ----------
  const findRow = el("div", "tab-find");
  const box = el("input", "tab-search");
  box.type = "search";
  box.id = "tab-search";
  box.placeholder = t.eco_find_placeholder;
  box.setAttribute("aria-label", t.eco_find_label);
  box.setAttribute("aria-controls", "tab-index");
  box.autocomplete = "off";
  box.enterKeyHint = "search";
  box.value = finder.query;
  const all = el("button", "tab-index-btn", fill(t.eco_index_button, { n: TABS.length }));
  all.type = "button";
  all.setAttribute("aria-controls", "tab-index");
  const list = el("div", "tab-index");
  list.id = "tab-index";
  findRow.append(box, all);
  view.append(findRow, list);

  // Open a tab (and a view of it), then show the heading that was looked for
  function open(tab, tabView, key) {
    finder.query = "";
    finder.open = false;
    finder.typing = false;
    finder.target = key ? { tab, key, until: Date.now() + TARGET_WAIT_MS } : null;
    if (tabView && VIEW_CHOICE[tab]) pick(VIEW_CHOICE[tab], tabView);
    if (tab === current) ctx.rerender();
    else select(tab);
  }
  // One line of the index or of the results: a button with a title and a second line under it
  function item(title, under, onClick, isCurrent) {
    const li = el("li");
    const b = el("button", "tab-index-item");
    b.type = "button";
    b.append(el("strong", "", title));
    if (under) b.append(el("span", "tab-index-sub", under));
    if (isCurrent) b.setAttribute("aria-current", "true");
    b.addEventListener("click", onClick);
    li.append(b);
    return li;
  }
  const where = (h) => `${t["inv_tab_" + h.tab]}${h.view ? " · " + viewName(t, h.tab, h.view) : ""}`;
  function fillIndex() {
    const query = finder.query.trim();
    list.replaceChildren();
    all.setAttribute("aria-expanded", String(finder.open && !query));
    list.hidden = !query && !finder.open;
    if (list.hidden) return;
    const ul = el("ul", "tab-index-list");
    if (!query) {
      // the index: every tab with what it holds (its views, or the first titles of its cards)
      ul.classList.add("as-index");
      const heads = allHeads(t).filter((h) => !h.section);
      for (const [id] of TABS) {
        const views = Array.isArray(TAB_HEADS[id]) ? null : Object.keys(TAB_HEADS[id]);
        const titles = views ? views.map((v) => viewName(t, id, v)) : [...new Set(heads.filter((h) => h.tab === id).map((h) => h.title))];
        const shown = views ? titles : titles.slice(0, INDEX_SHOWS);
        const more = titles.length - shown.length;
        ul.append(item(t["inv_tab_" + id], shown.join(" · ") + (more > 0 ? ` · ${fill(t.eco_index_more, { n: more })}` : ""), () => open(id, null, null), id === current));
      }
      list.append(ul);
      return;
    }
    const found = find(t, query);
    const n = found.tabs.length + found.heads.length;
    const status = el("p", "tab-index-count", n ? fill(t.eco_find_count, { n }) : t.eco_find_none);
    status.setAttribute("role", "status");
    list.append(status);
    for (const id of found.tabs) ul.append(item(t["inv_tab_" + id], t.eco_find_tab, () => open(id, null, null), id === current));
    for (const h of found.heads) ul.append(item(h.title, where(h), () => open(h.tab, h.view, h.key), false));
    if (n) list.append(ul);
  }
  box.addEventListener("input", () => {
    finder.query = box.value;
    fillIndex();
  });
  box.addEventListener("focus", () => (finder.typing = true));
  box.addEventListener("blur", () => (finder.typing = false));
  box.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      const first = list.querySelector(".tab-index-item");
      if (first && finder.query.trim()) first.click();
    } else if (ev.key === "Escape" && (finder.query || finder.open)) {
      finder.query = box.value = "";
      finder.open = false;
      fillIndex();
    }
  });
  all.addEventListener("click", () => {
    finder.open = finder.query.trim() ? true : !finder.open;
    finder.query = box.value = "";
    fillIndex();
  });
  fillIndex();

  // Tab bar: scrolls sideways on phones; left/right arrow keys move between tabs
  const bar = el("div", "tabbar");
  bar.setAttribute("role", "tablist");
  bar.setAttribute("aria-label", t.inv_tabs_label);
  for (const [id] of TABS) {
    const b = el("button", "", t["inv_tab_" + id]);
    b.type = "button";
    b.id = "tab-" + id;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(id === current));
    b.setAttribute("aria-controls", "tabpanel");
    b.tabIndex = id === current ? 0 : -1;
    b.addEventListener("click", () => select(id));
    bar.append(b);
  }
  bar.addEventListener("keydown", (ev) => {
    if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft") return;
    ev.preventDefault();
    const i = TABS.findIndex(([id]) => id === current);
    const next = TABS[(i + (ev.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length][0];
    select(next);
  });
  view.append(bar);

  const panel = el("div", "tabpanel");
  panel.id = "tabpanel";
  panel.setAttribute("role", "tabpanel");
  panel.setAttribute("aria-labelledby", "tab-" + current);
  view.append(panel);
  TABS.find(([id]) => id === current)[1](panel, e);

  view.append(el("p", "note disclaimer", t.inv_disclaimer));
  mountCharts(view);

  // Keep the chosen tab visible inside the sideways-scrolling bar (without moving the page)
  const active = bar.querySelector('[aria-selected="true"]');
  if (active) bar.scrollLeft = Math.max(0, active.offsetLeft - (bar.clientWidth - active.offsetWidth) / 2);

  // A redraw while the reader is typing (data that arrived, a new day): the box keeps the cursor
  if (finder.typing) {
    requestAnimationFrame(() => {
      box.focus({ preventScroll: true });
      box.setSelectionRange(box.value.length, box.value.length);
    });
  }
  // The heading that was looked for: mark its card for a moment and scroll to it. A tab whose data is still on its
  // way has no cards yet - the next redraw (when the data is there) tries again, until the time is up. The mark
  // is put on here, in the redraw itself, so the card never stands without it while it is due; only the scroll
  // waits for the next frame, because js/app.js puts the page back where it was after a redraw of the same page.
  if (finder.target && finder.target.tab === current) {
    const target = finder.target;
    const text = textOf(t, target.key);
    const heads = [...panel.querySelectorAll("h2, h3, .stat-label")];
    const head = heads.find((h) => h.textContent.trim() === text) || heads.find((h) => isHeading(h.textContent, text));
    if (head && !target.shownAt) target.shownAt = Date.now();
    // looked for until target.until; once found, marked for FOUND_MS
    const left = (target.shownAt ? target.shownAt + FOUND_MS : target.until) - Date.now();
    if (left <= 0) finder.target = null;
    else if (head) {
      const card = head.closest(".card, .stat") || head;
      card.classList.add("found");
      clearTimeout(unmark);
      unmark = setTimeout(() => {
        card.classList.remove("found");
        if (finder.target === target) finder.target = null;
      }, left);
      requestAnimationFrame(() => {
        if (head.isConnected) window.scrollTo(0, Math.max(0, window.scrollY + head.getBoundingClientRect().top - TOPBAR_PX));
      });
    }
  } else if (finder.target && Date.now() > finder.target.until) finder.target = null; // its tab was left before it was found
}
