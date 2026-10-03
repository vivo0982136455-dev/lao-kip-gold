// The official exchange rate has two routes (scripts/fetch-bol.js): the bank's own page, and a public mirror as
// the backup. This test runs the fetcher on SAVED pages in a throw-away folder - nothing is downloaded and the
// project's data is not touched - and looks at which route it takes and what it writes:
//   - numbers written the bank's way ("22.361" = 22,361 · "674,70" = 674.7) and everything else refused
//   - a weekend page without rates: the fetcher asks for the working day before
//   - a broken or changed page: the mirror is used and the file says why
//   - a number a thousand times too small or too big never reaches the file
//   - both routes down: the old numbers stay, marked stale, and the file still says which route they came by
// Usage: node tests/bol-route.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("node:assert/strict");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const bol = require(path.join(ROOT, "scripts", "fetch-bol.js"));

let passed = 0;
const failed = [];
const test = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log("PASS  " + name);
  } catch (e) {
    failed.push(name);
    console.log("FAIL  " + name + "\n      " + String(e.message).split("\n").slice(0, 8).join("\n      "));
  }
};

// ---------- a page with the same markup as https://www.bol.gov.la/en/ExchangRate (checked 2026-10-03) ----------
const pageDay = (day) => (day ? `${day.slice(8, 10)}-${day.slice(5, 7)}-${day.slice(0, 4)}` : "");
const TABLE_HEAD = "\t<table>\n\t\t<thead>\n\t\t\t<tr>\n\t\t\t\t<th>No.</th>\n\t\t\t\t<th>Countries</th>\n\t\t\t\t<th>Foreign Currencies</th>\n\t\t\t\t<th>Currency Code</th>\n\t\t\t\t<th>Buy Rates</th>\n\t\t\t\t<th>Sell Rates</th>\n\t\t\t</tr>\n\t\t</thead>\n\t\t<tbody>\n";
function page(shownDay, fieldDay, rows, head = TABLE_HEAD) {
  const body = rows
    .map(([code, buy, sell], i) => `\t\t\t<tr>\n\t\t\t\t<td>${i + 1}</td>\n\t\t\t\t<td><img src="img/flag/x.jpg" style="width:50px;height:30px;margin-right:5px;" ></td>\n\t\t\t\t<td>Currency ${i + 1}</td>\n\t\t\t\t<td>${code}</td>\n\t\t\t\t\t\t\t<td>${buy}</td>\n\t\t\t\t<td>${sell}</td>\n\n\t\t\t</tr>`)
    .join("\n");
  return `<html><body>\n<form method = "POST" enctype="multipart/form-data" id="frm_sel" onsubmit = "" >\n<div class="article-classic">\n\t<form action="#" class="ws-validate">\n\t\t<div class="form-row">\n\t\tDate: ${pageDay(shownDay)} &nbsp;&nbsp;&nbsp;&nbsp;\n\t\tDate: &nbsp;<input type="text"  name="date" class="date" value = "${pageDay(fieldDay)}" />\n\t\t\t<button type="submit">Search</button>\n\t\t</div>\n\t</form>\n</div>\n<div class="article-classic">\n${head}${body}\n\t\t</tbody>\n\t</table>\n</div>\n</form></body></html>`;
}
// the bank's rows of 2 October 2026, as written on its page
const FRI = "2026-10-02";
const SAT = "2026-10-03";
const ROWS = [
  ["AUD", "15.318", "15.624"],
  ["CNY", "3.319", "3.343"],
  ["EUR", "25.200", "25.454"],
  ["GBP", "29.290", "29.876"],
  ["JPY", "142,83", "145,69"],
  ["KRW", "15,93", "16,23"],
  ["THB", "674,70", "685"],
  ["USD", "22.361", "22.584"],
  ["VND", "0,8437", "0,8521"],
];
const VALUES = { USD: [22361, 22584], THB: [674.7, 685], CNY: [3319, 3343], GBP: [29290, 29876], EUR: [25200, 25454], JPY: [142.83, 145.69], KRW: [15.93, 16.23] };
const mirror = (day, change = {}) => ({
  source: "bol",
  date: day,
  rates: Object.entries({ ...VALUES, ...change }).flatMap(([base, [buy, sell]]) => [
    { base, quote: "LAK", type: "buy", value: buy },
    { base, quote: "LAK", type: "sell", value: sell },
  ]),
});
const records = (day, change = {}) =>
  bol.CURRENCIES.flatMap((cur) =>
    bol.TYPES.map((type, i) => ({ source: "bol", metric: `${cur}_LAK_${type}`, value: ({ ...VALUES, ...change })[cur][i], unit: `LAK per ${cur}`, fetched_at: day + "T02:00:00.000Z", source_date: day }))
  );
const oldFile = (day, extra = {}) => ({ source: "bol", source_name: "Bank of the Lao PDR (official rate)", source_url: "https://www.bol.gov.la/ExchangRate.php", license: "CC BY 4.0 - data mirror by AllRatesToday, https://allratestoday.com", kind: "official", ...extra, stale: false, last_success_at: day + "T02:00:00.000Z", last_error: null, records: records(day) });

// ---------- one run of the fetcher in its own folder ----------
// pages: { today: html, "2026-10-02": html, ... } · mirrorFile: object, or null = the mirror cannot be read
function runFetcher(dir, pages, mirrorFile) {
  const pageDir = path.join(dir, "pages");
  fs.rmSync(pageDir, { recursive: true, force: true });
  fs.mkdirSync(pageDir, { recursive: true });
  for (const [name, html] of Object.entries(pages)) fs.writeFileSync(path.join(pageDir, name + ".html"), html);
  const mirrorPath = path.join(dir, "mirror.json");
  fs.rmSync(mirrorPath, { force: true });
  if (mirrorFile) fs.writeFileSync(mirrorPath, JSON.stringify(mirrorFile));
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "fetch-bol.js")], {
    env: { ...process.env, DATA_DIR: dir, BOL_PAGE_URL: pageDir, BOL_URL: mirrorPath },
    encoding: "utf8",
    timeout: 60000,
  });
  const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
  return { status: r.status, out: r.stdout + r.stderr, latest: fs.existsSync(path.join(dir, "latest", "bol.json")) ? read("latest/bol.json") : null, history: fs.existsSync(path.join(dir, "history", "bol.json")) ? read("history/bol.json") : [] };
}
const dirs = [];
function folder(stored) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lkg-bol-route-"));
  dirs.push(dir);
  if (stored) {
    fs.mkdirSync(path.join(dir, "latest"), { recursive: true });
    fs.mkdirSync(path.join(dir, "history"), { recursive: true });
    fs.writeFileSync(path.join(dir, "latest", "bol.json"), JSON.stringify(stored, null, 2) + "\n");
    fs.writeFileSync(path.join(dir, "history", "bol.json"), JSON.stringify(stored.records));
  }
  return dir;
}
const valuesOf = (latest) => Object.fromEntries(latest.records.map((r) => [r.metric, r.value]));
const THU = "2026-10-01";
const THU_VALUES = { USD: [22354, 22577] };

(async () => {
  // ---------- reading numbers and pages ----------
  await test("numbers written the bank's way are read: dot = thousands, comma = decimals", () => {
    assert.equal(bol.lakNumber("22.361", "x"), 22361);
    assert.equal(bol.lakNumber("674,70", "x"), 674.7);
    assert.equal(bol.lakNumber("685", "x"), 685);
    assert.equal(bol.lakNumber("0,8437", "x"), 0.8437);
    assert.equal(bol.lakNumber("1.234.567,5", "x"), 1234567.5);
  });
  await test("numbers written any other way are refused, not guessed", () => {
    for (const bad of ["22,361.00", "22361", "22 361", "22.36", "abc", "", "-685", "1e3", "22.361,", "0"]) assert.throws(() => bol.lakNumber(bad, "x"), undefined, `"${bad}" was accepted`);
  });
  await test("a page with rates: the day comes from the page, the seven currencies are read", () => {
    const p = bol.parsePage(page(FRI, FRI, ROWS));
    assert.equal(p.day, FRI);
    assert.equal(p.asked, FRI);
    assert.deepEqual(Object.keys(p.rates), bol.CURRENCIES);
    for (const cur of bol.CURRENCIES) assert.deepEqual([p.rates[cur].buy, p.rates[cur].sell], VALUES[cur], cur);
  });
  await test("a page without rates (weekend): no day, but the form still says which day was asked", () => {
    const p = bol.parsePage(page(null, SAT, []));
    assert.equal(p.day, null);
    assert.equal(p.asked, SAT);
  });
  await test("a page that is not the rate page, has no date, an impossible date or a missing currency is refused", () => {
    assert.throws(() => bol.parsePage("<html><body>Service unavailable</body></html>"), /rate table/);
    assert.throws(() => bol.parsePage(page(FRI, FRI, ROWS, TABLE_HEAD.replace("Buy Rates", "Buying"))), /rate table/);
    assert.throws(() => bol.parsePage(page(null, FRI, ROWS)), /no date/);
    assert.throws(() => bol.parsePage(page(FRI, FRI, ROWS).replace("Date: 02-10-2026", "Date: 31-02-2026")), /not a real day/);
    assert.throws(() => bol.parsePage(page("2099-01-05", FRI, ROWS)), /future/);
    assert.throws(() => bol.parsePage(page(FRI, FRI, ROWS.filter((r) => r[0] !== "THB"))), /THB/);
    assert.throws(() => bol.parsePage(page(FRI, FRI, ROWS.map((r) => (r[0] === "USD" ? ["USD", "22.584", "22.361"] : r)))), /USD/); // buy above sell
  });
  await test("the date on the page is checked as a calendar day", () => {
    assert.equal(bol.fromPageDay("02-10-2026"), "2026-10-02");
    assert.equal(bol.fromPageDay("29-02-2024"), "2024-02-29");
    for (const bad of ["31-02-2026", "2026-10-02", "2-10-2026", "", null, "00-00-0000"]) assert.equal(bol.fromPageDay(bad), null, String(bad));
  });

  // ---------- which pages are asked ----------
  const asker = (pages) => {
    const asked = [];
    return { asked, ask: async (day) => (asked.push(day || "today"), pages[day || "today"] || page(null, day, [])) };
  };
  await test("a working day: one request, today's page", async () => {
    const a = asker({ today: page(FRI, FRI, ROWS) });
    const found = await bol.readDirect(null, a.ask);
    assert.equal(found.day, FRI);
    assert.deepEqual(a.asked, ["today"]);
  });
  await test("Sunday, numbers stored from the mirror: Saturday is skipped, Friday is asked", async () => {
    const a = asker({ today: page(null, "2026-10-04", []), [FRI]: page(FRI, FRI, ROWS) });
    const found = await bol.readDirect({ day: FRI, route: "mirror", complete: true }, a.ask);
    assert.equal(found.day, FRI);
    assert.deepEqual(a.asked, ["today", FRI]);
  });
  await test("Sunday, Friday already read from the bank: one request, nothing new", async () => {
    const a = asker({ today: page(null, "2026-10-04", []) });
    assert.equal(await bol.readDirect({ day: FRI, route: "direct", complete: true }, a.ask), null);
    assert.deepEqual(a.asked, ["today"]);
  });
  await test("Monday morning after a Friday holiday: Thursday's page is the newest", async () => {
    const a = asker({ today: page(null, "2026-10-05", []), [THU]: page(THU, THU, ROWS) });
    const found = await bol.readDirect({ day: "2026-09-30", route: "direct", complete: true }, a.ask);
    assert.equal(found.day, THU);
    assert.deepEqual(a.asked, ["today", FRI, THU]);
  });
  await test("no rates for many days: the direct route gives up instead of asking for ever", async () => {
    const a = asker({ today: page(null, "2026-10-05", []) });
    await assert.rejects(bol.readDirect(null, a.ask), /no rates on the bank's page/);
    assert.ok(a.asked.length <= 11, `${a.asked.length} requests`);
  });

  // ---------- whole runs ----------
  await test("first run ever, both routes agree: route = direct, 14 values, cross-check says they agree", () => {
    const r = runFetcher(folder(null), { today: page(FRI, FRI, ROWS) }, mirror(FRI));
    assert.equal(r.status, 0, r.out);
    assert.equal(r.latest.route, "direct");
    assert.equal(r.latest.route_note, null);
    assert.deepEqual(r.latest.cross_check, { against: "mirror", mirror_date: FRI, same_day: true, agree: true, max_diff_pct: 0 });
    assert.equal(r.latest.records.length, 14);
    assert.equal(valuesOf(r.latest).USD_LAK_buy, 22361);
    assert.equal(valuesOf(r.latest).THB_LAK_buy, 674.7);
    assert.ok(r.latest.records.every((x) => x.source_date === FRI));
    assert.equal(r.history.length, 14);
    assert.match(r.out, /route: direct/);
  });
  await test("a file written before the change (mirror numbers): same values, the file now names the direct route, history untouched", () => {
    const dir = folder(oldFile(FRI));
    const r = runFetcher(dir, { today: page(null, SAT, []), [FRI]: page(FRI, FRI, ROWS) }, mirror(FRI));
    assert.equal(r.status, 0, r.out);
    assert.equal(r.latest.route, "direct");
    assert.equal(r.latest.last_success_at, FRI + "T02:00:00.000Z"); // the values did not change
    assert.deepEqual(r.latest.records, records(FRI));
    assert.equal(r.history.length, 14);
    const before = fs.readFileSync(path.join(dir, "latest", "bol.json"), "utf8");
    const again = runFetcher(dir, { today: page(null, SAT, []) }, mirror(FRI)); // Friday's page is not even there: it is not asked again
    assert.equal(again.status, 0, again.out);
    assert.equal(fs.readFileSync(path.join(dir, "latest", "bol.json"), "utf8"), before, "the file was rewritten although nothing changed");
  });
  await test("a new day on the bank's page while the mirror is still on the day before: direct, marked as not compared", () => {
    const r = runFetcher(folder(oldFile(THU, { route: "direct" })), { today: page(FRI, FRI, ROWS) }, mirror(THU, THU_VALUES));
    assert.equal(r.status, 0, r.out);
    assert.equal(r.latest.route, "direct");
    assert.deepEqual(r.latest.cross_check, { against: "mirror", mirror_date: THU, same_day: false, agree: null, max_diff_pct: null });
    assert.ok(r.latest.records.every((x) => x.source_date === FRI));
    assert.equal(r.history.length, 28);
  });
  await test("the two routes disagree on the same day: the bank's page wins, the file and the log say so", () => {
    const r = runFetcher(folder(oldFile(THU)), { today: page(FRI, FRI, ROWS) }, mirror(FRI, { USD: [22300, 22584] }));
    assert.equal(r.status, 0, r.out);
    assert.equal(r.latest.route, "direct");
    assert.equal(r.latest.cross_check.agree, false);
    assert.equal(r.latest.cross_check.max_diff_pct, 0.27);
    assert.equal(valuesOf(r.latest).USD_LAK_buy, 22361);
    assert.match(r.out, /\[WARN\] bol: .*differ/);
  });
  await test("the bank's page cannot be read: the mirror is used and the file says why", () => {
    const r = runFetcher(folder(oldFile(THU)), {}, mirror(FRI));
    assert.equal(r.status, 0, r.out);
    assert.equal(r.latest.route, "mirror");
    assert.match(r.latest.route_note, /Cannot read local file|today\.html/);
    assert.equal(r.latest.cross_check, null);
    assert.equal(valuesOf(r.latest).USD_LAK_buy, 22361);
    assert.match(r.out, /route: mirror \(backup\)/);
  });
  await test("the bank changes how it writes numbers (22,361.00): refused, the mirror is used", () => {
    const rows = ROWS.map((x) => (x[0] === "USD" ? ["USD", "22,361.00", "22,584.00"] : x));
    const r = runFetcher(folder(oldFile(THU)), { today: page(FRI, FRI, rows) }, mirror(FRI));
    assert.equal(r.status, 0, r.out);
    assert.equal(r.latest.route, "mirror");
    assert.match(r.latest.route_note, /not a number written the way the bank writes them/);
    assert.equal(valuesOf(r.latest).USD_LAK_buy, 22361);
  });
  await test('"22,361" would read as 22.361 kip: a value a thousand times too small never reaches the file', () => {
    const rows = ROWS.map((x) => (x[0] === "USD" ? ["USD", "22,361", "22,584"] : x));
    const r = runFetcher(folder(oldFile(THU)), { today: page(FRI, FRI, rows) }, mirror(FRI));
    assert.equal(r.status, 0, r.out);
    assert.equal(r.latest.route, "mirror");
    assert.match(r.latest.route_note, /more than 20% away from the stored/);
    assert.equal(valuesOf(r.latest).USD_LAK_buy, 22361);
    assert.ok(r.history.every((x) => x.value > 10), "a wrong value is in the history");
  });
  await test("both routes down: exit 1, the old numbers stay and are marked stale, the route of the old numbers is kept", () => {
    const r = runFetcher(folder(oldFile(THU, { route: "direct", route_note: null, cross_check: { against: "mirror", mirror_date: THU, same_day: true, agree: true, max_diff_pct: 0 } })), {}, null);
    assert.equal(r.status, 1, r.out);
    assert.equal(r.latest.stale, true);
    assert.equal(r.latest.route, "direct");
    assert.equal(r.latest.cross_check.agree, true);
    assert.match(r.latest.last_error.message, /bank's page: .* · mirror: /);
    assert.deepEqual(r.latest.records, records(THU));
    assert.equal(r.history.length, 14);
  });
  await test("the mirror is wrong by a factor of a thousand while the bank's page is down: nothing is written, the source is marked stale", () => {
    const r = runFetcher(folder(oldFile(THU)), {}, mirror(FRI, { USD: [22.361, 22.584] }));
    assert.equal(r.status, 1, r.out);
    assert.equal(r.latest.stale, true);
    assert.deepEqual(r.latest.records, records(THU));
    assert.equal(r.history.length, 14);
  });
  await test("the mirror cannot be read: the bank's page alone is enough", () => {
    const r = runFetcher(folder(oldFile(THU)), { today: page(FRI, FRI, ROWS) }, null);
    assert.equal(r.status, 0, r.out);
    assert.equal(r.latest.route, "direct");
    assert.equal(r.latest.cross_check, null);
    assert.match(r.out, /not compared/);
  });
  await test("a route that shows an older day than the stored one is not used", () => {
    const r = runFetcher(folder(oldFile(FRI)), { today: page(null, SAT, []), [FRI]: page(null, FRI, []), [THU]: page(THU, THU, ROWS) }, mirror(FRI));
    assert.equal(r.status, 0, r.out);
    assert.equal(r.latest.route, "mirror");
    assert.match(r.latest.route_note, /older than the stored/);
    assert.ok(r.latest.records.every((x) => x.source_date === FRI));
  });

  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed.length} failed`);
  process.exit(failed.length ? 1 : 0);
})();
