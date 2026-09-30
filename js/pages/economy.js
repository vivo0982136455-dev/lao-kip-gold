// Page: Lao economy, for investors (8 tabs). Owner request 2026-09-30: "think like an investor".
//   overview · GDP & structure · government plan 2026–2030 · foreign investment · public debt · inflation & kip · rubber · land
// Yearly World Bank + IMF numbers come with the app (data/economy.json). The investor numbers (data/invest.json),
// the hand-checked plan targets and report facts (data/invest-static.json) and the Thai rubber prices
// (data/thai-prices.json) load only when this page is opened. Past data only - never investment advice.

import { el, emptyState } from "../ui.js";
import { mountCharts } from "../charts.js";
import { lazyJson } from "../lazy.js";
import { overviewTab } from "./eco-overview.js";
import { gdpTab } from "./eco-gdp.js";
import { planTab } from "./eco-plan.js";
import { fdiTab } from "./eco-fdi.js";
import { debtTab } from "./eco-debt.js";
import { inflationTab } from "./eco-inflation.js";
import { rubberTab, landTab } from "./eco-rubber.js";

const TABS = [
  ["overview", overviewTab],
  ["gdp", gdpTab],
  ["plan", planTab],
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

export function render(view, ctx) {
  const { t } = ctx;
  if (!ctx.economy || !ctx.economy.indicators) {
    view.append(emptyState(t.eco_missing_title, t.eco_missing_text));
    return;
  }
  const invest = lazyJson("data/invest.json", ctx.rerender);
  const facts = lazyJson("data/invest-static.json", ctx.rerender);

  // Switch tab, redraw, and bring the tab bar back into view if the page was scrolled down
  function select(id) {
    if (id === current) return;
    current = id;
    try {
      localStorage.setItem("eco_tab", id);
    } catch {
      /* private mode */
    }
    ctx.rerender();
    requestAnimationFrame(() => {
      const bar = document.querySelector(".tabbar");
      if (bar && bar.getBoundingClientRect().top < 0) window.scrollTo(0, window.scrollY + bar.getBoundingClientRect().top - 72);
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
    go: select,
  };

  view.append(el("p", "lead", t.inv_lead));

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
}
