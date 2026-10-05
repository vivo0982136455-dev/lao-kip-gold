// Find the question IDs of the owner's price Google Form, so the web page can fill it in.
// Reads the public form page (no login) and writes data/manual-form.json. Runs with every data
// run, so when the owner adds or edits questions the page follows automatically.
// Usage: node scripts/fetch-form-entries.js   (fetch-all.js also runs it)
//
// Real page (checked 2026-09-30): the HTML holds  var FB_PUBLIC_LOAD_DATA_ = [...];
//   data[1][1] = questions; q[1] = title, q[3] = type (0 short answer, 9 date), q[4][0][0] = entry ID
//   data[1][10][6] = collect e-mail (1 = no), data[18] = sign-in required (0 = no)
// A question is recognised by words in its title (Thai), so its position in the form does not matter.
// The page cannot read the form itself (Google sends no CORS headers), which is why this runs here.

// When config/manual-sources.json names a "save_url" (the owner's own Apps Script, apps-script/save-prices.gs),
// the Form is closed and cannot be read any more: the script itself is asked which prices its Sheet has a
// column for (a GET writes nothing and needs no key), and the page saves through that address.
//   Real answer: not seen yet - the owner has not deployed the script (2026-10-05). The same code answers in
//   tests/save-script.js: {"ok":true,"roles":["date","sell", ...]}
//
// The file also carries the limits of the owner's own prices (scripts/fetch-own-prices.js LIMITS), so that the
// page checks an entry with the very numbers the bot will check it with.

const path = require("path");
const { DATA_DIR, ROOT_DIR, fetchText, fetchJson, readJson, writeIfChanged } = require("./lib/common");
const { LIMITS } = require("./fetch-own-prices");

const OUT_FILE = path.join(DATA_DIR, "manual-form.json");

// role -> test on the normalised title. Checked in this order; the first match wins.
const ROLES = [
  ["note", (t) => t.includes("หมายเหตุ")],
  // the owner's own prices: rubber (ยาง) and land (ที่ดิน)
  ["rubber_price", (t) => t.includes("ยาง") && t.includes("ราคา")],
  ["rubber_type", (t) => t.includes("ยาง") && t.includes("ชนิด")],
  ["rubber_place", (t) => t.includes("ยาง") && t.includes("สถานที่")],
  ["land_place", (t) => t.includes("ที่ดิน") && t.includes("สถานที่")],
  ["land_total", (t) => t.includes("ที่ดิน") && t.includes("ราคา")],
  ["land_area", (t) => t.includes("ที่ดิน") && t.includes("เนื้อที่")],
  ["silver_sell", (t) => (t.includes("เงิน") || /silver/i.test(t)) && t.includes("ขาย")],
  ["silver_buy", (t) => (t.includes("เงิน") || /silver/i.test(t)) && t.includes("ซื้อ")],
  ["bar_sell", (t) => t.includes("แท่ง") && t.includes("ขาย")],
  ["bar_buy", (t) => t.includes("แท่ง") && t.includes("ซื้อ")],
  ["sell", (t) => t.includes("ขาย")],
  ["buy", (t) => t.includes("ซื้อ")],
];

function parseForm(html) {
  const m = /FB_PUBLIC_LOAD_DATA_ = (\[[\s\S]*?\]);\s*<\/script>/.exec(html);
  if (!m) throw new Error("FB_PUBLIC_LOAD_DATA_ not found in the form page");
  const data = JSON.parse(m[1]);
  const items = (data[1] && data[1][1]) || [];
  const entries = {};
  const questions = [];
  for (const q of items) {
    const title = String(q[1] || "").replace(/\s+/g, " ").replace(/\*/g, "").trim();
    const entry = q[4] && q[4][0] ? String(q[4][0][0]) : null;
    if (!entry) continue;
    let role = q[3] === 9 ? "date" : null;
    if (!role) {
      const found = ROLES.find(([r, test]) => !entries[r] && test(title));
      role = found ? found[0] : null;
    }
    if (role && !entries[role]) entries[role] = entry;
    questions.push({ title, type: q[3], entry, role });
  }
  const collectEmail = data[1] && data[1][10] ? data[1][10][6] : null;
  return {
    entries,
    questions,
    // A silent submit from the page only works when the form needs no sign-in and no e-mail
    direct_submit_ok: (collectEmail === 1 || collectEmail === null) && !data[18],
  };
}

async function main() {
  const config = readJson(path.join(ROOT_DIR, "config", "manual-sources.json"), {});
  const formUrl = String(config.shop_form_url || "").trim();
  const sheetMatch = /\/spreadsheets\/d\/([\w-]+)/.exec(config.lao_gold_csv_url || "");
  const formMatch = /\/forms\/d\/e\/([\w-]+)\//.exec(formUrl);
  const saveUrl = process.env.SAVE_URL !== undefined ? process.env.SAVE_URL.trim() : String(config.save_url || "").trim();
  if (saveUrl) {
    // an environment variable is a test's own server; the address in the config must be an Apps Script web app
    if (process.env.SAVE_URL === undefined && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(saveUrl)) throw new Error("save_url is not the address of an Apps Script web app (https://script.google.com/macros/s/.../exec)");
    const answer = await fetchJson(saveUrl);
    const roles = answer && answer.ok === true && Array.isArray(answer.roles) ? answer.roles.filter((r) => /^[a-z_]+$/.test(r)) : [];
    if (!roles.includes("date") || !roles.includes("sell")) throw new Error("the save script found no date / sell column in the Sheet");
    const out = { save_url: saveUrl, sheet_id: sheetMatch ? sheetMatch[1] : null, entries: Object.fromEntries(roles.map((r) => [r, r])), direct_submit_ok: true, limits: LIMITS };
    writeIfChanged(OUT_FILE, JSON.stringify(out, null, 2) + "\n");
    console.log(`[OK]   manual-form: saved through the owner's script: ${roles.join(", ")}`);
    return;
  }
  if (!formMatch) {
    console.log("[SKIP] manual-form: no shop_form_url in config/manual-sources.json");
    return;
  }
  const form = parseForm(await fetchText(formUrl.replace(/\?.*$/, "")));
  if (!form.entries.date || !form.entries.sell) throw new Error("the form has no date / sell question");
  const out = {
    form_id: formMatch[1],
    sheet_id: sheetMatch ? sheetMatch[1] : null,
    ...form,
    limits: LIMITS,
  };
  writeIfChanged(OUT_FILE, JSON.stringify(out, null, 2) + "\n");
  console.log(`[OK]   manual-form: ${Object.keys(form.entries).join(", ")}${form.direct_submit_ok ? "" : " (direct submit NOT possible)"}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[FAIL] manual-form: ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main, parseForm };
