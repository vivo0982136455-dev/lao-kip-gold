// The rules and formulas of the site, tested with fixed numbers (no browser, no download).
//   - when a plan target gets a status, and when a number is only a "baseline" (js/pages/eco-common.js)
//   - which of two numbers is "the newest the app has", and the one answer per indicator that every tab uses
//     (js/pages/eco-latest.js): newest inflation, reserves, public debt counted three ways, growth
//   - the forecast line of a level: the last real value carried on with the IMF's path of change, never the
//     IMF's own level glued to the World Bank's last value
//   - how far behind a number is
//   - the checks on the owner's own prices: the bot (scripts/fetch-own-prices.js) and the page
//     (js/pages/own-entry.js) must use the same limits and clean a text in the same way
//   - the 7z reader (scripts/lib/sevenzip.js) and the reading of UNCTAD's table (scripts/fetch-invest.js)
// Usage: node tests/calc.js
const assert = require("node:assert/strict");
const fs = require("fs");
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
  const now = await page("pages/eco-latest.js");
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
    const month = `${year}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}`;
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
    const r = now.reservesMonths(e);
    assert.deepEqual([r.value, r.bol, r.when.month, r.checked, r.source], [3.8, 5.3, "2026-04", "2026-10-02", "wb_lem_2606"]);
    delete e.stat.facts.reserves_wb;
    const s = now.reservesMonths(e);
    assert.deepEqual([s.value, s.bol, s.when.year], [2.394, null, 2024]);
    assert.equal(now.reservesMonths({ stat: { facts: {} }, invest: { indicators: {} } }), null);
  });

  // ---------- one answer per indicator (eco-latest.js) ----------
  const imfMonths = [["2026-06", 7.4], ["2026-07", 7.6], ["2026-08", 7.7]];
  const base = () => ({
    economy: {
      sources: { imf_sdmx: { source_name: "IMF Data" }, worldbank: { source_name: "World Bank" }, imf: { source_name: "IMF WEO", edition: "2026-04" } },
      monthly: { cpi_yoy: { source: "imf_sdmx", values: imfMonths, stale: false } },
      indicators: {
        "imf.GGXWDG_NGDP": { values: [[year - 2, 94.7], [year - 1, 80.6], [year, 74.6], [year + 1, 68.6]], stale: false },
        "wb.NY.GDP.MKTP.KD.ZG": { values: [[year - 2, 4.13], [year - 1, 4.538]], stale: false },
        "imf.NGDP_RPCH": { values: [[year - 1, 4.772], [year, 4.013]], stale: false },
      },
    },
    invest: { indicators: { "wb.FI.RES.TOTL.CD": { values: [[year - 2, 2.213]], stale: false } }, sources: {} },
    stat: { facts: { debt_mof: { pct: 84, year: year - 1, source: "wb_lem_2606" }, debt_peak: { now: 87.1, now_year: year - 1, source: "wb_lem_2606" }, growth_drivers: { growth: 4.8, year: year - 1, source: "wb_lem_2606" } } },
    bank: null,
  });
  const bankFile = {
    sources: { bol_inflation: { source_name: "BOL inflation" }, bol_reserves: { source_name: "BOL reserves" } },
    inflation: { rows: [["2026-07", 7.6], ["2026-08", 7.7], ["2026-09", 7.8]], stale: false },
    reserves: { rows: [["2026-06", 4070.9], ["2026-07", 3772.6]], includes_swap_since: "2020-07", stale: false },
  };
  test("inflation: the newest month of the IMF - or of the central bank, when it has a newer one", () => {
    const e = base();
    let i = now.latestInflation(e);
    assert.deepEqual([i.value, i.when.month, i.src], [7.7, "2026-08", "IMF"]);
    e.bank = bankFile;
    i = now.latestInflation(e);
    assert.deepEqual([i.value, i.when.month, i.src], [7.8, "2026-09", "BOL"]);
    assert.deepEqual(i.series.values.map((v) => v[0]), ["2026-06", "2026-07", "2026-08", "2026-09"]); // no month twice
    assert.equal(i.series.imfLast, "2026-08");
    e.bank = { ...bankFile, inflation: { rows: [["2026-07", 7.6]], stale: false } }; // nothing newer than the IMF
    assert.equal(now.latestInflation(e).src, "IMF");
    assert.equal(now.latestInflation({ economy: { monthly: {} } }), null);
  });
  test("reserves in dollars: the month of the central bank, else the yearly World Bank series", () => {
    const e = base();
    let r = now.latestReserves(e).usd;
    assert.deepEqual([r.value, r.when.year, r.src], [2.213, year - 2, "World Bank"]);
    e.bank = bankFile;
    r = now.latestReserves(e).usd;
    assert.deepEqual([Math.round(r.value * 1000), r.when.month, r.src, r.swap], [3773, "2026-07", "BOL", "2020-07"]);
  });
  test("public debt: three ways of counting the same year, shown as a range", () => {
    const d = now.publicDebt(base());
    assert.equal(d.year, year - 1);
    assert.deepEqual(d.list.map((x) => [x.who, x.value]), [["imf", 80.6], ["mof", 84], ["wb", 87.1]]);
    assert.equal(now.rangeText(d), "80.6–87.1%");
    const one = base();
    delete one.stat.facts.debt_mof;
    delete one.stat.facts.debt_peak;
    assert.equal(now.rangeText(now.publicDebt(one)), "80.6%"); // one source: one number, no range
    const older = base();
    older.stat.facts.debt_peak.now_year = year - 2; // a source that is a year behind is not mixed into the range
    assert.deepEqual(now.publicDebt(older).list.map((x) => x.who), ["imf", "mof"]);
  });
  test("growth: database, report and IMF for the same finished year; never the forecast year of the IMF", () => {
    const g = now.growthNow(base());
    assert.equal(g.year, year - 1);
    assert.deepEqual(g.list.map((x) => [x.who, x.value]), [["wdi", 4.538], ["lem", 4.8], ["imf", 4.772]]);
    assert.equal(now.rangeText(g), "4.5–4.8%");
  });
  test("no page reads the raw inflation or reserves series itself: only eco-latest.js does (audit P1-1)", () => {
    const dir = path.join(ROOT, "js", "pages");
    // the Settings page lists the IMF's monthly series as a SOURCE (is it up to date?), not as "the newest inflation"
    const allowed = { "settings.js": /economy\.monthly\.cpi_yoy/ };
    const found = [];
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".js") || name === "eco-latest.js") continue;
      fs.readFileSync(path.join(dir, name), "utf8").split("\n").forEach((line, i) => {
        // "tha_cpi_yoy" is another indicator (Thailand's inflation)
        if (/(?<![a-z_])cpi_yoy|FI\.RES\.TOTL\.MO/.test(line) && !(allowed[name] && allowed[name].test(line))) found.push(`${name}:${i + 1}`);
      });
    }
    assert.deepEqual(found, []);
  });

  // ---------- forecast line (audit P1-2) ----------
  const gdp = (extra = {}) => ({
    economy: {
      indicators: {
        "wb.GDP": { values: [[2024, 16.503], [2025, 18.303]], unit: "USD bn", source: "worldbank", stale: false },
        "imf.GDP": { values: [[2024, 15.792], [2025, 17.822], [2026, 18.959], [2027, 20.087]], unit: "USD bn", source: "imf", stale: false },
        "wb.RATE": { values: [[2024, 4.1], [2025, 4.5]], unit: "%", source: "worldbank", stale: false },
        "imf.RATE": { values: [[2025, 4.8], [2026, 4.0], [2027, 3.9]], unit: "%", source: "imf", stale: false },
        ...extra,
      },
    },
  });
  test("forecast of a level: last real value x IMF(year) / IMF(last real year) - 18.303, 17.822, 18.959 -> 19.47", () => {
    const s = eco.buildSeries(gdp(), { actual: "wb.GDP", forecast: "imf.GDP" }, 2024);
    assert.deepEqual(s.years, [2024, 2025, 2026, 2027]);
    assert.equal(s.rebased, true);
    assert.equal(s.forecast[2].toFixed(2), "19.47");
    assert.equal(s.forecast[2], Math.round(((18.303 * 18.959) / 17.822) * 1000) / 1000);
    assert.equal(s.forecast[3], Math.round(((18.303 * 20.087) / 17.822) * 1000) / 1000);
    assert.equal(s.forecast[1], 18.303); // the dashed line starts at the last real point
    assert.deepEqual(s.forecastOnly.slice(0, 2), [null, null]);
    // the first forecast year grows as the IMF says (+6.4%), not by the jump between the two sources (+3.6%)
    assert.equal(((s.forecast[2] / 18.303 - 1) * 100).toFixed(1), ((18.959 / 17.822 - 1) * 100).toFixed(1));
  });
  test("forecast of a rate (%): joined as it is, no rebasing", () => {
    const s = eco.buildSeries(gdp(), { actual: "wb.RATE", forecast: "imf.RATE" }, 2024);
    assert.equal(s.rebased, false);
    assert.deepEqual(s.forecast, [null, 4.5, 4.0, 3.9]);
  });
  test("forecast of a level without an IMF value for the last real year: no forecast line", () => {
    const s = eco.buildSeries(gdp({ "imf.GDP": { values: [[2026, 18.959], [2027, 20.087]], unit: "USD bn", source: "imf" } }), { actual: "wb.GDP", forecast: "imf.GDP" }, 2024);
    assert.equal(s.forecast, null);
    assert.equal(s.rebased, false);
    assert.deepEqual(s.sources, ["worldbank"]);
  });
  test("an IMF-only series is an estimate before this year and a forecast from this year on", () => {
    const s = eco.buildSeries({ economy: { indicators: { "imf.D": { values: [[year - 2, 94.7], [year - 1, 80.6], [year, 74.6], [year + 1, 68.6]], unit: "% of GDP", source: "imf" } } } }, { forecast: "imf.D" }, year - 2);
    assert.equal(s.isEstimate, true);
    assert.equal(s.lastActual, year - 1);
    assert.deepEqual(s.forecastOnly, [null, null, 74.6, 68.6]);
  });

  // ---------- how far behind a number is (audit P1-4) ----------
  test("months behind: a year ends in December; the running year and month count as 0", () => {
    const today = new Date(Date.now() + 7 * 3600000); // Vientiane
    const month = today.getUTCMonth() + 1;
    assert.equal(eco.monthsBehind({ year }), 0);
    assert.equal(eco.monthsBehind({ year: year - 1 }), month);
    assert.equal(eco.monthsBehind({ year: year - 2 }), 12 + month);
    assert.equal(eco.monthsBehind({ month: `${year}-${String(month).padStart(2, "0")}` }), 0);
    assert.equal(eco.monthsBehind({ month: `${year - 1}-${String(month).padStart(2, "0")}` }), 12);
    assert.equal(eco.monthsBehind({}), 0);
    assert.deepEqual(eco.FRESH_MONTHS, { year: 12, month: 3 });
  });

  // ---------- real rates and unit conversions (audit P1-10) ----------
  const calc = await page("calc.js");
  const units = require(path.join(ROOT, "scripts", "lib", "units.js"));
  const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);
  test("real rate: (1 + rate) / (1 + inflation) - 1, not the simple difference", () => {
    close(calc.realRate(5, 25), -16); // the difference would say -20
    close(calc.realRate(7, 7), 0);
    close(calc.realRate(0, 0), 0);
    close(calc.realRate(10, 0), 10);
    close(calc.realRate(6.86, 7.8), ((1.0686 / 1.078) - 1) * 100); // a 12-month kip deposit against September's inflation
    assert.ok(calc.realRate(6.86, 7.8) < 0 && calc.realRate(6.86, 7.8) > 6.86 - 7.8); // negative, and a little less negative than the difference
    close(calc.realRate(3, -1), (1.03 / 0.99 - 1) * 100); // falling prices add to the rate
  });
  test("rubber: US cents per pound -> US dollars per kilogram", () => {
    close(calc.usdPerKg(100), 2.20462);
    close(calc.usdPerKg(0), 0);
    close(calc.usdPerKg(88.5), 1.9510887);
    assert.equal(calc.LB_PER_KG, 2.20462);
  });
  test("gold and silver: dollars per troy ounce -> kip per baht-weight / per kilogram", () => {
    assert.deepEqual([units.GRAMS_PER_BAHT, units.GRAMS_PER_LAO_BAHT, units.GRAMS_PER_TROY_OZ], [15.244, 15, 31.1035]);
    assert.equal(units.TROY_OZ_PER_KG.toFixed(4), "32.1507"); // the number the notes of the gold page name
    // one ounce at $3,110.35 = $100 a gram = $1,524.40 per Thai baht-weight; at 22,000 kip per dollar
    close(units.goldLakPerBaht(3110.35, 22000), 100 * 15.244 * 22000, 1e-3);
    // silver at $31.1035 an ounce = $1 a gram = $1,000 a kilogram
    close(units.silverLakPerKg(31.1035, 22000), 1000 * 22000, 1e-3);
    assert.equal(units.lakPerLaoBaht(3000000), 45000000); // Lao Bullion Bank: per gram -> per Lao baht (15 g)
    assert.equal(units.mid(22361, 22584), 22472.5);
  });
  test("gold premium: fine gold against fine gold, gram for gram - not the ratio of two different bars (audit P2-1)", () => {
    // the two purities are hand-read facts (data/invest-static.json "gold"): the summary is built with them
    const facts = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "invest-static.json"), "utf8")).gold;
    const fineness = { lbb: facts.lbb_bar.fineness, thai: facts.thai_bar.fineness };
    assert.deepEqual(fineness, { lbb: 0.9999, thai: 0.965 });
    // a Thai bar holds 15.244 x 0.965 = 14.71046 g of fine gold, an LBB "baht" 15 x 0.9999 = 14.9985 g
    close(units.lakPerFineGram(44131380, 15.244, 0.965), 3000000, 1e-6);
    close(units.lakPerFineGram(3000000, 1, 0.9999), 3000300.030003, 1e-5);
    // both at 3,000,000 kip per gram of fine gold: no premium at all ...
    close(units.fineGoldPremium(3000000 * 0.9999, 44131380, fineness), 1, 1e-12);
    // ... while the plain ratio of the two bar prices says "2% dearer" (it holds the unit and the purity gap)
    close((3000000 * 0.9999 * 15) / 44131380, 14.9985 / 14.71046, 1e-12);
    assert.equal(((3000000 * 0.9999 * 15) / 44131380).toFixed(4), "1.0196");
    // numbers of the size of 2 October 2026: LBB sells at 3,093,600 kip a gram, an estimate of 44,134,646 kip per Thai baht
    const plain = (3093600 * 15) / 44134646;
    assert.equal(plain.toFixed(4), "1.0514"); // what the page used to call "+5.1% premium"
    assert.equal(units.fineGoldPremium(3093600, 44134646, fineness).toFixed(4), "1.0312"); // like for like: +3.1%
    close(units.fineGoldPremium(3093600, 44134646, fineness), plain * (14.71046 / 14.9985), 1e-12);
    // two bars of the same purity: only the unit gap is left (15 g against 15.244 g)
    close(units.fineGoldPremium(3000000, 3000000 * 15.244, { lbb: 0.965, thai: 0.965 }), 1, 1e-12);
  });
  test("kip line: a dearer dollar and a kip that lost value are two different sizes (audit P2-2)", () => {
    close(calc.dearer(10000, 20000), 100);
    close(calc.kipChange(10000, 20000), -50);
    close(calc.dearer(20000, 22000), 10);
    close(calc.kipChange(20000, 22000), -9.090909090909, 1e-9);
    // 2022-23 sized: 11,000 -> 17,000 kip per dollar is "+54.5% dearer" but "the kip lost 35.3%"
    assert.equal(calc.dearer(11000, 17000).toFixed(1), "54.5");
    assert.equal(calc.kipChange(11000, 17000).toFixed(1), "-35.3");
    // one follows from the other: lost = dearer / (1 + dearer)
    for (const [a, b] of [[9317, 22469], [21690, 22469], [22469, 21690]]) close(-calc.kipChange(a, b), (calc.dearer(a, b) / (100 + calc.dearer(a, b))) * 100, 1e-9);
    close(calc.dearer(500, 500), 0);
    close(calc.kipChange(500, 500), 0);
    assert.ok(calc.kipChange(22469, 21690) > 0 && calc.dearer(22469, 21690) < 0); // a cheaper dollar = a kip worth more
  });
  const wagesTab = await page("pages/eco-wages.js");
  test("average earnings: a multiple of Laos only from the value of Laos' own year (audit P2-3)", () => {
    const avg = {
      latest: { LAO: { year: 2022, usd: 178 }, THA: { year: 2025, usd: 508 }, CHN: { year: 2022, usd: 807 }, JPN: { year: 2021, usd: 2801 } },
      series: { LAO: [[2017, 240], [2022, 178]], THA: [[2021, 486], [2022, 467], [2025, 508]], CHN: [[2022, 807]], JPN: [[2020, 2882], [2021, 2801]] },
    };
    assert.equal(wagesTab.earningsIn(avg, "THA", 2022), 467); // not the 508 of 2025: 2.6 times Laos, not 2.9
    assert.equal(wagesTab.earningsIn(avg, "CHN", 2022), 807);
    assert.equal(wagesTab.earningsIn(avg, "JPN", 2022), null); // no number for Laos' year: a dash, never another year
    assert.equal(wagesTab.earningsIn(avg, "LAO", 2022), 178);
    assert.equal(wagesTab.earningsIn(avg, "KOR", 2022), null); // a country the file does not have
    // a file written before the yearly series existed: only a country whose newest year IS Laos' year has a multiple
    const old = { latest: avg.latest };
    assert.equal(wagesTab.earningsIn(old, "CHN", 2022), 807);
    assert.equal(wagesTab.earningsIn(old, "THA", 2022), null);
  });
  test("money amounts: millions of dollars are written as millions below a billion, as billions above", () => {
    const t = { unit_usd_bn: "bn", unit_usd_m: "m" };
    assert.equal(eco.usdText(988.46, t), "988.5 m");
    assert.equal(eco.usdText(1404.78, t), "1.40 bn");
    assert.deepEqual(eco.usdParts(15392.6, t), { num: "15.39", unit: "bn" });
    assert.equal(eco.pctText(4.538), "4.5%");
    assert.equal(eco.pctText(66.6, 0), "67%");
  });

  // ---------- chart read-outs and the yearly exchange rate (audit P2-5, P2-6) ----------
  const charts = await page("charts.js");
  test("read-out at rest: a line that runs into the future shows the value of now, not its far end", () => {
    const n = null;
    // labels 2022 ... 2028, now = 2026 (index 4)
    assert.equal(charts.restPoint([1, 2, 3, 4, n, n, n], 3, 4), 3); // ends before now: its last value
    assert.equal(charts.restPoint([n, n, n, n, 5, 6, 7], 6, 4), 4); // a forecast: this year, not 2028
    assert.equal(charts.restPoint([1, 2, 3, 4, 5, 6, 7], 6, 4), 4); // a schedule that runs through now
    assert.equal(charts.restPoint([n, n, n, n, n, 6, 7], 6, 4), 5); // starts only next year: its first value
    assert.equal(charts.restPoint([1, 2, n, n, n, n, 7], 6, 4), 1); // nothing at now: the last one before it
    assert.equal(charts.restPoint([1, 2, 3, 4, 5, 6, 7], 6, -1), 6); // a chart without "now": the last value, as always
    assert.equal(charts.restPoint([1, 2, 3, 4, 5, n, n], 4, 4), 4);
  });
  test("read-out: no '% since the first point' for a line that starts near zero or below it", () => {
    assert.equal(charts.sinceMakesSense([33.9, 500, 988.5]), false); // foreign investment 2000 -> 2024: "+2,816%" says nothing
    assert.equal(charts.sinceMakesSense([9317, 14000, 22469]), true);
    assert.equal(charts.sinceMakesSense([-2.5, 3, 4]), false);
    assert.equal(charts.sinceMakesSense([0, 3, 4]), false);
    assert.equal(charts.sinceMakesSense([null, 50, null, 900, 1000]), true); // 5% of the largest value is the limit
    assert.equal(charts.sinceMakesSense([null, 49, null, 900, 1000]), false);
    assert.equal(charts.sinceMakesSense([5]), false);
  });
  const inflationTab = await page("pages/eco-inflation.js");
  test("yearly exchange rate: two sources side by side (never glued), the baht through the dollar, the running year as it stands", () => {
    const months = (year, count, value) => Array.from({ length: count }, (_, i) => [`${year}-${String(i + 1).padStart(2, "0")}`, value]);
    const economy = {
      indicators: {
        "wb.PA.NUS.FCRF": { values: [[2022, 14000], [2023, 17500], [2024, 20000]] },
        "wb.PA.NUS.FCRF.THA": { values: [[2022, 35], [2023, 35], [2024, 40], [2025, 33]] },
      },
      monthly: {
        // 2023: half a year only (not counted) · 2024 and 2025 complete · 2026: three months so far
        bol_usd_mid: { values: [...months(2023, 6, 18000), ...months(2024, 12, 21400), ...months(2025, 12, 21600), ["2026-01", 22000], ["2026-02", 22100], ["2026-03", 22200]] },
        bol_thb_mid: { values: months(2024, 12, 600) },
      },
    };
    const usd = inflationTab.fxYears(economy, "USD", 2026);
    assert.deepEqual(usd.years, [2022, 2023, 2024, 2025, 2026]);
    assert.deepEqual(usd.wb, [14000, 17500, 20000, null, null]); // the World Bank's line simply ends
    assert.deepEqual(usd.bol, [null, null, 21400, 21600, 22100]); // ... and the central bank's line stands next to it
    assert.deepEqual(usd.partial, { year: 2026, month: "2026-03" });
    assert.equal(usd.gap.year, 2024);
    close(usd.gap.pct, 7, 1e-9); // the two counts of the same year are 7% apart: one glued line would invent a 2025 jump
    const thb = inflationTab.fxYears(economy, "THB", 2026);
    assert.deepEqual(thb.years, [2022, 2023, 2024]);
    assert.deepEqual(thb.wb, [400, 500, 500]); // kip per dollar ÷ baht per dollar
    assert.deepEqual(thb.bol, [null, null, 600]);
    assert.equal(thb.partial, null);
    close(thb.gap.pct, 20, 1e-9);
    assert.equal(inflationTab.fxYears(economy, "CNY", 2026), null); // no yuan series in this file: no chart, never a guess
    assert.equal(inflationTab.fxYears({ indicators: {} }, "USD", 2026), null);
  });

  // ---------- the list of every source on the Settings page (audit P2-8) ----------
  const sourcesPage = await page("pages/sources.js");
  test("sources list: each source with the state of the parts that name it, and the day it was last read", () => {
    const file = {
      sources: { a: { source_name: "A", retrieved: "2026-10-03" }, b: { source_name: "B" } },
      checked_at: "2026-10-04T01:00:00Z",
      p1: { source: "a", stale: false, values: [[2024, 1]] },
      p2: { source: "b", stale: true, last_error: { message: "HTTP 502" } },
      group: { x: { source: "a", stale: false }, y: { source: "b", stale: false } },
    };
    const rows = sourcesPage.sourcesOf(file);
    assert.deepEqual(rows.map((r) => [r.id, r.retrieved, r.parts, r.failed, r.error]), [["a", "2026-10-03", 2, 0, null], ["b", "2026-10-04", 2, 1, "HTTP 502"]]);
    // a file with ONE source whose parts do not name it: every part counts for that source
    const single = { source: { source_name: "S" }, stale: false, provinces: { A: { stale: true, last_error: { message: "page not found" } }, B: { stale: false } } };
    assert.deepEqual(sourcesPage.sourcesOf(single).map((r) => [r.id, r.retrieved, r.parts, r.failed, r.error]), [["main", null, 3, 1, "page not found"]]);
    assert.deepEqual(sourcesPage.sourcesOf(null), []);
    assert.deepEqual(sourcesPage.sourcesOf({ sources: {} }), []);
    // the real files: every one names at least one source, and nothing in them is counted as failed by mistake
    for (const [name] of sourcesPage.SOURCE_FILES) {
      const real = JSON.parse(fs.readFileSync(path.join(ROOT, "data", name), "utf8"));
      const list = sourcesPage.sourcesOf(real);
      assert.ok(list.length > 0, `${name}: no sources found`);
      for (const r of list) assert.ok(r.parts > 0 && r.src.source_name, `${name} ${r.id}: no part names this source`);
    }
  });
  test("hand-read facts: the days they were checked are shown as a range, not as the newest day alone", () => {
    assert.deepEqual(sourcesPage.checkedDays({ checked: "2026-10-01", a: { checked: "2026-10-04" }, b: [{ checked: "2026-10-02" }], c: { checked: "soon" } }), ["2026-10-01", "2026-10-04"]);
    assert.equal(sourcesPage.checkedDays({ a: 1 }), null);
  });

  // ---------- accuracy of the kip hint (audit P1-9) ----------
  const fc = await page("pages/forecast.js");
  test("kip hint: fewer than 20 checked hints give no percentage; with enough, the naive guess is counted next to it", () => {
    const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10); // Vientiane
    const dayBack = (n) => new Date(Date.parse(today + "T00:00:00Z") - n * 86400000).toISOString().slice(0, 10);
    // the THB side of every test hint: said "up", really "flat" -> always wrong, and "flat every day" always right
    const hint = (n, said, real) => ({ target_date: dayBack(n), status: "resolved", hint: { usd: said, thb: "up" }, actual: { usd: real, thb: "flat" }, correct: { usd: said === real, thb: false } });
    assert.equal(fc.MIN_CASES, 20);
    let a = fc.hintAccuracy({ hints: [hint(1, "up", "up"), hint(2, "down", "down")] });
    assert.deepEqual([a.usd.total, a.usd.correct, a.usd.enough], [2, 2, false]); // "100%" must never be shown from this
    const many = [];
    const add = (count, said, real) => {
      for (let i = 0; i < count; i++) many.push(hint(many.length + 1, said, real));
    };
    add(12, "up", "up"); // 15 days went up: the hint said so 12 times
    add(3, "down", "up");
    add(4, "down", "down"); // 10 days went down: the hint said so 4 times
    add(6, "up", "down");
    many.push(hint(200, "up", "up")); // checked long ago: outside the 90 days
    many.push({ target_date: today, status: "pending", hint: { usd: "up", thb: "up" } });
    many.push({ target_date: dayBack(40), status: "no_publication", hint: { usd: "up", thb: "up" } });
    a = fc.hintAccuracy({ hints: many });
    assert.deepEqual([a.usd.total, a.usd.correct, a.usd.naive, a.usd.enough], [25, 16, 15, true]); // 64% against 60% for "up every day"
    assert.deepEqual([a.thb.total, a.thb.correct, a.thb.naive], [25, 0, 25]);
    a = fc.hintAccuracy(null);
    assert.deepEqual([a.usd.total, a.usd.enough], [0, false]);
  });

  // ---------- Laos next to its neighbours: one row = one year (audit P1-6) ----------
  const cmp = await page("pages/eco-compare.js");
  const SIX = ["LAO", "THA", "VNM", "KHM", "MMR", "CHN"];
  test("compare: the row's year is the newest finished year Laos has; another country's year is never mixed in silently", () => {
    const ind = { rows: { LAO: [[2023, 2.1], [2024, 2.4]], THA: [[2024, 7.5], [2025, 8.0]], VNM: [[2024, 2.4]], KHM: [[2023, 7.0], [2025, 7.9]], MMR: [[2019, 3.3]], CHN: [] } };
    const row = cmp.compareRow(ind, SIX, 2025);
    assert.equal(row.year, 2024);
    assert.deepEqual(row.cells.map((c) => [c.iso, c.value, c.year, c.same]), [
      ["LAO", 2.4, 2024, true],
      ["THA", 7.5, 2024, true], // not its newer 2025
      ["VNM", 2.4, 2024, true],
      ["KHM", 7.0, 2023, false], // no 2024: the newest earlier year, marked - never the later 2025
      ["MMR", 3.3, 2019, false],
      ["CHN", null, null, false],
    ]);
    // a rank is counted only among the countries of the row's year: Laos and Viet Nam share the last place of 3
    assert.deepEqual(cmp.rankOf(row), { rank: 2, of: 3 });
  });
  test("compare: a year that is not finished (an IMF forecast) is never the row's year", () => {
    const ind = { rows: { LAO: [[year - 1, 80.6], [year, 74.6], [year + 1, 68.6]], THA: [[year - 1, 64.7], [year, 66.8]] } };
    const row = cmp.compareRow(ind, ["LAO", "THA"]);
    assert.equal(row.year, year - 1);
    assert.deepEqual(row.cells.map((c) => c.value), [80.6, 64.7]);
    assert.deepEqual(cmp.rankOf(row), { rank: 1, of: 2 });
    assert.deepEqual(cmp.compareRow({ rows: { THA: [[2025, 1]] } }, ["LAO", "THA"]), { year: null, cells: [] }); // nothing for Laos: no card
    assert.equal(cmp.rankOf({ cells: [{ iso: "LAO", value: 1, year: 2025, same: true }] }), null); // nobody to compare with
  });
  test("compare (bot): one IMF answer for six countries is split by country, forecast years left out", () => {
    const { readImf, byCountry } = require(path.join(ROOT, "scripts", "fetch-compare.js"));
    const answer = {
      structure: {
        dimensions: {
          series: [{ id: "COUNTRY", values: [{ id: "CHN" }, { id: "LAO" }] }, { id: "INDICATOR", values: [{ id: "GGXWDG_NGDP" }] }, { id: "FREQUENCY", values: [{ id: "A" }] }],
          observation: [{ id: "TIME_PERIOD", values: [{ id: "2024" }, { id: "2025" }, { id: "2026" }] }],
        },
        attributes: { dataSet: [] },
      },
      dataSets: [{ attributes: [], series: { "1:0:0": { observations: { 0: ["94.68"], 1: ["80.62"], 2: ["74.62"] } }, "0:0:0": { observations: { 0: ["90.42"], 1: ["99.24"], 2: [null] } } } }],
    };
    const r = readImf(answer, "GGXWDG_NGDP", 2025);
    assert.deepEqual(r.rows.filter((x) => x.iso === "LAO").map((x) => [x.year, x.value]), [[2024, 94.68], [2025, 80.62]]);
    const rows = byCountry(r.rows);
    assert.deepEqual(rows.CHN, [[2024, 90.42], [2025, 99.24]]);
    assert.deepEqual(rows.THA, []); // a country the answer does not hold: an empty list, not a missing key
    assert.throws(() => readImf({ structure: { dimensions: {} } }, "X", 2025), /Unexpected IMF/);
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
