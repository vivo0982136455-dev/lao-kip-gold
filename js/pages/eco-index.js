// The index of the economy page: which headings every tab holds (audit 2026-10-02, P3-2: "an index of the tabs; a
// search box over tab and card titles"). The page has twelve tabs in a bar that scrolls sideways on a phone - the
// index shows all of them at once, with what is inside, and the search box finds a card by a word of its title.
//
// TAB_HEADS: tab -> the text keys (i18n) of its headings, in the order of the page. "§key" = the title of a section
// (a group of cards), "a.b" = a text inside a group of texts (provinces). The rubber tab has six views: one list
// each. A heading is listed whether or not today's data shows it; tests/states.js opens every tab and view in both
// languages and fails when the page shows a heading that is not listed here, tests/words.js fails when a listed
// key has no text or no page names it any more.
// After adding, renaming or removing a card: change the list of its tab here.

export const TAB_HEADS = {
  overview: ["inv_k_gdp", "inv_k_growth", "inv_k_gdppc", "inv_k_inflation", "inv_k_debt", "inv_k_reserves", "inv_k_fdi", "inv_k_kip", "inv_facts_title", "risk_title", "§inv_watch_title", "inv_watch_savings", "inv_watch_rubber", "inv_watch_land", "§dif_section", "dif_title"],
  compare: ["cmp_how_title", "cmp_gdp", "cmp_gdp_pc", "cmp_gdp_pc_ppp", "cmp_growth", "cmp_inflation", "cmp_debt", "cmp_ext_debt", "cmp_reserves", "cmp_fdi", "cmp_exports", "cmp_urban"],
  population: ["pop_k_total", "pop_k_working", "pop_k_young", "pop_k_old", "pop_k_urban", "pop_k_fertility", "pop_k_life", "pop_k_labour", "pop_meaning_title", "§pop_sec_spend", "pop_k_income", "pop_k_consumption", "pop_k_poverty", "pop_k_household", "§pop_sec_size", "pop_chart_total", "pop_ages_title", "pop_pyramid_title", "pop_nb_title", "§pop_sec_where", "pop_prov_title", "§pop_sec_work", "pop_work_chart", "pop_remit_chart", "pop_census_title"],
  wages: ["wg_k_lao", "wg_k_rank", "wg_k_thai", "wg_k_real", "wg_k_avg", "wg_k_review", "wg_meaning_title", "§wg_sec_today", "wg_today_title", "wg_th_title", "wg_how_title", "§wg_sec_time", "wg_trend_title", "wg_avg_title"],
  gdp: ["inv_k_gdp", "inv_k_growth", "inv_k_gdppc", "inv_k_gdppc_ppp", "inv_gdp_size_title", "eco_growth", "inv_gdppc_title", "inv_gdp_read_title", "inv_structure_title", "inv_structure_chart", "§inv_trade_section", "inv_trade_title", "eco_current_account", "inv_drivers_title"],
  plan: ["inv_plan_title"],
  policy: ["pol_k_rate", "pol_k_band", "pol_k_inflation", "pol_k_reserves", "pol_k_vat", "pol_k_fuel", "pol_k_wage", "pol_k_service", "pol_how_title", "pol_chart_title", "§pol_sec_rules", "pol_read_title", "pol_area_money", "pol_area_tax", "pol_area_fuel", "pol_area_wages", "pol_area_debt", "pol_area_trade", "pol_area_land", "§pol_sec_ahead", "pol_cal_title", "pol_outlook_title", "pol_advice_title"],
  fdi: ["inv_k_fdi", "inv_k_fdi_gdp", "inv_k_fdi_stock", "inv_k_fdi_total", "inv_fdi_chart", "inv_fdi_who", "inv_fdi_where_title"],
  debt: ["inv_k_debt", "inv_k_debt_ext_gov", "inv_k_debt_ext_all", "inv_k_debt_service_exports", "eco_debt", "inv_debt_who", "inv_debt_schedule", "inv_debt_facts_title", "§inv_debt_story", "inv_debt_why", "inv_debt_effects", "inv_debt_plan", "inv_debt_can", "dif_title"],
  inflation: ["inv_k_inflation", "inv_k_imf_year", "inv_k_infl_target", "inv_k_kip", "inv_infl_vs_kip", "infl_compare_title", "inv_infl_yearly", "eco_fx_avg", "inv_infl_why_title", "dif_title"],
  rubber: {
    market: ["inv_rub_world", "inv_rub_cuplump", "inv_rub_latex", "inv_rub_china", "inv_rub_world_chart", "inv_rub_thai_chart", "inv_rub_years_title", "inv_rub_notes_title"],
    buyers: ["rb_k_china", "rb_k_vietnam", "rb_k_vn_month", "rb_k_thailand", "rb_who_title", "rb_vn_chart", "rb_kinds_title", "rb_thai_title", "rb_m_nongkhai", "rb_m_chiangrai", "rb_m_all", "rb_thai_chart"],
    lao: ["rw_lao_prov_title", "rw_lao_prod_chart", "inv_rub_lao_title"],
    asean: ["rb_prices_title", "rw_asean_trade_title", "rw_prod_title"],
    world: ["rw_k_tsr20", "rw_k_rss3", "rw_k_world_prod", "rw_world_chart", "rw_top_title", "rw_top_prod_title"],
    mine: ["own_rubber_title", "own_rubber_list"],
  },
  land: ["§land_focus_title", "provinces.Vientiane Capital", "provinces.Louangphabang", "§land_all_title", "inv_land_official_title", "§land_mine_title", "own_land_title", "own_land_list", "inv_land_title", "inv_land_watch_title"],
};
// the choice (eco-common.js "choice") that holds the views of a tab
export const VIEW_CHOICE = { rubber: "rubber_view" };
// the text key of a view's own name
export const viewName = (t, tab, view) => (tab === "rubber" ? t["rw_view_" + view] : view);

// The text of a key: "inv_plan_title", or "provinces.Vientiane Capital" for a text inside a group
export function textOf(t, key) {
  const dot = key.indexOf(".");
  const text = dot < 0 ? t[key] : (t[key.slice(0, dot)] || {})[key.slice(dot + 1)];
  return typeof text === "string" ? text : "";
}

// A heading as a line of a list, where the number of the day is not known: a bracket that only holds such a
// number is left out, any other one becomes "…"
//   "พื้นที่ปลูกยาง รายแขวง (ปี {year})" -> "พื้นที่ปลูกยาง รายแขวง" · "พีระมิดอายุ ปี {year}" -> "พีระมิดอายุ ปี …"
export function plainTitle(text) {
  return text
    .replace(/\s*\([^()]*\{[a-z_0-9]+\}[^()]*\)/g, "")
    .replace(/\{[a-z_0-9]+\}/g, "…")
    .replace(/\s+/g, " ")
    .trim();
}

// Is this heading of the page made from this text? A placeholder stands for anything, and the page may add
// " (year)" or " · kind" after the text.
export function isHeading(heading, text) {
  if (!text) return false;
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("^" + text.split(/\{[a-z_0-9]+\}/).map(escape).join(".+?") + "(?: [(·].*)?$").test(heading.trim());
}

// Every heading of the index: [{ tab, view (null: the tab has none), key, section, title }]
export function allHeads(t) {
  const out = [];
  for (const [tab, heads] of Object.entries(TAB_HEADS)) {
    for (const [view, keys] of Array.isArray(heads) ? [[null, heads]] : Object.entries(heads)) {
      for (const k of keys) {
        const section = k.startsWith("§");
        const key = section ? k.slice(1) : k;
        out.push({ tab, view, key, section, title: plainTitle(textOf(t, key)) });
      }
    }
  }
  return out;
}

// Words typed into the search box -> the same text without capitals and double spaces
const norm = (s) => String(s).toLowerCase().normalize("NFC").replace(/\s+/g, " ").trim();

// What the search box finds for a query: the tabs whose name holds every word typed, and the headings whose title
// (or whose view's name) does. An empty query finds nothing.
//   -> { tabs: [tab], heads: [{ tab, view, key, section, title }] }
export function find(t, query) {
  const wanted = norm(query).split(" ").filter(Boolean);
  if (!wanted.length) return { tabs: [], heads: [] };
  const has = (text) => {
    const hay = norm(text);
    return wanted.every((w) => hay.includes(w));
  };
  const tabs = Object.keys(TAB_HEADS).filter((tab) => has(t["inv_tab_" + tab] || ""));
  const seen = new Set();
  const heads = allHeads(t).filter((h) => {
    if (!h.title || !(has(h.title) || (h.view && has(viewName(t, h.tab, h.view) || "")))) return false;
    const line = `${h.tab}|${h.view}|${h.title}`;
    if (seen.has(line)) return false; // a tile and a chart of one tab can carry the same title: one line, the first of them
    seen.add(line);
    return true;
  });
  return { tabs, heads };
}
