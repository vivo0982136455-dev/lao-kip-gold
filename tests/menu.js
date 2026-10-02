// The menu: on a phone there is ONE menu button ("more" in the bottom bar). It opens the slide-in menu, which closes
// by its own close button, by a tap beside it, by Escape, or by choosing a page. On a wide screen the menu is always
// there and has no open / close buttons. Usage: node tests/menu.js
const path = require("path");
const { ROOT, SHOTS, launch, startSite, sleep } = require("./browser.js");

const PORT = 8099;
const BASE = `http://127.0.0.1:${PORT}/`;
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log((ok ? "PASS  " : "FAIL  ") + name + (detail ? "  -> " + detail : ""));
};
// what the reader sees: the menu is "open" when it is inside the screen
const STATE = `
  const side = document.getElementById("sidebar").getBoundingClientRect();
  const shown = (el) => !!el && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().width > 0;
  const close = document.getElementById("menu-close");
  return {
    open: side.right > 1 && side.left >= 0,
    closeShown: shown(close) && close.getBoundingClientRect().right > 1,
    more: shown(document.getElementById("more-btn")),
    expanded: document.getElementById("more-btn") ? document.getElementById("more-btn").getAttribute("aria-expanded") : null,
    oldButton: !!document.getElementById("menu-btn"),
    topbarButtons: document.querySelectorAll(".topbar button").length,
    title: document.getElementById("page-title").textContent,
    titleLeft: Math.round(document.getElementById("page-title").getBoundingClientRect().left),
    hash: location.hash,
  };
`;

// true while the menu is completely inside the screen / false when it is completely outside
const IS_OPEN = `(() => { const r = document.getElementById("sidebar").getBoundingClientRect(); return r.right > 1 && r.left >= 0; })()`;

(async () => {
  const site = await startSite(ROOT, PORT);
  const browser = await launch({ port: 9343 });
  try {
    const page = await browser.newPage({ width: 380, height: 820 });
    // The menu slides in and out: wait until it has arrived (a fixed pause was too short on a busy computer),
    // then read the state. Gives up after 5 seconds - the check after it then reports what it sees.
    const settle = async (open) => {
      await page.until(`${IS_OPEN} === ${open}`, 5000);
      await sleep(150);
      return page.eval(STATE);
    };
    for (const lang of ["th", "lo"]) {
      await page.goto(BASE + "#/overview", 300);
      await page.eval(`localStorage.setItem("lang", "${lang}"); localStorage.setItem("theme", "dark");`);
      await page.goto(`${BASE}?menu=${lang}#/economy`, 300);
      await page.until(`document.querySelectorAll("#view .card").length > 0 && document.getElementById("more-btn")`, 15000);
      await sleep(400);
      const start = await page.eval(STATE);
      check(`${lang} phone: one menu button only (bottom bar), none in the top bar`, start.more && !start.oldButton && start.topbarButtons === 0 && !start.open, JSON.stringify(start));
      check(`${lang} phone: the page title starts at the left edge`, start.titleLeft === 16, "left = " + start.titleLeft);

      await page.eval(`document.getElementById("more-btn").click();`);
      const opened = await settle(true);
      check(`${lang} phone: "more" opens the menu, close button visible`, opened.open && opened.closeShown && opened.expanded === "true", JSON.stringify(opened));
      if (lang === "th") await page.shot(path.join(SHOTS, "menu-open-380.png"));

      await page.eval(`document.getElementById("menu-close").click();`);
      const closed = await settle(false);
      check(`${lang} phone: the close button closes it`, !closed.open && closed.expanded === "false", JSON.stringify(closed));

      await page.eval(`document.getElementById("more-btn").click();`);
      await settle(true);
      await page.eval(`document.getElementById("backdrop").click();`);
      check(`${lang} phone: a tap beside the menu closes it`, !(await settle(false)).open);

      await page.eval(`document.getElementById("more-btn").click();`);
      await settle(true);
      await page.s("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await page.s("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      check(`${lang} phone: Escape closes it`, !(await settle(false)).open);

      await page.eval(`document.getElementById("more-btn").click();`);
      await settle(true);
      await page.eval(`document.querySelector('#nav a[href="#/forecast"]').click();`);
      await page.until(`location.hash === "#/forecast"`, 5000);
      const moved = await settle(false);
      check(`${lang} phone: choosing a page closes it and opens the page`, !moved.open && moved.hash === "#/forecast", JSON.stringify(moved));
    }

    // wide screen: the menu is always there
    await page.size(1440, 900, false);
    await page.goto(BASE + "?menu=wide#/overview", 800);
    await page.until(`document.querySelectorAll("#view .card").length > 0`, 15000);
    const wide = await page.eval(STATE);
    check("wide screen: menu always visible, no open / close buttons", wide.open && !wide.closeShown && !wide.more && wide.topbarButtons === 0, JSON.stringify(wide));

    const errs = page.errors.filter((e) => !/cdnjs|net::ERR|Failed to load resource/.test(e));
    check("no console errors", errs.length === 0, errs.slice(0, 4).join(" || "));
  } catch (e) {
    check("test run", false, e.stack || String(e));
  } finally {
    await browser.close();
    site.close();
  }
  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
