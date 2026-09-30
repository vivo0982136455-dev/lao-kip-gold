// One-time (resumable) backfill of Thai rubber MONTHLY prices into data/thai-prices.json.
// The ministry API times out on long ranges, so it asks for one month per request, one at a time.
// Months already stored with 15 or more days are skipped, so it can be stopped and started again.
// Run: node scripts/backfill-thai-rubber.js [fromMonth]      (default 2021-01, up to last month)
// After it: node scripts/fetch-thai-prices.js rubber_cuplump rubber_latex rubber_sheet   (daily values + latest)

const { fetchJson, readJson } = require("./lib/common");
const { ITEMS, API, OUT_FILE, SOURCE, writePrices, round2 } = require("./fetch-thai-prices");

const RUBBER = Object.keys(ITEMS).filter((k) => k.startsWith("rubber_"));
const FROM = process.argv[2] || "2021-01";
const TIMEOUT_MS = 90000;
const PAUSE_MS = 1500; // be polite to the ministry server
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const nextMonth = (m) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1)).toISOString().slice(0, 7);
const lastDay = (m) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);

async function fetchMonth(def, month) {
  const url = `${API}?product_id=${def.id}&from_date=${month}-01&to_date=${lastDay(month)}`;
  const data = await fetchJson(url, {}, TIMEOUT_MS);
  const list = Array.isArray(data.price_list) ? data.price_list : [];
  const mids = list.filter((p) => p.price_min > 0 && p.price_max > 0).map((p) => (p.price_min + p.price_max) / 2 / def.per);
  return { name: data.product_name || null, n: mids.length, avg: mids.length ? round2(mids.reduce((a, b) => a + b, 0) / mids.length) : null };
}

async function main() {
  if (!/^\d{4}-\d{2}$/.test(FROM)) throw new Error(`fromMonth must look like 2021-01, got "${FROM}"`);
  const file = readJson(OUT_FILE, { items: {} });
  const out = { source: file.source || SOURCE, unit_note: file.unit_note || "THB per unit (KG / L / egg)", items: { ...file.items } };
  const thisMonth = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 7); // Bangkok time
  const months = [];
  for (let m = FROM; m < thisMonth; m = nextMonth(m)) months.push(m); // the running month is left to the weekly job

  for (const key of RUBBER) {
    const def = ITEMS[key];
    const item = out.items[key] || { moc_id: def.id, name_th: null, unit: def.unit, latest: null, monthly: [], days: [], stale: false, last_error: null };
    const map = new Map((item.monthly || []).map(([m, v, n]) => [m, [v, n === undefined ? 31 : n]]));
    let fetched = 0;
    let skipped = 0;
    let failed = 0;
    for (const m of months) {
      if (map.has(m) && map.get(m)[1] >= 15) {
        skipped++;
        continue;
      }
      let res = null;
      for (let attempt = 1; attempt <= 2 && !res; attempt++) {
        try {
          res = await fetchMonth(def, m);
        } catch (err) {
          console.warn(`       ${key} ${m}: ${err.message}`);
          await sleep(10000);
        }
      }
      if (!res) {
        failed++;
        continue;
      }
      if (res.name && !item.name_th) item.name_th = res.name;
      if (res.n && (!map.has(m) || res.n >= map.get(m)[1])) map.set(m, [res.avg, res.n]);
      fetched++;
      item.monthly = [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-(def.months || 26)).map(([mm, [v, n]]) => [mm, v, n]);
      out.items[key] = item;
      writePrices(out); // saved after every month: safe to stop and restart
      console.log(`[OK]   ${key} ${m}: ${res.n} days, average ${res.avg}`);
      await sleep(PAUSE_MS);
    }
    console.log(`${key}: ${fetched} months fetched, ${skipped} already stored, ${failed} failed`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
