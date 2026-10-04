// Does the data checker (scripts/check-data.js) really catch a wrong number? (audit 2026-10-02, P1-10)
// The data folder is copied to a throw-away folder; the checker must pass on the copy as it is, and must fail -
// naming the file and what is wrong - after each deliberate damage. The project's own data is never touched.
// Usage: node tests/data-check.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lkg-data-check-"));
fs.cpSync(path.join(ROOT, "data"), dir, { recursive: true });

const run = () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "check-data.js")], { env: { ...process.env, DATA_DIR: dir }, encoding: "utf8", timeout: 60000 });
  return { status: r.status, out: r.stdout + r.stderr };
};
const file = (name) => path.join(dir, name);
const read = (name) => JSON.parse(fs.readFileSync(file(name), "utf8"));

let passed = 0;
const failed = [];
const result = (name, ok, detail) => {
  if (ok) passed++;
  else failed.push(name);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "\n      " + String(detail).split("\n").slice(-12).join("\n      ")}`);
};

// the copy as it is
const clean = run();
result("the data as it is passes every check", clean.status === 0 && /All checks passed/.test(clean.out), clean.out);

// One damage at a time: [what, file, change(data), text the checker must print]
const tomorrow = new Date(Date.now() + 7 * 3600000 + 2 * 86400000).toISOString().slice(0, 10);
const nextMonth = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 7);
const lastOf = (list) => list[list.length - 1];
const DAMAGE = [
  ["a value that is not a number", "economy.json", (d) => (lastOf(d.indicators["wb.NY.GDP.MKTP.CD"].values)[1] = "18.3"), /economy\.json wb\.NY\.GDP\.MKTP\.CD .*is not a number/],
  ["a growth of 4,500% (a wrong unit)", "economy.json", (d) => (lastOf(d.indicators["wb.NY.GDP.MKTP.KD.ZG"].values)[1] = 4500), /economy\.json wb\.NY\.GDP\.MKTP\.KD\.ZG .*outside what "%" can be/],
  ["a GDP of minus 5,000 billion", "economy.json", (d) => (lastOf(d.indicators["wb.NY.GDP.MKTP.CD"].values)[1] = -5000), /wb\.NY\.GDP\.MKTP\.CD .*outside what "USD bn" can be/],
  ["an impossible year", "economy.json", (d) => (lastOf(d.indicators["imf.NGDP_RPCH"].values)[0] = 20255), /imf\.NGDP_RPCH: impossible year 20255/],
  ["the same year twice", "economy.json", (d) => d.indicators["imf.GGXWDG_NGDP"].values.push([...lastOf(d.indicators["imf.GGXWDG_NGDP"].values)]), /imf\.GGXWDG_NGDP: .*not in order, or twice/],
  ["a month that does not exist", "economy.json", (d) => (lastOf(d.monthly.cpi_yoy.values)[0] = "2026-13"), /monthly cpi_yoy: impossible month "2026-13"/],
  ["a month in the future", "economy.json", (d) => d.monthly.cpi_yoy.values.push([nextMonth, 7.9]), /monthly cpi_yoy: month .* is in the future/],
  ["a series without its unit", "invest.json", (d) => delete d.indicators["wb.FI.RES.TOTL.MO"].unit, /invest\.json wb\.FI\.RES\.TOTL\.MO: no unit/],
  ["a series from a source the file does not list", "invest.json", (d) => (d.indicators["wb.FI.RES.TOTL.MO"].source = "somewhere"), /source "somewhere" is not in the file's list of sources/],
  ["a series without values that is not marked as failed", "invest.json", (d) => (d.indicators["wb.FI.RES.TOTL.MO"].values = []), /wb\.FI\.RES\.TOTL\.MO: no values/],
  ["24 births per woman", "population.json", (d) => (lastOf(d.indicators.fertility.values)[1] = 24), /population\.json fertility .*outside what "births per woman" can be/],
  ["a poverty rate of 150%", "population.json", (d) => (lastOf(d.indicators.poverty_national.values)[1] = 150), /poverty_national .*outside what "% of people" can be/],
  ["a unit nobody gave a range", "population.json", (d) => (d.indicators.life.unit = "moons"), /no range known for the unit "moons"/],
  ["the comparison without Laos", "compare.json", (d) => (d.indicators.gdp.rows.LAO = []), /compare\.json gdp: no values for Laos/],
  ["a country the comparison does not list", "compare.json", (d) => (d.indicators.gdp.rows.XXX = [[2025, 1]]), /compare\.json gdp: XXX is not in the list of countries/],
  ["years out of order in the comparison", "compare.json", (d) => d.indicators.debt.rows.THA.reverse(), /compare\.json debt THA: .*not in order/],
  ["two copies of one number that drifted apart (Laos' GDP in the comparison)", "compare.json", (d) => (lastOf(d.indicators.gdp.rows.LAO)[1] += 1.5), /worldbank:NY.GDP.MKTP.CD .*two copies of one number differ/],
  ["the population in millions that no longer fits the population in people", "population.json", (d) => (lastOf(d.indicators.pop.values)[1] = 7100000), /worldbank:SP.POP.TOTL .*two copies of one number differ/],
  ["a fact whose source is not in the list", "invest-static.json", (d) => (d.facts.debt_mof.source = "wb_lem_9999"), /facts\.debt_mof: source "wb_lem_9999" is not in the list of sources/],
  ["a fact without any source", "invest-static.json", (d) => delete d.facts.reserves_wb.source, /facts\.reserves_wb: a fact without a source/],
  ["a policy fact without any source", "invest-static.json", (d) => delete d.policy.areas[0].items[0].source, /policy\.[a-z]+\.[a-z_]+: a fact without a source/],
  ["a source without a link", "invest-static.json", (d) => delete d.sources.wb_lem_2606.source_url, /source wb_lem_2606: no https link/],
  ["a source that does not say when it was published", "invest-static.json", (d) => delete d.sources.wb_lem_2606.published, /source wb_lem_2606: does not say when it was published/],
  ["a publication date that is no date", "invest-static.json", (d) => (d.sources.wb_lem_2606.published = "summer 2026"), /source wb_lem_2606: "published" is not a day, a month or a year/],
  ["a section checked in the future", "invest-static.json", (d) => (d.facts.checked = tomorrow), /facts: checked on .* which is in the future/],
  ["a section that does not say when it was checked", "invest-static.json", (d) => delete d.plan.checked, /plan: does not say when it was last checked/],
  ["the World Bank's debt number in the chart series no longer the one of the sentences", "invest-static.json", (d) => (d.facts.debt_wb.values.find(([y]) => y === d.facts.debt_peak.now_year)[1] += 0.9), /facts\.debt_peak \(now\): .* two copies of one number differ/],
  ["the World Bank's debt forecast in the outlook table changed, the chart series not", "invest-static.json", (d) => (d.policy.outlook.rows.debt[d.policy.outlook.rows.debt.length - 1] = 70), /policy\.outlook\.debt: 70% for .* two copies of one number differ/],
  ["a debt of 1,310% of GDP in the chart series (a typing slip)", "invest-static.json", (d) => (d.facts.debt_wb.values[0][1] = 1310), /facts\.debt_wb .*outside what "% of GDP" can be/],
  ["a link in a data file that is not https", "land.json", (d) => {
    const visit = (node) => {
      if (!node || typeof node !== "object") return false;
      for (const [k, v] of Object.entries(node)) {
        if (typeof v === "string" && v.startsWith("https://")) {
          node[k] = "http://" + v.slice(8);
          return true;
        }
        if (visit(v)) return true;
      }
      return false;
    };
    if (!visit(d)) throw new Error("land.json holds no link to damage");
  }, /land\.json.*: a link that is not https/],
  ["a link in a data file that would run a script", "report-watch.json", (d) => (d.sources.wb_wds.source_url = "javascript:alert(1)"), /a link that is not https: "javascript:alert\(1\)"/],
  ["a gold purity typed as a percentage (99.99 instead of 0.9999)", "invest-static.json", (d) => (d.gold.lbb_bar.fineness = 99.99), /gold\.lbb_bar: fineness 99\.99 is not a share/],
  ["a gold purity without its source", "invest-static.json", (d) => delete d.gold.thai_bar.source, /gold\.thai_bar: a fact without a source/],
  ["a hint marked right although it was wrong", path.join("forecast", "hints.json"), (d) => {
    const h = d.hints.find((x) => x.status === "resolved");
    h.correct.usd = !h.correct.usd;
  }, /"correct" for usd does not follow from hint and actual/],
  ["a history row with a value below zero", path.join("history", "gold-world.json"), (d) => (d[0].value = -1), /gold-world\.json row 0: value is not > 0/],
];
for (const [what, name, change, expected] of DAMAGE) {
  const original = fs.readFileSync(file(name), "utf8");
  const data = JSON.parse(original);
  change(data);
  fs.writeFileSync(file(name), JSON.stringify(data));
  const r = run();
  result(`caught: ${what}`, r.status === 1 && expected.test(r.out), `exit ${r.status}, expected ${expected}\n${r.out.split("\n").filter((l) => l.includes("!!")).join("\n") || r.out.slice(-600)}`);
  fs.writeFileSync(file(name), original);
}
// a file that is not JSON at all
const original = fs.readFileSync(file("economy.json"), "utf8");
fs.writeFileSync(file("economy.json"), original.slice(0, 5000));
const cut = run();
result("caught: a file cut off in the middle", cut.status === 1 && /economy\.json: missing or not valid JSON/.test(cut.out), cut.out.slice(-600));
fs.writeFileSync(file("economy.json"), original);
// ... and after every repair the copy passes again
const again = run();
result("after putting everything back the copy passes again", again.status === 0, again.out.slice(-800));

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
