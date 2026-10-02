// The states the big matrix does not reach: every year x kind of rubber x seller/buyer choice, every road class of
// the land table, every kind of rubber of the Thai border markets, every "see the effect" button of the policy tab,
// the wages tab (all countries, without exchange rates, after the next rises), the official fuel card and the policy
// tab with and without the files that update themselves, and the two entry forms opened and filled in (NOT saved:
// requests to Google are blocked here).
// Usage: node tests/states.js
const fs = require("fs");
const path = require("path");
const { ROOT, SHOTS, launch, startSite, sleep } = require("./browser.js");
const PORT = 8098;
const BASE = `http://127.0.0.1:${PORT}/`;
const LOADING = { th: "กำลังโหลดข้อมูล", lo: "ກຳລັງໂຫຼດຂໍ້ມູນ" };

const CHECK = `
  const out = { overflow: document.documentElement.scrollWidth - innerWidth, wide: [], badText: [], placeholders: [], cards: document.querySelectorAll("#view .card").length };
  const vw = innerWidth;
  const inScroller = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { if (/(auto|scroll)/.test(getComputedStyle(p).overflowX)) return true; } return false; };
  for (const el of document.querySelectorAll("#view *, .topbar *")) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if ((r.right > vw + 1 || r.left < -1) && !inScroller(el)) out.wide.push(el.tagName.toLowerCase() + "." + String(el.className).slice(0, 30) + ": " + (el.textContent || "").trim().slice(0, 40) + " [" + Math.round(r.left) + ".." + Math.round(r.right) + "]");
  }
  const walker = document.createTreeWalker(document.getElementById("view"), NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = walker.currentNode.nodeValue;
    if (!text.trim()) continue;
    if (/\\bundefined\\b|\\bNaN\\b|\\[object |\\bnull\\b|Infinity/.test(text)) out.badText.push(text.trim().slice(0, 80));
    if (/\\{[a-z_0-9]+\\}/.test(text)) out.placeholders.push(text.trim().slice(0, 80));
  }
  for (const box of document.querySelectorAll("#view .stat, #view .card")) {
    if (box.scrollWidth > box.clientWidth + 2) out.wide.push("wider than its box: " + (box.className || "") + ": " + (box.textContent || "").trim().slice(0, 40) + " [" + box.scrollWidth + " > " + box.clientWidth + "]");
  }
  out.wide = out.wide.slice(0, 4);
  return out;
`;

(async () => {
  const site = await startSite(ROOT, PORT);
  const browser = await launch({ port: 9337 });
  let bad = 0;
  let states = 0;
  const report = (name, r, extra = "") => {
    const problems = [];
    if (r.overflow > 0) problems.push("sideways scroll " + r.overflow);
    if (r.wide.length) problems.push("outside: " + r.wide.join(" | "));
    if (r.badText.length) problems.push("bad text: " + [...new Set(r.badText)].slice(0, 4).join(" | "));
    if (r.placeholders.length) problems.push("placeholder: " + [...new Set(r.placeholders)].slice(0, 3).join(" | "));
    if (!r.cards) problems.push("no cards");
    states++;
    if (problems.length) {
      bad++;
      console.log("FAIL " + name + "\n       " + problems.join("\n       "));
    } else if (extra) console.log("ok   " + name + "  " + extra);
  };
  try {
    const page = await browser.newPage({ width: 380, height: 820 });
    await page.s("Network.setBlockedURLs", { urls: ["*docs.google.com*", "*google.com/forms*"] });
    let n = 0;
    const open = async (lang, store, hash = "economy") => {
      await page.eval(`const v = ${JSON.stringify({ lang, theme: "dark", ...store })}; for (const k of Object.keys(v)) localStorage.setItem(k, v[k]);`);
      await page.goto(`${BASE}?t=${++n}#/${hash}`, 150);
      await page.until(`!document.querySelector(".skeleton") && document.querySelectorAll("#view .card").length > 0 && !document.getElementById("view").innerText.includes(${JSON.stringify(LOADING[lang])})`, 15000);
      await sleep(350);
    };
    await page.goto(BASE + "#/overview", 500);

    // ---------- 1. world + ASEAN views: every year x kind x side ----------
    const world = JSON.parse(fs.readFileSync(path.join(ROOT, "data/rubber-world.json"), "utf8"));
    const years = Object.keys(world.trade.years);
    for (const lang of ["th", "lo"]) {
      for (const year of years) {
        for (const code of world.trade.codes) {
          for (const flow of ["X", "M"]) {
            await open(lang, { eco_tab: "rubber", eco_rubber_view: "world", eco_rubber_year: year, eco_rubber_form: code, eco_rubber_flow: flow });
            const r = await page.eval(CHECK);
            const rows = await page.eval(`const tb = [...document.querySelectorAll("#view table")].find((x) => x.querySelectorAll("tbody tr").length >= 5); return tb ? tb.querySelectorAll("tbody tr").length : 0;`);
            report(`${lang} world ${year} ${code} ${flow}`, r, lang === "th" && code === "400129" ? `rows in the top table: ${rows}` : "");
          }
          await open(lang, { eco_tab: "rubber", eco_rubber_view: "asean", eco_rubber_year: year, eco_rubber_form: code });
          report(`${lang} asean ${year} ${code}`, await page.eval(CHECK));
        }
        await open(lang, { eco_tab: "rubber", eco_rubber_view: "lao", eco_rubber_year: year, eco_rubber_form: "4001" });
        report(`${lang} lao ${year}`, await page.eval(CHECK));
      }
      // ---------- 2. land: every road class ----------
      for (const road of ["main", "connecting", "branch", "track"]) {
        await open(lang, { eco_tab: "land", eco_land_road: road });
        const r = await page.eval(CHECK);
        const first = await page.eval(`const tr = document.querySelector("#view table tbody tr"); return tr ? tr.innerText.replace(/\\s+/g, " ") : "";`);
        report(`${lang} land road ${road}`, r, lang === "th" ? first : "");
      }
    }

    // ---------- 2b. "who buys Lao rubber": every kind of rubber of the two Thai border markets ----------
    const daily = JSON.parse(fs.readFileSync(path.join(ROOT, "data/rubber-daily.json"), "utf8"));
    for (const lang of ["th", "lo"]) {
      for (const kind of Object.keys(daily.thai_border.kinds)) {
        await open(lang, { eco_tab: "rubber", eco_rubber_view: "buyers", eco_rubber_border_kind: kind });
        const r = await page.eval(CHECK);
        // the three tiles of the border card (Nong Khai, Chiang Rai, all markets): a price or the words "no trade"
        const tiles = await page.eval(`return [...document.querySelectorAll('#view .stat[data-kind="market"] .stat-value')].map((x) => x.textContent.trim()).join(" | ");`);
        const pressed = await page.eval(`return [...document.querySelectorAll('#view .choice button[aria-pressed="true"]')].length;`);
        if (!tiles || pressed < 2) r.badText.push(`border card: tiles "${tiles}", pressed buttons ${pressed}`);
        report(`${lang} buyers ${kind}`, r, lang === "th" ? tiles : "");
      }
    }

    // ---------- 2b'. the price of every country: all 16 rows (it must not be shown half-filled) ----------
    for (const lang of ["th", "lo"]) {
      await open(lang, { eco_tab: "rubber", eco_rubber_view: "asean" });
      const r = await page.eval(CHECK);
      const rows = await page.eval(`const tb = document.querySelector("#view .card table"); return tb ? [...tb.querySelectorAll("tbody tr")].map((tr) => tr.cells[0].firstChild.firstChild.textContent) : [];`);
      if (rows.length < 14) r.badText.push(`price table: only ${rows.length} rows`);
      report(`${lang} country prices`, r, lang === "th" ? `${rows.length} rows: ${[...new Set(rows)].join(" ")}` : "");
    }

    // ---------- 2c. policy tab: every "see the effect" button opens the tab it names ----------
    const stat = JSON.parse(fs.readFileSync(path.join(ROOT, "data/invest-static.json"), "utf8"));
    for (const lang of ["th", "lo"]) {
      for (let i = 0; i < stat.policy.areas.length; i++) {
        const area = stat.policy.areas[i];
        await open(lang, { eco_tab: "policy" });
        const r = await page.eval(CHECK);
        await page.eval(`document.querySelectorAll("#view .policy-card .watch-links .btn")[${i}].click();`);
        await sleep(400);
        const where = await page.eval(`const tab = document.querySelector('.tabbar [aria-selected="true"]'); return location.hash + " " + (tab ? tab.id : "");`);
        const want = area.tab === "living" ? "#/living " : `#/economy tab-${area.tab}`;
        if (where !== want) r.badText.push(`button of "${area.id}" led to "${where}", expected "${want}"`);
        report(`${lang} policy ${area.id} -> ${area.tab}`, r, lang === "th" ? where : "");
      }
    }

    // ---------- 2d. wages tab: all 17 countries, the sources, without exchange rates, and after 1 January 2027 ----------
    const GOOGLE = ["*docs.google.com*", "*google.com/forms*"];
    const block = (urls) => page.s("Network.setBlockedURLs", { urls: [...GOOGLE, ...urls] });
    const wageRows = `return [...document.querySelectorAll("#view .wage-table tbody tr")].map((tr) => tr.innerText.replace(/\\s+/g, " "));`;
    for (const lang of ["th", "lo"]) {
      await open(lang, { eco_tab: "wages" });
      let r = await page.eval(CHECK);
      let rows = await page.eval(wageRows);
      const info = await page.eval(`return { tiles: document.querySelectorAll("#view .stats .stat").length, sources: document.querySelectorAll("#view .source-list a").length, charts: document.querySelectorAll("#view canvas").length, thai: document.querySelectorAll("#view table")[1].querySelectorAll("tbody tr").length, one: [...document.querySelectorAll("#view .wage-table tbody tr")].filter((tr) => tr.cells[2].textContent === "1×").length };`);
      if (rows.length !== stat.wages.countries.length) r.badText.push(`wage table: ${rows.length} rows, expected ${stat.wages.countries.length}`);
      if (info.sources !== stat.wages.countries.length) r.badText.push(`sources: ${info.sources} links`);
      if (info.tiles < 5 || info.charts !== 1 || info.thai !== stat.wages.thailand.rows.length || info.one !== 1) r.badText.push("wages tab: " + JSON.stringify(info));
      // the amounts in dollars fall from the first row to the last one that has a number
      const usd = (await page.eval(`return [...document.querySelectorAll("#view .wage-table tbody tr")].map((tr) => tr.cells[1].textContent.replace(/[^0-9]/g, ""));`)).filter(Boolean).map(Number);
      if (usd.length < 14 || usd.some((v, i) => i > 0 && v > usd[i - 1])) r.badText.push("wage table not sorted by dollars: " + usd.join(","));
      report(`${lang} wages`, r, lang === "th" ? `${rows.length} rows, ${JSON.stringify(info)} | USD per month: ${usd.join(" ")}` : "");
      // every fold-out part opened (the list of sources, the table under the chart): still nothing outside the screen
      await page.eval(`for (const d of document.querySelectorAll("#view details")) d.open = true;`);
      await sleep(250);
      report(`${lang} wages, fold-outs opened`, await page.eval(CHECK));

      // without data/wages.json: the legal amounts only, and a line that says so
      await block(["*data/wages.json*"]);
      await open(lang, { eco_tab: "wages" });
      r = await page.eval(CHECK);
      rows = await page.eval(wageRows);
      const note = await page.eval(`return document.querySelector("#view .tabpanel > p.muted:not(.tab-intro)") ? document.querySelector("#view .tabpanel > p.muted:not(.tab-intro)").textContent : "";`);
      if (rows.length !== stat.wages.countries.length || !note) r.badText.push(`without rates: ${rows.length} rows, note "${note}"`);
      report(`${lang} wages without exchange rates`, r, lang === "th" ? note : "");
      await block([]);

      // 100 days later (January 2027): the rises that are already decided are in force, nothing is announced as "next"
      const later = await page.s("Page.addScriptToEvaluateOnNewDocument", { source: "(() => { const now = Date.now; Date.now = () => now() + 100 * 86400000; })();" });
      await open(lang, { eco_tab: "wages" });
      r = await page.eval(CHECK);
      rows = await page.eval(wageRows);
      const khm = stat.wages.countries.find((c) => c.iso === "KHM");
      const kor = stat.wages.countries.find((c) => c.iso === "KOR");
      const hasNew = rows.some((x) => x.includes(`${khm.steps[1][1]} USD/`)) && rows.some((x) => x.includes(kor.steps[1][1].toLocaleString("en-US") + " KRW/"));
      const stillOld = rows.some((x) => x.includes(`${khm.steps[0][1]} USD/`));
      if (!hasNew || stillOld) r.badText.push(`after 1 Jan 2027: new rates shown ${hasNew}, old Cambodian rate still shown ${stillOld}`);
      report(`${lang} wages 100 days later`, r, lang === "th" ? `new rates in force: ${hasNew}` : "");
      await page.s("Page.removeScriptToEvaluateOnNewDocument", { identifier: later.identifier });
    }

    // ---------- 2e. cost of living: the official fuel card in its three states ----------
    const fuelFile = JSON.parse(fs.readFileSync(path.join(ROOT, "data/fuel-lao.json"), "utf8"));
    const fuelCard = `const c = [...document.querySelectorAll("#view .card")].find((x) => x.querySelector(".fuel-notice")); return c ? { rows: c.querySelectorAll(".row").length, provinces: c.querySelectorAll(".fuel-provinces tbody tr").length, link: (c.querySelector(".fuel-notice a") || { href: "" }).href, alert: c.querySelector(".alert") ? c.querySelector(".alert a").href : "", text: c.querySelector(".fuel-notice").textContent.slice(0, 70) } : null;`;
    for (const lang of ["th", "lo"]) {
      // as it is today: the price of the newest notice
      await open(lang, {}, "living");
      let r = await page.eval(CHECK);
      let f = await page.eval(fuelCard);
      const fuels = ["premium", "regular", "diesel"].filter((k) => fuelFile.capital.latest[k]).length;
      if (!f || f.rows !== fuels || f.provinces !== fuelFile.provinces.rows.length || (fuelFile.capital.latest.from === "notice" && !f.link.startsWith("https://dit.moic.gov.la/"))) r.badText.push("fuel card: " + JSON.stringify(f));
      report(`${lang} living: official fuel`, r, lang === "th" ? JSON.stringify(f) : "");
      // the province table and every "show as table" opened: still nothing outside the screen
      await page.eval(`for (const d of document.querySelectorAll("#view details")) d.open = true;`);
      await sleep(250);
      report(`${lang} living, fold-outs opened`, await page.eval(CHECK));

      // a newer notice that could not be read, the price from the fuel company, only two fuels priced
      const variant = JSON.parse(JSON.stringify(fuelFile));
      variant.capital.latest = { ...variant.capital.latest, premium: null, from: "lsf", notice: null };
      variant.capital.waiting = { no: "1999", date: "2026-09-30", url: "https://dit.moic.gov.la/public/uploads/oil/test.pdf", count: 2 };
      site.override.set("/data/fuel-lao.json", JSON.stringify(variant));
      await open(lang, {}, "living");
      r = await page.eval(CHECK);
      f = await page.eval(fuelCard);
      if (!f || f.rows !== 2 || !f.alert.endsWith("/test.pdf") || f.link) r.badText.push("fuel card (waiting): " + JSON.stringify(f));
      report(`${lang} living: fuel, newer notice not read`, r, lang === "th" ? JSON.stringify(f) : "");
      site.override.clear();

      // the file is not there: the monthly estimate as before
      await block(["*data/fuel-lao.json*"]);
      await open(lang, {}, "living");
      r = await page.eval(CHECK);
      f = await page.eval(fuelCard);
      const fuelCards = await page.eval(`return document.querySelectorAll("#view canvas").length;`);
      if (f) r.badText.push("fuel card shown without its file");
      report(`${lang} living: fuel without the official file`, r, lang === "th" ? `charts on the page: ${fuelCards}` : "");
      await block([]);
    }

    // ---------- 2f. policy tab: the numbers that update themselves, a newer report, and the fall-back ----------
    const watchFile = JSON.parse(fs.readFileSync(path.join(ROOT, "data/report-watch.json"), "utf8"));
    const policyInfo = `return { auto: document.querySelectorAll("#view .tag-auto").length, read: !!document.querySelector("#view .policy-read"), alert: document.querySelector("#view .policy-read .alert a") ? document.querySelector("#view .policy-read .alert a").href : "", tiles: [...document.querySelectorAll("#view .stats .stat")].map((x) => x.querySelector(".stat-value").textContent).join(" | ") };`;
    for (const lang of ["th", "lo"]) {
      await open(lang, { eco_tab: "policy" });
      let r = await page.eval(CHECK);
      let p = await page.eval(policyInfo);
      if (p.auto < 4 || !p.read || p.alert) r.badText.push("policy: " + JSON.stringify(p));
      report(`${lang} policy: live numbers`, r, lang === "th" ? JSON.stringify(p) : "");

      // a newer edition of the World Bank report is out: the card says so and links to it
      const newer = JSON.parse(JSON.stringify(watchFile));
      newer.lem.latest = { date: "2026-12-10", title: "Lao PDR Economic Monitor : December 2026", url: "https://documents.worldbank.org/curated/en/test" };
      site.override.set("/data/report-watch.json", JSON.stringify(newer));
      await open(lang, { eco_tab: "policy" });
      r = await page.eval(CHECK);
      p = await page.eval(policyInfo);
      if (!p.alert.endsWith("/curated/en/test")) r.badText.push("policy (newer report): " + JSON.stringify(p));
      report(`${lang} policy: newer report`, r, lang === "th" ? p.alert : "");
      site.override.clear();

      // none of the three files that update themselves: the hand-checked values, no "updates itself" label
      await block(["*data/bol-policy.json*", "*data/fuel-lao.json*", "*data/report-watch.json*"]);
      await open(lang, { eco_tab: "policy" });
      r = await page.eval(CHECK);
      p = await page.eval(policyInfo);
      if (p.auto !== 0 || !p.read) r.badText.push("policy (fall-back): " + JSON.stringify(p));
      report(`${lang} policy: without the live files`, r, lang === "th" ? p.tiles : "");
      await block([]);
    }

    // ---------- 3. the entry forms, opened and filled in (never saved) ----------
    const type = async (selector, text) => {
      await page.eval(`const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));`);
      await sleep(120);
    };
    for (const [lang, width] of [["th", 380], ["lo", 380], ["th", 1440], ["lo", 1440]]) {
      await page.size(width, width < 700 ? 820 : 900, width < 700);
      // rubber
      await open(lang, { eco_tab: "rubber", eco_rubber_view: "mine" });
      await page.eval(`document.querySelector(".own-rubber .btn-primary").click();`);
      await page.until(`document.querySelector(".own-rubber .up-panel")`, 5000);
      await sleep(600);
      await type(".own-rubber .up-grid input[inputmode='numeric']", "18500");
      const rub = await page.eval(CHECK);
      const rubInfo = await page.eval(`const p = document.querySelector(".own-rubber"); return { checks: [...p.querySelectorAll(".up-check")].map((x) => x.textContent).join(" / "), analysis: (p.querySelector(".up-analysis") || { innerText: "" }).innerText.replace(/\\s+/g, " ").slice(0, 110), save: p.querySelector(".up-panel .btn-primary").disabled ? "disabled" : "enabled" };`);
      report(`${lang} ${width} rubber form`, rub, JSON.stringify(rubInfo));
      await page.eval(`document.querySelector(".own-rubber").scrollIntoView({ block: "start" }); window.scrollBy(0, -70);`);
      await sleep(200);
      await page.shot(path.join(SHOTS, `form-rubber-${lang}-${width}.png`));
      await page.eval(`[...document.querySelectorAll(".own-rubber .up-actions button")].pop().click();`); // cancel
      // land
      await open(lang, { eco_tab: "land" });
      await page.eval(`document.querySelector(".own-land .btn-primary").click();`);
      await page.until(`document.querySelector(".own-land .up-panel")`, 5000);
      await sleep(600);
      await page.eval(`const sel = document.querySelectorAll(".own-land .up-grid select"); sel[1].value = "THB"; sel[1].dispatchEvent(new Event("change", { bubbles: true })); sel[2].value = "rai"; sel[2].dispatchEvent(new Event("change", { bubbles: true }));`);
      const nums = `.own-land .up-grid input[inputmode]`;
      await page.eval(`const i = document.querySelectorAll(${JSON.stringify(nums)}); i[0].value = "1500000"; i[0].dispatchEvent(new Event("input", { bubbles: true })); i[1].value = "2.5"; i[1].dispatchEvent(new Event("input", { bubbles: true }));`);
      await sleep(200);
      const land = await page.eval(CHECK);
      const landInfo = await page.eval(`const p = document.querySelector(".own-land"); return { checks: [...p.querySelectorAll(".up-check")].map((x) => x.textContent).join(" / "), analysis: (p.querySelector(".up-analysis") || { innerText: "" }).innerText.replace(/\\s+/g, " ").slice(0, 160), save: p.querySelector(".up-panel .btn-primary").disabled ? "disabled" : "enabled" };`);
      report(`${lang} ${width} land form`, land, JSON.stringify(landInfo));
      await page.eval(`document.querySelector(".own-land").scrollIntoView({ block: "start" }); window.scrollBy(0, -70);`);
      await sleep(200);
      await page.shot(path.join(SHOTS, `form-land-${lang}-${width}.png`));
      await page.eval(`[...document.querySelectorAll(".own-land .up-actions button")].pop().click();`); // cancel
    }
    const errs = page.errors.filter((e) => !/cdnjs|ERR_CONNECTION_RESET|net::ERR_FAILED|ERR_BLOCKED_BY_CLIENT/.test(e));
    if (errs.length) {
      bad++;
      console.log("FAIL console: " + [...new Set(errs)].slice(0, 5).join(" || "));
    }
    const google = site.hits.filter((u) => /google/.test(u)).length;
    console.log("requests to Google during the test: blocked by the test (none can leave); server saw " + google);
  } catch (e) {
    bad++;
    console.log("FAIL run", e.stack || e);
  } finally {
    await browser.close();
    site.close();
  }
  console.log(`\n${states} states checked, ${bad} problems`);
  process.exit(bad ? 1 : 0);
})();
