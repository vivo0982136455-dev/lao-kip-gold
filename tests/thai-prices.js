// The Thai price script (scripts/fetch-thai-prices.js) and a server that hangs. The weekly workflow stops the step
// after 15 minutes; seen 2026-10-04 on GitHub: nine of twelve items hung, the step was stopped and the run was red.
// The script must end by itself: stop asking when its time is used up, keep the prices it has and mark every item
// it could not ask - and still write what did answer.
// A local server, a throw-away data folder and a child process; nothing is downloaded from outside and the
// project's own data is never touched. Usage: node tests/thai-prices.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "fetch-thai-prices.js");
const { ITEMS, RUN_LIMIT_MS, REQUEST_TIMEOUT_MS } = require(SCRIPT);
const { RETRY_WAIT_MS } = require(path.join(ROOT, "scripts", "lib", "common.js"));

const TIMEOUT_MS = 1000; // the time limit the child gives one request
const ITEM_MS = 2 * TIMEOUT_MS + RETRY_WAIT_MS; // what an item that hangs costs: two tries and the pause between them
const SPARE_MS = 4000; // starting node, writing the file, a slow machine
const keys = Object.keys(ITEMS);
const idOf = (key) => ITEMS[key].id;
const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const today = day(0);
const OLD_DAY = day(7); // the day the source last answered, in the file the run starts from
const SERVER_DAYS = [day(3), day(2), day(1)];

// The file a run starts from: every item with one price; the LAST item of the list holds the oldest price
const stored = (key, i) => ({ moc_id: idOf(key), name_th: "old " + key, unit: ITEMS[key].unit, latest: { date: day(30 + i), value: 50 + i }, days: [[day(30 + i), 50 + i]], monthly: [[day(30 + i).slice(0, 7), 50 + i, 1]], stale: false, last_error: null });
const oldFile = () => ({ source: { source_name: "old", source_url: "https://example.org/", retrieved: OLD_DAY }, unit_note: "THB per unit (KG / L / egg)", items: Object.fromEntries(keys.map((k, i) => [k, stored(k, i)])) });
const oldestFirst = [...keys].reverse();

let plan = () => "ok"; // (product id, how many times this id was asked) -> "ok" | "hang" | an HTTP status
let asked = []; // product ids, in the order of the requests
const server = http.createServer((req, res) => {
  const id = new URL(req.url, "http://localhost").searchParams.get("product_id");
  asked.push(id);
  const what = plan(id, asked.filter((x) => x === id).length);
  if (what === "hang") return; // the answer never comes
  if (typeof what === "number") {
    res.writeHead(what, { "Content-Type": "text/plain" });
    res.end("error");
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ product_id: id, product_name: "test " + id, unit: "บาท/กก.", price_list: SERVER_DAYS.map((d) => ({ date: d + "T00:00:00", price_min: 100, price_max: 110 })) }));
});

// One run of the script on a fresh copy of the old file
function run(limitMs, behaviour) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lkg-thai-prices-"));
  fs.writeFileSync(path.join(dir, "thai-prices.json"), JSON.stringify(oldFile()));
  plan = behaviour;
  asked = [];
  const env = { ...process.env, DATA_DIR: dir, THAI_PRICES_URL: `http://127.0.0.1:${server.address().port}/prices`, THAI_PRICES_TIMEOUT_MS: String(TIMEOUT_MS), THAI_PRICES_RUN_LIMIT_MS: String(limitMs), THAI_PRICES_SECOND_TRY_WAIT_MS: "200" };
  return new Promise((resolve) => {
    const started = Date.now();
    let out = "";
    const child = spawn(process.execPath, [SCRIPT], { env });
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const guard = setTimeout(() => child.kill(), 120000); // the script hangs: the checks below then fail
    child.on("exit", (status) => {
      clearTimeout(guard);
      let file = null;
      try {
        file = JSON.parse(fs.readFileSync(path.join(dir, "thai-prices.json"), "utf8"));
      } catch {
        /* not written, or not JSON: the checks fail */
      }
      fs.rmSync(dir, { recursive: true, force: true });
      resolve({ status, out, ms: Date.now() - started, asked: [...asked], file });
    });
  });
}

let passed = 0;
const failed = [];
const result = (name, ok, detail) => {
  if (ok) passed++;
  else failed.push(name);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "\n      " + String(detail).split("\n").slice(-14).join("\n      ")}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// an item that kept exactly the prices it had (the state and the error apart)
const kept = (item, key) => {
  const { stale, last_error, ...rest } = item || {};
  const { stale: s, last_error: e, ...before } = stored(key, keys.indexOf(key));
  return same(rest, before);
};
const items = (r) => (r.file && r.file.items) || {};
const secs = (ms) => (ms / 1000).toFixed(1) + " s";

async function main() {
  // ---------- 0. the limits the script ships with fit into the time the workflow gives the step ----------
  const workflow = fs.readFileSync(path.join(ROOT, ".github", "workflows", "fetch-economy.yml"), "utf8");
  const step = workflow.split(/\n\s*- name: /).find((s) => s.includes("node scripts/fetch-thai-prices.js")) || "";
  const stepMinutes = Number((step.match(/timeout-minutes:\s*(\d+)/) || [])[1]);
  const longest = RUN_LIMIT_MS + 2 * REQUEST_TIMEOUT_MS + RETRY_WAIT_MS;
  result(
    "the longest a run can take (its limit + one more item) leaves a minute of the workflow step's time",
    stepMinutes > 0 && longest + 60000 <= stepMinutes * 60000,
    `step: ${stepMinutes} minutes; the script: limit ${secs(RUN_LIMIT_MS)} + one item ${secs(2 * REQUEST_TIMEOUT_MS + RETRY_WAIT_MS)} = ${secs(longest)}`
  );

  // ---------- 1. a slow server: one item answers, the others hang ----------
  const first = idOf(oldestFirst[0]);
  const limitA = 8000; // enough for the item that answers and two that hang
  const a = await run(limitA, (id) => (id === first ? "ok" : "hang"));
  const askedA = oldestFirst.slice(0, 3);
  const hungA = askedA.slice(1);
  const notAskedA = oldestFirst.slice(3);
  result("slow server: the script ends by itself, soon after its time limit", a.status === 0 && a.ms < limitA + ITEM_MS + SPARE_MS, `exit ${a.status} after ${secs(a.ms)} (limit ${secs(limitA)} + one item ${secs(ITEM_MS)})\n${a.out}`);
  result(
    "slow server: the items with the oldest prices are asked first, and nothing is asked after the limit",
    same(a.asked, [first, idOf(hungA[0]), idOf(hungA[0]), idOf(hungA[1]), idOf(hungA[1])]),
    `asked: ${a.asked.join(" ")}`
  );
  const answered = items(a)[oldestFirst[0]] || {};
  result(
    "slow server: the item that answered is stored with its new prices",
    answered.stale === false && answered.last_error === null && answered.latest && answered.latest.date === SERVER_DAYS[2] && answered.latest.value === 105 && same(answered.days.map((d) => d[0]), [stored(oldestFirst[0], keys.length - 1).latest.date, ...SERVER_DAYS]),
    JSON.stringify(answered)
  );
  result(
    "slow server: an item that hung keeps its prices and is marked, with the time-out as the reason",
    hungA.every((k) => items(a)[k] && items(a)[k].stale === true && /Download failed .*timeout/i.test(items(a)[k].last_error.message) && kept(items(a)[k], k)),
    hungA.map((k) => `${k}: ${JSON.stringify(items(a)[k])}`).join("\n")
  );
  result(
    "slow server: an item the run had no time for keeps its prices and is marked as not asked",
    notAskedA.length === keys.length - 3 && notAskedA.every((k) => items(a)[k] && items(a)[k].stale === true && /^Not asked in this run/.test(items(a)[k].last_error.message) && kept(items(a)[k], k)),
    notAskedA.map((k) => `${k}: ${JSON.stringify(items(a)[k])}`).join("\n")
  );
  result(
    "slow server: the file names every item, says the source answered today, and the count is printed",
    same(Object.keys(items(a)), keys) && a.file.source.retrieved === today && /Ministry of Commerce/.test(a.file.source.source_name) && new RegExp(`Done: ${keys.length - 1} failed \\(${notAskedA.length} of them not asked: time limit\\)`).test(a.out),
    `${JSON.stringify(a.file && a.file.source)}\n${a.out}`
  );

  // ---------- 2. the server does not answer at all ----------
  const limitB = 4000; // less than one item that hangs
  const b = await run(limitB, () => "hang");
  result("no answer at all: the script ends by itself and reports the failure (exit code 1)", b.status === 1 && b.ms < limitB + ITEM_MS + SPARE_MS, `exit ${b.status} after ${secs(b.ms)}\n${b.out}`);
  result(
    "no answer at all: every item keeps its prices and is marked; the day the source last answered stays",
    same(Object.keys(items(b)), keys) && keys.every((k) => items(b)[k].stale === true && kept(items(b)[k], k)) && b.file.source.retrieved === OLD_DAY && b.asked.length === 2 && keys.filter((k) => /^Not asked/.test(items(b)[k].last_error.message)).length === keys.length - 1,
    `asked: ${b.asked.join(" ")}\n${JSON.stringify(b.file && b.file.source)}\n${b.out}`
  );

  // ---------- 3. an error that goes away: the second round still works ----------
  const shaky = idOf("garlic");
  const c = await run(60000, (id, nth) => (id === shaky && nth <= 2 ? 500 : "ok"));
  const firstRound = c.asked.filter((id, i) => c.asked.indexOf(id) === i);
  result(
    "an error that goes away: the item is asked again at the end and every item is stored as fresh",
    c.status === 0 && /Done: 0 failed\./.test(c.out) && c.asked.filter((id) => id === shaky).length === 3 && c.asked[c.asked.length - 1] === shaky && keys.every((k) => items(c)[k] && items(c)[k].stale === false && items(c)[k].last_error === null && items(c)[k].latest.date === SERVER_DAYS[2]),
    `exit ${c.status}, asked: ${c.asked.join(" ")}\n${c.out}`
  );
  result("a healthy server: every item is asked, the oldest prices first", same(firstRound, oldestFirst.map(idOf)), `asked: ${firstRound.join(" ")}`);

  server.closeAllConnections();
  server.close();
  console.log(`\n${passed} passed, ${failed.length} failed`);
  process.exit(failed.length ? 1 : 0);
}

server.listen(0, "127.0.0.1", main);
