// Read shop prices from a picture IN THE BROWSER - the picture never leaves the phone.
// Tesseract.js 7.0.0 (free OCR) is loaded from jsDelivr only when the owner uses it:
// about 4.4 MB the first time, then cached by the browser (engine 1 year, language data in IndexedDB).
// Research (2026-09-30, real Phouvong post): English data only, user_defined_dpi 300, page mode 6
// ("one block of rows") read 6/6 prices + the date; page mode 3 is the fallback.
// Do NOT add a character whitelist or image filters - both made results worse in tests.

const J = "https://cdn.jsdelivr.net/npm/";
const TESSERACT_ESM = J + "tesseract.js@7.0.0/dist/tesseract.esm.min.js";
// The exact published file of tesseract.js 7.0.0 (computed from the jsDelivr copy and compared with unpkg's copy of
// the same npm package, 2026-10-04). The library's entry file runs only when it matches (audit 2026-10-02, P2-9).
// What the browser offers no check for: the worker script, the engine and the language file, which the library
// loads by itself inside its worker. They are pinned to exact versions above, and the page's Content-Security-
// Policy lets scripts come from this site and the two CDNs only.
const TESSERACT_INTEGRITY = "sha384-fDdNU3AFf+hEiUiSjD96lSEFawtCYOWQFSrFyHZOkX2jhwuUQKiSOAgWNfuKg4B6";
const WORKER_OPTIONS = {
  workerPath: J + "tesseract.js@7.0.0/dist/worker.min.js",
  corePath: J + "tesseract.js-core@7.0.0", // must stay pinned: the unversioned core is an older, incompatible release
  langPath: J + "@tesseract.js-data/eng@1.0.0/4.0.0_best_int",
};
const MAX_SIDE = 2500; // camera photos are shrunk to this (also fixes phone rotation)

// A promise that gives up after `ms` (Tesseract can wait forever if a download fails)
function withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout: ${what}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Import a module from another host only when the file is exactly the expected one.
//   1) a browser with "modulepreload": the file is fetched by a <link rel="modulepreload" integrity=...>; the
//      browser itself compares the hash, and the import below uses that very copy (one fetch per address)
//   2) an older browser: the file is fetched and hashed here before the import
// A file that does not match is never run: the picture is then entered by hand as before.
const checked = new Map(); // address -> promise of the check
export function importChecked(url, integrity) {
  if (!checked.has(url)) {
    const check = (async () => {
      let preload = false;
      try {
        preload = document.createElement("link").relList.supports("modulepreload");
      } catch {
        /* very old browser */
      }
      if (preload) {
        await new Promise((resolve, reject) => {
          const link = document.createElement("link");
          link.rel = "modulepreload";
          link.href = url;
          link.integrity = integrity;
          link.crossOrigin = "anonymous";
          link.onload = resolve;
          link.onerror = () => reject(new Error("integrity check failed or file not reachable: " + url));
          document.head.append(link);
        });
      } else {
        const res = await fetch(url, { mode: "cors", credentials: "omit" });
        if (!res.ok) throw new Error("file not reachable: " + url);
        const digest = await crypto.subtle.digest("SHA-384", await res.arrayBuffer());
        const hash = "sha384-" + btoa(String.fromCharCode(...new Uint8Array(digest)));
        if (hash !== integrity) throw new Error("integrity check failed: " + url);
      }
    })();
    checked.set(url, check);
    check.catch(() => checked.delete(url)); // a failed download may be tried again
  }
  return checked.get(url).then(() => import(url));
}

// Big camera photos -> JPEG of at most MAX_SIDE px. Screenshots are used as they are.
async function shrinkIfHuge(file) {
  if (typeof createImageBitmap !== "function") return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = MAX_SIDE / Math.max(bmp.width, bmp.height);
    if (scale >= 1) {
      bmp.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b || file), "image/jpeg", 0.92));
  } catch {
    return file;
  }
}

// Read all text of the picture. score(text) = how many prices were understood; when it is below
// `enough`, the fallback page mode is tried and the better of the two texts is kept.
// onProgress({ stage: "load" | "read", progress: 0..1 })
export async function readImageText(file, { score = () => 0, enough = 0, onProgress } = {}) {
  const report = (stage, progress) => onProgress && onProgress({ stage, progress: progress || 0 });
  report("load", 0);
  const { default: Tesseract } = await withTimeout(importChecked(TESSERACT_ESM, TESSERACT_INTEGRITY), 60000, "load OCR library");
  const worker = await withTimeout(
    Tesseract.createWorker("eng", 1, {
      ...WORKER_OPTIONS,
      logger: (m) => report(m.status === "recognizing text" ? "read" : "load", m.progress),
    }),
    120000,
    "start OCR"
  );
  try {
    const image = await shrinkIfHuge(file);
    let best = null;
    for (const psm of ["6", "3"]) {
      await worker.setParameters({ user_defined_dpi: "300", tessedit_pageseg_mode: psm });
      const { data } = await withTimeout(worker.recognize(image), 90000, "read picture");
      const s = score(data.text);
      if (!best || s > best.score) best = { text: data.text, score: s };
      if (best.score >= enough) break;
    }
    return best.text;
  } finally {
    worker.terminate(); // frees 100+ MB on phones
  }
}

// ---------- Price parsing (plain text in, numbers out) ----------

// Prices are written 46.259.000 or 46,259,000 (exactly 3 groups). OCR sometimes adds a space
// after a separator ("45. 056. 000"), so that space is removed first. Dates (30.09.2026),
// Thai baht amounts (74.000) and phone numbers do not have 3 groups, so they are ignored.
export function pricesInLine(line) {
  const clean = String(line).replace(/([.,]) (\d{3})/g, "$1$2");
  const out = [];
  for (const run of clean.match(/[\d.,]+/g) || []) {
    const token = run.replace(/[.,]+$/, "");
    if (/^\d{1,3}(?:[.,]\d{3}){2}$/.test(token)) out.push(Number(token.replace(/[.,]/g, "")));
  }
  return out;
}

// "30.09.2026" / "30/9/2026" (Buddhist years like 2569 are converted) -> "2026-09-30"
export function dateInText(text) {
  const m = /(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(String(text));
  if (!m) return null;
  let [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y > 2400) y -= 543;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2020) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Pairs of [sell, buy] in reading order. A line with 2 prices is one pair (sell column is on the left).
// If the OCR broke rows apart, all prices are paired in order instead.
function pricePairs(text) {
  const lines = String(text).split(/\r?\n/);
  const pairs = lines.map(pricesInLine).filter((p) => p.length === 2);
  if (pairs.length) return pairs;
  const all = lines.flatMap(pricesInLine);
  const out = [];
  for (let i = 0; i + 1 < all.length; i += 2) out.push([all[i], all[i + 1]]);
  return out;
}

// Phouvong daily post (same layout every day):
//   gold jewellery table: 1 baht [sell | buy], 1 salung [sell | buy]; then KPV gold bar table: 1 baht [sell | buy]
// The salung row is ~1/4 of a baht; of the baht-size rows, the first is jewellery and the second is the bar.
export function parsePhouvong(text) {
  const pairs = pricePairs(text);
  const biggest = Math.max(0, ...pairs.flat());
  const baht = pairs.filter(([s]) => s > biggest * 0.6);
  const salung = pairs.find(([s]) => s < biggest * 0.4) || null;
  const pair = (p) => (p ? { sell: p[0], buy: p[1] } : { sell: null, buy: null });
  return {
    kind: "gold",
    date: dateInText(text),
    ornament: pair(baht[0]),
    bar: pair(baht[1]),
    salung: pair(salung),
    found: pairs.length * 2,
  };
}

// PML (Precious Metals Laos) silver post: 1 kg, sell on the upper row, buy on the lower row
export function parseSilver(text) {
  const all = String(text).split(/\r?\n/).flatMap(pricesInLine);
  return { kind: "silver", date: dateInText(text), silver: { sell: all[0] || null, buy: all[1] || null }, found: all.length };
}

// Phouvong posts have 3 rows of 2 prices; the silver post has 2 prices on separate rows
export function guessKind(text) {
  const rowsWithTwo = String(text).split(/\r?\n/).map(pricesInLine).filter((p) => p.length === 2).length;
  return rowsWithTwo >= 2 ? "gold" : "silver";
}

// How many useful prices a text gives (used to pick the better OCR pass): Phouvong has 6, silver 2
export function priceScore(text) {
  if (guessKind(text) === "silver") return Math.min(parseSilver(text).found, 2);
  const p = parsePhouvong(text);
  return [p.ornament.sell, p.ornament.buy, p.bar.sell, p.bar.buy, p.salung.sell, p.salung.buy].filter(Boolean).length;
}
