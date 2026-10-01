// The states the big matrix does not reach: every year x kind of rubber x seller/buyer choice, every road class of
// the land table, and the two entry forms opened and filled in (NOT saved: requests to Google are blocked here).
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
