// What the page may load, and from where (audit 2026-10-02, P2-9). In a real Edge (headless):
//   1. the files say what they should: a Content-Security-Policy above every script, no inline script, no inline
//      event handler, integrity hashes on the chart library (both CDNs), GitHub Actions pinned to commits
//   2. the first CDN (cdnjs) is blocked -> the charts come from the second one (jsDelivr), checked by its hash
//   3. every page opens without one refusal by the policy (a refusal = something the policy forgot)
//   4. a chart file that does not match its hash is NOT run (the browser refuses it, also from the saved copy)
//   5. the picture reader (Tesseract) still works under the policy, and its entry file is refused with a wrong hash
//   6. a link from a data file that is not https never becomes a link
//   7. no connection at all (site and CDNs): the app opens from the copy on the device, charts included
// Needs the network (jsDelivr) for 2, 3 and 5. Usage: node tests/security.js
const fs = require("fs");
const path = require("path");
const { ROOT, SHOTS, launch, startSite, startTunnel, sleep } = require("./browser.js");

const PORT = 8103;
const TUNNEL = 8104;
const BASE = `http://127.0.0.1:${PORT}/`;
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log((ok ? "PASS  " : "FAIL  ") + name + (detail && !ok ? "\n      " + String(detail).slice(0, 700) : detail ? "  -> " + String(detail).slice(0, 200) : ""));
};
// what the browser prints when the policy or a hash refuses something
const REFUSED = /Content Security Policy|Refused to|violates the following|integrity/i;

// ---------- 1. the files ----------
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const csp = (/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html) || [])[1] || "";
const directive = (name) => (csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(name + " ")) || "").slice(name.length + 1);
const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]);
check("index.html: the policy stands above every script and style", csp && html.indexOf("Content-Security-Policy") < html.indexOf("<script") && html.indexOf("Content-Security-Policy") < html.indexOf('rel="stylesheet"'));
check("index.html: scripts may not be inline and may not use eval", /'self'/.test(directive("script-src")) && !/unsafe-inline|unsafe-eval'|'unsafe-hashes|\*(?!\.)| data:| http:/.test(directive("script-src").replace("'wasm-unsafe-eval'", "")), directive("script-src"));
check("index.html: every script tag names a file (no inline script)", scripts.length > 0 && scripts.every((a) => /\bsrc="/.test(a)), scripts.filter((a) => !/\bsrc="/.test(a)).join(" | "));
check("index.html: no inline event handler", !/\son[a-z]+\s*=/i.test(html.replace(/<!--[\s\S]*?-->/g, "")));
check("index.html: default is this site only; no plug-ins; forms go nowhere", directive("default-src") === "'self'" && directive("object-src") === "'none'" && directive("form-action") === "'none'" && directive("base-uri") === "'self'");
const cdnTag = scripts.find((a) => a.includes("cdnjs.cloudflare.com")) || "";
const cdnHash = (/integrity="(sha(?:384|512)-[A-Za-z0-9+/=]+)"/.exec(cdnTag) || [])[1];
const backup = fs.readFileSync(path.join(ROOT, "js", "chart-backup.js"), "utf8");
const backupHash = (/integrity = "(sha(?:384|512)-[A-Za-z0-9+/=]+)"/.exec(backup) || [])[1];
check("chart library: integrity hash and crossorigin on the first CDN, the same hash on the second", !!cdnHash && /crossorigin="anonymous"/.test(cdnTag) && cdnHash === backupHash && /crossOrigin = "anonymous"/.test(backup), `${cdnHash} / ${backupHash}`);
const flows = fs.readdirSync(path.join(ROOT, ".github", "workflows")).map((f) => [f, fs.readFileSync(path.join(ROOT, ".github", "workflows", f), "utf8")]);
const uses = flows.flatMap(([f, text]) => [...text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => `${f}: ${m[1]}`));
check("GitHub Actions: every action is pinned to a commit, not to a tag", uses.length >= 4 && uses.every((u) => /@[0-9a-f]{40}$/.test(u)), uses.join(" | "));
const ocr = fs.readFileSync(path.join(ROOT, "js", "ocr.js"), "utf8");
check("picture reader: its entry file has a pinned hash, and every address names an exact version", /TESSERACT_INTEGRITY = "sha384-[A-Za-z0-9+/=]{64}"/.test(ocr) && !/tesseract\.js(-core)?@(latest|\d+")/.test(ocr) && (ocr.match(/@\d+\.\d+\.\d+/g) || []).length >= 4);

(async () => {
  const site = await startSite(ROOT, PORT);
  const tunnel = await startTunnel(TUNNEL); // every https request (the CDNs, fonts) goes through it: off = no internet
  const browser = await launch({ port: 9367, args: [`--proxy-server=http://127.0.0.1:${TUNNEL}`] });
  try {
    const page = await browser.newPage({ width: 380, height: 820 });
    const refusals = () => page.errors.filter((e) => REFUSED.test(e));
    const chartState = `return { chart: typeof window.Chart, from: [...document.scripts].filter((s) => /chart(\\.umd)?\\.min\\.js|Chart\\.js/.test(s.src)).map((s) => (s.src.includes("jsdelivr") ? "jsdelivr" : "cdnjs") + (s.integrity ? "+hash" : "")), cards: document.querySelectorAll("#view .card").length, drawn: [...document.querySelectorAll("#view canvas")].filter((c) => window.Chart && Chart.getChart(c)).length };`;
    const ready = () => page.until(`document.querySelectorAll("#view .card").length > 0 && !document.querySelector(".skeleton")`, 20000);

    // ---------- 2. first CDN blocked on a first visit ----------
    await page.s("Network.setBlockedURLs", { urls: ["*cdnjs.cloudflare.com*"] });
    await page.goto(BASE + "#/overview", 500);
    await page.eval(`localStorage.setItem("lang", "th"); localStorage.setItem("theme", "dark"); localStorage.setItem("range", "30");`);
    await page.goto(BASE + "?first=1#/rates", 500);
    await ready();
    await page.until(`typeof window.Chart === "function" && document.querySelectorAll("#view canvas").length > 0 && [...document.querySelectorAll("#view canvas")].every((c) => Chart.getChart(c))`, 30000);
    const fallback = await page.eval(chartState);
    check("first CDN blocked: the charts come from the second CDN, checked by its hash", fallback.chart === "function" && fallback.from.includes("jsdelivr+hash") && fallback.drawn > 0, JSON.stringify(fallback));
    const wrongPolicy = refusals().filter((e) => !/cdnjs/.test(e));
    check("first CDN blocked: nothing else was refused", wrongPolicy.length === 0, wrongPolicy.join(" || "));

    // ---------- 3. every page under the policy ----------
    await page.s("Network.setBlockedURLs", { urls: [] });
    page.errors.length = 0;
    const SCREENS = [["overview", {}], ["rates", {}], ["gold", {}], ["living", {}], ["forecast", {}], ["settings", {}], ["method", {}],
      ...["overview", "compare", "population", "wages", "gdp", "plan", "policy", "fdi", "debt", "inflation", "bank", "rubber", "land"].map((tab) => ["economy", { eco_tab: tab }])];
    let n = 0;
    const seen = [];
    for (const [route, values] of SCREENS) {
      await page.eval(`const v = ${JSON.stringify(values)}; for (const k of Object.keys(v)) localStorage.setItem(k, v[k]);`);
      await page.goto(`${BASE}?p=${++n}#/${route}`, 300);
      await ready();
      await sleep(900);
      const s = await page.eval(chartState);
      seen.push(`${route}${values.eco_tab ? ":" + values.eco_tab : ""} ${s.cards} cards ${s.drawn} charts`);
      if (s.cards === 0) check(`page ${route} ${values.eco_tab || ""} opens`, false, JSON.stringify(s));
    }
    const refused = refusals().filter((e) => !/cdnjs\.cloudflare\.com.*(ERR_|net::)/.test(e));
    check(`all ${SCREENS.length} screens open and the policy refuses nothing`, refused.length === 0 && seen.length === SCREENS.length, refused.slice(0, 5).join(" || ") || seen.join(" · "));
    await page.shot(path.join(SHOTS, "security-method-380.png"));

    // ---------- 6. links from data files ----------
    const links = await page.eval(`const ui = await import("./js/ui.js"); return {
      js: ui.safeUrl("javascript:alert(1)"), data: ui.safeUrl("data:text/html,x"), http: ui.safeUrl("http://www.bol.gov.la/"), none: ui.safeUrl("not a link"), nothing: ui.safeUrl(null),
      user: ui.safeUrl("https://user:pw@example.org/"), ok: ui.safeUrl("https://www.bol.gov.la/en/ExchangRate"),
      badTag: ui.outLink("open", "javascript:alert(1)").tagName, goodTag: ui.outLink("open", "https://example.org/a").tagName, rel: ui.outLink("open", "https://example.org/a").rel,
      srcTag: ui.sourceLink({ source_name: "x", source_url: "http://example.org" }).tagName };`);
    check("a link from a data file becomes a link only when it is https", links.js === null && links.data === null && links.http === null && links.none === null && links.nothing === null && links.user === null && links.ok === "https://www.bol.gov.la/en/ExchangRate" && links.badTag === "SPAN" && links.goodTag === "A" && links.rel === "noopener" && links.srcTag === "SPAN", JSON.stringify(links));

    // ---------- 5. the picture reader under the policy ----------
    page.errors.length = 0;
    await page.goto(`${BASE}?ocr=1#/gold`, 300);
    await ready();
    const wrong = await page.eval(`const m = await import("./js/ocr.js"); try { await m.importChecked("https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.esm.min.js?check=wrong-hash", "sha384-" + "A".repeat(64)); return "ran"; } catch (e) { return "refused: " + e.message; }`);
    check("picture reader: an entry file that does not match its hash is refused", wrong.startsWith("refused"), wrong);
    page.errors.length = 0;
    const started = Date.now();
    // started in the page and asked for later: the first run downloads several megabytes, which can take longer
    // than one command to the browser may
    await page.eval(`
      window.__ocr = null;
      (async () => {
        const m = await import("./js/ocr.js");
        const c = document.createElement("canvas");
        c.width = 1100; c.height = 420;
        const g = c.getContext("2d");
        g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
        g.fillStyle = "#000"; g.font = "bold 54px Arial";
        g.fillText("30.09.2026", 40, 80);
        g.fillText("46.259.000      45.056.000", 40, 180);
        g.fillText("11.565.000      11.264.000", 40, 270);
        g.fillText("46.404.000      45.954.000", 40, 360);
        const blob = await new Promise((ok) => c.toBlob(ok, "image/png"));
        const text = await m.readImageText(blob, { score: m.priceScore, enough: 6 });
        const p = m.parsePhouvong(text);
        return { sell: p.ornament.sell, buy: p.ornament.buy, bar: p.bar.sell, date: p.date, found: p.found };
      })().then((v) => (window.__ocr = v), (e) => (window.__ocr = { error: String(e && e.message ? e.message : e) }));`);
    await page.until(`window.__ocr`, 300000);
    const read = await page.eval(`return window.__ocr || { timeout: true };`);
    check("picture reader: reads a test picture under the policy (engine, worker and language file load)", read && read.sell === 46259000 && read.buy === 45056000 && read.bar === 46404000 && read.date === "2026-09-30", `${JSON.stringify(read)} after ${Math.round((Date.now() - started) / 1000)} s`);
    const ocrRefused = refusals();
    check("picture reader: the policy refuses nothing it needs", ocrRefused.length === 0, ocrRefused.slice(0, 4).join(" || "));

    // ---------- 4. a chart file that does not match its hash ----------
    // the page and the backup loader with a WRONG hash for both CDNs: the browser must not run the file, although
    // the very same file is in its store by now (the saved copy is checked against the hash as well)
    const wrongHash = "sha512-" + "A".repeat(86) + "==";
    // (the loader gets a new address, so the browser cannot reuse the copy of it that it still has in memory)
    site.override.set("/index.html", html.replace(cdnHash, wrongHash).replace('src="js/chart-backup.js"', 'src="js/chart-backup.js?wrong=1"'));
    site.override.set("/js/chart-backup.js", backup.replace(backupHash, wrongHash));
    page.errors.length = 0;
    site.hits.length = 0;
    await page.goto(`${BASE}?bad=1#/rates`, 300);
    await ready();
    await sleep(5000);
    const bad = await page.eval(chartState);
    const said = page.errors.filter((e) => /integrity|digest/i.test(e));
    const asked = site.hits.filter((h) => h.startsWith("/?bad=1") || h.includes("chart-backup"));
    const tags = await page.eval(`return [...document.scripts].map((s) => s.src.replace(/^https?:\\/\\/[^/]+/, "").slice(-28) + " " + s.integrity.slice(7, 13)).join(" , ");`);
    check("a chart file with a wrong hash is not run (the page shows its numbers without charts)", bad.chart === "undefined" && bad.cards > 0 && said.length > 0, `${JSON.stringify(bad)} | ${said[0] || "no message from the browser"} | asked from the server: ${asked.join(" ") || "nothing"} | script tags: ${tags} | other messages: ${page.errors.slice(0, 3).join(" || ")}`);
    site.override.clear();

    // ---------- 7. no connection at all ----------
    await page.goto(`${BASE}?again=1#/overview`, 1500); // online once more: the right files are saved again
    await ready();
    await page.goto(`${BASE}?again=2#/rates`, 1500);
    await page.until(`typeof window.Chart === "function"`, 20000);
    await sleep(2500); // the worker finishes saving
    site.mode = "down";
    tunnel.off();
    page.errors.length = 0;
    await page.goto(`${BASE}?offline=1#/rates`, 2500);
    await ready();
    await page.until(`typeof window.Chart === "function" && [...document.querySelectorAll("#view canvas")].some((c) => Chart.getChart(c))`, 15000);
    const off = await page.eval(chartState);
    const offRefused = refusals();
    check("no connection at all: the app opens from the copy on the device, charts included", off.chart === "function" && off.cards > 0 && off.drawn > 0, JSON.stringify(off));
    check("no connection at all: the saved chart library passed its hash, nothing was refused", offRefused.length === 0, offRefused.slice(0, 3).join(" || "));
    site.mode = "ok";
    tunnel.on();
  } catch (e) {
    check("test run", false, e.stack || String(e));
  } finally {
    await browser.close();
    site.close();
    tunnel.close();
  }
  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
