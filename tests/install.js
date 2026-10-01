// "Install as an app" + the offline copy (sw.js), on a local copy of the site whose server can be switched to
// "down" and "slow". Usage: node tests/install.js   (takes ~2 minutes: it waits out the worker's 30 s slow period)
const path = require("path");
const { ROOT, SHOTS, launch, startSite, sleep } = require("./browser.js");

const PORT = 8094;
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = SHOTS;
const results = [];
const check = (name, ok, detail = "") => {
  results.push([ok, name, detail]);
  console.log((ok ? "PASS  " : "FAIL  ") + name + (detail ? "  -> " + detail : ""));
};

(async () => {
  const site = await startSite(ROOT, PORT);
  const browser = await launch({ port: 9333 });
  try {
    const page = await browser.newPage({ width: 380, height: 820 });

    // ---------- 1. first visit: the worker installs and saves what the page loaded ----------
    await page.goto(BASE + "#/settings");
    const scope = await page.eval(`const r = await Promise.race([navigator.serviceWorker.ready, new Promise((x) => setTimeout(() => x(null), 8000))]); return r && r.scope;`);
    check("service worker registered", scope === BASE, String(scope));
    await sleep(7000); // the second "warm" message is sent 5 s after the worker took over
    const saved = await page.eval(`const out = {}; for (const k of await caches.keys()) { const c = await caches.open(k); out[k] = (await c.keys()).map((r) => r.url); } return out;`);
    const siteFiles = (saved["lkg-site-1"] || []).map((u) => u.replace(BASE, ""));
    const libFiles = saved["lkg-libs-1"] || [];
    console.log("   site files saved:", siteFiles.length, "| lib files saved:", libFiles.length);
    console.log("   libs:", libFiles.map((u) => u.slice(0, 70)).join("\n         "));
    for (const need of ["", "css/style.css", "js/app.js", "js/pwa.js", "js/charts.js", "js/pages/settings.js", "js/pages/eco-rubber.js", "i18n/th.json", "data/summary.json", "data/economy.json", "data/forecast/hints.json"]) {
      check("saved after first visit: " + (need || "(page)"), siteFiles.includes(need));
    }
    check("no file saved twice because of ?query", siteFiles.every((u) => !u.includes("?")));
    check("chart library saved", libFiles.some((u) => u.includes("chart.umd")));
    check("font style sheet saved", libFiles.some((u) => u.startsWith("https://fonts.googleapis.com/")));
    check("font files saved", libFiles.some((u) => u.startsWith("https://fonts.gstatic.com/")));

    // ---------- 2. the manifest, as the browser reads it ----------
    const man = await page.s("Page.getAppManifest");
    check("manifest found", !!man.url && man.url.endsWith("manifest.webmanifest"), man.url);
    check("manifest has no errors", (man.errors || []).length === 0, JSON.stringify(man.errors));
    const inst = await page.s("Page.getInstallabilityErrors");
    check("no installability errors", (inst.installabilityErrors || []).length === 0, JSON.stringify(inst.installabilityErrors));
    const parsed = JSON.parse(man.data);
    console.log("   name:", parsed.name, "| short_name:", parsed.short_name, "| start_url:", parsed.start_url, "| display:", parsed.display);
    const iconInfo = await page.eval(`const out = []; for (const src of ["icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png"]) { const img = new Image(); img.src = src; await img.decode(); out.push(src + " " + img.naturalWidth + "x" + img.naturalHeight); } return out;`);
    check("icons load with the declared sizes", iconInfo.join(",") === "icons/icon-192.png 192x192,icons/icon-512.png 512x512,icons/icon-maskable-512.png 512x512,icons/apple-touch-icon.png 180x180", iconInfo.join(" | "));

    // ---------- 3. second visit: the worker controls the page ----------
    await page.reload(1500);
    const second = await page.eval(`const nav = performance.getEntriesByType("navigation")[0]; return { controlled: !!navigator.serviceWorker.controller, workerStart: nav.workerStart > 0, chip: !!document.querySelector(".offline-chip"), title: document.title, updated: document.getElementById("topbar-updated").textContent };`);
    check("second visit is controlled by the worker", second.controlled && second.workerStart, JSON.stringify(second));
    check("online: no offline label", !second.chip, second.updated);
    const card = await page.eval(`const c = document.querySelector(".install-card"); return c ? c.innerText : null;`);
    check("settings page shows the install card", !!card && card.includes("ติดตั้งเป็นแอป"));
    await page.eval(`document.querySelector(".install-card").scrollIntoView({ block: "center" });`);
    await sleep(300);
    await page.shot(path.join(OUT, "pwa-settings-th-380.png"));

    // ---------- 4. the browser's install offer (simulated event; the real one needs a visible browser) ----------
    await page.eval(`const e = new Event("beforeinstallprompt", { cancelable: true }); window.__prompted = 0; e.prompt = () => { window.__prompted++; }; e.userChoice = Promise.resolve({ outcome: "dismissed" }); window.dispatchEvent(e); window.__prevented = e.defaultPrevented;`);
    await sleep(300);
    const ready = await page.eval(`const b = document.querySelector(".install-card .btn-primary"); return { button: b ? b.textContent : null, prevented: window.__prevented };`);
    check("install offer -> the button appears", !!ready.button && ready.prevented, JSON.stringify(ready));
    await page.eval(`document.querySelector(".install-card").scrollIntoView({ block: "center" });`);
    await sleep(300);
    await page.shot(path.join(OUT, "pwa-settings-button-380.png"));
    await page.eval(`document.querySelector(".install-card .btn-primary").click();`);
    await sleep(400);
    const after = await page.eval(`return { prompted: window.__prompted, button: !!document.querySelector(".install-card .btn-primary") };`);
    check("tap -> the browser's question is shown once, the button goes away after a 'no'", after.prompted === 1 && !after.button, JSON.stringify(after));
    await page.eval(`window.dispatchEvent(new Event("appinstalled"));`);
    await sleep(300);
    const installedText = await page.eval(`return document.querySelector(".install-card").innerText;`);
    check("after install: the card says installed", installedText.includes("ติดตั้งแล้ว"), installedText.split("\\n")[2] || "");

    // ---------- 5. no connection ----------
    await page.goto(BASE + "#/overview", 1500); // visit a few pages online first (their lazy data gets saved)
    await page.goto(BASE + "#/economy", 2500);
    site.mode = "down";
    site.hits.length = 0;
    await page.goto(BASE + "?offline=1#/overview", 2500);
    const off = await page.eval(`return { chip: document.querySelector(".offline-chip") ? document.querySelector(".offline-chip").textContent : null, updated: document.getElementById("topbar-updated").textContent, title: document.title, cards: document.querySelectorAll(".card").length, charts: document.querySelectorAll("canvas").length, fonts: [...document.fonts].filter((f) => f.status === "loaded").length, chartLib: typeof Chart };`);
    check("offline: the page still opens from the saved copy", off.cards > 3 && off.chartLib === "function", JSON.stringify(off));
    check("offline: label shown in the top bar", off.chip === "ออฟไลน์", off.updated);
    check("offline: fonts come from the saved copy", off.fonts > 0, "loaded font faces: " + off.fonts);
    await page.shot(path.join(OUT, "pwa-offline-overview-380.png"));
    await page.goto(BASE + "?offline=1#/gold", 1500);
    const offGold = await page.eval(`return { cards: document.querySelectorAll(".card").length, text: document.getElementById("view").innerText.slice(0, 80) };`);
    check("offline: another page opens", offGold.cards > 2, JSON.stringify(offGold));
    await page.goto(BASE + "?offline=1#/economy", 2000);
    const offEco = await page.eval(`return { cards: document.querySelectorAll(".card").length, text: document.getElementById("view").innerText.slice(0, 80) };`);
    check("offline: economy page (lazy data saved earlier) opens", offEco.cards > 2, JSON.stringify(offEco));

    // ---------- 6. the connection comes back: the numbers refresh by themselves ----------
    site.mode = "ok";
    await page.goto(BASE + "?online=1#/overview", 1500); // a real new load (network first)
    const back = await page.eval(`return { chip: !!document.querySelector(".offline-chip"), visible: document.visibilityState };`);
    check("online again: a new load has no offline label", !back.chip, JSON.stringify(back));
    // now the case "the page stays open": go offline, load, come back, fire the browser's 'online' event
    site.mode = "down";
    await page.reload(2500);
    const stay1 = await page.eval(`return !!document.querySelector(".offline-chip");`);
    site.mode = "ok";
    await page.eval(`window.dispatchEvent(new Event("online"));`);
    const cleared = await page.until(`!document.querySelector(".offline-chip")`, 8000);
    check("page left open: label appears offline and goes away when the connection is back", stay1 && cleared, `offline label: ${stay1}, cleared: ${cleared}`);

    // ---------- 7. a very slow connection: the saved copy after ~4 s, then straight away ----------
    site.mode = "slow";
    const t0 = Date.now();
    await page.goto(BASE + "?slow=1#/overview", 300);
    await page.until(`document.querySelectorAll(".card").length > 3`, 30000);
    const slowMs = Date.now() - t0;
    const slow = await page.eval(`return { chip: !!document.querySelector(".offline-chip"), cards: document.querySelectorAll(".card").length };`);
    check("slow network: page is on screen in well under the 6 s the server needs per file", slowMs < 9000 && slow.cards > 3, slowMs + " ms, " + JSON.stringify(slow));
    check("slow network: label shown (numbers are the saved copy)", slow.chip);
    site.mode = "ok";
    await sleep(7000); // the slow answers arrive and renew the saved copies

    await sleep(24000); // let the 30 s "slow" period of the worker pass (the app state is tested in test-pwa2.js)

    // ---------- 9. Lao + light theme of the install card ----------
    await page.eval(`localStorage.setItem("lang", "lo"); localStorage.setItem("theme", "light");`);
    await page.goto(BASE + "?lo=1#/settings", 1500);
    const lo = await page.eval(`const c = document.querySelector(".install-card"); return { text: c.innerText.slice(0, 60), overflow: document.documentElement.scrollWidth - innerWidth };`);
    check("Lao install card, no sideways scroll", lo.text.includes("ຕິດຕັ້ງ") && lo.overflow <= 0, JSON.stringify(lo));
    await page.eval(`document.querySelector(".install-card").scrollIntoView({ block: "center" });`);
    await sleep(300);
    await page.shot(path.join(OUT, "pwa-settings-lo-light-380.png"));
    await page.eval(`localStorage.setItem("lang", "th"); localStorage.setItem("theme", "dark");`);

    const errs = page.errors.filter((e) => !/ERR_EMPTY_RESPONSE|ERR_CONNECTION|Failed to load resource|net::ERR/.test(e));
    check("no unexpected console errors", errs.length === 0, errs.slice(0, 6).join(" || "));
    if (page.errors.length) console.log("   (all console lines, incl. the expected network failures of the offline test: " + page.errors.length + ")");
  } catch (e) {
    check("test run", false, e.stack || String(e));
  } finally {
    await browser.close();
    site.close();
  }
  console.log("server answers: full " + site.full + ", not-modified " + site.notModified);
  const failed = results.filter(([ok]) => !ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  process.exit(failed.length ? 1 : 0);
})();
