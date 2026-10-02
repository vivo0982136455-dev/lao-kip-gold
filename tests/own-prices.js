// The checks on answers of the price form (scripts/fetch-own-prices.js, scripts/lib/manual-sheet.js), run on a
// SAMPLE sheet in a throw-away folder - never on the real form or sheet, and nothing is downloaded.
// The form link is public, so a stranger can send any answer: this test sends the kinds of answers a stranger
// (or a slip of the finger) would send and looks at what reaches the files the site shows.
// Usage: node tests/own-prices.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("node:assert/strict");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lkg-own-prices-"));
const write = (name, value) => {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
};

// ---------- reference files (fixed numbers, so the test does not depend on today's data) ----------
const DAY = "2026-09-15";
// kip per baht that day: middle of 660 and 680 = 670
write("history/bol.json", [
  { source: "bol", metric: "THB_LAK_buy", value: 660, unit: "LAK per THB", fetched_at: "2026-09-15T02:00:00.000Z", source_date: DAY },
  { source: "bol", metric: "THB_LAK_sell", value: 680, unit: "LAK per THB", fetched_at: "2026-09-15T02:00:00.000Z", source_date: DAY },
]);
write("history/fx-market.json", []);
// Thai central markets, baht per kg: [day, Nong Khai, Chiang Rai, all, all (EUDR)]
const kind = (all) => ({ days: [[DAY, null, null, all, null]], months: [] });
write("rubber-daily.json", { thai_border: { kinds: { cuplump: kind(75), latex: kind(82), uss: kind(84), rss3: kind(87) } } });
write("thai-prices.json", { items: {} });
// official assessed land prices: the real file (Vientiane Capital: 1,000 to 6,800,000 kip per square metre)
fs.copyFileSync(path.join(ROOT, "data", "invest-static.json"), path.join(dir, "invest-static.json"));
// Lao Bullion Bank that day: 3,000,000 kip per gram = 45,000,000 per baht (15 g)
write("history/gold-lbb.json", [{ source: "gold-lbb", metric: "sell_g", value: 3000000, unit: "LAK per gram", fetched_at: "2026-09-15T03:00:00.000Z", source_date: "2026-09-15T03:00:00.000Z" }]);

// ---------- the sample sheet ----------
const HEAD = ["ประทับเวลา", "วันที่", "ราคาขาย (กีบ ต่อ 1 บาท)", "ราคารับซื้อ (กีบ ต่อ 1 บาท)", "หมายเหตุ", "ทองแท่ง ราคาขาย (กีบ ต่อ 1 บาท)", "ทองแท่ง ราคารับซื้อ (กีบ ต่อ 1 บาท)", "เงิน PML ราคาขาย (กีบ ต่อ 1 กิโล)", "เงิน PML ราคารับซื้อ (กีบ ต่อ 1 กิโล)", "ยาง ราคา (กีบ ต่อ 1 กิโล)", "ยาง ชนิด", "ยาง สถานที่", "ที่ดิน สถานที่", "ที่ดิน ราคารวม (กีบ)", "ที่ดิน เนื้อที่ (ตารางเมตร)"];
const future = new Date(Date.now() + 30 * 86400000);
const FUTURE = `${future.getUTCDate()}/${future.getUTCMonth() + 1}/${future.getUTCFullYear()}`;
const D = "15/9/2026";
const rows = [];
let minute = 0;
const add = (date, cells) => {
  const row = new Array(HEAD.length).fill("");
  row[0] = `15/9/2026, 10:${String(minute++).padStart(2, "0")}:00`;
  row[1] = date;
  for (const [title, value] of Object.entries(cells)) row[HEAD.findIndex((h) => h.startsWith(title))] = String(value);
  rows.push(row);
};
const rubber = (date, price, type, place) => add(date, { "ยาง ราคา": price, "ยาง ชนิด": type, "ยาง สถานที่": place });
const land = (date, place, total, area) => add(date, { "ที่ดิน สถานที่": place, "ที่ดิน ราคารวม": total, "ที่ดิน เนื้อที่": area });

// Thai price that day in kip: cup lump 50,250 · latex 54,940 · sheet 56,280 · smoked sheet 58,290
// accepted: 0.15 x to 1.3 x  ->  cup lump 7,538 - 65,325
rubber(D, 20000, "ยางก้อนถ้วย", "Bokeo | ບ້ານ ນ້ຳຢາງ"); //                                        in
rubber(D, 70000, "ยางก้อนถ้วย", "Bokeo |"); //                                                   out: above the band
rubber(D, 5000, "ยางก้อนถ้วย", "Bokeo |"); //                                                    out: below the band
rubber(D, 60000, "น้ำยางสด", "Louangnamtha | ເມືອງສິງ"); //                                      in
rubber(D, 74000, "อื่น ๆ", "Oudomxai |"); //                                                     in: "other" = cheapest to dearest kind
rubber(D, 150000, "ยางแผ่นดิบ", "Oudomxai |"); //                                                out: above the band
rubber(FUTURE, 20000, "ยางก้อนถ้วย", "Bokeo |"); //                                              out: date in the future
rubber(D, 21000, "ยางก้อนถ้วย", "Louangnamtha | ໂທ 020 5555 1234 www.spam-shop.com ຂາຍຢາງ"); //  in, place without phone and link
rubber(D, 22000, "ยางก้อนถ้วย http://evil.example/x?y=1 best price!!! write to spam@mail.com or call 0812345678 and more and more text", "Phongsaly |"); // in, text cleaned and cut
rubber("1/6/2019", 30000, "ยางก้อนถ้วย", "Bokeo |"); //                                          in: no Thai price known for 2019 -> outer limits only
rubber("1/6/2019", 250000, "ยางก้อนถ้วย", "Bokeo |"); //                                         out: above the outer limit
// land: Vientiane Capital 500 - 136,000,000 kip per square metre; other provinces 50 - 136,000,000
land(D, "Vientiane Capital | ບ້ານ ໂພນທັນ", 2000000000, 1000); //                                  in  (2,000,000 per sqm)
land(D, "Vientiane Capital |", 100000, 1000); //                                                 out (100 per sqm)
land(D, "Phongsaly | ນາ", 4000000, 10000); //                                                    in  (400 per sqm)
land(D, "Phongsaly |", 2000000000000, 10000); //                                                 out (200,000,000 per sqm)
land(D, "ที่ดินสวย โทร 020-555-1234 <b>ด่วน</b>", 1000000000, 1000); //                           in, text cleaned
land(FUTURE, "Vientiane Capital |", 2000000000, 1000); //                                        out: date in the future
// shop gold: one real-looking pair, and a pair dated in the future (no Lao Bullion Bank price can check that one)
add(D, { "ราคาขาย": 46000000, "ราคารับซื้อ": 45000000 });
add(FUTURE, { "ราคาขาย": 99000000, "ราคารับซื้อ": 98000000 });

const csv = [HEAD, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n") + "\r\n";
write("sheet.csv", csv);

// ---------- run the two fetchers on it ----------
const env = { ...process.env, DATA_DIR: dir, LAO_GOLD_CSV_URL: path.join(dir, "sheet.csv") };
const runScript = (name) => {
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", name)], { env, encoding: "utf8" });
  return (r.stdout || "") + (r.stderr || "");
};
const logOwn = runScript("fetch-own-prices.js");
const logGold = runScript("fetch-lao-gold-manual.js");
const own = JSON.parse(fs.readFileSync(path.join(dir, "own-prices.json"), "utf8"));
const gold = JSON.parse(fs.readFileSync(path.join(dir, "history", "gold-lao-manual.json"), "utf8"));

// ---------- what must have happened ----------
let passed = 0;
const failed = [];
const check = (name, fn) => {
  try {
    fn();
    passed++;
    console.log("PASS  " + name);
  } catch (e) {
    failed.push(name);
    console.log("FAIL  " + name + "\n      " + String(e.message).split("\n").join("\n      "));
  }
};
const prices = own.rubber.entries.map((e) => e.price).sort((a, b) => a - b);
check("rubber: only the answers inside the band of that day's Thai price come through", () => assert.deepEqual(prices, [20000, 21000, 22000, 30000, 60000, 74000]));
check("rubber: 5 answers skipped (too high x 3, too low, future date)", () => assert.equal(own.rubber.skipped, 5));
check("rubber: an answer dated in the future is not there", () => assert.ok(own.rubber.entries.every((e) => e.date <= new Date().toISOString().slice(0, 10))));
const by = (price) => own.rubber.entries.find((e) => e.price === price);
check("rubber: place keeps the province and the typed words", () => assert.deepEqual([by(20000).province, by(20000).place], ["Bokeo", "ບ້ານ ນ້ຳຢາງ"]));
check("rubber: phone number and link are taken out of the place", () => assert.equal(by(21000).place, "ໂທ ຂາຍຢາງ"));
check("rubber: the kind is still read from a text full of junk", () => assert.equal(by(22000).type, "cuplump"));
check("rubber: link, e-mail and phone number are taken out of the kind's text, and it is cut at 40 characters", () => {
  const text = by(22000).type_text;
  assert.ok(!/http|evil|example|@|mail|0812345678|\.com/.test(text), text);
  assert.ok([...text].length <= 40, `${[...text].length} characters: ${text}`);
  assert.ok(text.startsWith("ยางก้อนถ้วย"), text);
});
check("land: only the answers inside the band of the official prices come through", () => assert.deepEqual(own.land.entries.map((e) => e.per_sqm).sort((a, b) => a - b), [400, 1000000, 2000000]));
check("land: 3 answers skipped (too low for the capital, too high, future date)", () => assert.equal(own.land.skipped, 3));
check("land: phone number and tags are taken out of the place", () => assert.equal(own.land.entries.find((e) => e.per_sqm === 1000000).place, "ที่ดินสวย โทร b ด่วน /b"));
check("no text on the site is longer than 40 characters", () => {
  for (const e of [...own.rubber.entries, ...own.land.entries]) for (const text of [e.place, e.type_text]) assert.ok(text === undefined || [...text].length <= 40, text);
});
check("no text on the site holds a link, an e-mail address or 7 digits in a row", () => {
  for (const e of [...own.rubber.entries, ...own.land.entries]) for (const text of [e.place, e.type_text]) assert.ok(!text || !/https?:|www\.|@|\d[\d\s\-.()]{6,}/.test(text), text);
});
check("shop gold: the pair of the day comes through, the pair dated in the future does not", () => {
  assert.deepEqual(gold.map((r) => [r.metric, r.value, r.source_date]), [["buy", 45000000, DAY], ["sell", 46000000, DAY]]);
});
check("the log names every skipped answer with its reason", () => {
  assert.equal((logOwn.match(/skipped row/g) || []).length, 8, logOwn);
  assert.match(logOwn, /is in the future/);
  assert.match(logOwn, /the Thai market price of that day/);
  assert.match(logGold, /is in the future/);
});

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
