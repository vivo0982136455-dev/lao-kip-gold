// The top bar with the offline label on every page (Thai + Lao, 380 px), and the "opened as an app" state of the
// install card. Usage: node tests/offline-label.js
const path = require("path");
const { ROOT, SHOTS, launch, startSite, sleep } = require("./browser.js");
const PORT = 8095;
const BASE = `http://127.0.0.1:${PORT}/`;
const PAGES = ["overview", "rates", "gold", "living", "economy", "forecast", "settings", "method"];
(async () => {
  const site = await startSite(ROOT, PORT);
  const browser = await launch({ port: 9333 });
  let bad = 0;
  try {
    const page = await browser.newPage({ width: 380, height: 820 });
    await page.goto(BASE + "#/overview", 1500);
    await page.eval(`await navigator.serviceWorker.ready;`);
    await sleep(6500);
    for (const lang of ["th", "lo"]) {
      site.mode = "ok";
      await page.eval(`localStorage.setItem("lang", "${lang}");`);
      for (const p of PAGES) await page.goto(BASE + "#/" + p, 900); // online once: everything saved
      site.mode = "down";
      for (const p of PAGES) {
        await page.goto(BASE + "?x=" + lang + "#/" + p, 1200);
        const r = await page.eval(`const bar = document.querySelector(".topbar"); const h1 = bar.querySelector("h1"); const up = document.getElementById("topbar-updated"); return { chip: !!document.querySelector(".offline-chip"), barH: Math.round(bar.getBoundingClientRect().height), h1: h1.textContent, h1H: Math.round(h1.getBoundingClientRect().height), h1W: Math.round(h1.getBoundingClientRect().width), upH: Math.round(up.getBoundingClientRect().height), upW: Math.round(up.getBoundingClientRect().width), overflow: document.documentElement.scrollWidth - innerWidth };`);
        const ok = r.chip && r.overflow <= 0;
        if (!ok) bad++;
        console.log((ok ? "PASS " : "FAIL ") + lang + " " + p.padEnd(9) + JSON.stringify(r));
        if (p === "forecast" || p === "living") {
          await page.s("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 380, height: 70, scale: 2 } }).then((x) => require("fs").writeFileSync(path.join(SHOTS, `pwa-topbar-${lang}-${p}.png`), Buffer.from(x.data, "base64")));
        }
      }
    }
    // opened as an app: the browser reports display-mode "standalone"
    site.mode = "ok";
    await page.eval(`localStorage.setItem("lang", "th");`);
    await page.s("Page.addScriptToEvaluateOnNewDocument", { source: `const real = window.matchMedia.bind(window); window.matchMedia = (q) => (q.includes("display-mode: standalone") ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : real(q));` });
    await sleep(31000); // the 30 s "slow / offline" period of the worker
    await page.goto(BASE + "?app=1#/settings", 1500);
    const app = await page.eval(`const c = document.querySelector(".install-card"); return { text: c.innerText, button: !!c.querySelector("button"), gapAbove: Math.round(c.getBoundingClientRect().top - c.previousElementSibling.getBoundingClientRect().bottom) };`);
    const okApp = app.text.includes("กำลังเปิดแบบแอปอยู่") && !app.button && app.gapAbove === 12;
    if (!okApp) bad++;
    console.log((okApp ? "PASS " : "FAIL ") + "opened as an app: " + JSON.stringify(app));
    await page.eval(`document.querySelector(".install-card").scrollIntoView({ block: "center" });`);
    await sleep(300);
    await page.shot(path.join(SHOTS, "pwa-settings-app-380.png"));
    console.log("console lines:", page.errors.filter((e) => !/Failed to load resource|net::ERR/.test(e)).join(" || ") || "none unexpected");
  } catch (e) {
    bad++;
    console.log("FAIL run", e.stack || e);
  } finally {
    await browser.close();
    site.close();
  }
  console.log(bad ? bad + " failed" : "all passed");
  process.exit(bad ? 1 : 0);
})();
