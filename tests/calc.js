// The rules and formulas of the site, tested with fixed numbers (no browser, no download).
//   - when a plan target gets a status, and when a number is only a "baseline" (js/pages/eco-common.js)
//   - which of two numbers is "the newest the app has"
//   - the checks on the owner's own prices: the bot (scripts/fetch-own-prices.js) and the page
//     (js/pages/own-entry.js) must use the same limits and clean a text in the same way
//   - the 7z reader (scripts/lib/sevenzip.js) and the reading of UNCTAD's table (scripts/fetch-invest.js)
// Usage: node tests/calc.js
const assert = require("node:assert/strict");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");
const page = (file) => import(pathToFileURL(path.join(ROOT, "js", file)).href);
// the page's modules expect a browser: the two things they touch while loading
const nothing = () => {};
globalThis.document = { addEventListener: nothing, documentElement: { dataset: {} } };
globalThis.window = { addEventListener: nothing, matchMedia: () => ({ matches: false, addEventListener: nothing }) };

let passed = 0;
const failed = [];
const test = (name, fn) => {
  try {
    fn();
    passed++;
    console.log("PASS  " + name);
  } catch (e) {
    failed.push(name);
    console.log("FAIL  " + name + "\n      " + String(e.message).split("\n").slice(0, 6).join("\n      "));
  }
};

(async () => {
  const eco = await page("pages/eco-common.js");
  const own = await page("pages/own-entry.js");
  const bot = require(path.join(ROOT, "scripts", "fetch-own-prices.js"));
  const { unpack7z, crc32 } = require(path.join(ROOT, "scripts", "lib", "sevenzip.js"));
  const { fdiTotalFromCsv } = require(path.join(ROOT, "scripts", "fetch-invest.js"));
  const { notInFuture } = require(path.join(ROOT, "scripts", "lib", "manual.js"));
  const year = eco.THIS_YEAR;

  // ---------- plan targets ----------
  const { targetStatus } = eco;
  test("target: met, near (within 10%), far - both directions", () => {
    assert.equal(targetStatus(6.2, 6, ">="), "met");
    assert.equal(targetStatus(5.5, 6, ">="), "near"); // 8.3% below
    assert.equal(targetStatus(5.3, 6, ">="), "far"); // 11.7% below
    assert.equal(targetStatus(4.9, 5, "<="), "met");
    assert.equal(targetStatus(5.5, 5, "<="), "near");
    assert.equal(targetStatus(7.7, 5, "<="), "far");
    assert.equal(targetStatus(null, 5, "<="), "none");
    assert.equal(targetStatus(undefined, 5, "<="), "none");
  });
  test("target: a number from before the plan starts is the baseline, never met / near / far", () => {
    const thisMonth = `${year}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}`;
    for (const value of [0, 4.5, 6, 21.2, 99]) {
      assert.equal(targetStatus(value, 6, ">=", { from: year, when: { year: year - 1 } }), "baseline");
      assert.equal(targetStatus(value, 6, ">=", { from: year + 1, when: { month: thisMonth } }), "baseline"); // a plan that starts next year
    }
  });
  test("target: a number from inside the plan is judged (a year, or a month of it)", () => {
    const now = new Date();
    const month = `${year}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    assert.equal(targetStatus(7.7, 5, "<=", { when: { month }, from: year }), "far");
    assert.equal(targetStatus(6.1, 6, ">=", { when: { year }, from: year }), "met");
  });
  test("target: a number that is too old is not compared at all", () => {
    assert.equal(targetStatus(13.9, 20.95, ">=", { when: { year: year - 4 }, from: year }), "old");
    assert.equal(targetStatus(13.9, 20.95, ">=", { when: { year: year - 3 }, from: year - 10 }), "old"); // also inside a plan
    assert.equal(targetStatus(3, 5, ">=", { when: { month: `${year - 2}-01` }, from: year }), "old");
  });
  test("old = more than 2 years (yearly) or more than 6 months (monthly) behind", () => {
    assert.equal(eco.isOld({ year: year - 2 }), false);
    assert.equal(eco.isOld({ year: year - 3 }), true);
    assert.equal(eco.isOld({ month: `${year - 1}-01` }), true);
    assert.equal(eco.isOld({}), false);
  });

  // ---------- the newest number ----------
  test("newest: a year counts as its last month; null candidates are ignored", () => {
    const a = { value: 1, when: { year: 2024 } };
    const b = { value: 2, when: { month: "2026-04" } };
    const c = { value: 3, when: { month: "2024-06" } };
    assert.equal(eco.newest(a, b), b);
    assert.equal(eco.newest(b, a), b);
    assert.equal(eco.newest(a, c), a); // 2024 = up to December 2024
    assert.equal(eco.newest(null, a), a);
    assert.equal(eco.newest(null, undefined), null);
  });
  test("reserves: the report's number (both ways of counting) wins over the older yearly series", () => {
    const e = {
      stat: { checked: "2026-10-01", facts: { checked: "2026-10-02", reserves_wb: { usd_bn: 4.3, months: 3.8, months_bol: 5.3, month: "2026-04", source: "wb_lem_2606" } } },
      invest: { indicators: { "wb.FI.RES.TOTL.MO": { values: [[2023, 2.169], [2024, 2.394]], stale: false } } },
    };
    const r = eco.reservesMonths(e);
    assert.deepEqual([r.value, r.bol, r.when.month, r.checked, r.source], [3.8, 5.3, "2026-04", "2026-10-02", "wb_lem_2606"]);
    delete e.stat.facts.reserves_wb;
    const s = eco.reservesMonths(e);
    assert.deepEqual([s.value, s.bol, s.when.year], [2.394, null, 2024]);
    assert.equal(eco.reservesMonths({ stat: { facts: {} }, invest: { indicators: {} } }), null);
  });

  // ---------- the owner's own prices: bot and page ----------
  test("limits: the page's built-in limits are the bot's", () => assert.deepEqual(own.FALLBACK_LIMITS, bot.LIMITS));
  test("limits: the page's band lies inside the bot's band", () => {
    const { band, page_band: pageBand } = bot.LIMITS.rubber;
    assert.ok(pageBand[0] > band[0] && pageBand[1] < band[1]);
  });
  const TEXTS = [
    ["ເມືອງສິງ", "ເມືອງສິງ"],
    ["  บ้าน   นา  ", "บ้าน นา"],
    ["ໂທ 020 5555 1234 ຂາຍຢາງ", "ໂທ ຂາຍຢາງ"],
    ["call +856 20 5555-1234 now", "call now"],
    ["โทร ๐๘๑๒๓๔๕๖๗๘ ด่วน", "โทร ด่วน"],
    ["see www.spam-shop.com/buy?x=1 today", "see today"],
    ["https://evil.example/a b", "b"],
    ["mail spam@mail.com me", "mail me"],
    ["shop.la/x is cheap", "is cheap"],
    ["<b>bold</b>", "b bold /b"],
    ["km 12, road 13", "km 12, road 13"], // short numbers stay
    ["2 ໄຮ່ 3 ງານ", "2 ໄຮ່ 3 ງານ"],
    ["", ""],
    [null, ""],
  ];
  test("text: links, e-mail addresses and phone numbers are taken out (bot)", () => {
    for (const [input, want] of TEXTS) assert.equal(bot.cleanText(input), want, JSON.stringify(input));
  });
  test("text: the page cleans exactly like the bot", () => {
    for (const [input] of TEXTS) assert.equal(own.cleanText(input), bot.cleanText(input), JSON.stringify(input));
    const long = "ກ".repeat(100) + " 12345678 " + "ข".repeat(100);
    assert.equal(own.cleanText(long), bot.cleanText(long));
  });
  test("text: never longer than 40 characters, and no half characters", () => {
    const text = bot.cleanText("😀".repeat(60));
    assert.equal([...text].length, 40);
    assert.equal(text, "😀".repeat(40));
    assert.equal(bot.LIMITS.text_max, 40);
  });
  const refs = { rubber: (type) => (type === "other" ? [50000, 58000] : [50000, 50000]), land: (province) => (province === "Vientiane Capital" ? [500, 136000000] : [50, 136000000]) };
  test("rubber: inside 0.15 x to 1.3 x of the Thai price of that day, in kip", () => {
    assert.doesNotThrow(() => bot.checkRubber(7500, "cuplump", "2026-09-15", refs));
    assert.doesNotThrow(() => bot.checkRubber(65000, "cuplump", "2026-09-15", refs));
    assert.throws(() => bot.checkRubber(7499, "cuplump", "2026-09-15", refs), /outside 7500-65000/);
    assert.throws(() => bot.checkRubber(65001, "cuplump", "2026-09-15", refs), /outside/);
    assert.doesNotThrow(() => bot.checkRubber(75400, "other", "2026-09-15", refs)); // up to 1.3 x the dearest kind
    assert.throws(() => bot.checkRubber(75401, "other", "2026-09-15", refs), /outside/);
  });
  test("rubber: without a Thai price for the day only the outer limits apply", () => {
    const none = { rubber: () => null };
    assert.doesNotThrow(() => bot.checkRubber(1000, "cuplump", "2019-01-01", none));
    assert.doesNotThrow(() => bot.checkRubber(200000, "cuplump", "2019-01-01", none));
    assert.throws(() => bot.checkRubber(999, "cuplump", "2019-01-01", none), /looks wrong/);
    assert.throws(() => bot.checkRubber(200001, "cuplump", "2019-01-01", null), /looks wrong/);
  });
  test("land: inside the band around the official assessed prices, by province", () => {
    assert.doesNotThrow(() => bot.checkLand(500, 1000, "Vientiane Capital", refs));
    assert.throws(() => bot.checkLand(499, 1000, "Vientiane Capital", refs), /outside 500-136000000/);
    assert.doesNotThrow(() => bot.checkLand(60, 1000, "Phongsaly", refs));
    assert.throws(() => bot.checkLand(136000001, 1000, "Phongsaly", refs), /outside/);
    assert.throws(() => bot.checkLand(1000, 0.5, "Phongsaly", refs), /area/);
  });
  test("land: the band comes from the official table of Vientiane Capital in data/invest-static.json", () => {
    const real = bot.loadReferences();
    assert.deepEqual(real.official, [1000, 6800000]);
    assert.deepEqual(real.land("Vientiane Capital"), [500, 136000000]);
    assert.deepEqual(real.land("Bokeo"), [50, 136000000]);
    assert.deepEqual(real.land(null), [50, 136000000]);
  });
  test("date: today and tomorrow pass, later days do not", () => {
    const now = Date.parse("2026-10-02T12:00:00Z");
    assert.equal(notInFuture("2026-10-02", now), true);
    assert.equal(notInFuture("2026-10-03", now), true);
    assert.equal(notInFuture("2026-10-04", now), false);
    assert.equal(notInFuture("2027-01-01", now), false);
  });

  // ---------- 7z reader + UNCTAD's table ----------
  // three tiny archives made with 7-Zip 22.01 from the same two-line CSV: LZMA2, LZMA, stored
  const SAMPLES = {
    lzma2: "N3q8ryccAASNRHOwkAAAAAAAAABiAAAAAAAAALfEQvPgAKgAiF0ALJlIJ1OCYovx1l+GcoZ+CKgeEu96B/AvAeNhEmxmyonsEDOD4NDJDRYkpB8eu0LkfQcnmGbk4bkxEX/D4167Aw/Vm05u20EcPolbRl7uC84Rg2odjD0Kl9SuXJLLClo6B6ULvEchOCY9i+Ac757SKdvW/bvj5SoDtHkxBi3QRNiIHaxDeusAAAABBAYAAQmAkAAHCwEAASEhAQAMgKkACAoBDn2ggAAABQEZCgAAAAAAAAAAAAARFwBzAGEAbQBwAGwAZQAuAGMAcwB2AAAAGQQAAAAAFAoBACDhL2dnUt0BFQYBACAAAAAAAA==",
    lzma: "N3q8ryccAAQtiIDpiQAAAAAAAABiAAAAAAAAALqkSLIALJlIJ1OCYovx1l+GcoZ+CKgeEu96B/AvAeNhEmxmyonsEDOD4NDJDRYkpB8eu0LkfQcnmGbk4bkxEX/D4167Aw/Vm05u20EcPolbRl7uC84Rg2odjD0Kl9SuXJLLClo6B6ULvEchOCY9i+Ac757SKdvW/bvj5SoDtHkxBi3QRNiIHaxDeusAAAEEBgABCYCJAAcLAQABIwMBAQVdABAAAAyAqQAICgEOfaCAAAAFARkEAAAAABEXAHMAYQBtAHAAbABlAC4AYwBzAHYAAAAZBAAAAAAUCgEAIOEvZ2dS3QEVBgEAIAAAAAAA",
    stored: "N3q8ryccAATKgvX0qQAAAAAAAABiAAAAAAAAAOhzZcVZZWFyLEVjb25vbXksRWNvbm9teSBMYWJlbCxGbG93LEZsb3cgTGFiZWwsRGlyZWN0aW9uLERpcmVjdGlvbiBMYWJlbCxNaWxsaW9ucyBvZiBVUyQgYXQgY3VycmVudCBwcmljZXMKMjAyNCw0MTgsIkxhbyBQZW9wbGUncyBEZW0uIFJlcC4iLDA5LCJTdG9jayIsMSwiSW53YXJkIiwxNTM5Mi42MzgKAQQGAAEJgKkABwsBAAEBAAyAqQAICgEOfaCAAAAFARkMAAAAAAAAAAAAAAAAERcAcwBhAG0AcABsAGUALgBjAHMAdgAAABkEAAAAABQKAQAg4S9nZ1LdARUGAQAgAAAAAAA=",
  };
  const CSV_SAMPLE = 'Year,Economy,Economy Label,Flow,Flow Label,Direction,Direction Label,Millions of US$ at current prices\n2024,418,"Lao People\'s Dem. Rep.",09,"Stock",1,"Inward",15392.638\n';
  for (const [method, base64] of Object.entries(SAMPLES)) {
    test(`7z: an archive packed with "${method}" unpacks to the file that went in`, () => {
      const files = unpack7z(Buffer.from(base64, "base64"));
      assert.equal(files.length, 1);
      assert.equal(files[0].name, "sample.csv");
      assert.equal(files[0].data.toString("utf8"), CSV_SAMPLE);
    });
  }
  test("7z: a damaged archive is refused, never unpacked into other data", () => {
    for (const base64 of Object.values(SAMPLES)) {
      const good = Buffer.from(base64, "base64");
      for (let at = 32; at < good.length; at += 7) {
        const broken = Buffer.from(good);
        broken[at] ^= 0x5a;
        let out = null;
        try {
          out = unpack7z(broken);
        } catch {
          continue; // refused: fine
        }
        // accepted: then the data must still be exactly right (the changed byte was one that is not checked, e.g. a date)
        assert.equal(out[0].data.toString("utf8"), CSV_SAMPLE, `byte ${at} changed, wrong data accepted`);
      }
    }
    assert.throws(() => unpack7z(Buffer.from("PK\x03\x04 a zip, not a 7z ................")), /Not a 7z file/);
    assert.throws(() => unpack7z(Buffer.from(SAMPLES.lzma2, "base64").subarray(0, 120)), /7z/);
  });
  test("crc32 of a known text", () => assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926));

  const row = (y, flow, direction, value, economy = 418) => `${y},${String(economy).padStart(3, "0")},"${economy === 418 ? "Lao People's Dem. Rep." : "Other"}",${flow === "Stock" ? "09" : "08"},"${flow}",${direction === "Inward" ? 1 : 2},"${direction}",${value},,,0.03,,,95.4,,,415.3,,`;
  const HEAD = "Year,Economy,Economy Label,Flow,Flow Label,Direction,Direction Label,Millions of US$ at current prices,Millions of US$ at current prices Footnote,Millions of US$ at current prices Missing value,Percentage of total world";
  const table = (rows) => [HEAD, ...rows].join("\n") + "\n";
  const stocks = [[2019, 10168.172], [2020, 11135.878], [2021, 12207.792], [2022, 12736.017], [2023, 14404.18], [2024, 15392.638], [2025, 16797.421]];
  test("UNCTAD: only the inward stock and flow of Laos are read, in millions of dollars", () => {
    const csv = table([
      ...stocks.map(([y, v]) => row(y, "Stock", "Inward", v)),
      row(2025, "Flow", "Inward", 1404.783),
      row(2025, "Stock", "Outward", 418), // outward: ignored
      row(2025, "Stock", "Inward", 999999, 764), // another country: ignored
      row(2024, "Flow", "Inward", 418, 704), // another country whose VALUE is 418: ignored
      row(2005, "Stock", "Inward", 600), // before the first year kept
    ]);
    const out = fdiTotalFromCsv(csv);
    assert.deepEqual([out.unit, out.year, out.total], ["USD m", 2025, 16797.4]);
    assert.deepEqual(out.values, stocks.map(([y, v]) => [y, Math.round(v * 10) / 10]));
    assert.deepEqual(out.flows, [[2025, 1404.8]]);
  });
  test("UNCTAD: a changed table or an impossible number is refused", () => {
    assert.throws(() => fdiTotalFromCsv("Year,Economy,Value\n2024,418,1\n"), /unexpected columns/);
    assert.throws(() => fdiTotalFromCsv(table([row(2024, "Stock", "Inward", 15392.6), row(2025, "Stock", "Inward", 16797.4)])), /only 2 years/);
    assert.throws(() => fdiTotalFromCsv(table([...stocks.slice(0, 6).map(([y, v]) => row(y, "Stock", "Inward", v)), row(2025, "Stock", "Inward", 167974.21)])), /looks wrong/);
  });

  console.log(`\n${passed} passed, ${failed.length} failed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.log("FAIL run", e.stack || e);
  process.exit(1);
});
