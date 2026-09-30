// Source #10: BCEL commercial bank exchange rates (BANK) - the rate people really get at the counter.
// Official BCEL website, plain HTML table.
//
// Real page (checked 2026-09-30):
//   <strong>Date: 2026-09-30</strong> ... <select id="round"><option value="1" selected>1</option></select>
//   <tr> <td data-title="Currency Code">USD 50-100 </td> <td data-title="NOTE">22,196</td>
//        <td data-title="BILL">22,196</td> <td data-title="EFT">22,198</td> <td data-title="Sell Rates">22,570</td> </tr>
// Notes: BCEL may publish more than one "round" per day (no time is shown). We store one value per day
//        and a newer round REPLACES the older one (same_day_updates). Buy = NOTE (cash) rate.
//        USD has two rows (small / big notes); we use "USD 50-100", the usual rate for big notes.

const { fetchText, parseNumber, makeRecord, runSource, runIfMain } = require("./lib/common");

const URL = process.env.BCEL_URL || "https://www.bcel.com.la/bcel/exchange-rate.html?lang=en";

// Owner decision: only the 3 main currencies for now. Row label on the page -> our code.
const ROWS = { "USD 50-100": "USD", THB: "THB", CNY: "CNY" };

const META = {
  source: "bcel",
  source_name: "BCEL (Banque pour le Commerce Extérieur Lao)",
  source_url: "https://www.bcel.com.la/bcel/exchange-rate.html?lang=en",
  license: "Public rates on the BCEL website",
  kind: "bank",
  same_day_updates: true,
};

// Text of the <td data-title="..."> cell inside one table row
function cell(rowHtml, title) {
  const m = new RegExp(`data-title="${title}"[^>]*>([^<]*)<`).exec(rowHtml);
  return m ? m[1].trim() : null;
}

async function getRecords(fetchedAt) {
  const html = await fetchText(URL);

  const dateMatch = /<strong>\s*Date:\s*(\d{4}-\d{2}-\d{2})\s*<\/strong>/.exec(html);
  if (!dateMatch) throw new Error('Cannot find "Date:" on the BCEL page');
  const day = dateMatch[1];
  // Sanity check: not in the future (1 day margin) and not older than 10 days
  const ageDays = (Date.now() - Date.parse(day + "T00:00:00+07:00")) / 86400000;
  if (Number.isNaN(ageDays) || ageDays < -1 || ageDays > 10) throw new Error(`BCEL date looks wrong: ${day}`);

  const records = [];
  for (const row of html.split("<tr").slice(1)) {
    const code = ROWS[(cell(row, "Currency Code") || "").replace(/\s+/g, " ")];
    if (!code) continue;
    const buy = parseNumber(cell(row, "NOTE"), `${code} buy`);
    const sell = parseNumber(cell(row, "Sell Rates"), `${code} sell`);
    if (sell < buy) throw new Error(`BCEL ${code}: sell (${sell}) is below buy (${buy})`);
    for (const [side, value] of [["buy", buy], ["sell", sell]]) {
      records.push(
        makeRecord({ source: "bcel", metric: `${code}_LAK_${side}`, value, unit: `LAK per ${code}`, fetched_at: fetchedAt, source_date: day })
      );
    }
  }
  const found = new Set(records.map((r) => r.metric.slice(0, 3)));
  const missing = Object.values(ROWS).filter((c) => !found.has(c));
  if (missing.length) throw new Error(`BCEL table is missing: ${missing.join(", ")}`);
  return records;
}

const run = () => runSource(META, getRecords);
runIfMain(module, run);

module.exports = { run };
