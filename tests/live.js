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
      ["rubber market", { eco_tab: "rubber", eco_rubber_view: "market" }, "economy"],
      ["rubber by province", { eco_tab: "rubber", eco_rubber_view: "lao" }, "economy"],
      ["rubber ASEAN", { eco_tab: "rubber", eco_rubber_view: "asean" }, "economy"],
      ["rubber world", { eco_tab: "rubber", eco_rubber_view: "world" }, "economy"],
      ["rubber own prices", { eco_tab: "rubber", eco_rubber_view: "mine" }, "economy"],
      ["land", { eco_tab: "land" }, "economy"],
    ]) {
      const r = await open(store, hash, name.replace(/ /g, ""));
      check("live screen: " + name, r.cards > 0 && r.overflow <= 0 && !r.badText.length && !r.placeholders.length, JSON.stringify(r));
    }
    // the entry form knows the new questions (no "question missing" line), nothing is sent
    await open({ eco_tab: "rubber", eco_rubber_view: "mine" }, "economy", "form");
    await page.eval(`document.querySelector(".own-rubber .btn-primary").click();`);
    await page.until(`document.querySelector(".own-rubber .up-panel")`, 5000);
    await sleep(1500);
    await page.eval(`const i = document.querySelector(".own-rubber .up-grid input[inputmode='numeric']"); i.value = "18500"; i.dispatchEvent(new Event("input", { bubbles: true }));`);
    await sleep(300);
    const form = await page.eval(`const p = document.querySelector(".own-rubber"); return { checks: [...p.querySelectorAll(".up-check")].map((x) => x.textContent).join(" / "), save: p.querySelector(".up-panel .btn-primary").disabled ? "disabled" : "enabled" };`);
    check("live: rubber entry form ready (questions found in the real form)", form.save === "enabled" && form.checks.startsWith("✓"), JSON.stringify(form));
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
