// Source #19: official land price decisions of every province (OFFICIAL), from the Lao Official Gazette
// (Ministry of Justice). Each province sets "assessed" land prices (kip per square metre, by zone and road
// class) as the base for land tax and fees - NOT market prices. The decisions are scanned PDFs without a text
// layer, so a script cannot read the PRICES; this source only finds which provinces have a decision, its date
// and the link to open it, and so tells the page when a province publishes a new one.
//
// Real response (checked 2026-10-01), no login, no robots.txt:
//   https://laoofficialgazette.gov.la/index.php?r=site/listlegistioncp&agencies_id=43&old=0   (&Document_page=2 ...)
//   Summary line: "ສະແດງ 1-10 ຂອງ 37 ຜົນທີ່ໄດ້ຮັບ."  (showing 1-10 of 37)
//   One row per act:
//   <tr class="odd"><td>TITLE</td><td>ຂໍ້ຕົກລົງ</td><td>ແຂວງ ບໍລິຄໍາໄຊ</td><td style="width:70px">12-02-2026</td>
//     <td style="width:70px">20-03-2026</td><td>ປັດຈຸບັນ</td><td><a href="/index.php?r=site/display&amp;id=2536">ເບິ່ງ</a></td>
//     <td ...></td><td ...><a target="_blank" href="/kcfinder/upload/files/41.12.2.2026_0001.pdf">...</a></td></tr>
//   Columns: title | type of act | agency | date of the act (DD-MM-YYYY) | date posted | status | view | PDF English | PDF Lao
// Only acts in force are listed here ("old=0"); replaced ones are in a separate list and are not used.
//
// Output data/land.json: { source, checked_at, stale, last_error, provinces: { <name>: { id, acts, stale, decisions: [...] } } }
// A province that cannot be read keeps last week's decisions and gets stale: true.

const path = require("path");
const { DATA_DIR, fetchText, readJson, writeIfChanged } = require("./lib/common");

const BASE = process.env.LAND_GAZETTE_URL || "https://laoofficialgazette.gov.la";
const OUT_FILE = path.join(DATA_DIR, "land.json");
const SOURCE = {
  source_name: "Lao Official Gazette (Ministry of Justice): provincial legislation",
  source_url: "https://laoofficialgazette.gov.la/index.php?r=site/listlegistioncp&agencies_id=34&old=0",
};
const PAGE_SIZE = 10;
const MAX_PAGES = 30; // a province has 5-80 acts
const PAUSE_MS = 300; // be gentle with a small government server
const REQUEST_TIMEOUT_MS = 40000;

// Gazette agency id -> province (same spelling as "provinces" in i18n/*.json)
const PROVINCES = {
  34: "Vientiane Capital", 35: "Phongsaly", 36: "Xiengkhouang", 37: "Houaphan", 38: "Louangphabang", 39: "Oudomxai",
  40: "Louangnamtha", 41: "Bokeo", 42: "Xaignabouly", 43: "Bolikhamxai", 44: "Khammouan", 45: "Savannakhet",
  46: "Salavan", 47: "Champasack", 48: "Sekong", 49: "Attapeu", 50: "Vientiane", 51: "Xaisomboun",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const listUrl = (id, page) => `${BASE}/index.php?r=site/listlegistioncp&agencies_id=${id}&old=0${page > 1 ? `&Document_page=${page}` : ""}`;

function cleanText(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/[​‌‍﻿]/g, "") // zero-width characters that Lao pages often carry
    .replace(/\s+/g, " ")
    .trim();
}

// "12-02-2026" -> "2026-02-12" (null if it is not a real date)
function isoDay(text) {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(text || "").trim());
  if (!m) return null;
  const day = `${m[3]}-${m[2]}-${m[1]}`;
  return Number.isNaN(Date.parse(day + "T00:00:00Z")) ? null : day;
}

// A decision that sets land prices for tax ("... ລາຄາທີ່ດິນ ..."). Compensation prices for one project
// ("ທົດແທນ") are something else: they apply to one road or power line, not to the province.
function isLandPriceDecision(title) {
  const t = title.normalize("NFC").replace(/\s+/g, "");
  if (t.includes("ທົດແທນ")) return false;
  return t.includes("ລາຄາທີ່ດິນ") || t.includes("ລາຄາມູນຄ່າທີ່ດິນ");
}

// One page of the list -> { total, acts: [{ id, title, decided, posted, pdf }] }
function parseList(html, label) {
  const total = /(\d+)-(\d+)\s*ຂອງ\s*(\d+)/.exec(html);
  const acts = [];
  for (const row of html.match(/<tr class="(?:odd|even)">[\s\S]*?<\/tr>/g) || []) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (cells.length < 9) continue;
    const id = /r=site(?:\/|%2F)display&(?:amp;)?id=(\d+)/.exec(cells[6]);
    const decided = isoDay(cleanText(cells[3]));
    if (!id || !decided) throw new Error(`${label}: a row without an id or a date - the page layout has changed`);
    const pdf = /href="(\/kcfinder\/[^"]+\.pdf)"/i.exec(cells[8]);
    acts.push({
      id: Number(id[1]),
      title: cleanText(cells[0]),
      decided,
      posted: isoDay(cleanText(cells[4])),
      pdf: pdf ? BASE + encodeURI(pdf[1].replace(/&amp;/g, "&")) : null,
    });
  }
  return { total: total ? Number(total[3]) : null, acts };
}

async function fetchProvince(id, name) {
  const first = parseList(await fetchText(listUrl(id, 1), {}, REQUEST_TIMEOUT_MS), name);
  const acts = [...first.acts];
  // No summary line = everything fits on one page (or the province has no acts at all)
  const pages = first.total ? Math.min(MAX_PAGES, Math.ceil(first.total / PAGE_SIZE)) : 1;
  for (let page = 2; page <= pages; page++) {
    await sleep(PAUSE_MS);
    acts.push(...parseList(await fetchText(listUrl(id, page), {}, REQUEST_TIMEOUT_MS), name).acts);
  }
  if (first.total !== null && acts.length !== first.total) throw new Error(`${name}: read ${acts.length} acts, the site says ${first.total}`);
  const decisions = acts
    .filter((a) => isLandPriceDecision(a.title))
    .sort((a, b) => (a.decided < b.decided ? 1 : -1)) // newest first
    .map((a) => ({ id: a.id, title: a.title, decided: a.decided, posted: a.posted, url: `${BASE}/index.php?r=site/display&id=${a.id}`, pdf: a.pdf }));
  return { id, acts: acts.length, stale: false, decisions };
}

// One province per line: small git diffs
function toText(out) {
  const { provinces, ...head } = out;
  const lines = Object.entries(provinces).map(([name, p]) => `    ${JSON.stringify(name)}: ${JSON.stringify(p)}`);
  return JSON.stringify({ ...head, provinces: "@" }, null, 2).replace('"@"', "{\n" + lines.join(",\n") + "\n  }") + "\n";
}

async function main() {
  const before = readJson(OUT_FILE, null);
  const provinces = {};
  const failed = [];
  for (const [idText, name] of Object.entries(PROVINCES)) {
    try {
      provinces[name] = await fetchProvince(Number(idText), name);
      console.log(`[OK]   ${name}: ${provinces[name].acts} acts, ${provinces[name].decisions.length} land price decision(s)`);
    } catch (err) {
      failed.push(`${name}: ${err.message}`);
      console.error(`[FAIL] ${name}: ${err.message}`);
      const old = before && before.provinces && before.provinces[name];
      provinces[name] = old ? { ...old, stale: true } : { id: Number(idText), acts: 0, stale: true, decisions: [] };
    }
    await sleep(PAUSE_MS);
  }

  // Sanity: the site lists about 400 acts and 11 provinces with a land price decision (2026-10-01).
  // Far less than that = the site or its layout changed: keep last week's file and say so.
  const good = Object.values(provinces).filter((p) => !p.stale);
  const totalActs = good.reduce((n, p) => n + p.acts, 0);
  const withDecision = good.filter((p) => p.decisions.length).length;
  // (one example is enough in the stored message when many provinces fail for the same reason)
  let error = failed.length > 3 ? `${failed.length} provinces failed, e.g. ${failed[0]}` : failed.length ? failed.join(" | ") : null;
  if (good.length < 12 || totalActs < 150 || withDecision < 6) {
    error = `Too little read from the Gazette (${good.length} provinces, ${totalActs} acts, ${withDecision} with a land price decision). ${error || ""}`.trim();
    console.error(`[FAIL] land-decisions: ${error}`);
    if (before) {
      const kept = { ...before, stale: true, last_error: { message: error, at: new Date().toISOString() } };
      writeIfChanged(OUT_FILE, toText(kept));
    }
    return { source: "land-decisions", ok: false, message: error };
  }

  const out = {
    source: SOURCE,
    checked_at: new Date().toISOString(),
    stale: failed.length > 0,
    last_error: error ? { message: error, at: new Date().toISOString() } : null,
    provinces,
  };
  writeIfChanged(OUT_FILE, toText(out));
  const message = `${good.length}/${Object.keys(PROVINCES).length} provinces, ${totalActs} acts, ${withDecision} provinces with a land price decision`;
  console.log(`${failed.length ? "[WARN]" : "[OK]  "} land-decisions: ${message}`);
  return { source: "land-decisions", ok: failed.length === 0, message };
}

if (require.main === module) {
  main().then((result) => {
    process.exitCode = result.ok ? 0 : 1;
  });
}
module.exports = { parseList, isLandPriceDecision, isoDay, PROVINCES };
