// Source #1: Bank of the Lao PDR official exchange rates (OFFICIAL).
//
// Two routes (audit 2026-10-02, P1-5):
//   direct  the bank's own page https://www.bol.gov.la/en/ExchangRate - the primary source
//   mirror  a public copy of that page made by AllRatesToday (CC BY 4.0) - the backup, used only when the
//           bank's page cannot be read or shows numbers that cannot be right
// data/latest/bol.json says which route gave the numbers ("route"), why the direct route was not used
// ("route_note") and whether the two routes agreed on the same day ("cross_check"); the Settings page shows it.
// BOL publishes once per business day; running more often is harmless (duplicates are skipped).
//
// The bank's page (checked 2026-10-03):
//   GET  -> "Date: 02-10-2026" and one table row per currency:
//             <td>13</td> <td><img ...></td> <td>US Dollar</td> <td>USD</td> <td>22.361</td> <td>22.584</td>
//           Numbers are written the Lao way: "." separates thousands, "," is the decimal mark
//           ("22.361" = 22,361 kip · "674,70" = 674.7 kip · "0,8437").
//           On a day without rates (weekend, holiday, before the morning's announcement) the date is empty and
//           the table has no rows; the form's field still holds today's date: value = "03-10-2026".
//   POST date=dd-mm-yyyy (the page's own search form) -> the same page for that day. A day that does not exist
//           is answered with another one (31-02-2026 -> "Date: 03-03-2026"), so the date is always read from
//           the page, never taken from the question.
// The mirror (checked 2026-09-29):
//   { "date": "2026-09-28", "rates": [ { "base": "USD", "quote": "LAK", "type": "buy", "value": 22329 }, ... ] }
// Compared on 2026-10-01 and 2026-10-02: all 14 values of the two routes were the same.

const path = require("path");
const { fetchJson, fetchText, parseNumber, makeRecord, runSource, runIfMain, readJson, LATEST_DIR } = require("./lib/common");
const { fetchTextAia } = require("./lib/aia");

// For tests: BOL_PAGE_URL = a folder of saved pages (today.html, 2026-10-02.html, ...), BOL_URL = a saved mirror file
const PAGE_URL = process.env.BOL_PAGE_URL || "https://www.bol.gov.la/en/ExchangRate";
const MIRROR_URL =
  process.env.BOL_URL ||
  "https://raw.githubusercontent.com/AllRates-Today/central-bank-exchange-rates/main/data/bol/latest.json";

// Currencies we keep (all against LAK). Owner's choice - change here to add more.
const CURRENCIES = ["USD", "THB", "CNY", "GBP", "EUR", "JPY", "KRW"];
const TYPES = ["buy", "sell"];

const MAX_DAYS_BACK = 12; // the longest run of days without rates is the Lao New Year week
const MAX_SPREAD = 0.1; // selling rate at most 10% above the buying rate (the bank's own spread is about 1%)
const MAX_JUMP = 0.2; // a rate more than 20% away from the stored one is a reading error, not a market move ...
const JUMP_CHECK_DAYS = 30; // ... as long as the stored one is not older than this
const SAME = 0.0005; // the two routes "agree" when no value differs by more than 0.05%
const RETRY_WAIT_MS = 3000;

const META = {
  source: "bol",
  source_name: "Bank of the Lao PDR (official rate)",
  source_url: "https://www.bol.gov.la/en/ExchangRate",
  license: "Public page of the Bank of the Lao PDR · backup and cross-check: data mirror by AllRatesToday (CC BY 4.0), https://allratestoday.com",
  kind: "official",
};

// ---------- Days ----------

const addDays = (day, n) => new Date(Date.parse(day + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const isWeekend = (day) => [0, 6].includes(new Date(day + "T00:00:00Z").getUTCDay());
const todayVientiane = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const toPageDay = (day) => `${day.slice(8, 10)}-${day.slice(5, 7)}-${day.slice(0, 4)}`; // 2026-10-02 -> 02-10-2026
// "02-10-2026" -> "2026-10-02"; null when it is not a real day
function fromPageDay(text) {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text || "");
  if (!m) return null;
  const day = `${m[3]}-${m[2]}-${m[1]}`;
  const ms = Date.parse(day + "T00:00:00Z");
  return Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== day ? null : day;
}

// ---------- Reading the two routes (no network in these functions: they are tested with saved pages) ----------

// "22.361" -> 22361 · "674,70" -> 674.7 · "685" -> 685. Anything not written the bank's way is refused: a changed
// number format must stop the direct route, never be guessed at.
function lakNumber(text, label) {
  const s = String(text ?? "").trim();
  if (!/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(s)) throw new Error(`${label}: "${s}" is not a number written the way the bank writes them`);
  return parseNumber(s.replace(/\./g, "").replace(",", "."), label);
}

function checkPair(cur, buy, sell) {
  if (sell < buy || sell / buy - 1 > MAX_SPREAD) throw new Error(`${cur}: buy ${buy} and sell ${sell} cannot both be right`);
}

// One page of the bank -> { day, asked, rates }
//   day   = the day the rates are for; null when the page shows no rates (weekend, holiday, not announced yet)
//   asked = the day in the form's field: the server's "today" on a plain GET
//   rates = { USD: { buy, sell }, ... } for the currencies we keep
function parsePage(html) {
  if (!/<th>\s*Currency Code\s*<\/th>\s*<th>\s*Buy Rates\s*<\/th>\s*<th>\s*Sell Rates\s*<\/th>/i.test(html)) {
    throw new Error('the rate table ("Currency Code | Buy Rates | Sell Rates") is not on the page');
  }
  const shown = /Date:\s*(\d{2}-\d{2}-\d{4})\s*&nbsp;/.exec(html);
  const field = /name="date"[^>]*value\s*=\s*"(\d{2}-\d{2}-\d{4})"/.exec(html);
  const asked = field ? fromPageDay(field[1]) : null;
  const rows = new Map();
  const re = /<td>\s*([A-Z]{3})\s*<\/td>\s*<td>\s*([^<]*?)\s*<\/td>\s*<td>\s*([^<]*?)\s*<\/td>/g;
  for (let m; (m = re.exec(html)); ) rows.set(m[1], [m[2], m[3]]);

  if (!shown && rows.size === 0) return { day: null, asked, rates: {} };
  if (!shown) throw new Error("the page has rates but no date");
  const day = fromPageDay(shown[1]);
  if (!day) throw new Error(`the page's date "${shown[1]}" is not a real day`);
  if (day > addDays(todayVientiane(), 1)) throw new Error(`the page's date ${day} is in the future`);

  const rates = {};
  for (const cur of CURRENCIES) {
    if (!rows.has(cur)) throw new Error(`rate ${cur}/LAK is not on the bank's page of ${day}`);
    const [buy, sell] = rows.get(cur).map((text, i) => lakNumber(text, `${cur} ${TYPES[i]}`));
    checkPair(cur, buy, sell);
    rates[cur] = { buy, sell };
  }
  return { day, asked, rates };
}

// The mirror's file -> { day, rates }
function fromMirror(data) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date || "")) throw new Error(`Missing or bad "date": ${JSON.stringify(data.date)}`);
  if (!Array.isArray(data.rates)) throw new Error('Missing "rates" list');
  const rates = {};
  for (const cur of CURRENCIES) {
    rates[cur] = {};
    for (const type of TYPES) {
      const rate = data.rates.find((r) => r.base === cur && r.quote === "LAK" && r.type === type);
      if (!rate) throw new Error(`Rate ${cur}/LAK ${type} not found`);
      rates[cur][type] = parseNumber(rate.value, `${cur} ${type}`);
    }
    checkPair(cur, rates[cur].buy, rates[cur].sell);
  }
  return { day: data.date, rates };
}

// A reading error (a changed number format: "22,361" read as 22.361) shows as a jump that no exchange rate makes
// from one announcement to the next. Throws when a value is that far from the stored one.
function checkJump(found, stored) {
  if (!stored || !stored.day) return;
  if (Math.abs(Date.parse(found.day) - Date.parse(stored.day)) / 86400000 > JUMP_CHECK_DAYS) return;
  for (const cur of CURRENCIES) {
    for (const type of TYPES) {
      const before = stored.rates[cur] && stored.rates[cur][type];
      const now = found.rates[cur][type];
      if (before && Math.abs(now / before - 1) > MAX_JUMP) {
        throw new Error(`${cur} ${type} ${now} is more than ${MAX_JUMP * 100}% away from the stored ${before} of ${stored.day}`);
      }
    }
  }
}

// The two routes side by side -> what the file keeps as "cross_check". Values are compared only for the same day.
function crossCheck(direct, mirror) {
  if (direct.day !== mirror.day) return { against: "mirror", mirror_date: mirror.day, same_day: false, agree: null, max_diff_pct: null };
  let worst = 0;
  for (const cur of CURRENCIES) for (const type of TYPES) worst = Math.max(worst, Math.abs(mirror.rates[cur][type] / direct.rates[cur][type] - 1));
  return { against: "mirror", mirror_date: mirror.day, same_day: true, agree: worst <= SAME, max_diff_pct: Math.round(worst * 10000) / 100 };
}

// The newest day the bank's page has rates for: today's page, else the working days before it (newest first).
// ask(day) gives the page of a day (null = today's page). Returns null when the stored day - already read from
// the bank itself - is still the newest, so a quiet day costs one request.
async function readDirect(stored, ask) {
  const first = parsePage(await ask(null));
  if (first.day) return first;
  let day = first.asked || todayVientiane();
  for (let back = 1; back <= MAX_DAYS_BACK; back++) {
    day = addDays(day, -1);
    if (isWeekend(day)) continue; // no rate is announced on Saturday and Sunday; a rate of such a day would be on today's page
    if (stored && stored.route === "direct" && stored.complete && day <= stored.day) return null;
    const page = parsePage(await ask(day));
    if (page.day) return page;
  }
  throw new Error(`no rates on the bank's page for the last ${MAX_DAYS_BACK} days`);
}

// ---------- Files and network ----------

// What data/latest/bol.json holds now: { day, complete, route, route_note, cross_check, rates, records } or null
// (complete = every currency we keep is there, all for the same day)
function storedDay() {
  const file = readJson(path.join(LATEST_DIR, "bol.json"), null);
  if (!file || !Array.isArray(file.records) || !file.records.length) return null;
  const rates = {};
  for (const r of file.records) {
    const m = /^([A-Z]{3})_LAK_(buy|sell)$/.exec(r.metric);
    if (m) (rates[m[1]] = rates[m[1]] || {})[m[2]] = r.value;
  }
  const day = file.records.map((r) => r.source_date).sort().pop();
  // a file written before the direct route existed has no "route": its numbers came from the mirror
  const complete = CURRENCIES.every((cur) => rates[cur] && rates[cur].buy && rates[cur].sell) && file.records.every((r) => r.source_date === day);
  return { day, complete, route: file.route || "mirror", route_note: file.route_note || null, cross_check: file.cross_check || null, rates, records: file.records };
}

async function ask(day) {
  if (!/^https?:\/\//i.test(PAGE_URL)) return fetchText(path.join(PAGE_URL, (day || "today") + ".html"));
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return (await fetchTextAia(PAGE_URL, {}, 20000, day ? "date=" + toPageDay(day) : null)).text;
    } catch (err) {
      lastError = err;
      if (attempt === 1) await new Promise((r) => setTimeout(r, RETRY_WAIT_MS));
    }
  }
  throw lastError;
}

async function getRecords(fetchedAt, meta) {
  const stored = storedDay();
  // a failed run keeps what the file says about the numbers it still holds
  Object.assign(meta, { route: stored ? stored.route : null, route_note: stored ? stored.route_note : null, cross_check: stored ? stored.cross_check : null });

  const [direct, mirror] = await Promise.allSettled([
    readDirect(stored, ask).then((found) => {
      if (found) checkJump(found, stored);
      if (found && stored && found.day < stored.day) throw new Error(`the bank's page shows ${found.day}, older than the stored ${stored.day}`);
      return found;
    }),
    fetchJson(MIRROR_URL).then(fromMirror),
  ]);

  let day;
  let route;
  let note = null;
  let check = null;
  if (direct.status === "fulfilled") {
    route = "direct";
    day = direct.value || { day: stored.day, rates: stored.rates }; // null = the stored day is still the newest
    if (mirror.status === "fulfilled") check = crossCheck(day, mirror.value);
    else if (stored && stored.route === "direct" && stored.day === day.day) check = stored.cross_check; // compared earlier for this day
    if (check && check.same_day && !check.agree) {
      console.warn(`[WARN] bol: the bank's page and the mirror differ by up to ${check.max_diff_pct}% for ${day.day} - the bank's page is used`);
    }
  } else {
    note = direct.reason.message;
    if (mirror.status !== "fulfilled") throw new Error(`bank's page: ${note} · mirror: ${mirror.reason.message}`);
    day = mirror.value;
    try {
      checkJump(day, stored);
      if (stored && day.day < stored.day) throw new Error(`the mirror shows ${day.day}, older than the stored ${stored.day}`);
    } catch (err) {
      throw new Error(`bank's page: ${note} · mirror: ${err.message}`);
    }
    route = "mirror";
  }
  Object.assign(meta, { route, route_note: note, cross_check: check });
  const checked = !check ? "not compared" : !check.same_day ? `mirror still on ${check.mirror_date}` : check.agree ? "mirror agrees" : `mirror differs by up to ${check.max_diff_pct}%`;
  console.log(`[bol] route: ${route === "direct" ? "direct (the bank's own page)" : "mirror (backup) - " + note} · rates of ${day.day} · ${checked}`);

  // the stored day is still the newest: hand the stored records back untouched, so nothing is rewritten
  if (direct.status === "fulfilled" && !direct.value) return stored.records;

  const records = [];
  for (const cur of CURRENCIES) {
    for (const type of TYPES) {
      records.push(
        makeRecord({
          source: "bol",
          metric: `${cur}_LAK_${type}`,
          value: day.rates[cur][type],
          unit: `LAK per ${cur}`,
          fetched_at: fetchedAt,
          source_date: day.day,
        })
      );
    }
  }
  return records;
}

const run = () => {
  const meta = { ...META }; // getRecords adds the route of this run
  return runSource(meta, (fetchedAt) => getRecords(fetchedAt, meta));
};
runIfMain(module, run);

module.exports = { run, CURRENCIES, TYPES, parsePage, lakNumber, fromMirror, checkJump, crossCheck, readDirect, fromPageDay };
