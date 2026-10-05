// The owner's save script (apps-script/save-prices.gs) - the code Google will run - and the bot's side of it.
// The script is loaded as it is and run in Node with a pretend Sheet: a row is written only with the right key,
// into the columns of the Form's questions; everything else is refused and writes nothing.
// Then a local server answers like the deployed script, and scripts/fetch-form-entries.js is run against it.
// Nothing is sent to Google and the project's own data is never touched. Usage: node tests/save-script.js
// tests/states.js uses loadScript() and fakeSheet() of this file for the page's side.
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const http = require("http");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const KEY = "test-key-Abc234defGHJ567k"; // only for this test; the owner's key is made at Google and is in no file

// handle(), roles() and the constants of the script (the parts that need Google's services are never called)
function loadScript() {
  const box = {};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "apps-script", "save-prices.gs"), "utf8") + "\n;this.api = { handle, roles, KEY_MIN_LENGTH, WRONG_KEY_WAIT_MS, TEXT_MAX };", box);
  return box.api;
}

// The Sheet of the Form: its time stamp column, then one column for each question the real Form has
// (the titles of the owner's Form as the bot read them on 2026-10-05: data/manual-form.json "questions" of that day)
const HEADERS = ["ประทับเวลา", "วันที่", "ราคาขาย (กีบ ต่อ 1 บาท)", "ราคารับซื้อ (กีบ ต่อ 1 บาท)", "หมายเหตุ", "ทองแท่ง ราคาขาย (กีบ ต่อ 1 บาท)", "ทองแท่ง ราคารับซื้อ (กีบ ต่อ 1 บาท)", "เงิน PML ราคาขาย (กีบ ต่อ 1 กิโล)", "เงิน PML ราคารับซื้อ (กีบ ต่อ 1 กิโล)", "ยาง ราคา (กีบ ต่อ 1 กิโล)", "ยาง ชนิด", "ยาง สถานที่", "ที่ดิน สถานที่", "ที่ดิน ราคารวม (กีบ)", "ที่ดิน เนื้อที่ (ตารางเมตร)"];
function fakeSheet(headers = HEADERS, key = KEY) {
  const sheet = { rows: [], waited: 0 };
  sheet.env = () => ({ key, headers, append: (row) => sheet.rows.push(row) + 1, wait: (ms) => (sheet.waited += ms), now: "NOW" });
  return sheet;
}

if (require.main === module) main();
module.exports = { loadScript, fakeSheet, KEY, HEADERS };

async function main() {
  let passed = 0;
  const failed = [];
  const check = (name, ok, detail = "") => {
    if (ok) passed++;
    else failed.push(name);
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "\n      " + String(detail).slice(0, 600)}`);
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const api = loadScript();
  const post = (sheet, msg) => api.handle(typeof msg === "string" ? msg : JSON.stringify(msg), sheet.env());

  // ---------- 1. the columns ----------
  const cols = api.roles(HEADERS);
  const wanted = ["date", "sell", "buy", "note", "bar_sell", "bar_buy", "silver_sell", "silver_buy", "rubber_price", "rubber_type", "rubber_place", "land_place", "land_total", "land_area"];
  check("every question of the real Form has its column, each one a different column", HEADERS.length === 15 && same(Object.keys(cols).sort(), [...wanted].sort()) && new Set(Object.values(cols)).size === wanted.length && !Object.values(cols).includes(0), JSON.stringify(cols));
  const shuffled = [HEADERS[0], ...HEADERS.slice(1).reverse()];
  check("the columns are found by their titles, in any order", wanted.every((r) => shuffled[api.roles(shuffled)[r]] === HEADERS[cols[r]]), JSON.stringify(api.roles(shuffled)));

  // ---------- 2. the right key writes one row ----------
  let sheet = fakeSheet();
  let a = post(sheet, { key: KEY, values: { date: "2026-10-05", sell: 46000000, buy: 45000000, note: "from the page" } });
  const row = sheet.rows[0] || [];
  check("right key: one row, the answer names it", a.ok === true && a.row === 2 && sheet.rows.length === 1 && sheet.waited === 0, JSON.stringify(a));
  check(
    "right key: time stamp first, every value in the column of its question, the other columns empty",
    row.length === HEADERS.length && row[0] === "NOW" && row[cols.date] === "2026-10-05" && row[cols.sell] === 46000000 && row[cols.buy] === 45000000 && row[cols.note] === "from the page" && row.filter((c) => c !== "").length === 5,
    JSON.stringify(row)
  );
  sheet = fakeSheet();
  a = post(sheet, { key: KEY, values: { date: "2026-10-05", rubber_price: 18500, rubber_type: "ยางก้อนถ้วย", rubber_place: "Bokeo | ບ້ານ", note: "x" } });
  check("right key: a rubber price with its kind and place", a.ok === true && sheet.rows[0][cols.rubber_price] === 18500 && sheet.rows[0][cols.rubber_type] === "ยางก้อนถ้วย" && sheet.rows[0][cols.rubber_place] === "Bokeo | ບ້ານ", JSON.stringify(sheet.rows));

  // ---------- 3. everything else writes nothing ----------
  const refused = (name, msg, error, env) => {
    const s = fakeSheet(...(env || []));
    const r = post(s, msg);
    check(name, r.ok === false && r.error === error && s.rows.length === 0, JSON.stringify(r) + " rows " + s.rows.length);
    return s;
  };
  const good = { date: "2026-10-05", sell: 46000000 };
  const slow = refused("wrong key: refused, nothing written", { key: KEY.slice(0, -1) + "X", values: good }, "key");
  check("wrong key: answered slowly", slow.waited === api.WRONG_KEY_WAIT_MS, String(slow.waited));
  refused("no key: refused", { values: good }, "key");
  refused("the right key with one more letter: refused", { key: KEY + "a", values: good }, "key");
  refused("a key that is not a text: refused", { key: { length: KEY.length }, values: good }, "key");
  refused("not JSON at all: refused", "sell=1", "key");
  refused("no key set in the script yet: refused, even with an empty key", { key: "", values: good }, "setup", [HEADERS, ""]);
  refused("a key shorter than the script allows: refused", { key: "short", values: good }, "setup", [HEADERS, "short"]);
  check("the shortest key the script allows is long", api.KEY_MIN_LENGTH >= 16, String(api.KEY_MIN_LENGTH));
  refused("a date that is not YYYY-MM-DD: refused", { key: KEY, values: { date: "5/10/2026", sell: 1 } }, "values");
  refused("no date: refused", { key: KEY, values: { sell: 46000000 } }, "values");
  refused("a date and no price: refused", { key: KEY, values: { date: "2026-10-05", note: "only words" } }, "values");
  refused("a price sent as text: refused", { key: KEY, values: { date: "2026-10-05", sell: "46000000" } }, "values");
  refused("a price of zero: refused", { key: KEY, values: { date: "2026-10-05", sell: 0 } }, "values");
  refused("a price beyond any money: refused", { key: KEY, values: { date: "2026-10-05", sell: 1e15 } }, "values");
  refused("a field the Sheet has no column for: refused", { key: KEY, values: { ...good, formula: "x" } }, "values");
  refused("a text longer than the limit: refused", { key: KEY, values: { ...good, note: "x".repeat(api.TEXT_MAX + 1) } }, "values");
  refused("a Sheet without a date column: refused", { key: KEY, values: good }, "sheet", [["ประทับเวลา", "ราคาขาย"]]);
  sheet = fakeSheet();
  post(sheet, { key: KEY, values: { ...good, note: "=IMPORTXML(\"http://x\")" } });
  check("a text that starts like a formula is stored as text", String((sheet.rows[0] || [])[cols.note]).startsWith("'="), JSON.stringify(sheet.rows));

  // ---------- 4. the bot asks the script which prices the Sheet takes ----------
  const live = fakeSheet();
  const server = http.createServer((req, res) => {
    const send = (obj) => {
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(obj));
    };
    if (req.method === "GET") return send(server.broken ? { ok: true, roles: ["note"] } : { ok: true, roles: Object.keys(api.roles(HEADERS)) });
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => send(api.handle(body, live.env())));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const runBot = () =>
    new Promise((resolve) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lkg-save-script-"));
      let out = "";
      const child = spawn(process.execPath, [path.join(ROOT, "scripts", "fetch-form-entries.js")], { env: { ...process.env, DATA_DIR: dir, SAVE_URL: `http://127.0.0.1:${server.address().port}/exec` } });
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      child.on("exit", (status) => {
        let file = null;
        try {
          file = JSON.parse(fs.readFileSync(path.join(dir, "manual-form.json"), "utf8"));
        } catch {
          /* not written */
        }
        fs.rmSync(dir, { recursive: true, force: true });
        resolve({ status, out, file });
      });
    });
  const bot = await runBot();
  check(
    "the bot: the page's file names the script, every price of the Sheet and the limits - and no Form",
    bot.status === 0 && bot.file && /\/exec$/.test(bot.file.save_url) && same(Object.keys(bot.file.entries).sort(), [...wanted].sort()) && bot.file.limits && bot.file.limits.rubber && !("form_id" in bot.file),
    bot.out + JSON.stringify(bot.file)
  );
  check("the bot: asking wrote nothing into the Sheet", live.rows.length === 0, JSON.stringify(live.rows));
  server.broken = true;
  const botBad = await runBot();
  check("the bot: a script that finds no date / sell column is a failure, and no file is written", botBad.status === 1 && botBad.file === null, botBad.out);
  server.close();

  // ---------- 5. no key anywhere in the site's files ----------
  const real = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "manual-sources.json"), "utf8"));
  check("the address of the script in the config is empty or an Apps Script web app", !real.save_url || /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(real.save_url), String(real.save_url));
  check("the script file holds no key (it is made at Google by makeKey)", !/SAVE_KEY\s*=\s*["'][^"']/.test(fs.readFileSync(path.join(ROOT, "apps-script", "save-prices.gs"), "utf8")));

  console.log(`\n${passed} passed, ${failed.length} failed`);
  process.exit(failed.length ? 1 : 0);
}
