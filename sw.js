// Service worker: lets the site be installed as an app and keeps it usable without a connection.
//
// Rules (kept simple on purpose - a number must never be older than it has to be):
//   - files of this site (page, scripts, styles, texts, data): ALWAYS ask the network first. The copy saved on the
//     device is used only when the network fails, answers with a server error, or is very slow. A saved copy of a
//     data file is marked with the header "X-Offline-Copy", so the page can tell the reader ("offline").
//   - fonts and the chart library (other hosts, files that never change): the saved copy first.
//   - everything else (Google Form / Sheet, the OCR files, links to other sites) is not touched at all.
// Only copies of files that this site itself has loaded are stored. No key, no personal data.
//
// If this file ever has to be switched off: publish a sw.js that only contains
//   self.addEventListener("install", () => self.skipWaiting());
//   self.addEventListener("activate", (e) => e.waitUntil(self.registration.unregister()));

const SITE_CACHE = "lkg-site-1";
const LIB_CACHE = "lkg-libs-1";
const TIMEOUT_MS = 4000; // wait this long for the network before the saved copy is used
const SLOW_MS = 30000; // after one slow answer: use the saved copies straight away for this long
const SCOPE = self.registration.scope; // e.g. https://<user>.github.io/lao-kip-gold/
const CHART_FILES = [
  "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.5.1/chart.umd.min.js",
  "https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js",
];
let slowUntil = 0;

// "site" = a file of this site · "font-css" = the Google Fonts style sheet · "lib" = a file that never changes ·
// null = not ours, the browser handles it as if this worker did not exist
function kindOf(url) {
  if (url.startsWith(SCOPE)) return url.slice(SCOPE.length).startsWith("sw.js") ? null : "site";
  if (url.startsWith("https://fonts.googleapis.com/")) return "font-css";
  if (url.startsWith("https://fonts.gstatic.com/") || CHART_FILES.includes(url)) return "lib";
  return null;
}

// One saved copy per file: "?v=3" and "#/gold" do not make a new one
function keyOf(url) {
  const u = new URL(url);
  u.search = "";
  u.hash = "";
  return u.href;
}

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith("lkg-") && name !== SITE_CACHE && name !== LIB_CACHE) await caches.delete(name);
      }
      await self.clients.claim();
    })()
  );
});

// A saved data file is marked, so the page can say that the numbers come from the device and not from the network
function savedCopy(res, url) {
  if (!url.endsWith(".json")) return res;
  const headers = new Headers(res.headers);
  headers.set("X-Offline-Copy", "1");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

// Keep a copy of a fresh answer - unless it is the very file we already have (same ETag): nothing to write then
async function keep(key, copy, savedPromise, cachePromise) {
  const saved = await savedPromise.catch(() => null);
  const tag = copy.headers.get("etag");
  if (saved && tag && saved.headers.get("etag") === tag) {
    if (copy.body) copy.body.cancel().catch(() => {});
    return;
  }
  await (await cachePromise).put(key, copy);
}

// A file of this site: network first, saved copy when the network fails or is too slow.
// The network is asked straight away; the saved copy is looked up at the same time.
async function siteFile(event) {
  const req = event.request;
  const key = keyOf(req.url);
  const cachePromise = caches.open(SITE_CACHE);
  const savedPromise = cachePromise.then((cache) => cache.match(key));
  // "no-cache" = ask the server every time whether the file changed (a short answer when it did not)
  const network = fetch(req, { cache: "no-cache" }).then((res) => {
    if (res.status === 200 && res.type === "basic") event.waitUntil(keep(key, res.clone(), savedPromise, cachePromise).catch(() => {}));
    return res;
  });
  network.catch(() => {}); // handled below; never an "unhandled" error in the log
  const saved = await savedPromise.catch(() => null);
  if (!saved) return network; // nothing saved yet: only the network can answer
  event.waitUntil(network.catch(() => {})); // a slow answer still renews the saved copy
  if (Date.now() < slowUntil) return savedCopy(saved, key);
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), TIMEOUT_MS);
  });
  try {
    const res = await Promise.race([network, late]);
    if (!res) {
      slowUntil = Date.now() + SLOW_MS;
      return savedCopy(saved, key);
    }
    return res.status >= 500 ? savedCopy(saved, key) : res;
  } catch {
    return savedCopy(saved, key); // no connection
  } finally {
    clearTimeout(timer);
  }
}

// A font file or the chart library: these addresses never change their content -> saved copy first
async function libFile(event) {
  const url = event.request.url;
  const cache = await caches.open(LIB_CACHE);
  const saved = await cache.match(url, { ignoreVary: true });
  if (saved) return saved;
  const res = await fetch(event.request);
  if (res.status === 200 && res.type === "cors") event.waitUntil(cache.put(url, res.clone()).catch(() => {}));
  return res;
}

// The Google Fonts style sheet: saved copy straight away, renewed in the background
async function fontCss(event) {
  const url = event.request.url;
  const cache = await caches.open(LIB_CACHE);
  const saved = await cache.match(url, { ignoreVary: true });
  const network = fetch(event.request).then((res) => {
    if (res.status === 200 && res.type === "cors") event.waitUntil(cache.put(url, res.clone()).catch(() => {}));
    return res;
  });
  if (!saved) return network;
  event.waitUntil(network.catch(() => {}));
  return saved;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || req.headers.has("range")) return;
  const kind = kindOf(req.url);
  if (!kind) return;
  const answer = kind === "site" ? siteFile(event) : kind === "font-css" ? fontCss(event) : libFile(event);
  // whatever goes wrong in here, the reader still gets the plain network answer
  event.respondWith(answer.catch(() => fetch(req)));
});

// First visit: the page was loaded before this worker existed, so nothing is saved yet. The page sends the list of
// files it has loaded (js/pwa.js); they are read once more (mostly from the browser's own store) and saved.
async function warm(urls) {
  const site = await caches.open(SITE_CACHE);
  const libs = await caches.open(LIB_CACHE);
  const list = [...new Set(urls.filter((u) => typeof u === "string"))].slice(0, 300);
  await Promise.all(
    list.map(async (url) => {
      const kind = kindOf(url);
      if (!kind) return;
      const cache = kind === "site" ? site : libs;
      const key = kind === "site" ? keyOf(url) : url;
      try {
        if (await cache.match(key, { ignoreVary: true })) return;
        const res = await fetch(url, kind === "site" ? { credentials: "same-origin" } : { mode: "cors", credentials: "omit" });
        if (res.status === 200 && (res.type === "basic" || res.type === "cors")) await cache.put(key, res);
      } catch {
        /* saved on a later visit */
      }
    })
  );
}

self.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg && msg.type === "warm" && Array.isArray(msg.urls)) event.waitUntil(warm(msg.urls));
});
