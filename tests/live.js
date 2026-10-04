// The LIVE site (GitHub Pages) with a fresh browser profile: install, saved copy, the new screens, and a real loss
// of connection (the browser goes through a local tunnel that is switched off). Nothing is sent to the owner's form.
// Usage: node tests/live.js   (run it a few minutes after a push, when GitHub Pages has published the update)
const path = require("path");
const { SHOTS, launch, startTunnel, sleep } = require("./browser.js");

const LIVE = "https://vivo0982136455-dev.github.io/lao-kip-gold/";
const OUT = SHOTS;
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log((ok ? "PASS  " : "FAIL  ") + name + (detail ? "  -> " + detail : ""));
};

const CHECK = `
  const out = { overflow: document.documentElement.scrollWidth - innerWidth, badText: [], placeholders: [], cards: document.querySelectorAll("#view .card").length };
  const walker = document.createTreeWalker(document.getElementById("view"), NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = walker.currentNode.nodeValue;
    if (/\\bundefined\\b|\\bNaN\\b|\\[object |\\bnull\\b|Infinity/.test(text)) out.badText.push(text.trim().slice(0, 60));
    if (/\\{[a-z_0-9]+\\}/.test(text)) out.placeholders.push(text.trim().slice(0, 60));
  }
  return out;
`;

(async () => {
  const tunnel = await startTunnel(8877);
  const browser = await launch({ port: 9342, args: ["--proxy-server=http://127.0.0.1:8877"] });
  try {
    const page = await browser.newPage({ width: 380, height: 820 });

    // ---------- first visit ----------
    await page.goto(LIVE + "#/settings", 1500);
    const scope = await page.eval(`const r = await Promise.race([navigator.serviceWorker.ready, new Promise((x) => setTimeout(() => x(null), 15000))]); return r && r.scope;`);
    check("live: service worker registered", scope === LIVE, String(scope));
    await sleep(8000);
    const saved = await page.eval(`const out = {}; for (const k of await caches.keys()) { const c = await caches.open(k); out[k] = (await c.keys()).length; } return out;`);
    check("live: files saved after the first visit", saved["lkg-site-1"] >= 35 && saved["lkg-libs-1"] >= 4, JSON.stringify(saved));
    const man = await page.s("Page.getAppManifest");
    check("live: manifest without errors", !!man.url && (man.errors || []).length === 0, man.url + " " + JSON.stringify(man.errors));
    const inst = await page.s("Page.getInstallabilityErrors");
    check("live: installable (no installability errors)", (inst.installabilityErrors || []).length === 0, JSON.stringify(inst.installabilityErrors));
    const card = await page.eval(`const c = document.querySelector(".install-card"); return c ? { text: c.innerText.slice(0, 40), button: !!c.querySelector(".btn-primary") } : null;`);
    check("live: install card on the Settings page", !!card && card.text.includes("ติดตั้งเป็นแอป"), JSON.stringify(card));
    console.log("   (the gold install button is there = the browser really offered to install: " + (card && card.button) + ")");
    await page.eval(`document.querySelector(".install-card").scrollIntoView({ block: "center" });`);
    await sleep(300);
    await page.shot(path.join(OUT, "live-settings-380.png"));

    // ---------- a few screens of the new parts ----------
    const open = async (store, hash, tag) => {
      await page.eval(`const v = ${JSON.stringify(store)}; for (const k of Object.keys(v)) localStorage.setItem(k, v[k]);`);
      await page.goto(`${LIVE}?c=${tag}#/${hash}`, 300);
      await page.until(`!document.querySelector(".skeleton") && document.querySelectorAll("#view .card").length > 0 && !document.getElementById("view").innerText.includes("กำลังโหลดข้อมูล")`, 20000);
      await sleep(900);
      return page.eval(CHECK);
    };
    for (const [name, store, hash] of [
      ["overview", {}, "overview"],
      ["gold", {}, "gold"],
      ["living", {}, "living"],
      ["economy overview", { eco_tab: "overview" }, "economy"],
      ["compare with the neighbours", { eco_tab: "compare" }, "economy"],
      ["population", { eco_tab: "population" }, "economy"],
      ["wages", { eco_tab: "wages" }, "economy"],
      ["plan", { eco_tab: "plan" }, "economy"],
      ["policy", { eco_tab: "policy" }, "economy"],
      ["foreign investment", { eco_tab: "fdi" }, "economy"],
      ["debt", { eco_tab: "debt" }, "economy"],
      ["rubber market", { eco_tab: "rubber", eco_rubber_view: "market" }, "economy"],
      ["rubber who buys", { eco_tab: "rubber", eco_rubber_view: "buyers" }, "economy"],
      ["rubber by province", { eco_tab: "rubber", eco_rubber_view: "lao" }, "economy"],
      ["rubber ASEAN", { eco_tab: "rubber", eco_rubber_view: "asean" }, "economy"],
      ["rubber world", { eco_tab: "rubber", eco_rubber_view: "world" }, "economy"],
      ["rubber own prices", { eco_tab: "rubber", eco_rubber_view: "mine" }, "economy"],
      ["land", { eco_tab: "land" }, "economy"],
      ["inflation", { eco_tab: "inflation" }, "economy"],
      ["method", {}, "method"],
    ]) {
      const r = await open(store, hash, name.replace(/ /g, ""));
      check("live screen: " + name, r.cards > 0 && r.overflow <= 0 && !r.badText.length && !r.placeholders.length, JSON.stringify(r));
    }
    // the policy tab shows the central bank's own numbers (read on GitHub's servers every week), not a failed copy
    await open({ eco_tab: "policy" }, "economy", "policyrate");
    const lever = await page.eval(`const tile = document.querySelector("#view .stats .stat"); return tile ? { value: tile.querySelector(".stat-value").textContent, label: tile.querySelector(".fresh").textContent, charts: document.querySelectorAll("#view canvas").length } : null;`);
    check("live: policy tab - policy rate from the central bank's page, with its chart", !!lever && /^\d+(\.\d+)?%$/.test(lever.value) && !lever.label.includes("⚠") && lever.charts === 1, JSON.stringify(lever));
    // ... and the numbers that update themselves: the bank's reserves, the fuel price of the newest notice (4 labels),
    // none of them a failed copy, and the card that says what is read by hand
    const auto = await page.eval(`return { labels: document.querySelectorAll("#view .tag-auto").length, read: !!document.querySelector("#view .policy-read"), failed: document.querySelectorAll("#view .fresh-stale").length };`);
    check("live: policy tab - reserves and fuel price update themselves, nothing failed", auto.labels >= 4 && auto.read && auto.failed === 0, JSON.stringify(auto));
    // plan tab (audit 2026-10-02): a number from before the plan's first year is a baseline, never met / near / far;
    // the summary line counts every target once
    await open({ eco_tab: "plan" }, "economy", "planrows");
    await sleep(800);
    const plan = await page.eval(`const rows = [...document.querySelectorAll("#view .plan-table tbody tr")].map((tr) => ({ year: Number(((tr.querySelector(".plan-actual .fresh") || { textContent: "" }).textContent.match(/20\\d\\d/) || [0])[0]), status: [...tr.querySelectorAll(".status")].map((s) => s.className.replace("status status-", "")), byForecast: !!tr.querySelector(".plan-actual .status + .sub-line") })); const first = (await (await fetch("data/invest-static.json")).json()).plan.period[0]; const summary = ([...document.querySelectorAll("#view .card p.note")].map((p) => p.textContent).find((x) => /\\d+ .*: .*\\d/.test(x)) || "").match(/\\d+/g) || []; return { rows: rows.length, first, early: rows.filter((r) => r.year && r.year < first && !r.byForecast && r.status.some((s) => ["met", "near", "far"].includes(s))).length, summary: summary.map(Number), twoWays: rows.filter((r) => r.status.length === 2).length };`);
    check("live: plan tab - no status from a number before the plan, the summary adds up", plan.rows >= 10 && plan.first > 2000 && plan.early === 0 && plan.summary[0] === plan.rows && plan.summary.slice(1).reduce((a, b) => a + b, 0) === plan.rows, JSON.stringify(plan));
    // foreign investment: UNCTAD's total (unpacked from a .7z file on GitHub's servers) is there and did not fail
    await open({ eco_tab: "fdi" }, "economy", "fditotal");
    const fdi = await page.eval(`return { tiles: document.querySelectorAll("#view .stats .stat").length, unctad: [...document.querySelectorAll("#view .card p.note")].some((p) => p.textContent.includes("UNCTAD") && /\\d+%/.test(p.textContent)), failed: document.querySelectorAll("#view .fresh-stale").length };`);
    check("live: foreign investment - UNCTAD's total next to the reported amounts, nothing failed", fdi.tiles === 4 && fdi.unctad && fdi.failed === 0, JSON.stringify(fdi));
    // cost of living: the official Lao fuel prices, read on GitHub's servers from the ministry's notices
    await open({}, "living", "fuel");
    const fuel = await page.eval(`const c = [...document.querySelectorAll("#view .card")].find((x) => x.querySelector(".fuel-notice")); return c ? { rows: c.querySelectorAll(".row").length, provinces: c.querySelectorAll(".fuel-provinces tbody tr").length, failed: c.querySelectorAll(".fresh-stale").length, from: c.querySelector(".fuel-notice").textContent.slice(0, 60) } : null;`);
    check("live: cost of living - official Lao fuel prices and every province", !!fuel && fuel.rows >= 2 && fuel.provinces >= 15 && fuel.failed === 0, JSON.stringify(fuel));
    // wages: all 17 countries with a dollar amount for every country that has a minimum wage
    await open({ eco_tab: "wages" }, "economy", "wagerows");
    const wage = await page.eval(`const rows = [...document.querySelectorAll("#view .wage-table tbody tr")]; return { rows: rows.length, dollars: rows.filter((tr) => /[0-9]/.test(tr.cells[1].textContent)).length, charts: document.querySelectorAll("#view canvas").length, failed: document.querySelectorAll("#view .fresh-stale").length };`);
    check("live: wages tab - 17 countries, dollars for 16, the ILO chart", wage.rows === 17 && wage.dollars >= 15 && wage.charts === 1 && wage.failed === 0, JSON.stringify(wage));
    // ---------- audit 2026-10-02, group P1 ----------
    // P1-5: the official rate is read from the central bank's own page on GitHub's servers, and Settings says so;
    // the API rate is called a reference rate
    await open({}, "settings", "route");
    const route = await page.eval(`const items = [...document.querySelectorAll("#view .status-item")]; const bol = items.find((x) => x.textContent.includes("Bank of the Lao PDR")); const fx = items.find((x) => x.textContent.includes("open.er-api.com")); return { route: bol && bol.querySelector(".status-route") ? bol.querySelector(".status-route").textContent : "", failed: bol ? !!bol.querySelector(".error-text") : null, fx: fx ? fx.querySelector(".status-top").firstChild.textContent : "", chip: fx && fx.querySelector(".chip") ? fx.querySelector(".chip").textContent : "" };`);
    check("live: settings - the official rate comes straight from the central bank's page, and the page says so", route.route.includes("อ่านตรงจากเว็บ BOL") && route.failed === false, JSON.stringify(route));
    check("live: settings - the API rate is a reference rate, not a market rate", /^Reference mid rate/.test(route.fx) && route.chip === "อ้างอิง", JSON.stringify(route));
    await open({}, "rates", "apirate");
    const api = await page.eval(`const c = [...document.querySelectorAll("#view .card")].find((x) => x.dataset.kind === "reference"); return c ? c.querySelector(".card-head").textContent : "";`);
    check("live: rates page - the card of the API rate has its own name", api.includes("อัตรากลางอ้างอิง (API)"), api);
    // P1-6: Laos next to its neighbours - every row names its year, another year than the card's is marked
    await open({ eco_tab: "compare" }, "economy", "comparerows");
    const cmp = await page.eval(`const cards = [...document.querySelectorAll("#view .compare-card")]; const rows = cards.flatMap((c) => [...c.querySelectorAll("tbody tr")].map((tr) => ({ card: c.dataset.year, value: tr.cells[1].textContent.trim(), year: (tr.cells[2].textContent.match(/(19|20)\\d\\d/) || [""])[0], marked: !!tr.cells[2].querySelector(".cmp-year-off") }))); return { cards: cards.length, rows: rows.length, noYear: rows.filter((r) => r.value !== "—" && !r.year).length, unmarked: rows.filter((r) => r.year && r.year !== r.card && !r.marked).length, marked: rows.filter((r) => r.marked).length, failed: document.querySelectorAll("#view .fresh-stale").length };`);
    check("live: compare tab - 11 indicators x 6 countries, a year in every row, other years marked, nothing failed", cmp.cards === 11 && cmp.rows === 66 && cmp.noYear === 0 && cmp.unmarked === 0 && cmp.failed === 0, JSON.stringify(cmp));
    // P1-3: the GDP tab says which prices a number is in, and shows GDP per person at purchasing power
    await open({ eco_tab: "gdp" }, "economy", "gdpprices");
    const gdp = await page.eval(`const tiles = [...document.querySelectorAll("#view .stats .stat")].map((x) => x.textContent); return { current: tiles.filter((x) => x.includes("ราคาปัจจุบัน")).length, constant: tiles.filter((x) => x.includes("ราคาคงที่")).length, ppp: tiles.filter((x) => x.includes("PPP")).length, charts: document.querySelectorAll("#view canvas").length, failed: document.querySelectorAll("#view .fresh-stale").length };`);
    check("live: GDP tab - current prices, constant prices and PPP named on the tiles", gdp.current >= 2 && gdp.constant >= 1 && gdp.ppp === 1 && gdp.charts >= 4 && gdp.failed === 0, JSON.stringify(gdp));
    // P1-4: a number of an earlier year does not carry the "latest" tick - it says how far behind it is
    await open({ eco_tab: "overview" }, "economy", "freshness");
    const fresh = await page.eval(`const year = new Date().getFullYear(); const tiles = [...document.querySelectorAll("#view .stats .stat")].map((x) => ({ text: x.querySelector(".fresh") ? x.querySelector(".fresh").textContent : "", tick: !!x.querySelector(".fresh-ok"), behind: !!x.querySelector(".fresh-behind, .fresh-old") })); const old = tiles.filter((x) => { const y = (x.text.match(/(19|20)\\d\\d/) || [""])[0]; return y && Number(y) < year - 1; }); return { tiles: tiles.length, old: old.length, oldWithTick: old.filter((x) => x.tick && !/ตรวจ/.test(x.text)).length, oldWithAge: old.filter((x) => x.behind).length, differ: !!document.querySelector("#view .differ-card") };`);
    check("live: economy overview - an older year shows its age, never the 'latest' tick; the 'why numbers differ' card is there", fresh.tiles >= 6 && fresh.oldWithTick === 0 && fresh.old === fresh.oldWithAge && fresh.differ, JSON.stringify(fresh));
    // P1-8: the head count is not called a market; what people can spend has its own tiles
    await open({ eco_tab: "population" }, "economy", "spending");
    const pop = await page.eval(`const text = [...document.querySelectorAll("#view li, #view p, #view .stat")].map((x) => x.textContent); const h = [...document.querySelectorAll("#view h2.section-title")].find((x) => x.nextElementSibling && x.nextElementSibling.nextElementSibling && x.nextElementSibling.nextElementSibling.classList.contains("stats")); return { market: text.filter((x) => x.includes("ตลาด") && x.includes("ล้านคน")).length, tiles: h ? h.nextElementSibling.nextElementSibling.querySelectorAll(".stat").length : 0 };`);
    check("live: population tab - no head count called a market, four tiles on what people can spend", pop.market === 0 && pop.tiles === 4, JSON.stringify(pop));
    // P1-9: the kip hint shows a percentage only with 20 checked cases or more
    await open({}, "forecast", "hintcases");
    const hint = await page.eval(`const tiles = [...document.querySelectorAll("#view .stats .stat")].slice(0, 2).map((x) => ({ value: x.querySelector(".stat-value").textContent, sub: x.querySelector(".stat-sub") ? x.querySelector(".stat-sub").textContent : "" })); return tiles.map((x) => ({ ...x, n: Number((x.sub.match(/\\d+/) || ["0"])[0]) }));`);
    check("live: kip hint - a percentage only from 20 checked cases", hint.length === 2 && hint.every((x) => (/^\d+%$/.test(x.value) ? x.n >= 20 : x.value === "กรณียังไม่พอ")), JSON.stringify(hint));
    // ---------- audit 2026-10-02, group P2 ----------
    // P2-9: the page's policy is in force and refused nothing so far; the chart library carries its hash
    const policy = await page.eval(`const m = document.querySelector('meta[http-equiv="Content-Security-Policy"]'); const s = [...document.scripts].filter((x) => /chart\\.umd\\.min\\.js/.test(x.src)); return { policy: m ? m.content.slice(0, 40) : "", inline: [...document.scripts].filter((x) => !x.src).length, hashes: s.map((x) => x.integrity.slice(0, 13)), chart: typeof Chart };`);
    const refused = page.errors.filter((e) => /Content Security Policy|Refused to|violates the following/i.test(e));
    check("live: the page's policy is in force, refused nothing, and the chart library is checked by its hash", policy.policy.startsWith("default-src 'self'") && policy.inline === 0 && policy.hashes.length >= 1 && policy.hashes.every((h) => h.startsWith("sha512-")) && policy.chart === "function" && refused.length === 0, JSON.stringify(policy) + " " + refused.slice(0, 2).join(" || "));
    // P2-8: the method page, and every source of every data file on the Settings page
    const methodPage = await open({}, "method", "method");
    const sections = await page.eval(`return document.querySelectorAll("#view .method-card").length;`);
    check("live: method page - how every number is worked out", sections === 11 && !methodPage.badText.length && !methodPage.placeholders.length, sections + " sections " + JSON.stringify(methodPage));
    await open({}, "settings", "sources");
    await page.until(`document.querySelectorAll("#view .src-group").length > 0`, 20000);
    const allSources = await page.eval(`const g = [...document.querySelectorAll("#view .src-group")]; return { groups: g.length, sources: document.querySelectorAll("#view .src-item").length, failed: g.filter((x) => x.querySelector(".badge-bad")).map((x) => x.querySelector(".src-group-title").textContent.slice(0, 30)), dated: [...document.querySelectorAll("#view .src-meta")].filter((x) => /\\d/.test(x.textContent)).length };`);
    check("live: settings - every source of every data file, with its dates, nothing failed", allSources.groups === 15 && allSources.sources >= 75 && allSources.failed.length === 0 && allSources.dated >= 60, JSON.stringify(allSources));
    // P2-1: the gold premium is like for like; the multiplier of the estimate is named as such
    await open({}, "gold", "premium");
    const premium = await page.eval(`return [...document.querySelectorAll('#view .card[data-kind="estimated"] .row')].map((x) => x.innerText.replace(/\\s+/g, " ")).slice(-2);`);
    check("live: gold - premium per gram of fine gold, and the multiplier under its own name", premium.length === 2 && /[+−]\d+\.\d%/.test(premium[0]) && /× \d\.\d{3}/.test(premium[1]), premium.join(" | "));
    // P2-2, P2-6: the kip tile shows the kip's own change; the yearly rate has dollar / baht / yuan and two lines
    await open({ eco_tab: "inflation", eco_fx_cur: "THB" }, "economy", "kip");
    const kip = await page.eval(`const bar = document.querySelector("#view .stack > .choice"); const c = bar ? bar.parentElement.querySelector(".chart-card") : null; return { buttons: bar ? bar.querySelectorAll("button").length : 0, lines: c ? c.querySelectorAll(".readout-row").length : 0, line: [...document.querySelectorAll("#view .readout-label")].some((x) => x.textContent.includes("ดอลลาร์แพงขึ้น")), old: document.getElementById("view").innerText.includes("กีบอ่อนค่าเทียบ USD") };`);
    check("live: inflation tab - 'dollar dearer' line, yearly rate for dollar / baht / yuan as two lines", kip.buttons === 3 && kip.lines === 2 && kip.line && !kip.old, JSON.stringify(kip));
    // P2-5, P2-6: the debt charts rest on this year, name the peak, and show the World Bank's count
    await open({ eco_tab: "debt" }, "economy", "debtcharts");
    const debtCharts = await page.eval(`return { now: [...document.querySelectorAll("#view .readout-when")].filter((x) => x.textContent.includes("ปัจจุบัน")).length, peak: document.querySelectorAll("#view .readout-peak").length, lines: document.querySelector("#view .chart-card").querySelectorAll(".readout-row").length };`);
    check("live: debt tab - read-outs rest on this year, the peak is named, two counts of the debt", debtCharts.now === 2 && debtCharts.peak === 1 && debtCharts.lines === 5, JSON.stringify(debtCharts));
    // P2-3: a multiple of Laos' average earnings only from Laos' own year
    await open({ eco_tab: "wages" }, "economy", "avgyear");
    const avg = await page.eval(`const c = [...document.querySelectorAll("#view .card")].filter((x) => x.querySelector(".bar-cell") && !x.querySelector(".wage-table")).pop(); const head = c ? c.querySelector("thead").innerText : ""; const cells = c ? [...c.querySelectorAll("tbody tr")].map((tr) => tr.cells[2].innerText.replace(/\\s+/g, " ")) : []; return { head: head.replace(/\\s+/g, " "), dashes: cells.filter((x) => x === "—").length, same: cells.filter((x) => /USD/.test(x)).length, rows: cells.length };`);
    check("live: wages tab - 'times Laos' from one year only (others show the value of that year or a dash)", /\(.*20\d\d\)/.test(avg.head) && avg.rows >= 14 && avg.same >= 3 && avg.dashes >= 3, JSON.stringify(avg));
    // P2-11, P2-10: the risk card (numbers only); every neighbour's number names its year; sold against produced
    await open({ eco_tab: "overview" }, "economy", "risk");
    const risk = await page.eval(`const c = document.querySelector("#view .risk-card"); return c ? [...c.querySelectorAll("li")].map((x) => /\\d/.test(x.textContent)) : [];`);
    check("live: economy overview - risk card, every line with its numbers", risk.length === 4 && risk.every(Boolean), JSON.stringify(risk));
    await open({ eco_tab: "population" }, "economy", "nbyears");
    const nb = await page.eval(`return document.querySelectorAll("#view .cmp-year").length;`);
    check("live: population tab - every number of the neighbours' table names its year", nb >= 24, nb + " years shown");
    await open({ eco_tab: "rubber", eco_rubber_view: "lao" }, "economy", "sold");
    await page.until(`document.getElementById("view").innerText.includes("ทำไมขายออกมากกว่าที่ผลิต")`, 10000);
    const sold = await page.eval(`return document.getElementById("view").innerText.includes("ทำไมขายออกมากกว่าที่ผลิต");`);
    check("live: rubber - why more is recorded as sold than as produced", sold);

    // the "who buys" view has its two data files (buyers per year, daily border markets)
    await open({ eco_tab: "rubber", eco_rubber_view: "buyers", eco_rubber_border_kind: "cuplump" }, "economy", "buyers");
    const buyers = await page.eval(`return { tiles: document.querySelectorAll("#view .stat").length, charts: document.querySelectorAll("#view canvas").length, failed: document.getElementById("view").innerText.includes("⚠") };`);
    check("live: rubber 'who buys' view - buyers, border months and the two Thai border markets", buyers.tiles >= 7 && buyers.charts === 2 && !buyers.failed, JSON.stringify(buyers));
    // the price of every country: complete only when all its files arrived (Laos 2, Thailand 3, Malaysia 2, Viet Nam,
    // Indonesia, Cambodia, Myanmar, Philippines, China 2, world 2 = 16 rows)
    await open({ eco_tab: "rubber", eco_rubber_view: "asean" }, "economy", "prices");
    const priceRows = await page.eval(`const tb = document.querySelector("#view .card table"); return tb ? tb.querySelectorAll("tbody tr").length : 0;`);
    check("live: rubber price of every country - Laos, ASEAN, China, world", priceRows >= 14, priceRows + " rows");
    // one menu button on phones: the "more" tab of the bottom bar (no second button in the top bar)
    const menu = await page.eval(`return { top: !!document.getElementById("menu-btn"), more: !!document.getElementById("more-btn") };`);
    check("live: one menu button (bottom bar), none in the top bar", !menu.top && menu.more, JSON.stringify(menu));

    // the entry form knows the new questions (no "question missing" line), nothing is sent
    await open({ eco_tab: "rubber", eco_rubber_view: "mine" }, "economy", "form");
    await page.eval(`document.querySelector(".own-rubber .btn-primary").click();`);
    await page.until(`document.querySelector(".own-rubber .up-panel")`, 5000);
    await sleep(1500);
    await page.eval(`const i = document.querySelector(".own-rubber .up-grid input[inputmode='numeric']"); i.value = "18500"; i.dispatchEvent(new Event("input", { bubbles: true }));`);
    await sleep(300);
    const form = await page.eval(`const p = document.querySelector(".own-rubber"); return { checks: [...p.querySelectorAll(".up-check")].map((x) => x.textContent).join(" / "), save: p.querySelector(".up-panel .btn-primary").disabled ? "disabled" : "enabled" };`);
    check("live: rubber entry form ready (questions found in the real form)", form.save === "enabled" && form.checks.startsWith("✓"), JSON.stringify(form));
    // a price far from the Thai price of the day is refused with the bot's own limits (nothing is sent)
    await page.eval(`const i = document.querySelector(".own-rubber .up-grid input[inputmode='numeric']"); i.value = "150000"; i.dispatchEvent(new Event("input", { bubbles: true }));`);
    await sleep(300);
    const far = await page.eval(`const p = document.querySelector(".own-rubber"); return { bad: [...p.querySelectorAll(".up-check.bad")].map((x) => x.textContent).join(" / "), disabled: p.querySelector(".up-panel .btn-primary").disabled };`);
    check("live: rubber entry form refuses a price far from that day's Thai price", far.disabled && /\d/.test(far.bad), JSON.stringify(far));
    await page.eval(`[...document.querySelectorAll(".own-rubber .up-actions button")].pop().click();`);

    // ---------- second visit: through the worker ----------
    await page.goto(LIVE + "?second=1#/overview", 2000);
    const second = await page.eval(`return { controlled: !!navigator.serviceWorker.controller, chip: !!document.querySelector(".offline-chip"), updated: document.getElementById("topbar-updated").textContent };`);
    check("live: second visit runs through the worker, no offline label", second.controlled && !second.chip, JSON.stringify(second));

    // ---------- the connection is lost ----------
    tunnel.off();
    await page.goto(LIVE + "?lost=1#/overview", 3000);
    await page.until(`document.querySelectorAll("#view .card").length > 3`, 20000);
    const off = await page.eval(`return { chip: document.querySelector(".offline-chip") ? document.querySelector(".offline-chip").textContent : null, cards: document.querySelectorAll("#view .card").length, charts: document.querySelectorAll("#view canvas").length, chartLib: typeof Chart, updated: document.getElementById("topbar-updated").textContent };`);
    check("live, no connection: the app opens from the saved copy with the offline label", off.chip === "ออฟไลน์" && off.cards > 3 && off.chartLib === "function", JSON.stringify(off));
    await page.shot(path.join(OUT, "live-offline-380.png"));
    await page.goto(LIVE + "?lost=2#/economy", 2500);
    const offEco = await page.eval(`return { cards: document.querySelectorAll("#view .card").length, chip: !!document.querySelector(".offline-chip") };`);
    check("live, no connection: economy page opens too", offEco.cards > 1 && offEco.chip, JSON.stringify(offEco));

    // ---------- the connection is back ----------
    tunnel.on();
    await page.eval(`window.dispatchEvent(new Event("online"));`);
    const cleared = await page.until(`!document.querySelector(".offline-chip")`, 15000);
    check("live: label goes away by itself when the connection is back", cleared);

    const errs = page.errors.filter((e) => !/cdnjs|net::ERR|Failed to load resource/.test(e));
    check("live: no unexpected console errors", errs.length === 0, errs.slice(0, 5).join(" || "));
    console.log("   tunnels opened by the browser:", tunnel.tunnels);
  } catch (e) {
    check("live test run", false, e.stack || String(e));
  } finally {
    await browser.close();
    tunnel.close();
  }
  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
