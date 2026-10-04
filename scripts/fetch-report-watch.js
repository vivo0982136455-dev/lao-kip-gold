// Source #31: is there a newer edition of a report that this site quotes by hand? Asked once a week.
//   lem   World Bank "Lao PDR Economic Monitor" (two editions a year). The Policy tab quotes facts read by hand from
//         one edition (data/invest-static.json "policy.read"); when a newer edition is out, the tab says so and
//         links to it - the facts themselves are never changed automatically.
// Writes data/report-watch.json (loaded only on the Economy > Policy tab).
// Usage: node scripts/fetch-report-watch.js
//
// Real answer (checked 2026-10-02):
//   GET https://search.worldbank.org/api/v3/wds?format=json&qterm=Lao PDR Economic Monitor
//         &count_exact=Lao People's Democratic Republic&fl=docdt,display_title,url,docty&rows=40&srt=docdt&order=desc
//   { "total": 408, "documents": { "D40125926": { "docty": "Report", "docdt": "2026-06-30T04:00:00Z",
//       "display_title": "Lao People’s Democratic Republic Economic Monitor : June 2026",
//       "url": "http://documents.worldbank.org/curated/en/099070126060026616" }, ..., "facets": {} } }
//   The search returns every document about Laos, newest first: only reports whose title says "Economic Monitor"
//   are kept. Before: 2025-12-10 "Lao PDR Economic Monitor : Consolidating Recent Reform Momentum ...",
//   2025-05-01 "Lao PDR Economic Monitor - Weathering Risks ...".

const path = require("path");
const { DATA_DIR, fetchJson, readJson, writeIfChanged } = require("./lib/common");
const { runParts, partsText, stampedSources } = require("./lib/parts");

const OUT_FILE = path.join(DATA_DIR, "report-watch.json");
const TIMEOUT_MS = 30000;
const WDS_URL =
  process.env.REPORT_WATCH_WDS_URL ||
  "https://search.worldbank.org/api/v3/wds?format=json&qterm=Lao%20PDR%20Economic%20Monitor&count_exact=Lao%20People%27s%20Democratic%20Republic&fl=docdt,display_title,url,docty&rows=40&srt=docdt&order=desc";
// The edition the site already knows: it must be in the answer, or the search has changed and proves nothing
const KNOWN_EDITION = "2026-06-30";

const SOURCES = {
  wb_wds: { source_name: "World Bank: Documents & Reports (search)", source_url: "https://documents.worldbank.org/en/publication/documents-reports", license: "World Bank - CC BY 4.0" },
};

async function economicMonitor() {
  const data = await fetchJson(WDS_URL, {}, TIMEOUT_MS);
  const docs = Object.values((data && data.documents) || {}).filter((d) => d && typeof d === "object" && d.docdt && d.display_title);
  const editions = docs
    .filter((d) => d.docty === "Report" && /Lao/i.test(d.display_title) && /Economic Monitor/i.test(d.display_title))
    .map((d) => [String(d.docdt).slice(0, 10), String(d.display_title).replace(/\s+/g, " ").trim(), String(d.url || "").replace(/^http:/, "https:")])
    .filter(([day, , url]) => /^\d{4}-\d{2}-\d{2}$/.test(day) && /^https:\/\/documents\.worldbank\.org\//.test(url))
    .sort((a, b) => (a[0] < b[0] ? 1 : -1));
  if (!editions.length) throw new Error("World Bank search: no Lao Economic Monitor in the answer");
  if (!editions.some((e) => e[0] === KNOWN_EDITION)) throw new Error(`World Bank search: the known edition of ${KNOWN_EDITION} is missing - has the search changed?`);
  const tomorrow = new Date(Date.now() + 86400000 + 7 * 3600000).toISOString().slice(0, 10);
  if (editions[0][0] > tomorrow) throw new Error(`World Bank search: an edition dated ${editions[0][0]} (in the future)`);
  return { source: "wb_wds", latest: { date: editions[0][0], title: editions[0][1], url: editions[0][2] }, editions: editions.slice(0, 4) };
}

async function main() {
  const old = readJson(OUT_FILE, {});
  const now = new Date().toISOString();
  const { out, failed } = await runParts(old, [["lem", { source: "wb_wds", latest: null, editions: [] }, economicMonitor, (p) => `newest: ${p.latest.date} "${p.latest.title}" (${p.editions.length} editions kept)`]], now);
  // checked_at moves only when the search answered: the page shows it as "last looked on"
  const text = partsText({ sources: stampedSources(SOURCES, old.sources, out, now), checked_at: failed ? old.checked_at || null : now.slice(0, 10) }, out);
  writeIfChanged(OUT_FILE, text);
  console.log(`\nDone: ${failed} of 1 parts failed. Wrote data/report-watch.json (${(text.length / 1024).toFixed(1)} KB)`);
  return { ok: failed < 1 };
}

if (require.main === module) main().then((r) => (process.exitCode = r.ok ? 0 : 1));

module.exports = { main };
