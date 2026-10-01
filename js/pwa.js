// Install as an app + a copy for use without a connection. The work is done by sw.js (site root);
// this file switches it on and keeps the browser's "install" offer for the button on the Settings page.
// Works without any of it: a browser with no service worker simply shows the site as before.

let offer = null; // the browser's install offer (Chrome / Edge), kept until the reader taps the button
let done = false; // installed during this visit
let notify = () => {};

// Called when the install state changes (app.js redraws the Settings page)
export function onInstallChange(fn) {
  notify = fn;
}

// Opened from the icon (own window, no address bar)?
const standalone = () => ["standalone", "window-controls-overlay", "minimal-ui"].some((m) => window.matchMedia(`(display-mode: ${m})`).matches) || navigator.standalone === true;

// "app" = running as the installed app · "installed" = just installed · "ready" = the button can install it ·
// "manual" = the reader has to use the browser's own menu (iPhone, Firefox, or the offer was not made)
export function installState() {
  if (standalone()) return "app";
  if (done) return "installed";
  return offer ? "ready" : "manual";
}

// Show the browser's own install question. Returns "accepted", "dismissed" or "unavailable".
export async function askInstall() {
  if (!offer) return "unavailable";
  const ev = offer;
  offer = null; // an offer can be used once
  try {
    ev.prompt();
    const choice = await ev.userChoice;
    return choice && choice.outcome === "accepted" ? "accepted" : "dismissed";
  } catch {
    return "unavailable";
  } finally {
    notify();
  }
}

// Files this page has loaded so far (its own + fonts + chart library): sw.js keeps a copy of each
function loadedFiles() {
  const list = performance.getEntriesByType("resource").map((e) => e.name);
  list.push(location.href);
  return list;
}

export function startPwa() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // no automatic banner: the Settings page has the button
    offer = e;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    offer = null;
    done = true;
    notify();
  });

  if (!("serviceWorker" in navigator)) return;
  const sw = navigator.serviceWorker;
  // A new worker has taken over this page (first visit, or sw.js changed): hand it the list of loaded files,
  // because the page was loaded before the worker could save them. Once more a little later, for the files that
  // were still on their way at that moment (the worker skips what it already has).
  const warm = () => {
    if (sw.controller) sw.controller.postMessage({ type: "warm", urls: loadedFiles() });
  };
  sw.addEventListener("controllerchange", () => {
    warm();
    setTimeout(warm, 5000);
  });
  const register = () => sw.register("sw.js").catch(() => {});
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register);
}
