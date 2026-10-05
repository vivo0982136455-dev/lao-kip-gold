// Test helper: drive a real Microsoft Edge / Chrome (headless, throw-away profile) through the DevTools protocol.
// No packages needed: Node 22+ has fetch and WebSocket built in.
// Why a real browser: service workers, the install offer and real layout cannot be checked any other way.
// Another browser: set BROWSER_PATH to its .exe before running a test.
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const net = require("net");
const path = require("path");
const http = require("http");

const ROOT = path.join(__dirname, ".."); // the site
const SHOTS = path.join(__dirname, "shots"); // pictures taken by the tests (not committed)
const BROWSERS = [
  process.env.BROWSER_PATH,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/microsoft-edge",
  "/usr/bin/google-chrome",
];
const EDGE = BROWSERS.find((p) => p && fs.existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- a static server for the site, which can be switched to "down" or "slow" ----------
// site.override.set("/data/x.json", text): answer that path with this text instead of the file (a test of a state
// the real data does not show today); site.override.clear() puts the files back.
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
function startSite(root, port) {
  const site = { mode: "ok", delay: 6000, hits: [], full: 0, notModified: 0, override: new Map() };
  const server = http.createServer((req, res) => {
    site.hits.push(req.url);
    if (site.mode === "down") return req.socket.destroy(); // like a lost connection
    if (site.handle && site.handle(req, res)) return; // a test's own answer for a path that is not a file
    let urlPath = decodeURIComponent(req.url.split("?")[0]);
    if (urlPath.endsWith("/")) urlPath += "index.html";
    const filePath = path.join(root, urlPath);
    const send = () =>
      fs.readFile(filePath, (err, content) => {
        if (site.override.has(urlPath)) {
          err = null;
          content = Buffer.from(site.override.get(urlPath));
        }
        if (err) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          return res.end("Not found");
        }
        // like GitHub Pages: files may be reused for 10 minutes; an unchanged file is answered with a short "304"
        const etag = '"' + require("crypto").createHash("md5").update(content).digest("hex") + '"';
        const head = { "Content-Type": TYPES[path.extname(filePath)] || "application/octet-stream", "Cache-Control": "max-age=600", ETag: etag };
        if (req.headers["if-none-match"] === etag) {
          site.notModified++;
          res.writeHead(304, head);
          return res.end();
        }
        site.full++;
        res.writeHead(200, head);
        res.end(content);
      });
    if (site.mode === "slow") setTimeout(send, site.delay);
    else send();
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(Object.assign(site, { server, close: () => server.close() }))));
}

// ---------- the browser ----------
// A fresh profile for every launch = a true first visit. The folder is removed again when the browser closes.
async function launch({ port = 9333, args = [] } = {}) {
  if (!EDGE) throw new Error("No Edge / Chrome found - set BROWSER_PATH to the browser's .exe");
  // a test that was stopped half-way leaves its profile (~50 MB) behind: old ones are removed here
  for (const name of fs.readdirSync(os.tmpdir())) {
    const stamp = /^lkg-test-profile-\d+-(\d+)$/.exec(name);
    if (!stamp || Date.now() - Number(stamp[1]) < 2 * 3600000) continue;
    try {
      fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
    } catch {
      /* still held by a browser that hangs */
    }
  }
  const profile = path.join(os.tmpdir(), `lkg-test-profile-${port}-${Date.now()}`);
  fs.mkdirSync(SHOTS, { recursive: true });
  const child = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-sync", ...args, "about:blank"], { stdio: "ignore" });
  let info = null;
  for (let i = 0; i < 60 && !info; i++) {
    await sleep(250);
    try {
      info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    } catch {
      /* not up yet */
    }
  }
  if (!info) throw new Error("the browser did not start");
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error("no connection to the browser"));
  });
  let nextId = 1;
  const waiting = new Map();
  const listeners = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) {
      const { resolve, reject } = waiting.get(msg.id);
      waiting.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message + (msg.error.data ? " - " + msg.error.data : "")));
      else resolve(msg.result);
    } else if (msg.method) for (const fn of listeners) fn(msg);
  };
  // A browser that hangs must fail the test, not block it for ever: every command gets 90 seconds for its answer
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error(`the browser did not answer "${method}" within 90 seconds`));
      }, 90000);
      const done = (fn) => (value) => {
        clearTimeout(timer);
        fn(value);
      };
      waiting.set(id, { resolve: done(resolve), reject: done(reject) });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });

  async function newPage({ width = 380, height = 820, mobile = true } = {}) {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const s = (method, params) => send(method, params, sessionId);
    const page = { errors: [], logs: [], sessionId, targetId, s };
    listeners.push((msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === "Runtime.exceptionThrown") page.errors.push("exception: " + (msg.params.exceptionDetails.exception ? msg.params.exceptionDetails.exception.description : msg.params.exceptionDetails.text));
      if (msg.method === "Runtime.consoleAPICalled" && (msg.params.type === "error" || msg.params.type === "warning")) page.errors.push(msg.params.type + ": " + msg.params.args.map((a) => a.value || a.description || "").join(" "));
      if (msg.method === "Log.entryAdded" && (msg.params.entry.level === "error" || msg.params.entry.level === "warning")) page.errors.push("log " + msg.params.entry.level + ": " + msg.params.entry.text + " " + (msg.params.entry.url || ""));
      if (msg.method === "Page.loadEventFired") page.loaded && page.loaded();
    });
    await s("Page.enable");
    await s("Runtime.enable");
    await s("Log.enable");
    await s("Network.enable");
    page.size = async (w, h, isMobile = w < 700) => {
      await s("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: isMobile ? 2 : 1, mobile: isMobile });
      await s("Emulation.setTouchEmulationEnabled", { enabled: isMobile });
    };
    await page.size(width, height, mobile);
    page.goto = async (url, wait = 800) => {
      const done = new Promise((resolve) => (page.loaded = resolve));
      const r = await s("Page.navigate", { url });
      if (r.errorText) throw new Error("navigate: " + r.errorText);
      if (r.loaderId) await Promise.race([done, sleep(20000)]); // only "#/page" changed: same document, no load event
      await sleep(wait);
    };
    page.reload = async (wait = 800) => {
      const done = new Promise((resolve) => (page.loaded = resolve));
      await s("Page.reload", {});
      await Promise.race([done, sleep(20000)]);
      await sleep(wait);
    };
    page.eval = async (expression) => {
      const r = await s("Runtime.evaluate", { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error("in page: " + (r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text));
      return r.result.value;
    };
    // wait until the expression is true in the page (or give up)
    page.until = async (expression, ms = 10000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        try {
          if (await page.eval(`return !!(${expression});`)) return true;
        } catch {
          /* page is navigating */
        }
        await sleep(150);
      }
      return false;
    };
    page.shot = async (file, full = false) => {
      const params = { format: "png" };
      if (full) {
        const m = await s("Page.getLayoutMetrics");
        params.clip = { x: 0, y: 0, width: m.cssContentSize.width, height: Math.min(m.cssContentSize.height, 9000), scale: 1 };
        params.captureBeyondViewport = true;
      }
      const r = await s("Page.captureScreenshot", params);
      fs.writeFileSync(file, Buffer.from(r.data, "base64"));
      return file;
    };
    page.close = () => send("Target.closeTarget", { targetId });
    return page;
  }

  async function close() {
    try {
      await send("Browser.close");
    } catch {
      /* already gone */
    }
    await sleep(300);
    try {
      child.kill();
    } catch {
      /* already gone */
    }
    // the profile is ~50 MB: remove it (the closing browser may hold it for a moment)
    for (let i = 0; i < 10; i++) {
      try {
        fs.rmSync(profile, { recursive: true, force: true });
        break;
      } catch {
        await sleep(400);
      }
    }
  }
  return { send, newPage, close, listeners };
}

// ---------- a tunnel the browser goes through (--proxy-server): switch it off = no connection at all ----------
// Used for the live site, where the server cannot be stopped: every request fails, for the page and for the
// service worker alike - like a phone without signal.
function startTunnel(port) {
  const state = { down: false, sockets: new Set(), tunnels: 0 };
  const server = http.createServer((req, res) => {
    res.writeHead(502);
    res.end();
  });
  server.on("connect", (req, client, head) => {
    if (state.down) return client.destroy();
    const [host, p] = req.url.split(":");
    const upstream = net.connect(Number(p) || 443, host, () => {
      state.tunnels++;
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    state.sockets.add(client);
    state.sockets.add(upstream);
    const done = () => {
      client.destroy();
      upstream.destroy();
      state.sockets.delete(client);
      state.sockets.delete(upstream);
    };
    for (const s of [client, upstream]) {
      s.on("error", done);
      s.on("close", done);
    }
  });
  state.off = () => {
    state.down = true;
    for (const s of state.sockets) s.destroy();
    state.sockets.clear();
  };
  state.on = () => {
    state.down = false;
  };
  state.close = () => {
    state.off();
    server.close();
  };
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(state)));
}

module.exports = { ROOT, SHOTS, launch, startSite, startTunnel, sleep };
