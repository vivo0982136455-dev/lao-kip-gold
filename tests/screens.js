// Every screen of the site x Thai / Lao x dark / light x phone 380 / tablet 768 / desktop 1440, in a real Edge (headless).
// 768 px is the layout in between (audit 2026-10-02, P3-3): two columns of cards and four tiles in a row (from 640 px),
// but still the phone's bottom bar and no side menu (up to 899 px).
// Checks: no sideways scroll, nothing sticking out of the screen or out of its own tile / card, no "undefined" / "NaN" / unfilled {placeholder},
// every chart drawn, no console errors. Saves pictures of the screens for a look by eye.
// Usage: node tests/screens.js [quick] [th|lo] [dark|light] [380|768|1440]
//   no word = everything (288 screens) · quick = Thai dark phone only (24 screens)
//   a language, a theme or a width = only that one, e.g. "node tests/screens.js 768 dark" (48 screens)
const fs = require("fs");
const path = require("path");
const { ROOT, SHOTS, launch, startSite, sleep } = require("./browser.js");

const PORT = 8096;
const BASE = `http://127.0.0.1:${PORT}/`;
const args = process.argv.slice(2);
const quick = args.includes("quick");
const LANGS = ["th", "lo"];
const THEMES = ["dark", "light"];
const WIDTHS = [380, 768, 1440];
// the words on the command line that name a language, a theme or a width; none of a kind = all of that kind
const only = (all) => {
  const named = all.filter((x) => args.includes(String(x)));
  return named.length ? named : all;
};
const unknown = args.filter((a) => a !== "quick" && ![...LANGS, ...THEMES, ...WIDTHS.map(String)].includes(a));
if (unknown.length) {
  console.log(`Unknown word: ${unknown.join(", ")}. Usage: node tests/screens.js [quick] [th|lo] [dark|light] [380|768|1440]`);
  process.exit(2);
}
const PHONE_BELOW = 700; // narrower than this: a phone (touch, no scroll bar that takes room)
const BOTTOM_BAR_BELOW = 900; // narrower than this the site shows the bottom bar (css/style.css)

// screen id -> [page, localStorage values]
const SCREENS = [
  ["overview", "overview", {}],
  ["rates", "rates", {}],
  ["gold", "gold", {}],
  ["living", "living", {}],
  ["forecast", "forecast", {}],
  ["settings", "settings", {}],
  ["method", "method", {}],
  ...["overview", "compare", "population", "wages", "gdp", "plan", "policy", "fdi", "debt", "inflation"].map((tab) => ["eco-" + tab, "economy", { eco_tab: tab }]),
  ...["market", "buyers", "lao", "asean", "world", "mine"].map((v) => ["rubber-" + v, "economy", { eco_tab: "rubber", eco_rubber_view: v }]),
  ["land", "economy", { eco_tab: "land" }],
];
const LOADING = { th: "กำลังโหลดข้อมูล", lo: "ກຳລັງໂຫຼດຂໍ້ມູນ" };

const CHECK = `
  const out = { overflow: document.documentElement.scrollWidth - innerWidth, wide: [], badText: [], placeholders: [], cards: document.querySelectorAll("#view .card").length, canvases: 0, deadCharts: 0, height: document.documentElement.scrollHeight };
  const vw = innerWidth;
  const inScroller = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { if (/(auto|scroll)/.test(getComputedStyle(p).overflowX)) return true; } return false; };
  for (const el of document.querySelectorAll("#view *, .topbar *, .bottom-nav *")) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if ((r.right > vw + 1 || r.left < -1) && !inScroller(el)) out.wide.push(el.tagName.toLowerCase() + "." + String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).slice(0, 30) + ": " + (el.textContent || "").trim().slice(0, 40) + " [" + Math.round(r.left) + ".." + Math.round(r.right) + "]");
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = walker.currentNode.nodeValue;
    if (!text.trim()) continue;
    const parent = walker.currentNode.parentElement;
    if (parent && (parent.tagName === "SCRIPT" || parent.tagName === "STYLE")) continue;
    if (/\\bundefined\\b|\\bNaN\\b|\\[object |\\bnull\\b|Infinity/.test(text)) out.badText.push(text.trim().slice(0, 80));
    if (/\\{[a-z_0-9]+\\}/.test(text)) out.placeholders.push(text.trim().slice(0, 80));
  }
  for (const c of document.querySelectorAll("#view canvas")) {
    out.canvases++;
    const chart = window.Chart && Chart.getChart(c);
    const r = c.getBoundingClientRect();
    if (!chart || r.width < 50 || r.height < 50) out.deadCharts++;
  }
  // text that sticks out of its own tile or card (it can still be inside the screen, so the check above misses it)
  for (const box of document.querySelectorAll("#view .stat, #view .card")) {
    if (box.scrollWidth > box.clientWidth + 2) out.wide.push("wider than its box: " + (box.className || "") + ": " + (box.textContent || "").trim().slice(0, 40) + " [" + box.scrollWidth + " > " + box.clientWidth + "]");
  }
  out.wide = out.wide.slice(0, 5);
  return out;
`;

async function shots(page, name, width) {
  const sliceH = width < PHONE_BELOW ? 1700 : 1300;
  const total = await page.eval(`return document.documentElement.scrollHeight;`);
  const n = Math.min(Math.ceil(total / sliceH), 7);
  for (let i = 0; i < n; i++) {
    const r = await page.s("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: i * sliceH, width, height: Math.min(sliceH, total - i * sliceH), scale: 1 } });
    fs.writeFileSync(path.join(SHOTS, `${name}-${i + 1}.png`), Buffer.from(r.data, "base64"));
  }
  return n;
}

(async () => {
  const site = await startSite(ROOT, PORT);
  const browser = await launch({ port: 9335 });
  const problems = [];
  let screens = 0;
  try {
    const page = await browser.newPage({ width: 380, height: 820 });
    let n = 0;
    const combos = [];
    for (const lang of quick ? ["th"] : only(LANGS)) for (const theme of quick ? ["dark"] : only(THEMES)) for (const width of quick ? [380] : only(WIDTHS)) combos.push([lang, theme, width]);
    await page.goto(BASE + "#/overview", 500);
    for (const [lang, theme, width] of combos) {
      // a tablet is a touch device like a phone (no scroll bar that takes 15 px of the width), only taller
      await page.size(width, width < PHONE_BELOW ? 820 : width < BOTTOM_BAR_BELOW ? 1024 : 900, width < BOTTOM_BAR_BELOW);
      for (const [id, route, store] of SCREENS) {
        const values = { lang, theme, range: "30", ...store };
        await page.eval(`const v = ${JSON.stringify(values)}; for (const k of Object.keys(v)) localStorage.setItem(k, v[k]);`);
        page.errors.length = 0;
        await page.goto(`${BASE}?m=${++n}#/${route}`, 200);
        await page.until(`!document.querySelector(".skeleton") && document.querySelectorAll("#view .card").length > 0 && !document.getElementById("view").innerText.includes(${JSON.stringify(LOADING[lang])})`, 15000);
        await page.eval(`await document.fonts.ready;`);
        await sleep(900); // chart draw-in
        const closed = await page.eval(CHECK);
        // the tables under the charts ("view as table") are closed by default: open them all and check again
        await page.eval(`document.querySelectorAll("#view details").forEach((d) => (d.open = true));`);
        await sleep(150);
        const open = await page.eval(CHECK);
        const name = `${lang}-${theme}-${width}-${id}`;
        const errs = page.errors.filter((e) => !/cdnjs|ERR_CONNECTION_RESET|net::ERR_FAILED/.test(e));
        const bad = [];
        for (const [label, r] of [["", closed], ["tables open: ", open]]) {
          if (r.overflow > 0) bad.push(label + "page scrolls sideways by " + r.overflow + " px");
          if (r.wide.length) bad.push(label + "outside the screen: " + r.wide.join(" | "));
          if (r.badText.length) bad.push(label + "bad text: " + [...new Set(r.badText)].slice(0, 4).join(" | "));
          if (r.placeholders.length) bad.push(label + "unfilled placeholder: " + [...new Set(r.placeholders)].slice(0, 4).join(" | "));
          if (r.deadCharts) bad.push(label + r.deadCharts + " of " + r.canvases + " charts not drawn");
          if (!r.cards) bad.push(label + "no cards");
        }
        if (errs.length) bad.push("console: " + [...new Set(errs)].slice(0, 3).join(" | "));
        await page.eval(`document.querySelectorAll("#view details").forEach((d) => (d.open = false)); window.scrollTo(0, 0);`);
        const pics = await shots(page, name, width);
        screens++;
        console.log(`${bad.length ? "FAIL" : "ok  "} ${name.padEnd(34)} cards ${String(closed.cards).padStart(2)} charts ${closed.canvases} height ${closed.height} pics ${pics}` + (bad.length ? "\n       " + bad.join("\n       ") : ""));
        if (bad.length) problems.push([name, bad]);
      }
    }
  } catch (e) {
    problems.push(["run", [e.stack || String(e)]]);
    console.log("FAIL run", e.stack || e);
  } finally {
    await browser.close();
    site.close();
  }
  console.log(`\n${screens} screens checked, ${problems.length} with problems`);
  process.exit(problems.length ? 1 : 0);
})();
