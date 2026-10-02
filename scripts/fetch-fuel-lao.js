// Source #30: retail fuel prices in Laos (OFFICIAL), from two public pages.
//   notices    Ministry of Industry and Commerce, Department of Internal Trade: the list of official notices
//              "adjusting retail fuel prices nationwide" (number, date, PDF). About one notice a week.
//   provinces  Lao State Fuel Company (state enterprise): its newest pump prices in all 18 provinces
//   capital    Vientiane Capital, kip per litre: premium petrol, regular petrol, diesel - the newest price,
//              and every price of a notice that could be CONFIRMED (see below)
// Writes data/fuel-lao.json (loaded on the cost-of-living page and the Economy > Policy tab).
// Runs with the 30-minute job, but asks its sources at most every 6 hours.
// Usage: node scripts/fetch-fuel-lao.js              (always asks; reads the 8 newest notices)
//        node scripts/fetch-fuel-lao.js notices=120  (also reads older notices: fills the history once)
//
// Real answers (checked 2026-10-02):
//   GET https://dit.moic.gov.la/public/oil  - HTML. Every notice is a link:
//       <a href="https://dit.moic.gov.la/public/uploads/oil/oil_20260924024801.pdf" target="_blank">ແຈ້ງການ
//       ປັບລາຄານໍ້າມັນເຊື້ອໄຟ ໃນຂອບເຂດທົ່ວປະເທດ ສະບັບເລກທີ 1814/ກຄພນ, ລົງວັນທີ 23 ກັນຍາ 2026</a>
//       (number / date in Lao; 182 notices back to December 2021; none between 8 April and 22 July 2026)
//   The PDF is a SCAN (3 pages) with a text layer made by the scanner: the Lao letters are garbage, most digits
//       are right, some are not ("36,8 0", "44,6s0", "3 I,630"). A notice applies from 06:00 of the next day.
//       page 1  table of Vientiane Capital: 1 premium, 2 regular, 3 diesel, each  old | new | change | %
//               e.g. "43,380  43,660  +280  0.65". The ministry's own arithmetic can be 10 kip off.
//       page 3  table of the new prices in all 18 provinces: premium | regular | diesel. Row 1 = Vientiane Capital,
//               row 10 = Vientiane province, which has had the same prices as the capital in every notice read.
//       March - July 2026 (the fuel crisis): only TWO fuels were priced - regular petrol and diesel.
//   GET https://laostatefuel.com/en/gas-price.html  - HTML. A ticker with one entry per province:
//       "Province : Vientiane Capital Date 2026-09-17 Gasoline 95 : 43,380 KIP Regular : 36,280 KIP Diesel : 36,830 KIP"
//       and ?province=1&page=N lists the history of one province (15 rows a page: No. | Province | 17/09/2026 | 43,380 KIP ...).
//       Typed by hand, about once a month (so it is often one or more notices behind), with typing mistakes:
//       "369,330 KIP", and one row dated 04/12/2025 that holds the prices of the notice of 5 March 2026.
//       During the crisis the one petrol price was typed into both petrol columns.
//
// How a price is CONFIRMED: one reading is never enough. For each fuel there are several readings of the same
// number - (a) the "new" column on page 1, (b) old price + printed change on page 1, (c) row 1 of the province
// table, (d) row 10 of the province table, (e) three or more other provinces (capital + their transport cost),
// (f) the "old" column of the NEXT notice, (g) the fuel company's row for that day - and a price is used only when
// two of them are clean numbers and equal. Checked on the 85 notices of January 2024 - September 2026: 27 could be
// confirmed, all from October 2025 on (older scans have no text layer: there the fuel company's typed rows are the
// only numbers, and they are marked as such in the file). Wherever two confirmed notices follow each other
// directly, the newer one's "old" prices equal the older one's prices (26 of 26).
// A notice that cannot be confirmed is still listed (number, date, link) and the page says that a newer notice exists.

const fs = require("fs");
const path = require("path");
const { DATA_DIR, fetchText, readJson, writeIfChanged } = require("./lib/common");
const { runParts, partsText, throttleArgs } = require("./lib/parts");
const { readPdf } = require("./lib/pdf-text");

const OUT_FILE = path.join(DATA_DIR, "fuel-lao.json");
const TIMEOUT_MS = 15000; // short: a source that hangs must not eat the 10 minutes of the 30-minute job
const PDF_TIMEOUT_MS = 30000; // one scan is about 0.9 MB
const PDFS_PER_RUN = 3; // new scans downloaded in one normal run (the next run reads the rest)
const GAP_OK_MS = 6 * 3600000; // run() from fetch-all.js: time between two checks
const GAP_FAILED_MS = 2 * 3600000; // ... while a part is failing
const PARTS = ["notices", "provinces", "capital"];
const DIT_URL = process.env.FUEL_LAO_NOTICES_URL || "https://dit.moic.gov.la/public/oil";
const LSF_URL = process.env.FUEL_LAO_PRICES_URL || "https://laostatefuel.com/en/gas-price.html";
const PDF_DIR = process.env.FUEL_LAO_PDF_DIR || ""; // a folder with notices already downloaded (tests, filling the history)
const NOTICES_KEPT = 60; // newest notices listed in the file
const NOTICES_READ = 8; // newest notices whose scan is read on a normal run
const HISTORY_FROM = "2024-01-01";
const PRICE_MIN = 8000; // kip per litre: anything outside is a typing or reading mistake
const PRICE_MAX = 90000;
const FUELS = ["premium", "regular", "diesel"];

const SOURCES = {
  dit: { source_name: "Ministry of Industry and Commerce, Department of Internal Trade: notices on retail fuel prices", source_url: "https://dit.moic.gov.la/public/oil", license: "Official notices of the Lao government" },
  lsf: { source_name: "Lao State Fuel Company: fuel prices by province", source_url: "https://laostatefuel.com/en/gas-price.html", license: "Lao State Fuel Company (state enterprise) - public price list, with attribution" },
};

// LSF province names -> our province keys (i18n "provinces")
const PROVINCES = {
  "Vientiane Capital": "Vientiane Capital", Bolikhamxai: "Bolikhamxai", Luangprabang: "Louangphabang", Xayyabouly: "Xaignabouly", Savannakhet: "Savannakhet",
  Khammouan: "Khammouan", Champasak: "Champasack", Salavan: "Salavan", Xekong: "Sekong", Attapeu: "Attapeu", Bokeo: "Bokeo", Oudomxai: "Oudomxai",
  Louangnamtha: "Louangnamtha", Phongsaly: "Phongsaly", Xiengkhouang: "Xiengkhouang", Houaphan: "Houaphan", Vientiane: "Vientiane", Xaisomboun: "Xaisomboun",
};
const LAO_MONTHS = ["ມັງກອນ", "ກຸມພາ", "ມີນາ", "ເມສາ", "ພຶດສະພາ", "ມິຖຸນາ", "ກໍລະກົດ", "ສິງຫາ", "ກັນຍາ", "ຕຸລາ", "ພະຈິກ", "ທັນວາ"];
// zero-width characters that the ministry's page has inside some words (U+200B..U+200D, U+FEFF)
const ZERO_WIDTH = new RegExp("[" + String.fromCharCode(0x200b) + "-" + String.fromCharCode(0x200d) + String.fromCharCode(0xfeff) + "]", "g");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, "0");
const strip = (html) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const nextDay = (day) => new Date(Date.parse(day + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);
const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
const keyOf = (notice) => `${notice[0]}|${notice[1]}`; // a notice in the list = [date, number, url]
// "43,380" -> 43380. Only a complete, clean number counts (a comma read as a dot, or left out, is accepted).
const price = (s) => {
  const m = /^(\d{2})[,.]?(\d{3})$/.exec(String(s).trim());
  const v = m ? Number(m[1] + m[2]) : null;
  return v !== null && v >= PRICE_MIN && v <= PRICE_MAX ? v : null;
};

// ---------- the list of notices ----------
// -> [{ no: "1814", date: "2026-09-23", url }] newest first
function parseNotices(html) {
  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(/<a[^>]+href="(https:\/\/dit\.moic\.gov\.la\/public\/uploads\/oil\/[^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const text = strip(m[2]).replace(ZERO_WIDTH, "").replace(/ມິນາ/g, "ມີນາ"); // (a common misspelling of March)
    // the number: the digits between "ເລກທີ" and "/ກຄພນ" (sometimes with stray vowel marks between the digits)
    const noText = /ເລກທີ\s*([^\/]{1,12})\//.exec(text);
    const no = noText ? noText[1].replace(/\D/g, "").replace(/^0+(?=\d)/, "") : "";
    const d = /ລົງວັນທີ\s*(\d{1,2})\s*(\S+?)\s*(\d{4})(?!\d)/.exec(text);
    const month = d ? LAO_MONTHS.findIndex((name) => name === d[2] || (d[2].length >= 3 && name.startsWith(d[2]))) : -1;
    if (!no || no.length > 5 || month < 0 || Number(d[1]) < 1 || Number(d[1]) > 31) continue; // still on the ministry's page
    const item = { no, date: `${d[3]}-${pad(month + 1)}-${pad(d[1])}`, url: m[1] };
    if (seen.has(item.no + "|" + item.date)) continue; // the page lists some notices twice
    seen.add(item.no + "|" + item.date);
    out.push(item);
  }
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return out;
}

// ---------- the state fuel company: every province, and the history of the capital ----------
// The ticker: one entry per province -> [{ name, date, premium, regular, diesel }]
function parseTicker(text) {
  const out = [];
  for (const m of text.matchAll(/Province\s*:\s*([A-Za-z ]+?)\s+Date\s+(\d{4}-\d{2}-\d{2})\s+Gasoline 95\s*:\s*([\d,]+)\s*KIP\s+Regular\s*:\s*([\d,]+)\s*KIP\s+Diesel\s*:\s*([\d,]+)\s*KIP/g)) {
    out.push({ name: m[1].trim(), date: m[2], premium: price(m[3]), regular: price(m[4]), diesel: price(m[5]) });
  }
  return out;
}
// A history page of one province -> [[date, premium, regular, diesel]]
// premium = null when the same number is typed in both petrol columns (the crisis: one petrol price)
function parseHistory(html) {
  const table = /<table[\s\S]*?<\/table>/.exec(html);
  if (!table) return [];
  const out = [];
  for (const tr of table[0].matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => strip(c[1]));
    const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(cells[2] || "");
    if (!d) continue;
    const v = [cells[3], cells[4], cells[5]].map((c) => price(String(c).replace(/\s*KIP$/, "")));
    if (v[1] === null || v[2] === null) continue;
    out.push([`${d[3]}-${d[2]}-${d[1]}`, v[0] !== null && v[0] > v[1] ? v[0] : null, v[1], v[2]]);
  }
  return out;
}
// A value that is far from what the other provinces pay is a typing mistake: left out
function dropOutliers(rows, key) {
  const values = rows.map((r) => r[key]).filter((v) => v !== null).sort((a, b) => a - b);
  const mid = values[Math.floor(values.length / 2)];
  for (const r of rows) if (r[key] !== null && Math.abs(r[key] - mid) > mid * 0.15) r[key] = null;
}
async function provinces() {
  const rows = parseTicker(strip(await fetchText(LSF_URL, {}, TIMEOUT_MS))).filter((r) => PROVINCES[r.name]);
  if (rows.length < 15) throw new Error(`fuel company: only ${rows.length} provinces in the price list`);
  for (const key of FUELS) dropOutliers(rows, key);
  const date = rows.map((r) => r.date).sort().pop();
  const out = rows
    .filter((r) => r.date === date && (r.regular !== null || r.diesel !== null)) // (a mistyped number is null: the row stays)
    .map((r) => [PROVINCES[r.name], r.premium !== null && r.premium !== r.regular ? r.premium : null, r.regular, r.diesel]);
  if (!out.some((r) => r[0] === "Vientiane Capital")) throw new Error("fuel company: no price for Vientiane Capital");
  return { source: "lsf", unit: "LAK per litre", columns: FUELS, date, rows: out };
}

// ---------- reading one scanned notice ----------
// Text pieces of a page grouped into rows (top row first); each row keeps its clean prices with their x position
function pageRows(page) {
  const rows = [];
  for (const t of page.texts) {
    let row = rows.find((r) => Math.abs(r.y - t.y) < 4);
    if (!row) rows.push((row = { y: t.y, cells: [] }));
    row.cells.push(t);
  }
  for (const r of rows) {
    r.cells.sort((a, b) => a.x - b.x);
    r.prices = r.cells.map((c) => ({ x: c.x, v: price(c.text) })).filter((c) => c.v !== null);
  }
  return rows.sort((a, b) => b.y - a.y);
}
// The readings of one notice (nothing is decided here). Fuels are always [premium, regular, diesel].
//   { cols: 3 | 2 | 0          price columns of the province table (2 = regular + diesel only, 0 = no table found)
//     pairs: [[old, new, sums], ...]  page 1, top row first: rows with a clean old AND a clean new price;
//                              sums = true when the printed change (and %) is exactly new - old: a second proof
//     first: [p, r, d]         province table, row 1 (Vientiane Capital); null where the number is not clean
//     tenth: [p, r, d]         province table, row 10 (Vientiane province)
//     rows: [[p, r, d], ...] } every row of the province table that has a clean number
// or null when the file has no usable text layer.
function readNotice(buffer) {
  let pages;
  try {
    pages = readPdf(buffer);
  } catch {
    return null;
  }
  if (!pages.length || !pages.some((p) => p.texts.length)) return null;
  const out = { cols: 0, pairs: [], first: [null, null, null], tenth: [null, null, null], rows: [] };

  // page 1: old | new | change | %. A row whose change contradicts its two prices is not used
  // (the ministry's own sums can be 10 kip off, so a small difference is tolerated - but then it proves nothing).
  for (const r of pageRows(pages[0])) {
    if (r.prices.length !== 2) continue;
    const [oldP, newP] = r.prices.map((c) => c.v);
    const after = r.cells.filter((c) => c.x > r.prices[1].x).map((c) => c.text.trim());
    const change = after.map((s) => (/^[+-]\d{1,2},\d{3}$|^[+-]\d{1,3}$/.test(s) ? Number(s.replace(",", "")) : null)).find((v) => v !== null);
    if (change !== undefined && Math.abs(newP - oldP - change) > 20) continue;
    const pct = after.map((s) => (/^\d{1,2}\.\d{1,2}$/.test(s) ? Number(s) : null)).find((v) => v !== null);
    const sums = change !== undefined && newP - oldP === change && (pct === undefined || Math.abs((Math.abs(change) / oldP) * 100 - pct) < 0.011);
    out.pairs.push([oldP, newP, sums]);
  }

  // the province table: three price columns (3+ rows with three clean prices), or two (5+ rows with two, none with three)
  let best = null;
  for (const page of pages.slice(1)) {
    const rows = pageRows(page);
    const three = rows.filter((r) => r.prices.length === 3);
    const two = rows.filter((r) => r.prices.length === 2);
    const found = three.length >= 3 ? { rows, full: three, cols: 3 } : !three.length && two.length >= 5 ? { rows, full: two, cols: 2 } : null;
    if (found && (!best || found.full.length > best.full.length)) best = found;
  }
  if (best) {
    out.cols = best.cols;
    const xs = Array.from({ length: best.cols }, (_, k) => median(best.full.map((r) => r.prices[k].x)));
    const fuels = (values) => (best.cols === 3 ? values : [null, ...values]);
    const inTable = best.rows
      .map((r) => ({ y: r.y, values: xs.map((x) => (r.prices.find((c) => Math.abs(c.x - x) < 20) || { v: null }).v) }))
      .filter((r) => r.values.some((v) => v !== null));
    const step = median(inTable.slice(1).map((r, i) => inTable[i].y - r.y));
    const top = inTable[0];
    out.first = fuels(top.values);
    const ten = inTable.find((r) => Math.abs((top.y - r.y) / step - 9) < 0.3);
    if (ten) out.tenth = fuels(ten.values);
    out.rows = inTable.map((r) => fuels(r.values));
  }
  return out;
}
// Decide the prices of a notice from its readings + other readings of the same numbers:
//   extras  [p, r, d] lists (or null): the "old" prices of the next notice, the fuel company's row for that day
//   loose   plain numbers: "old" prices of the next notice whose fuel is not known (page 1 not read completely)
// -> { prices: [p, r, d], old: [p, r, d] } or null. Regular and diesel must both be confirmed; premium is null when it
// is not confirmed (or when the notice prices two fuels only).
const NO_READING = { cols: 0, pairs: [], first: [null, null, null], tenth: [null, null, null], rows: [] };
function confirm(reading, extras = [], loose = []) {
  const r = reading || NO_READING;
  const others = extras.filter(Boolean);
  const news = r.pairs.map((p) => p[1]);
  // page 1 read completely: its rows are premium, regular, diesel (or regular, diesel) in this order
  const page1 = oldColumn(r) ? (r.pairs.length === 3 ? r.pairs : [null, ...r.pairs]) : [null, null, null];
  // more(k, v) -> 1 when another kind of reading also gives v for fuel k
  const pick = (k, more) => {
    const candidates = new Set([r.first[k], r.tenth[k], page1[k] && page1[k][1], ...others.map((e) => e[k])].filter((v) => v !== null && v !== undefined));
    for (const v of candidates) {
      const inTable = (r.first[k] === v ? 1 : 0) + (r.tenth[k] === v ? 1 : 0) + (more ? more(k, v) : 0);
      // (a loose number only counts with a three-column table, where the fuel of a column is certain)
      const outside =
        (news.includes(v) ? 1 : 0) +
        (page1[k] && page1[k][1] === v && page1[k][2] ? 1 : 0) + // old + printed change = this number
        others.filter((e) => e[k] === v).length +
        (r.cols === 3 && loose.includes(v) ? 1 : 0);
      // a two-column table alone cannot tell which fuel a column is: one reading from outside the table is needed
      if (inTable + outside >= 2 && (r.cols === 3 || outside >= 1)) return v;
    }
    return null;
  };
  const prices = [0, 1, 2].map((k) => pick(k));
  // One more reading for a fuel that has a single clean number: the other provinces. A province pays the capital's
  // price plus the same transport cost for every fuel, so once another fuel is confirmed, three or more province
  // rows must lead to exactly this number. (Rows equal to the capital are the readings already counted.)
  for (const k of [0, 1, 2]) {
    if (prices[k] !== null) continue;
    const known = [0, 1, 2].filter((j) => j !== k && prices[j] !== null);
    if (!known.length) continue;
    prices[k] = pick(k, (kk, v) => (r.rows.filter((row) => row[kk] !== null && row[kk] !== v && known.every((j) => row[j] !== null && row[kk] - v === row[j] - prices[j])).length >= 3 ? 1 : 0));
  }
  if (prices[1] === null || prices[2] === null) return null;
  if (prices[0] !== null && prices[0] <= prices[1]) prices[0] = null; // premium always costs more than regular
  const old = prices.map((v) => {
    const rows = r.pairs.filter((p) => p[1] === v);
    return v !== null && rows.length === 1 ? rows[0][0] : null;
  });
  return { prices, old };
}
// The "old" column of a notice as [p, r, d] (the prices of the notice before it), when page 1 was read completely
function oldColumn(reading) {
  if (!reading) return null;
  if (reading.pairs.length === 3) return reading.pairs.map((p) => p[0]);
  if (reading.pairs.length === 2 && reading.cols === 2) return [null, reading.pairs[0][0], reading.pairs[1][0]];
  return null;
}
async function fetchPdf(url) {
  if (PDF_DIR) {
    const file = path.join(PDF_DIR, path.basename(url));
    if (fs.existsSync(file)) return fs.readFileSync(file);
  }
  const res = await fetch(url, { headers: { "User-Agent": "lao-kip-gold-dashboard (personal, non-commercial)" }, signal: AbortSignal.timeout(PDF_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

// ---------- Vientiane Capital: the newest price + every price that is known ----------
// list: every notice [date, number, url], newest first. company: the "provinces" part (its newest price list).
// A history row: [day the price starts, premium or null, regular, diesel, notice number]
//   notice number = null: a row typed by the fuel company (no notice could be confirmed for that day)
async function capital(old, list, company, howMany) {
  // 1) the company's own history (about one row a month): one more reading of a notice's numbers,
  //    and the only numbers there are for the days whose scan cannot be read
  const typed = new Map();
  for (const n of [1, 2, 3]) {
    try {
      for (const r of parseHistory(await fetchText(`${LSF_URL}?province=1&page=${n}`, {}, TIMEOUT_MS))) typed.set(r[0], r.slice(1));
    } catch (err) {
      console.warn(`[WARN] fuel company history page ${n}: ${err.message}`);
      break;
    }
    await sleep(400);
  }
  const row = company && company.rows && company.rows.find((r) => r[0] === "Vientiane Capital");
  if (row && !typed.has(company.date)) typed.set(company.date, row.slice(1));

  // 2) the scans: read each notice once (the readings are kept in the file), then confirm
  const readings = { ...((old && old.readings) || {}) };
  const wanted = list.slice(0, howMany);
  let downloads = 0;
  for (const notice of wanted) {
    if (readings[keyOf(notice)] !== undefined) continue;
    if (howMany === NOTICES_READ && ++downloads > PDFS_PER_RUN) break;
    try {
      readings[keyOf(notice)] = readNotice(await fetchPdf(notice[2])); // null = no text layer: not asked again
    } catch (err) {
      console.warn(`[WARN] fuel notice ${notice[1]} of ${notice[0]}: ${err.message}`); // asked again on the next run
    }
    if (!PDF_DIR) await sleep(500);
  }
  // 3) one history. Stored rows stay; the company's rows are taken fresh (it corrects its own typing), and a
  //    confirmed notice always wins over the company's row for the same day.
  const byDay = new Map(((old && old.history) || []).map((r) => [r[0], r]));
  const typedFrom = [...typed.keys()].sort()[0];
  for (const [day, r] of byDay) if (r[4] === null && typedFrom && day >= typedFrom) byDay.delete(day);
  for (const [day, v] of typed) if (day >= HISTORY_FROM && !(byDay.get(day) && byDay.get(day)[4] !== null)) byDay.set(day, [day, v[0], v[1], v[2], null]);
  wanted.forEach((notice, i) => {
    const day = nextDay(notice[0]); // a notice applies from 06:00 of the next day
    if (day < HISTORY_FROM) return;
    // the notice after this one prints this notice's prices as its "old" prices (when no notice lies between them)
    const next = i > 0 ? readings[keyOf(wanted[i - 1])] : null;
    const aligned = oldColumn(next);
    const c = confirm(readings[keyOf(notice)], [aligned, typed.get(day), typed.get(notice[0])], next && !aligned ? next.pairs.map((p) => p[0]) : []);
    if (!c) return;
    const have = byDay.get(day);
    if (have && have[4] === null && (have[2] !== c.prices[1] || have[3] !== c.prices[2])) {
      console.warn(`[WARN] fuel ${day}: notice ${notice[1]} says ${c.prices.join("/")}, the fuel company typed ${have.slice(1, 4).join("/")} - the notice is used`);
    }
    byDay.set(day, [day, ...c.prices, notice[1]]);
  });
  const history = [...byDay.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (!history.length) throw new Error("no fuel price could be read (notices and fuel company)");

  // 4) the newest price, the notice it belongs to, and the notices that are newer than it
  const last = history[history.length - 1];
  const noticeFor = (day) => {
    const n = list.find(([date]) => nextDay(date) === day);
    return n ? { no: n[1], date: n[0], url: n[2] } : null;
  };
  const latest = { date: last[0], premium: last[1], regular: last[2], diesel: last[3], from: last[4] === null ? "lsf" : "notice", notice: noticeFor(last[0]) };
  const before = history[history.length - 2];
  const unread = list.filter(([date]) => nextDay(date) > latest.date);
  // the readings of the newest notices stay in the file (a later notice or price list can still confirm them)
  const keep = {};
  for (const notice of list.slice(0, NOTICES_READ + 2)) if (readings[keyOf(notice)] !== undefined) keep[keyOf(notice)] = readings[keyOf(notice)];
  return {
    source: latest.from === "notice" ? "dit" : "lsf",
    unit: "LAK per litre",
    columns: FUELS,
    latest, // date = the day the price started
    previous: before ? before.slice(0, 4) : null, // the known price before it (not always the notice just before)
    // newer notices whose numbers could not be confirmed: the page links to the newest one
    waiting: unread.length ? { no: unread[0][1], date: unread[0][0], url: unread[0][2], count: unread.length } : null,
    history,
    readings: keep,
  };
}

async function main(args = process.argv.slice(2)) {
  const old = readJson(OUT_FILE, {});
  const now = new Date().toISOString();
  if (args.includes("throttle") && old.checked_at) {
    const failing = PARTS.some((id) => !old[id] || old[id].stale);
    const minutes = Math.round((Date.parse(now) - Date.parse(old.checked_at)) / 60000);
    if (minutes * 60000 < (failing ? GAP_FAILED_MS : GAP_OK_MS)) {
      console.log(`fuel-lao: checked ${minutes} minutes ago - not asking again yet`);
      return { ok: true, skipped: true };
    }
  }
  const howManyArg = args.map((a) => /^notices=(\d+)$/.exec(a)).find(Boolean);
  const howMany = howManyArg ? Number(howManyArg[1]) : NOTICES_READ;
  const fresh = {}; // what the first two parts returned in this run
  const { out, failed } = await runParts(old, [
    [
      "notices",
      { source: "dit", latest: null, list: [] },
      async () => {
        const all = parseNotices(await fetchText(DIT_URL, {}, TIMEOUT_MS));
        if (all.length < 20) throw new Error(`fuel notices: only ${all.length} could be read from the ministry's page`);
        const tomorrow = new Date(Date.now() + 7 * 3600000 + 86400000).toISOString().slice(0, 10);
        if (all[0].date > tomorrow) throw new Error(`fuel notices: the newest one is dated ${all[0].date} (in the future)`);
        fresh.list = all.map((n) => [n.date, n.no, n.url]);
        return { source: "dit", latest: all[0], list: fresh.list.slice(0, NOTICES_KEPT) };
      },
      (p) => `${p.list.length} listed, newest no. ${p.latest.no} of ${p.latest.date}`,
    ],
    ["provinces", { source: "lsf", unit: "LAK per litre", columns: FUELS, date: null, rows: [] }, async () => (fresh.company = await provinces()), (p) => `${p.rows.length} provinces on ${p.date}`],
    [
      "capital",
      { source: "lsf", unit: "LAK per litre", columns: FUELS, latest: null, previous: null, waiting: null, history: [], readings: {} },
      (o) => capital(o, fresh.list || (old.notices && old.notices.list) || [], fresh.company || old.provinces, howMany),
      (p) => `${p.latest.date} ${p.latest.premium}/${p.latest.regular}/${p.latest.diesel} (${p.latest.from}${p.latest.notice ? " no. " + p.latest.notice.no : ""}) | ${p.history.length} confirmed notices since ${p.history.length ? p.history[0][0] : "-"} | ${p.waiting ? p.waiting.count + " newer notice(s) not confirmed" : "nothing newer"}`,
    ],
  ]);
  const text = partsText({ sources: SOURCES, checked_at: now }, out);
  writeIfChanged(OUT_FILE, text);
  console.log(`fuel-lao: ${failed} of 3 parts failed. Wrote data/fuel-lao.json (${(text.length / 1024).toFixed(0)} KB)`);
  return { ok: failed < 3 };
}

if (require.main === module) main().then((r) => (process.exitCode = r.ok ? 0 : 1));

module.exports = { main, run: () => main(throttleArgs()), parseNotices, parseTicker, parseHistory, readNotice, confirm, oldColumn };
