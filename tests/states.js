// The states the big matrix does not reach: every year x kind of rubber x seller/buyer choice, every road class of
// the land table, every kind of rubber of the Thai border markets, every "see the effect" button of the policy tab,
// the wages tab (all countries, without exchange rates, after the next rises), the official fuel card and the policy
// tab with and without the files that update themselves, the plan tab (only a number from inside the plan is judged;
// the fall-back without the hand-read facts), the investment tab with and without UNCTAD's total, the route of the
// official rate on the Settings page (bank's page / mirror, compared or not), the kip hint with 2 and with 25
// checked cases (words, never "100%", below 20), the population tab (a head count is not a market), the Compare tab (one row = one year), the labels of prices and age on the economy tabs, and the two entry
// forms opened and filled in, also with a price the checks must refuse (NOT saved: requests to Google are blocked here).
// Usage: node tests/states.js
const fs = require("fs");
const path = require("path");
const { ROOT, SHOTS, launch, startSite, sleep } = require("./browser.js");
const { loadScript, fakeSheet, KEY, HEADERS } = require("./save-script.js");
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
    // Every request goes to the test server, around the service worker: after ONE slow answer the worker hands out
    // the copies it saved for 30 seconds (sw.js) - and in this test a saved copy can be the file an earlier state
    // had changed on purpose. Seen 2026-10-04: five states in a row judged with the data of the state before.
    // (What the worker does is tested in install.js and offline-label.js.)
    await page.s("Network.setBypassServiceWorker", { bypass: true });
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

    // ---------- 2g. plan tab: only a number from inside the plan's years is judged (audit 2026-10-02, P0-1) ----------
    const planRows = `return { rows: [...document.querySelectorAll("#view .plan-table tbody tr")].map((tr) => ({ name: tr.cells[0].firstChild.textContent, value: (tr.querySelector(".plan-value") || { textContent: "" }).textContent, year: Number(((tr.querySelector(".plan-actual .fresh") || { textContent: "" }).textContent.match(/20\\d\\d/) || [0])[0]), status: [...tr.querySelectorAll(".status")].map((s) => s.className.replace("status status-", "")), byForecast: [...tr.querySelectorAll(".plan-actual .status + .sub-line")].some((x) => /IMF/.test(x.textContent)), under: [...tr.cells[0].querySelectorAll(".sub-line")].map((x) => x.textContent).join(" | ") })), summary: [...document.querySelectorAll("#view .card p.note")].map((p) => p.textContent).find((x) => /\\d+ .*: .*\\d/.test(x)) || "" };`;
    const judged = ["met", "near", "far"];
    const revenue = stat.policy.areas.find((a) => a.id === "tax").items.find((i) => i.id === "revenue");
    for (const lang of ["th", "lo"]) {
      await open(lang, { eco_tab: "plan" });
      await sleep(500); // the central bank's file (the line under "reserves") arrives after the table
      let r = await page.eval(CHECK);
      let p = await page.eval(planRows);
      const early = p.rows.filter((x) => x.year && x.year < stat.plan.period[0] && !x.byForecast && x.status.some((s) => judged.includes(s)));
      if (early.length) r.badText.push("judged with a number from before the plan: " + early.map((x) => `${x.name} (${x.year}: ${x.status})`).join(", "));
      if (p.rows.length !== stat.plan.targets.length) r.badText.push(`plan table: ${p.rows.length} rows`);
      if (!p.rows.some((x) => x.value === `${revenue.revenue.toFixed(1)}%` && x.year === revenue.year)) r.badText.push(`state revenue is not ${revenue.revenue}% (${revenue.year})`);
      const counts = (p.summary.match(/\d+/g) || []).map(Number);
      if (counts.length < 4 || counts[0] !== p.rows.length || counts.slice(1).reduce((a, b) => a + b, 0) !== counts[0]) r.badText.push("summary does not add up: " + p.summary);
      const two = p.rows.find((x) => x.status.length === 2);
      if (!two || !/BOL/.test(two.under)) r.badText.push("reserves: two ways of counting with the central bank's newest number expected: " + JSON.stringify(two));
      report(`${lang} plan: baseline, not a status`, r, lang === "th" ? `${p.summary} | reserves: ${two ? two.status.join(" + ") : "-"}` : "");

      // without the hand-read facts of the World Bank report: the yearly series, which is before the plan -> baseline
      const bare = JSON.parse(JSON.stringify(stat));
      delete bare.facts.reserves_wb;
      bare.policy.areas.find((a) => a.id === "tax").items = bare.policy.areas.find((a) => a.id === "tax").items.filter((i) => i.id !== "revenue");
      site.override.set("/data/invest-static.json", JSON.stringify(bare));
      await open(lang, { eco_tab: "plan" });
      r = await page.eval(CHECK);
      p = await page.eval(planRows);
      const wrong = p.rows.filter((x) => x.year && x.year < stat.plan.period[0] && !x.byForecast && x.status.some((s) => judged.includes(s)));
      if (wrong.length || !p.rows.some((x) => x.status.includes("old"))) r.badText.push("fall-back: " + JSON.stringify(p.rows.map((x) => [x.year, x.status.join("+")])));
      report(`${lang} plan: without the hand-read facts`, r, lang === "th" ? p.summary : "");
      await open(lang, { eco_tab: "overview" });
      report(`${lang} overview: without the hand-read reserves`, await page.eval(CHECK));
      site.override.clear();
    }

    // ---------- 2h. who invests: a share is always called a share of the REPORTED amounts (P0-2) ----------
    const investFile = JSON.parse(fs.readFileSync(path.join(ROOT, "data/invest.json"), "utf8"));
    const REPORTED = { th: "รายงาน", lo: "ລາຍງານ" };
    const top2 = investFile.parts.fdi_positions.list.slice(0, 2).reduce((a, x) => a + x[2], 0) / investFile.parts.fdi_positions.total;
    const share = `${Math.round(top2 * 100)}%`;
    const fdiInfo = `const tb = [...document.querySelectorAll("#view table")].find((x) => x.querySelectorAll("tbody tr").length === ${investFile.parts.fdi_positions.list.length}); return { head: tb ? tb.querySelector("thead tr").lastElementChild.textContent : "", tiles: document.querySelectorAll("#view .stats .stat").length, unctad: [...document.querySelectorAll("#view .card p.note")].map((p) => p.textContent).find((x) => x.includes("UNCTAD")) || "" };`;
    for (const lang of ["th", "lo"]) {
      await open(lang, { eco_tab: "overview" });
      let r = await page.eval(CHECK);
      const lines = await page.eval(`return [...document.querySelectorAll("#view li, #view p, #view .stat")].map((x) => x.textContent).filter((x) => x.includes(${JSON.stringify(share)}));`);
      if (!lines.length || lines.some((x) => !x.includes(REPORTED[lang]))) r.badText.push(`"${share}" without the word for "reported": ${JSON.stringify(lines)}`);
      report(`${lang} overview: ${share} only as a share of the reported amounts`, r, lang === "th" ? lines[0].slice(0, 150) : "");

      await open(lang, { eco_tab: "fdi" });
      r = await page.eval(CHECK);
      let f = await page.eval(fdiInfo);
      const cover = `${Math.round((investFile.parts.fdi_positions.total / investFile.parts.fdi_total.values.find(([y]) => y === investFile.parts.fdi_positions.year)[1]) * 100)}%`;
      if (!f.head.includes(REPORTED[lang]) || f.tiles !== 4 || !f.unctad.includes(cover)) r.badText.push(`fdi: ${JSON.stringify(f)} (cover ${cover})`);
      report(`${lang} fdi: share of the reported amounts, UNCTAD total next to it`, r, lang === "th" ? `column "${f.head}", ${cover} of UNCTAD's total` : "");

      // without UNCTAD's total: no coverage line, no fourth tile, nothing broken
      const bare = JSON.parse(JSON.stringify(investFile));
      delete bare.parts.fdi_total;
      site.override.set("/data/invest.json", JSON.stringify(bare));
      await open(lang, { eco_tab: "fdi" });
      r = await page.eval(CHECK);
      f = await page.eval(fdiInfo);
      if (!f.head.includes(REPORTED[lang]) || f.tiles !== 3 || f.unctad) r.badText.push(`fdi without UNCTAD: ${JSON.stringify(f)}`);
      report(`${lang} fdi: without UNCTAD's total`, r);
      site.override.clear();
    }

    // ---------- 2i. which route gave the official rate, and the API rate under its own name (audit P1-5) ----------
    const summaryFile = JSON.parse(fs.readFileSync(path.join(ROOT, "data/summary.json"), "utf8"));
    const WORDS = {
      th: { direct: "อ่านตรงจากเว็บ BOL", mirror: "สำเนาสำรอง", agree: "ตรงกันทุกค่า", wait: "ยังเทียบไม่ได้", none: "ยังไม่ได้เทียบ", via: "ผ่านสำเนาสำรอง", reference: "อ้างอิง", market: "ตลาด", card: "อัตรากลางอ้างอิง (API)" },
      lo: { direct: "ອ່ານໂດຍກົງຈາກເວັບ BOL", mirror: "ສຳເນົາສຳຮອງ", agree: "ກົງກັນທຸກຄ່າ", wait: "ຍັງທຽບບໍ່ໄດ້", none: "ຍັງບໍ່ໄດ້ທຽບ", via: "ຜ່ານສຳເນົາສຳຮອງ", reference: "ອ້າງອີງ", market: "ຕະຫຼາດ", card: "ອັດຕາກາງອ້າງອີງ (API)" },
    };
    const withRoute = (extra, fxKind) => {
      const copy = JSON.parse(JSON.stringify(summaryFile));
      for (const k of ["route", "route_note", "cross_check"]) delete copy.sources.bol[k];
      Object.assign(copy.sources.bol, extra);
      delete copy.sources["fx-market"].shown_as;
      if (fxKind === "reference") copy.sources["fx-market"].shown_as = fxKind; // what the bot writes now
      else copy.sources["fx-market"].kind = fxKind;
      return JSON.stringify(copy);
    };
    const check = (same_day, agree, max_diff_pct, mirror_date = "2026-10-02") => ({ against: "mirror", mirror_date, same_day, agree, max_diff_pct });
    // [name, what data/latest/bol.json says, kind of the API rate in the file, what the Settings row must say]
    const ROUTES = [
      ["direct, the mirror agrees", { route: "direct", route_note: null, cross_check: check(true, true, 0) }, "reference", (x, w) => x.route.includes(w.direct) && x.route.includes(w.agree) && x.fxChip === w.reference],
      ["direct, the mirror differs", { route: "direct", route_note: null, cross_check: check(true, false, 0.27) }, "reference", (x, w) => x.route.includes(w.direct) && x.route.includes("0.27%")],
      ["direct, the mirror is a day behind", { route: "direct", route_note: null, cross_check: check(false, null, null, "2026-10-01") }, "reference", (x, w) => x.route.includes(w.direct) && x.route.includes(w.wait)],
      ["direct, the mirror could not be read", { route: "direct", route_note: null, cross_check: null }, "reference", (x, w) => x.route.includes(w.direct) && x.route.includes(w.none)],
      ["mirror, with the reason", { route: "mirror", route_note: "HTTP 503 from https://www.bol.gov.la/en/ExchangRate", cross_check: null }, "reference", (x, w) => x.route.includes(w.mirror) && x.route.includes("HTTP 503") && !x.route.includes(w.direct)],
      ["a file from before the change: no route line, the old kind", {}, "market", (x, w) => x.route === "" && x.fxChip === w.market],
      ["a kind this page does not know: its id, never 'undefined'", {}, "benchmark", (x) => x.fxChip === "benchmark"],
    ];
    const settingsInfo = `const items = [...document.querySelectorAll("#view .status-item")]; const of = (name) => items.find((li) => li.textContent.includes(name)); const bol = of("Bank of the Lao PDR"); const fx = of("open.er-api.com"); return { route: bol && bol.querySelector(".status-route") ? bol.querySelector(".status-route").textContent : "", fxChip: fx && fx.querySelector(".chip") ? fx.querySelector(".chip").textContent : "(no row)" };`;
    const ratesInfo = `const cards = [...document.querySelectorAll("#view .card")]; const api = cards.find((c) => c.dataset.kind === "reference"); const table = cards.find((c) => c.querySelector("table")); return { card: api ? api.querySelector(".card-head").firstChild.textContent : "(no card)", chip: api && api.querySelector(".chip") ? api.querySelector(".chip").textContent : "", foot: table && table.querySelector(".card-foot") ? table.querySelector(".card-foot").textContent : "", lineColour: getComputedStyle(document.documentElement).getPropertyValue("--kind-reference").trim(), marketColour: getComputedStyle(document.documentElement).getPropertyValue("--kind-market").trim() };`;
    for (const lang of ["th", "lo"]) {
      const w = WORDS[lang];
      for (const [name, extra, fxKind, good] of ROUTES) {
        site.override.set("/data/summary.json", withRoute(extra, fxKind));
        await open(lang, {}, "settings");
        const r = await page.eval(CHECK);
        const x = await page.eval(settingsInfo);
        if (!good(x, w)) r.badText.push("settings route: " + JSON.stringify(x));
        report(`${lang} settings: ${name}`, r, lang === "th" ? x.route || "(no route line)" : "");
      }
      // the rates page: the API rate has its own name and label, in the colour of its kind; a mirror day is credited
      for (const [route, credited] of [["direct", false], ["mirror", true]]) {
        site.override.set("/data/summary.json", withRoute({ route, route_note: null, cross_check: null }, "reference"));
        await open(lang, {}, "rates");
        const r = await page.eval(CHECK);
        const x = await page.eval(ratesInfo);
        if (x.card !== w.card || x.chip !== w.reference || x.foot.includes(w.via) !== credited || !x.lineColour || x.lineColour !== x.marketColour) r.badText.push("rates: " + JSON.stringify(x));
        report(`${lang} rates: the API rate by its own name, route ${route}`, r, lang === "th" ? `${x.card} | ${x.foot}` : "");
      }
      site.override.clear();
    }

    // ---------- 2j. the kip hint: a small sample shows words, never "100%" (audit P1-9) ----------
    const FEW = { th: "กรณียังไม่พอ", lo: "ກໍລະນີຍັງບໍ່ພໍ" };
    const dayBack = (n) => new Date(Date.now() + 7 * 3600000 - n * 86400000).toISOString().slice(0, 10);
    const oneHint = (n, said, real) => ({ target_date: dayBack(n), made_at: dayBack(n) + "T02:00:00.000Z", basis: { from_day: dayBack(n + 1), to_day: dayBack(n), usd_pct: 0.05, thb_pct: 0.05 }, hint: { usd: said, thb: said }, status: "resolved", actual: { usd: real, thb: real }, actual_pct: { usd: 0.04, thb: 0.04 }, correct: { usd: said === real, thb: said === real }, resolved_at: dayBack(n) + "T09:00:00.000Z" });
    const hintFile = (list) => JSON.stringify({ flat_threshold_pct: 0.02, hints: list.sort((a, b) => (a.target_date < b.target_date ? -1 : 1)) });
    // 2 checked hints, both right: the old page said "100%"
    const small = hintFile([oneHint(1, "up", "up"), oneHint(2, "down", "down")]);
    // 25 checked hints: 16 right = 64%; "up every day" would have been right 15 times = 60%
    const many = [];
    for (const [count, said, real] of [[12, "up", "up"], [3, "down", "up"], [4, "down", "down"], [6, "up", "down"]]) for (let i = 0; i < count; i++) many.push(oneHint(many.length + 1, said, real));
    const big = hintFile(many);
    const hintInfo = `const tiles = [...document.querySelectorAll("#view .stats .stat")].slice(0, 2).map((x) => ({ value: x.querySelector(".stat-value").textContent, sub: x.querySelector(".stat-sub") ? x.querySelector(".stat-sub").textContent : "" })); const note = document.querySelector("#view .hint-card p.note:last-of-type"); return { tiles, note: note ? note.textContent : "" };`;
    for (const lang of ["th", "lo"]) {
      for (const [name, text, hash] of [["2 checked hints", small, "forecast"], ["2 checked hints", small, "overview"], ["25 checked hints", big, "forecast"], ["25 checked hints", big, "overview"]]) {
        site.override.set("/data/forecast/hints.json", text);
        await open(lang, {}, hash);
        const r = await page.eval(CHECK);
        const x = await page.eval(hintInfo);
        const percents = (x.note.match(/\d+%/g) || []).join(" ");
        if (text === small) {
          // no percentage anywhere near the hint: not in the tiles, not in the line under the hint
          if (percents || (hash === "forecast" && (x.tiles.length !== 2 || x.tiles.some((tile) => tile.value !== FEW[lang] || /%/.test(tile.sub) || !/2\D+20/.test(tile.sub)))) || !/2\D+20/.test(x.note)) r.badText.push("small sample: " + JSON.stringify(x));
        } else if (percents !== "64% 60% 64% 60%" || (hash === "forecast" && (x.tiles.length !== 2 || x.tiles.some((tile) => tile.value !== "64%" || !tile.sub.includes("25") || !tile.sub.includes("60%"))))) r.badText.push("big sample: " + JSON.stringify(x));
        report(`${lang} ${hash}: kip hint with ${name}`, r, lang === "th" ? (hash === "forecast" ? x.tiles.map((tile) => `${tile.value} (${tile.sub})`).join(" | ") : x.note) : "");
      }
      site.override.clear();
    }

    // ---------- 2k. population: a head count is never called a market; what people can spend has its own tiles (P1-8) ----------
    const popFile = JSON.parse(fs.readFileSync(path.join(ROOT, "data/population.json"), "utf8"));
    const MARKET = { th: "ตลาด", lo: "ຕະຫຼາດ" };
    const PEOPLE = { th: "ล้านคน", lo: "ລ້ານຄົນ" };
    const popInfo = (lang) => `const h = [...document.querySelectorAll("#view h2.section-title")].find((x) => x.nextElementSibling && x.nextElementSibling.nextElementSibling && x.nextElementSibling.nextElementSibling.classList.contains("stats")); const tiles = h ? [...h.nextElementSibling.nextElementSibling.querySelectorAll(".stat")] : []; return { tiles: tiles.map((x) => ({ label: x.querySelector(".stat-label").textContent, value: x.querySelector(".stat-value").textContent, old: !!x.querySelector(".fresh-old"), year: (x.querySelector(".fresh").textContent.match(/(19|20)\\d\\d/) || [""])[0] })), market: [...document.querySelectorAll("#view li, #view p, #view .stat, #view td")].map((x) => x.textContent).filter((x) => x.includes(${JSON.stringify(MARKET[lang])}) && x.includes(${JSON.stringify(PEOPLE[lang])})) };`;
    const yearOf = (id) => String(popFile.indicators[id].values[popFile.indicators[id].values.length - 1][0]);
    for (const lang of ["th", "lo"]) {
      await open(lang, { eco_tab: "population" });
      let r = await page.eval(CHECK);
      let x = await page.eval(popInfo(lang));
      const home = stat.population.household;
      const want = [yearOf("gni_ppp"), yearOf("consumption"), yearOf("poverty_national"), String(home.year)];
      if (x.market.length) r.badText.push("a head count is called a market: " + x.market[0].slice(0, 90));
      if (x.tiles.length !== 4 || x.tiles.some((tile, i) => tile.year !== want[i]) || !x.tiles[1].old || !x.tiles[3].old || x.tiles[0].old || x.tiles[3].value.indexOf(home.size.toFixed(1)) !== 0) r.badText.push("spending tiles: " + JSON.stringify(x.tiles));
      report(`${lang} population: head count and spending power apart`, r, lang === "th" ? x.tiles.map((tile) => `${tile.value} (${tile.year}${tile.old ? ", old" : ""})`).join(" | ") : "");

      // without the hand-read household size, and with a file from before the new indicators: no empty tiles
      const bareStat = JSON.parse(JSON.stringify(stat));
      delete bareStat.population.household;
      site.override.set("/data/invest-static.json", JSON.stringify(bareStat));
      await open(lang, { eco_tab: "population" });
      r = await page.eval(CHECK);
      x = await page.eval(popInfo(lang));
      if (x.tiles.length !== 3) r.badText.push("without the household size: " + JSON.stringify(x.tiles));
      report(`${lang} population: without the household size`, r);
      const barePop = JSON.parse(JSON.stringify(popFile));
      for (const id of ["gni_ppp", "consumption", "consumption_gdp", "poverty_national", "poverty_3usd"]) delete barePop.indicators[id];
      site.override.set("/data/population.json", JSON.stringify(barePop));
      await open(lang, { eco_tab: "population" });
      r = await page.eval(CHECK);
      x = await page.eval(popInfo(lang));
      if (x.tiles.length) r.badText.push("a spending section without any number: " + JSON.stringify(x.tiles));
      report(`${lang} population: a file from before the spending numbers`, r);
      site.override.clear();
    }

    // ---------- 2l. Laos next to its neighbours: every row names its year, another year is always marked (P1-6) ----------
    const cmpFile = JSON.parse(fs.readFileSync(path.join(ROOT, "data/compare.json"), "utf8"));
    const cmpInfo = `return [...document.querySelectorAll("#view .compare-card")].map((c) => ({ id: c.dataset.indicator, year: c.dataset.year, stale: !!c.querySelector(".badge-stale, .stale"), rows: [...c.querySelectorAll("tbody tr")].map((tr) => ({ name: tr.cells[0].firstChild.textContent, value: tr.cells[1].textContent.trim(), year: tr.cells[2].textContent.trim(), marked: !!tr.cells[2].querySelector(".cmp-year-off") })) }));`;
    // the rule of the tab, checked on what the page shows: a row with a number names a year; a year that is not
    // the card's year carries the mark; a row of the card's year does not
    const yearProblems = (cards) => {
      const out = [];
      for (const c of cards) {
        for (const r of c.rows) {
          const yr = (r.year.match(/(19|20)\d\d/) || [""])[0];
          if (r.value === "—") {
            if (r.year) out.push(`${c.id}: ${r.name} has no number but a year`);
          } else if (!yr) out.push(`${c.id}: ${r.name} has no year`);
          else if (yr !== c.year && !(r.marked && r.year.includes("⚠"))) out.push(`${c.id}: ${r.name} is from ${yr}, the card is ${c.year} - not marked`);
          else if (yr === c.year && r.marked) out.push(`${c.id}: ${r.name} is marked although it is of the card's year`);
        }
        if (c.rows.length !== cmpFile.countries.length) out.push(`${c.id}: ${c.rows.length} rows`);
      }
      return out;
    };
    const newestOf = (id, iso) => { const list = cmpFile.indicators[id].rows[iso] || []; return list.length ? list[list.length - 1][0] : null; };
    // an indicator in today's file where a neighbour has no number for Laos' newest year (a mark must show today)
    const behind = Object.keys(cmpFile.indicators).filter((id) => cmpFile.countries.some((iso) => { const y = newestOf(id, iso); return y !== null && y < newestOf(id, "LAO"); }));
    for (const lang of ["th", "lo"]) {
      await open(lang, { eco_tab: "compare" });
      let r = await page.eval(CHECK);
      let cards = await page.eval(cmpInfo);
      let problems = yearProblems(cards);
      const marks = cards.reduce((n, c) => n + c.rows.filter((x) => x.marked).length, 0);
      if (cards.length !== 11) problems.push(`${cards.length} cards`);
      if (behind.length && !marks) problems.push("no mark although " + behind.join(", ") + " has a country behind");
      if (problems.length) r.badText.push("compare: " + problems.slice(0, 4).join(" | "));
      report(`${lang} compare: one row = one year, other years marked`, r, lang === "th" ? `${cards.length} cards, ${marks} marked rows (${cards.filter((c) => c.rows.some((x) => x.marked)).map((c) => c.id).join(", ")}) · years ${[...new Set(cards.map((c) => c.year))].join(", ")}` : "");

      // Laos one year behind everybody: the whole card moves to Laos' year, and nobody needs a mark
      const lagging = JSON.parse(JSON.stringify(cmpFile));
      const laoGdp = lagging.indicators.gdp.rows.LAO;
      const dropped = laoGdp.pop()[0];
      // a country with nothing at all, and a number that failed to update
      lagging.indicators.urban.rows.MMR = [];
      lagging.indicators.growth.stale = true;
      lagging.indicators.growth.last_error = { message: "HTTP 502", at: "2026-10-03T00:00:00.000Z" };
      site.override.set("/data/compare.json", JSON.stringify(lagging));
      await open(lang, { eco_tab: "compare" });
      r = await page.eval(CHECK);
      cards = await page.eval(cmpInfo);
      problems = yearProblems(cards);
      const gdpCard = cards.find((c) => c.id === "gdp");
      const urbanCard = cards.find((c) => c.id === "urban");
      if (!gdpCard || gdpCard.year !== String(dropped - 1) || gdpCard.rows.some((x) => x.marked)) problems.push("gdp card with Laos a year behind: " + JSON.stringify(gdpCard));
      if (!urbanCard || urbanCard.rows.filter((x) => x.value === "—").length !== 1 || urbanCard.rows[urbanCard.rows.length - 1].value !== "—") problems.push("urban card without Myanmar: " + JSON.stringify(urbanCard && urbanCard.rows));
      if (problems.length) r.badText.push("compare (variant): " + problems.slice(0, 4).join(" | "));
      report(`${lang} compare: Laos a year behind, a country without numbers, a failed update`, r, lang === "th" ? `gdp card year ${gdpCard && gdpCard.year}` : "");
      site.override.clear();

      // the file is not there: a sentence, no broken page
      await block(["*data/compare.json*"]);
      await open(lang, { eco_tab: "overview" });
      await page.eval(`document.getElementById("tab-compare").click();`);
      await sleep(1500);
      const gone = await page.eval(`return { cards: document.querySelectorAll("#view .compare-card").length, text: document.getElementById("tabpanel").innerText.length, bad: /undefined|NaN/.test(document.getElementById("tabpanel").innerText) };`);
      states++;
      if (gone.cards || gone.bad || gone.text < 40) {
        bad++;
        console.log(`FAIL ${lang} compare: without its file  ${JSON.stringify(gone)}`);
      }
      await block([]);
    }

    // ---------- 2m. which prices a number is in, how old it is, and why two sources differ (P1-1, P1-3, P1-4) ----------
    const PRICES = { th: { current: "ราคาปัจจุบัน", constant: "ราคาคงที่", estimate: "ค่าประมาณ IMF" }, lo: { current: "ລາຄາປັດຈຸບັນ", constant: "ລາຄາຄົງທີ່", estimate: "ຄ່າປະມານ IMF" } };
    const LATEST = { th: "ล่าสุดจากแหล่ง", lo: "ລ່າສຸດຈາກແຫຼ່ງ" };
    // every tile and every plan row of the screen: the year it shows, whether it carries the "latest" tick, whether it says its age
    const tilesInfo = `return [...document.querySelectorAll("#view .stats .stat, #view .plan-actual")].map((x) => { const f = x.querySelector(".fresh"); const text = f ? f.textContent : ""; return { label: (x.querySelector(".stat-label") || x).textContent.slice(0, 40), text, year: Number((text.match(/(19|20)\\d\\d/) || [0])[0]), latest: [...x.querySelectorAll(".fresh-ok")].map((n) => n.textContent).join(" "), aged: !!x.querySelector(".fresh-behind, .fresh-old") }; }).filter((x) => x.year);`;
    const thisYear = new Date(Date.now() + 7 * 3600000).getUTCFullYear();
    for (const lang of ["th", "lo"]) {
      const w = PRICES[lang];
      // GDP tab: the tiles and the size chart say "current prices" / "constant prices"; PPP has its own tile
      await open(lang, { eco_tab: "gdp" });
      let r = await page.eval(CHECK);
      const g = await page.eval(`const tiles = [...document.querySelectorAll("#view .stats .stat")].map((x) => x.textContent); const legend = [...document.querySelectorAll("#view .card")].map((c) => c.textContent); return { current: tiles.filter((x) => x.includes(${JSON.stringify(w.current)})).length, constant: tiles.filter((x) => x.includes(${JSON.stringify(w.constant)})).length, ppp: tiles.filter((x) => x.includes("PPP")).length, chart: legend.some((x) => x.includes(${JSON.stringify(w.current)}) && x.includes(${JSON.stringify(w.constant)})), estimate: legend.some((x) => x.includes(${JSON.stringify(w.estimate)})) };`);
      if (g.current < 2 || g.constant < 1 || g.ppp !== 1 || !g.chart) r.badText.push("gdp labels: " + JSON.stringify(g));
      report(`${lang} gdp: current prices, constant prices and PPP are named`, r, lang === "th" ? JSON.stringify(g) : "");

      // every screen with tiles: a number from two years ago or older never carries the "latest" tick, it says its age
      for (const tab of ["overview", "gdp", "debt", "fdi", "inflation", "population", "plan"]) {
        await open(lang, { eco_tab: tab });
        if (tab === "plan") await sleep(500);
        r = await page.eval(CHECK);
        const tiles = await page.eval(tilesInfo);
        const old = tiles.filter((x) => x.year <= thisYear - 2);
        const wrong = old.filter((x) => x.latest.includes(LATEST[lang]) || !x.aged);
        if (wrong.length) r.badText.push("an old number shown as the latest: " + JSON.stringify(wrong.slice(0, 3)));
        report(`${lang} ${tab}: an older year says its age, no "latest" tick`, r, lang === "th" ? `${tiles.length} dated numbers, ${old.length} of them two years old or older` : "");
      }

      // overview and debt tab: the card that says why two sources give two numbers
      for (const [tab, topics] of [["overview", 5], ["debt", 2], ["inflation", 1]]) {
        await open(lang, { eco_tab: tab });
        const d = await page.eval(`const c = document.querySelector("#view .differ-card"); return c ? { topics: c.querySelectorAll(".differ-topic").length, lines: c.querySelectorAll("li").length } : null;`);
        states++;
        if (!d || d.topics !== topics || d.lines < topics * 2) {
          bad++;
          console.log(`FAIL ${lang} ${tab}: the "why the numbers differ" card  ${JSON.stringify(d)}`);
        } else if (lang === "th") console.log(`ok   ${lang} ${tab}: why the numbers differ  ${d.topics} topics, ${d.lines} lines`);
      }
    }

    // ---------- 2n. audit group P2: the states of the new parts ----------
    const readJson = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", name), "utf8"));
    const serve = (name, data) => site.override.set("/data/" + name, typeof data === "string" ? data : JSON.stringify(data));
    const need = (r, ok, what) => {
      if (!ok) r.badText.push(what);
    };
    const P2_WORDS = {
      th: { now: "ปัจจุบัน", peak: "สูงสุด", sold: "ทำไมขายออกมากกว่าที่ผลิต", failed: "โหลดรายการของชุดนี้ไม่สำเร็จ", general: "เหตุผลทั่วไป" },
      lo: { now: "ປັດຈຸບັນ", peak: "ສູງສຸດ", sold: "ເປັນຫຍັງຂາຍອອກຫຼາຍກວ່າທີ່ຜະລິດ", failed: "ໂຫຼດລາຍການຂອງຊຸດນີ້ບໍ່ສຳເລັດ", general: "ເຫດຜົນທົ່ວໄປ" },
    };
    const text = `return document.getElementById("view").innerText;`;
    for (const lang of ["th", "lo"]) {
      const w = P2_WORDS[lang];
      // gold: the like-for-like premium and the multiplier are two rows; an older summary file has neither (P2-1)
      await open(lang, {}, "gold");
      let r = await page.eval(CHECK);
      let rows = await page.eval(`return [...document.querySelectorAll('#view .card[data-kind="estimated"] .row')].map((x) => x.innerText.replace(/\\s+/g, " "));`);
      need(r, rows.some((x) => /LBB .*[+−]\d+\.\d%/.test(x)) && rows.some((x) => /× 1\.\d{3}/.test(x)), "gold: premium rows " + JSON.stringify(rows.slice(-2)));
      report(`${lang} gold: like-for-like premium and the multiplier`, r, lang === "th" ? rows.slice(-2).join(" | ") : "");
      const summary = readJson("summary.json");
      for (const [name, premium] of [["an older summary file", { avg_14d: summary.gold_premium.avg_14d, days_used: summary.gold_premium.days_used, last_day: summary.gold_premium.last_day }], ["no premium yet", null]]) {
        serve("summary.json", { ...summary, gold_premium: premium });
        await open(lang, {}, "gold");
        report(`${lang} gold: ${name}`, await page.eval(CHECK));
        await open(lang, {}, "method");
        report(`${lang} method page: ${name}`, await page.eval(CHECK));
      }
      site.override.clear();

      // method page: every section, every number filled in
      await open(lang, {}, "method");
      r = await page.eval(CHECK);
      const method = await page.eval(`return { cards: document.querySelectorAll("#view .method-card").length, lines: document.querySelectorAll("#view .method-card li").length, dash: document.getElementById("view").innerText.includes("—") };`);
      need(r, method.cards === 11 && method.lines >= 24, "method page: " + JSON.stringify(method));
      report(`${lang} method page`, r, lang === "th" ? JSON.stringify(method) : "");

      // settings: every source of every file; a part that failed and a file that does not load are said so (P2-8)
      const groupsInfo = `return [...document.querySelectorAll("#view .src-group")].map((g) => ({ title: g.querySelector(".src-group-title").textContent.slice(0, 30), badge: g.querySelector(".badge").className, items: g.querySelectorAll(".src-item").length, errors: [...g.querySelectorAll(".error-text")].map((x) => x.textContent.slice(0, 200)) }));`;
      const sourcesReady = () => page.until(`document.querySelectorAll("#view .src-group").length > 0`, 15000);
      // Which files have a failed download right now? Asked of the page's own module on the files as they are served
      // (a source that is down in the real data is a fact about the world, not a fault of the page): one answer per
      // file of SOURCE_FILES, true = a part of it failed or the file does not load.
      const failedFiles = `const m = await import(new URL("js/pages/sources.js", document.baseURI).href); return { names: m.SOURCE_FILES.map(([name]) => name), bad: await Promise.all(m.SOURCE_FILES.map(([name]) => fetch("data/" + name, { cache: "no-store" }).then((res) => res.json()).then((d) => m.sourcesOf(d).some((s) => s.failed > 0)).catch(() => true))) };`;
      const badgeOf = (g) => (g.badge.includes("badge-bad") ? "bad" : g.badge.includes("badge-ok") ? "ok" : "other");
      await open(lang, {}, "settings");
      await sourcesReady();
      r = await page.eval(CHECK);
      let groups = await page.eval(groupsInfo);
      let expected = await page.eval(failedFiles);
      const fileCount = expected.names.length;
      // every data file is a group, marked as failed exactly when one of its downloads failed - and then it says why
      need(r, fileCount === 15 && groups.length === fileCount + 1 && groups.every((g) => g.items > 0) && groups.slice(0, fileCount).every((g, i) => badgeOf(g) === (expected.bad[i] ? "bad" : "ok") && (g.errors.length > 0) === expected.bad[i]) && badgeOf(groups[fileCount]) === "other", "sources list: " + JSON.stringify(groups.map((g, i) => [expected.names[i] || "hand-read", g.items, g.badge, expected.bad[i], g.errors.length])));
      const downNow = expected.names.filter((name, i) => expected.bad[i]);
      await page.eval(`for (const d of document.querySelectorAll("#view details")) d.open = true;`);
      await sleep(300);
      const opened = await page.eval(CHECK);
      need(opened, true, "");
      report(`${lang} settings: all sources, every group opened`, { ...opened, badText: [...r.badText, ...opened.badText] }, lang === "th" ? `${groups.length} groups, ${groups.reduce((sum, g) => sum + g.items, 0)} sources${downNow.length ? " · a download failed in the real data of: " + downNow.join(", ") : ""}` : "");
      const wagesFile = readJson("wages.json");
      // (every part of the file, so that the answer does not depend on which part is down in the real data today:
      // seen 2026-10-05, the ILO was down and the page - rightly - showed that part's own message first)
      const testError = { stale: true, last_error: { message: "HTTP 502 from the test", at: "2026-10-04T00:00:00Z" } };
      serve("wages.json", Object.fromEntries(Object.entries(wagesFile).map(([k, v]) => [k, v && typeof v.stale === "boolean" ? { ...v, ...testError } : v])));
      serve("land.json", "{ this is not JSON");
      await open(lang, {}, "settings");
      await sourcesReady();
      r = await page.eval(CHECK);
      groups = await page.eval(groupsInfo);
      const failing = groups.filter((g) => g.badge.includes("badge-bad"));
      const before = expected.bad;
      expected = await page.eval(failedFiles);
      const at = (name) => expected.names.indexOf(name);
      // the two files the test broke are marked and say why; every other file is marked as it was before
      need(
        r,
        expected.bad[at("wages.json")] && expected.bad[at("land.json")] &&
          groups.slice(0, fileCount).every((g, i) => badgeOf(g) === (expected.bad[i] ? "bad" : "ok")) &&
          expected.names.every((name, i) => name === "wages.json" || name === "land.json" || expected.bad[i] === before[i]) &&
          groups[at("wages.json")].errors.some((x) => x.includes("HTTP 502 from the test")) && groups[at("land.json")].errors.some((x) => x.includes(w.failed)),
        "sources list with failures: " + JSON.stringify(failing)
      );
      report(`${lang} settings: a failed part and a file that does not load`, r, lang === "th" ? JSON.stringify([groups[at("wages.json")].errors, groups[at("land.json")].errors]).slice(0, 300) : "");
      site.override.clear();

      // wages: a multiple of Laos only from the same year; an older file without the yearly series (P2-3)
      const avgRows = `return [...document.querySelectorAll("#view .card")].filter((c) => c.querySelector(".bar-cell") && !c.querySelector(".wage-table")).map((c) => [...c.querySelectorAll("tbody tr")].map((tr) => tr.cells[0].innerText.replace(/\\s+/g, " ") + " => " + tr.cells[2].innerText.replace(/\\s+/g, " "))).pop() || [];`;
      await open(lang, { eco_tab: "wages" });
      r = await page.eval(CHECK);
      rows = await page.eval(avgRows);
      const laoYear = wagesFile.ilo_avg.latest.LAO.year;
      const otherYear = Object.entries(wagesFile.ilo_avg.latest).filter(([, v]) => v.year !== laoYear);
      const withSeries = otherYear.filter(([iso]) => (wagesFile.ilo_avg.series[iso] || []).some(([y]) => y === laoYear)).length;
      need(r, rows.length === Object.keys(wagesFile.ilo_avg.latest).length && rows.filter((x) => x.endsWith("=> —")).length === otherYear.length - withSeries && rows.filter((x) => x.includes(String(laoYear)) && /=> \d/.test(x)).length >= withSeries, `average earnings: ${JSON.stringify(rows)}`);
      report(`${lang} wages: multiples of Laos from one year only`, r, lang === "th" ? `${rows.length} rows, ${rows.filter((x) => x.endsWith("=> —")).length} without a number for ${laoYear}` : "");
      const { series, ...latestOnly } = wagesFile.ilo_avg;
      serve("wages.json", { ...wagesFile, ilo_avg: latestOnly });
      await open(lang, { eco_tab: "wages" });
      r = await page.eval(CHECK);
      rows = await page.eval(avgRows);
      need(r, rows.filter((x) => x.endsWith("=> —")).length === otherYear.length, `average earnings without the yearly series: ${JSON.stringify(rows)}`);
      report(`${lang} wages: a file without the yearly series`, r);
      site.override.clear();

      // population: a neighbour whose number is from another year is marked (P2-10)
      const pop = readJson("population.json");
      const tha = pop.neighbours.rows.THA;
      serve("population.json", { ...pop, neighbours: { ...pop.neighbours, rows: { ...pop.neighbours.rows, THA: { ...tha, urban: [tha.urban[0] - 2, tha.urban[1]] } } } });
      await open(lang, { eco_tab: "population" });
      r = await page.eval(CHECK);
      const marks = await page.eval(`return { off: [...document.querySelectorAll("#view .cmp-year-off")].map((x) => x.textContent), years: document.querySelectorAll("#view .cmp-year").length };`);
      need(r, marks.off.length === 1 && marks.off[0].includes(String(tha.urban[0] - 2)) && marks.years >= 24, "neighbours: " + JSON.stringify(marks));
      report(`${lang} population: a neighbour's number from another year is marked`, r, lang === "th" ? JSON.stringify(marks) : "");
      site.override.clear();

      // debt: "now" in the read-outs, the peak of the schedule, the World Bank's line; without that hand-read series (P2-5, P2-6)
      const debtInfo = `return { heads: [...document.querySelectorAll("#view .readout-when")].map((x) => x.textContent), peak: [...document.querySelectorAll("#view .readout-peak")].map((x) => x.textContent), rows: [...document.querySelectorAll("#view .chart-card")].map((c) => c.querySelectorAll(".readout-row").length) };`;
      await open(lang, { eco_tab: "debt" });
      r = await page.eval(CHECK);
      let debt = await page.eval(debtInfo);
      need(r, debt.heads.filter((x) => x.includes(w.now) && x.includes(String(thisYear))).length === 2 && debt.peak.length === 1 && debt.peak[0].includes(w.peak) && debt.rows[0] === 5, "debt charts: " + JSON.stringify(debt));
      report(`${lang} debt: this year in the read-outs, the peak, two counts of the debt`, r, lang === "th" ? JSON.stringify(debt) : "");
      const { debt_wb, ...otherFacts } = stat.facts;
      serve("invest-static.json", { ...stat, facts: otherFacts });
      await open(lang, { eco_tab: "debt" });
      r = await page.eval(CHECK);
      debt = await page.eval(debtInfo);
      need(r, debt.rows[0] === 3, "debt chart without the World Bank series: " + JSON.stringify(debt));
      report(`${lang} debt: without the World Bank's series`, r);
      site.override.clear();

      // overview: the risk card - every line is numbers; with facts missing it gets shorter, never empty words (P2-11)
      await open(lang, { eco_tab: "overview" });
      r = await page.eval(CHECK);
      let risk = await page.eval(`const c = document.querySelector("#view .risk-card"); return c ? [...c.querySelectorAll("li")].map((x) => x.textContent) : null;`);
      need(r, risk && risk.length === 4 && risk.every((x) => /\d/.test(x)), "risk card: " + JSON.stringify(risk));
      report(`${lang} overview: risk card`, r, lang === "th" && risk ? risk.map((x) => x.slice(0, 46)).join(" | ") : "");
      const { debt_external, oil_imports, ...fewFacts } = stat.facts;
      serve("invest-static.json", { ...stat, facts: fewFacts });
      await open(lang, { eco_tab: "overview" });
      r = await page.eval(CHECK);
      risk = await page.eval(`const c = document.querySelector("#view .risk-card"); return c ? [...c.querySelectorAll("li")].map((x) => x.textContent) : null;`);
      need(r, risk && risk.length === 2, "risk card with two facts missing: " + JSON.stringify(risk));
      report(`${lang} overview: risk card with facts missing`, r);
      site.override.clear();

      // inflation: the yearly exchange rate for the dollar, the baht and the yuan; a file without the baht series (P2-6)
      for (const cur of ["USD", "THB", "CNY"]) {
        await open(lang, { eco_tab: "inflation", eco_fx_cur: cur });
        r = await page.eval(CHECK);
        const fx = await page.eval(`const pressed = document.querySelector('#view .choice button[aria-pressed="true"]'); const c = pressed ? pressed.closest(".stack").querySelector(".chart-card") : null; return { pressed: pressed ? pressed.textContent : null, rows: c ? c.querySelectorAll(".readout-row").length : 0, drawn: c ? !!Chart.getChart(c.querySelector("canvas")) : false, unit: c ? c.querySelector(".chart-sub").textContent : "" };`);
        need(r, fx.pressed && fx.pressed.includes(cur) && fx.rows === 2 && fx.drawn && fx.unit.includes(cur), "yearly exchange rate: " + JSON.stringify(fx));
        report(`${lang} inflation: yearly exchange rate ${cur}`, r, lang === "th" ? fx.unit.slice(0, 60) : "");
      }
      const eco = readJson("economy.json");
      const { "wb.PA.NUS.FCRF.THA": gone, ...otherIndicators } = eco.indicators;
      serve("economy.json", { ...eco, indicators: otherIndicators });
      await open(lang, { eco_tab: "inflation", eco_fx_cur: "THB" });
      r = await page.eval(CHECK);
      const noBaht = await page.eval(`return document.querySelectorAll("#view .choice").length;`);
      need(r, noBaht === 0, "the baht chart without its series is still there: " + noBaht);
      report(`${lang} inflation: a file without the baht series`, r);
      site.override.clear();
      await open(lang, { eco_tab: "inflation", eco_fx_cur: "USD" });

      // rubber, view "Laos": why more is sold than produced; the land tab says what is general reasoning (P2-10, P2-7)
      await open(lang, { eco_tab: "rubber", eco_rubber_view: "lao" });
      await page.until(`document.getElementById("view").innerText.includes(${JSON.stringify(w.sold)})`, 8000);
      r = await page.eval(CHECK);
      need(r, (await page.eval(text)).includes(w.sold), "rubber: the note on sold and produced is missing");
      report(`${lang} rubber: sold and produced`, r);
      await open(lang, { eco_tab: "land" });
      r = await page.eval(CHECK);
      need(r, (await page.eval(text)).split(w.general).length >= 3, "land: general reasoning is not marked");
      report(`${lang} land: general reasoning is marked`, r);
      // cost of living: Lao diesel in kip, in dollars, and crude oil - three lines from one base month (P2-6)
      await open(lang, {}, "living");
      await page.until(`[...document.querySelectorAll("#view .chart-card")].some((c) => c.textContent.includes("Brent"))`, 15000);
      r = await page.eval(CHECK);
      const fuel = await page.eval(`const c = [...document.querySelectorAll("#view .chart-card")].find((x) => x.textContent.includes("Brent")); return c ? c.querySelectorAll(".readout-row").length : 0;`);
      need(r, fuel === 3, "fuel trend chart: " + fuel + " lines");
      report(`${lang} living: diesel in kip, in dollars, crude oil`, r, lang === "th" ? fuel + " lines" : "");
    }

    // ---------- 2o. audit group P3: the index of the economy tabs and the search box (P3-2) ----------
    // (phone width; the index itself is read from js/pages/eco-index.js by the page's own module)
    const FIND = { th: { debt: "หนี้", reserves: "ทุนสำรอง", top: "10 อันดับ", none: "ไม่พบ" }, lo: { debt: "ໜີ້", reserves: "ຄັງສຳຮອງ", top: "10 ອັນດັບ", none: "ບໍ່ພົບ" } };
    const typeIn = async (q) => {
      await page.eval(`const b = document.getElementById("tab-search"); b.focus(); b.value = ${JSON.stringify(q)}; b.dispatchEvent(new Event("input", { bubbles: true }));`);
      await sleep(150);
    };
    const indexInfo = `const box = document.getElementById("tab-index"); return { hidden: box.hidden, expanded: document.querySelector(".tab-index-btn").getAttribute("aria-expanded"), count: (box.querySelector(".tab-index-count") || {}).textContent || "", items: [...box.querySelectorAll(".tab-index-item")].map((b) => ({ title: b.querySelector("strong").textContent, under: (b.querySelector(".tab-index-sub") || {}).textContent || "", current: b.getAttribute("aria-current") === "true" })) };`;
    const TABS_AND_VIEWS = [...["overview", "compare", "population", "wages", "gdp", "plan", "policy", "fdi", "debt", "inflation", "bank"].map((tab) => [tab, null]), ...["market", "buyers", "lao", "asean", "world", "mine"].map((v) => ["rubber", v]), ["land", null]];
    for (const lang of ["th", "lo"]) {
      const w = FIND[lang];
      await open(lang, { eco_tab: "debt" });
      let info = await page.eval(indexInfo);
      let r = await page.eval(CHECK);
      need(r, info.hidden && info.expanded === "false" && !info.items.length, "the index is open before anything was tapped: " + JSON.stringify(info).slice(0, 200));
      // the index: all twelve tabs, each with what it holds; the open tab is marked
      await page.eval(`document.querySelector(".tab-index-btn").click();`);
      await sleep(150);
      info = await page.eval(indexInfo);
      r = await page.eval(CHECK);
      need(r, !info.hidden && info.expanded === "true" && info.items.length === 13 && info.items.every((x) => x.title && x.under) && info.items.filter((x) => x.current).length === 1, "index: " + JSON.stringify(info).slice(0, 500));
      report(`${lang} economy: the index of the twelve tabs`, r, lang === "th" ? info.items.map((x) => x.title).join(" · ") : "");
      // a tab chosen in the index: the tab opens and the index closes
      await page.eval(`[...document.querySelectorAll("#tab-index .tab-index-item")][7].click();`);
      await sleep(500);
      info = await page.eval(indexInfo);
      const chosen = await page.eval(`return { tab: localStorage.getItem("eco_tab"), selected: document.querySelector('.tabbar [aria-selected="true"]').id };`);
      r = await page.eval(CHECK);
      need(r, info.hidden && chosen.tab === "fdi" && chosen.selected === "tab-fdi", "a tab chosen in the index: " + JSON.stringify([chosen, info.hidden]));
      report(`${lang} economy: a tab chosen in the index`, r);
      // search: one word finds the tab and the cards and tiles that carry it
      await typeIn(w.debt);
      info = await page.eval(indexInfo);
      r = await page.eval(CHECK);
      need(r, !info.hidden && info.items.length >= 6 && info.items.every((x) => `${x.title} ${x.under}`.includes(w.debt)) && /\d/.test(info.count), "search for a word: " + JSON.stringify(info).slice(0, 500));
      report(`${lang} economy: search finds tabs, cards and tiles`, r, lang === "th" ? `"${w.debt}": ${info.count} · ${info.items.slice(0, 4).map((x) => x.title).join(" | ")}` : "");
      // a word that is the label of a tile
      await typeIn(w.reserves);
      info = await page.eval(indexInfo);
      need(r, info.items.length >= 2 && info.items.every((x) => x.title.includes(w.reserves)), "search for the label of a tile: " + JSON.stringify(info).slice(0, 400));
      // nothing found: said in words, no list
      await typeIn("qqqqzz");
      info = await page.eval(indexInfo);
      r = await page.eval(CHECK);
      need(r, !info.hidden && !info.items.length && info.count.includes(w.none), "nothing found: " + JSON.stringify(info).slice(0, 300));
      report(`${lang} economy: search finds nothing`, r, lang === "th" ? info.count : "");
      // a result in another tab and another view: the tab and the view open, the heading comes into view and its
      // card is marked for a moment; the box is empty again
      await typeIn(w.top);
      info = await page.eval(indexInfo);
      const pickAt = info.items.findIndex((x) => x.title.includes(w.top));
      await page.eval(`[...document.querySelectorAll("#tab-index .tab-index-item")][${pickAt}].click();`);
      await page.until(`!!document.querySelector("#tabpanel .found")`, 12000);
      await sleep(400); // the files of the tab that are still arriving redraw it: the card keeps its mark and its place
      const landed = await page.eval(`const f = document.querySelector("#tabpanel .found"); const h = f && f.querySelector("h3, .stat-label"); const top = h ? Math.round(h.getBoundingClientRect().top) : null; return { tab: localStorage.getItem("eco_tab"), view: localStorage.getItem("eco_rubber_view"), selected: document.querySelector('.tabbar [aria-selected="true"]').id, heading: h ? h.textContent : null, top, screen: innerHeight, box: document.getElementById("tab-search").value, hidden: document.getElementById("tab-index").hidden };`);
      r = await page.eval(CHECK);
      need(r, pickAt >= 0 && landed.tab === "rubber" && landed.view === "world" && landed.selected === "tab-rubber" && landed.heading && landed.heading.includes(w.top) && landed.top >= 0 && landed.top < landed.screen / 2 && landed.box === "" && landed.hidden, "a result opened: " + JSON.stringify(landed));
      report(`${lang} economy: a search result opens its tab and view and shows the card`, r, lang === "th" ? JSON.stringify(landed) : "");
      await sleep(2700);
      const still = await page.eval(`return document.querySelectorAll(".found").length;`);
      // Escape empties the box and closes the list
      await typeIn(w.debt);
      await page.eval(`document.getElementById("tab-search").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));`);
      await sleep(150);
      info = await page.eval(indexInfo);
      const boxNow = await page.eval(`return document.getElementById("tab-search").value;`);
      r = await page.eval(CHECK);
      need(r, still === 0 && info.hidden && boxNow === "", "the mark stays, or Escape does not close the list: " + JSON.stringify({ still, hidden: info.hidden, boxNow }));
      report(`${lang} economy: the mark goes away, Escape closes the list`, r);
      // every heading and every tile label a tab shows is in the index of that tab (a card added without its line
      // in js/pages/eco-index.js fails here) - whatever today's data makes of the page
      const missing = [];
      let seen = 0;
      for (const [tab, v] of TABS_AND_VIEWS) {
        await open(lang, { eco_tab: tab, ...(v ? { eco_rubber_view: v } : {}) });
        const got = await page.eval(`const m = await import(new URL("js/pages/eco-index.js", document.baseURI).href); const t = Object.assign({}, ...(await Promise.all(["app", "economy"].map((f) => fetch("i18n/${lang}/" + f + ".json").then((res) => res.json()))))); const texts = m.allHeads(t).filter((h) => h.tab === ${JSON.stringify(tab)} && h.view === ${JSON.stringify(v)}).map((h) => m.textOf(t, h.key)); const heads = [...document.querySelectorAll("#tabpanel h2, #tabpanel h3, #tabpanel .stat-label")].map((h) => h.textContent.trim()); return { heads: heads.length, missing: heads.filter((text) => !texts.some((x) => m.isHeading(text, x))) };`);
        seen += got.heads;
        for (const text of got.missing) missing.push(`${tab}${v ? "/" + v : ""}: ${text}`);
      }
      r = await page.eval(CHECK);
      need(r, seen > 150 && !missing.length, `headings the index does not list (${seen} seen): ` + missing.join(" | "));
      report(`${lang} economy: every heading and tile label on the page is in the index`, r, lang === "th" ? `${seen} headings in ${TABS_AND_VIEWS.length} tabs and views` : "");
      // P3-7: the texts of the economy page are a file of their own. It does not load: the page says so in the words
      // every page has, and draws nothing without its words (no card, no "undefined").
      site.override.set(`/i18n/${lang}/economy.json`, "{ this is not JSON");
      await page.goto(`${BASE}?t=${++n}#/economy`, 1500);
      const noWords = await page.eval(`return { text: document.getElementById("view").innerText.trim(), cards: document.querySelectorAll("#view .card").length, tabs: document.querySelectorAll(".tabbar button").length };`);
      site.override.clear();
      const appWords = JSON.parse(fs.readFileSync(path.join(ROOT, "i18n", lang, "app.json"), "utf8"));
      states++;
      if (noWords.cards === 0 && noWords.tabs === 0 && noWords.text === appWords.load_error) {
        if (lang === "th") console.log("ok   th economy: its texts do not load  " + noWords.text);
      } else {
        bad++;
        console.log(`FAIL ${lang} economy: its texts do not load\n       ` + JSON.stringify(noWords).slice(0, 300));
      }
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
      // a price far from the Thai price of that day is refused on the page already; a phone number and a link in
      // the place are flagged (the bot takes them out) - audit 2026-10-02, P0-3
      const formState = `const p = document.querySelector(".own-rubber"); return { bad: [...p.querySelectorAll(".up-check.bad")].map((x) => x.textContent).join(" / "), warn: [...p.querySelectorAll(".up-check.warn")].map((x) => x.textContent).join(" / "), disabled: p.querySelector(".up-panel .btn-primary").disabled };`;
      await type(".own-rubber .up-grid input[inputmode='numeric']", "150000");
      const far = await page.eval(formState);
      await type(".own-rubber .up-grid input[inputmode='numeric']", "18500");
      await type(".own-rubber .up-grid input[type='text']:not([inputmode])", "020 5555 1234 www.x.com");
      const junk = await page.eval(formState);
      const rub2 = await page.eval(CHECK);
      if (!far.disabled || !/\d/.test(far.bad)) rub2.badText.push("a price of 150,000 was not refused: " + JSON.stringify(far));
      if (junk.disabled || junk.bad || !junk.warn) rub2.badText.push("phone number and link in the place were not flagged: " + JSON.stringify(junk));
      report(`${lang} ${width} rubber form: far price refused, junk text flagged`, rub2, lang === "th" && width === 380 ? `${far.bad} || ${junk.warn}` : "");
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
      // a price per square metre far below the official assessed prices of the capital is refused
      await page.eval(`const i = document.querySelectorAll(${JSON.stringify(nums)}); i[0].value = "1"; i[0].dispatchEvent(new Event("input", { bubbles: true }));`);
      await sleep(200);
      const low = await page.eval(`const p = document.querySelector(".own-land"); return { bad: [...p.querySelectorAll(".up-check.bad")].map((x) => x.textContent).join(" / "), disabled: p.querySelector(".up-panel .btn-primary").disabled };`);
      const land2 = await page.eval(CHECK);
      if (!low.disabled || !/\d/.test(low.bad)) land2.badText.push("a land price of 1 baht for 2.5 rai was not refused: " + JSON.stringify(low));
      report(`${lang} ${width} land form: far price refused`, land2, lang === "th" && width === 380 ? low.bad : "");
      await page.eval(`const i = document.querySelectorAll(${JSON.stringify(nums)}); i[0].value = "1500000"; i[0].dispatchEvent(new Event("input", { bubbles: true }));`);
      await sleep(150);
      await page.eval(`document.querySelector(".own-land").scrollIntoView({ block: "start" }); window.scrollBy(0, -70);`);
      await sleep(200);
      await page.shot(path.join(SHOTS, `form-land-${lang}-${width}.png`));
      await page.eval(`[...document.querySelectorAll(".own-land .up-actions button")].pop().click();`); // cancel
    }
    // ---------- 3b. saving with the owner's key (apps-script/save-prices.gs answers from the test server) ----------
    // The page's file names a save address: the Form is not used, a wrong key saves nothing, the right key saves
    // one row and is kept on this device. The script's own code answers; nothing leaves this machine.
    {
      const script = loadScript();
      const sheet = fakeSheet();
      const realForm = JSON.parse(fs.readFileSync(path.join(ROOT, "data/manual-form.json"), "utf8"));
      const keyed = { save_url: BASE + "__save", sheet_id: null, entries: Object.fromEntries(Object.keys(script.roles(HEADERS)).map((r) => [r, r])), direct_submit_ok: true, limits: realForm.limits };
      site.override.set("/data/manual-form.json", JSON.stringify(keyed));
      site.handle = (req, res) => {
        if (!req.url.startsWith("/__save")) return false;
        let body = "";
        req.on("data", (d) => (body += d));
        req.on("end", () => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(script.handle(body, sheet.env())));
        });
        return true;
      };
      const words = (lang) => JSON.parse(fs.readFileSync(path.join(ROOT, "i18n", lang, "app.json"), "utf8"));
      const look = `const p = document.querySelector(".own-rubber"); const st = p.querySelector(".up-save-status"); const link = p.querySelector(".up-actions a"); return { field: !!p.querySelector(".up-key input[type=password]"), stored: !!p.querySelector(".up-key-forget"), disabled: (p.querySelector(".up-panel .btn-primary") || {}).disabled, status: st ? st.textContent : "", cls: st ? st.className : "", open: !!p.querySelector(".up-panel"), link: link ? !link.hidden && getComputedStyle(link).display !== "none" : false, kept: localStorage.getItem("save_key") };`;
      const press = `document.querySelector(".own-rubber .up-panel .btn-primary").click();`;
      const warned = `(document.querySelector(".own-rubber .up-save-status") || {}).className === "up-save-status warn"`;
      for (const [lang, width] of [["th", 380], ["lo", 380], ["th", 1440]]) {
        const t = words(lang);
        sheet.rows.length = 0;
        await page.size(width, width < 700 ? 820 : 900, width < 700);
        await page.eval(`localStorage.removeItem("save_key");`);
        await open(lang, { eco_tab: "rubber", eco_rubber_view: "mine" });
        await page.eval(`document.querySelector(".own-rubber .btn-primary").click();`);
        await page.until(`document.querySelector(".own-rubber .up-key")`, 5000);
        await sleep(500);
        await type(".own-rubber .up-grid input[inputmode='numeric']", "18500");
        const r = await page.eval(CHECK);
        const first = await page.eval(look);
        if (!first.field || first.stored || !first.disabled || first.link) r.badText.push("before a key is typed: " + JSON.stringify(first));
        // a wrong key
        await type(".own-rubber .up-key input", "not-the-owners-key-123");
        const ready = await page.eval(look);
        await page.eval(press);
        await page.until(warned, 8000);
        const wrong = await page.eval(look);
        if (ready.disabled || wrong.status !== t.up_save_key || sheet.rows.length !== 0 || wrong.kept || !wrong.field || !wrong.open) r.badText.push("a wrong key: " + JSON.stringify(wrong) + " rows " + sheet.rows.length);
        const rWrong = await page.eval(CHECK);
        report(`${lang} ${width} save with key: a wrong key saves nothing and is not kept`, rWrong, lang === "th" && width === 380 ? wrong.status : "");
        if (width === 380) {
          await page.eval(`document.querySelector(".own-rubber .up-key").scrollIntoView({ block: "center" });`);
          await sleep(200);
          await page.shot(path.join(SHOTS, `save-key-wrong-${lang}-${width}.png`));
        }
        // the right key
        await type(".own-rubber .up-key input", KEY);
        await page.eval(press);
        await page.until(`!document.querySelector(".own-rubber .up-panel") && document.querySelector(".own-rubber .up-save-status.ok")`, 8000);
        const done = await page.eval(look);
        const row = sheet.rows[0] || [];
        const cols = script.roles(HEADERS);
        if (sheet.rows.length !== 1 || row[cols.rubber_price] !== 18500 || row[cols.rubber_type] !== "ยางก้อนถ้วย" || !/^\d{4}-\d{2}-\d{2}$/.test(row[cols.date]) || done.kept !== KEY) r.badText.push("the right key: " + JSON.stringify(done) + " rows " + JSON.stringify(sheet.rows));
        report(`${lang} ${width} save with key: the right key saves one row`, r, lang === "th" && width === 380 ? JSON.stringify(row.filter((c) => c !== "")) : "");
        // the next entry: the key is not asked for again; it can be removed from this device
        await page.eval(`document.querySelector(".own-rubber .btn-primary").click();`);
        await page.until(`document.querySelector(".own-rubber .up-key")`, 5000);
        await sleep(300);
        const again = await page.eval(look);
        const r2 = await page.eval(CHECK);
        if (again.field || !again.stored || again.link) r2.badText.push("the next entry: " + JSON.stringify(again));
        if (width === 380) {
          await page.eval(`document.querySelector(".own-rubber .up-key").scrollIntoView({ block: "center" });`);
          await sleep(200);
          await page.shot(path.join(SHOTS, `save-key-kept-${lang}-${width}.png`));
        }
        await page.eval(`document.querySelector(".own-rubber .up-key-forget").click();`);
        await sleep(300);
        const forgot = await page.eval(look);
        if (!forgot.field || forgot.stored || forgot.kept) r2.badText.push("after the key was removed: " + JSON.stringify(forgot));
        report(`${lang} ${width} save with key: kept for the next entry, and removable`, r2);
        // no answer from the script: said plainly, nothing kept
        await type(".own-rubber .up-grid input[inputmode='numeric']", "18500");
        await type(".own-rubber .up-key input", KEY);
        await block(["*__save*"]);
        await page.eval(press);
        await page.until(warned, 8000);
        const lost = await page.eval(look);
        await block([]);
        const r3 = await page.eval(CHECK);
        if (lost.status !== t.up_save_failed || sheet.rows.length !== 1 || lost.kept) r3.badText.push("no answer: " + JSON.stringify(lost));
        report(`${lang} ${width} save with key: no answer is said plainly`, r3, lang === "th" && width === 380 ? lost.status : "");
        // the gold page asks for the same key
        await open(lang, {}, "gold");
        await page.eval(`[...document.querySelectorAll(".upload-card .up-actions button")].find((b) => !b.classList.contains("btn-primary")).click();`);
        await page.until(`document.querySelector(".upload-card .up-key")`, 5000);
        const gold = await page.eval(`const p = document.querySelector(".upload-card"); const link = p.querySelector(".up-panel .up-actions a"); return { field: !!p.querySelector(".up-key input[type=password]"), link: link ? !link.hidden && getComputedStyle(link).display !== "none" : false };`);
        const r4 = await page.eval(CHECK);
        if (!gold.field || gold.link) r4.badText.push("gold form: " + JSON.stringify(gold));
        report(`${lang} ${width} save with key: the gold form asks for the key, no Form link`, r4);
        await page.eval(`localStorage.removeItem("save_key");`);
      }
      site.override.delete("/data/manual-form.json");
      site.handle = null;
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
