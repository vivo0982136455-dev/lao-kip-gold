// Source #11: BCEL deposit interest rates (BANK) - what a saver earns in LAK / USD / THB / CNY.
// Official BCEL website: the "Deposit Interest Rate" box on the home page (the rate page itself has no table).
//
// Real page (checked 2026-09-30):
//   ... Deposit Interest Rate ... LAK USD THB CNY ...
//   <tr> <td class="">Saving Deposit Account</td> <td class="xred">1.60%</td> <td class="xred">1.00%</td>
//        <td class="xred">0.55%</td> <td class="xred">0.20%</td> </tr>
//   <tr> <td class="">Fixed Deposit Account 12 months</td> <td class="xred">5.59%</td> ... </tr>
// "-" = not offered. No date is shown, so the record date is the day we read it (Vientiane);
// if BCEL changes a rate during the day, the newer value replaces the older one (same_day_updates).

const { fetchText, parseNumber, makeRecord, runSource, runIfMain } = require("./lib/common");

const URL = process.env.BCEL_DEPOSIT_URL || "https://www.bcel.com.la/bcel/home.html?lang=en";
const CURRENCIES = ["LAK", "USD", "THB", "CNY"]; // column order in the box

const META = {
  source: "bcel-deposit",
  source_name: "BCEL deposit interest rates",
  source_url: "https://www.bcel.com.la/bcel/interest.html?fid=deposit-interest",
  license: "Public rates on the BCEL website",
  kind: "bank",
  same_day_updates: true,
};

// "Saving Deposit Account" -> "saving" ; "Fixed Deposit Account 12 months" -> "fixed_12m"
function termId(label) {
  if (/^Saving Deposit Account$/i.test(label)) return "saving";
  const m = /^Fixed Deposit Account (\d+) months?$/i.exec(label);
  return m ? `fixed_${m[1]}m` : null;
}

async function getRecords(fetchedAt) {
  const html = await fetchText(URL);
  const start = html.indexOf("Saving Deposit Account");
  if (start < 0) throw new Error('Cannot find the "Deposit Interest Rate" box on the BCEL home page');
  const box = html.slice(html.lastIndexOf("<table", start), html.indexOf("</table>", start));

  const day = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10); // today in Vientiane
  const records = [];
  for (const row of box.split("<tr").slice(1)) {
    const cells = [...row.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((m) => m[1].trim());
    const term = termId(cells[0] || "");
    if (!term) continue;
    cells.slice(1, 1 + CURRENCIES.length).forEach((text, i) => {
      if (!/%$/.test(text)) return; // "-" = not offered
      const value = parseNumber(text.replace("%", ""), `${CURRENCIES[i]} ${term}`);
      if (value > 30) throw new Error(`Deposit rate looks wrong: ${CURRENCIES[i]} ${term} = ${text}`);
      records.push(makeRecord({ source: "bcel-deposit", metric: `${CURRENCIES[i]}_${term}`, value, unit: "% per year", fetched_at: fetchedAt, source_date: day }));
    });
  }
  if (!records.some((r) => r.metric === "LAK_fixed_12m")) throw new Error("BCEL deposit box has no LAK 12-month rate");
  return records;
}

const run = () => runSource(META, getRecords);
runIfMain(module, run);

module.exports = { run };
