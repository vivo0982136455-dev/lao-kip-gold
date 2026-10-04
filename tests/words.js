// The word files, checked without a browser. The texts of a language are in two files (audit 2026-10-02, P3-7):
//   i18n/<lang>/app.json      the shell and every page but the economy page - loaded with the first screen
//   i18n/<lang>/economy.json  what only the economy page names (two thirds of all texts) - loaded when it is opened
// Checks:
//   1. Thai and Lao have the same files, and every file the same keys; a key lives in one file only
//   2. a text has the same {placeholders} in both languages
//   3. no year is typed inside a text (audit 2026-10-02, P2-4): a year belongs to a fact, and a fact lives in the
//      data (data/invest-static.json or a fetched file) and reaches the sentence through a {placeholder} - a typed
//      year goes stale without anybody noticing. Checked: every year from 2015 to 2035, in both languages.
//      ALLOW lists the keys that may hold one, each with its reason (empty today).
//   4. every text the page code asks for by name (t.key) exists, and every family of names it builds
//      (t["prefix_" + id]) has at least one text
//   5. the right file: a text that the shell or any page other than the economy can reach is in app.json (it would
//      be missing on that page otherwise), and a text in app.json is named by one of them (else it only makes the
//      first screen slower: it belongs in economy.json)
//   6. no text that nothing names (not a page, not index.html, not a data file)
//   7. the index of the economy page (js/pages/eco-index.js): every heading it lists has a text, and the code of the
//      economy tabs still names it
// Usage: node tests/words.js
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");
const LANGS = ["th", "lo"];
const FILES = ["app", "economy"];
// page module -> the word files it has when it is drawn (the shell and every other page: app only)
const PAGE_FILES = { "js/pages/economy.js": ["app", "economy"] };
const read = (lang, file) => JSON.parse(fs.readFileSync(path.join(ROOT, "i18n", lang, file + ".json"), "utf8"));
const words = Object.fromEntries(LANGS.map((lang) => [lang, Object.fromEntries(FILES.map((f) => [f, read(lang, f)]))]));
const th = Object.assign({}, ...FILES.map((f) => words.th[f]));
const lo = Object.assign({}, ...FILES.map((f) => words.lo[f]));
const fileOf = new Map(FILES.flatMap((f) => Object.keys(words.th[f]).map((k) => [k, f])));

// key -> why a year may be typed in this text
const ALLOW = {};

// { a: "x", b: { c: "y" } } -> [["a", "x"], ["b.c", "y"]]
const flat = (obj, prefix = "") => Object.entries(obj).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, prefix + k + ".") : [[prefix + k, String(v)]]));
const holes = (s) => (s.match(/\{[a-z_0-9]+\}/g) || []).sort().join(" ");
// a year standing on its own: not a part of a longer number ("12026", "2026.5", "1,2026")
const YEAR = /(?<![\d.,])20(?:1[5-9]|2\d|3[0-5])(?![\d]|[.,]\d)/g;
const yearsIn = (s) => [...new Set(s.replace(/\{[a-z_0-9]+\}/g, "").match(YEAR) || [])];

const results = [];
const check = (name, problems) => results.push([name, problems]);

// the detector itself, on sentences with a known answer: a guard that finds nothing must not pass for that reason
const KNOWN = { "แผน 2026–2030": "2026 2030", "ปี {year} และ 2025": "2025", "(ตรวจ 1 ต.ค. 2026: เว็บ)": "2026", "ถึงปี 2026.": "2026", "22,026 กีบ": "", "ราคา 2026.50": "", "12026": "", "ปี 2014": "", "ปี 2036": "" };
check(
  "the year detector finds a typed year and leaves other numbers alone",
  Object.entries(KNOWN).filter(([text, want]) => yearsIn(text).join(" ") !== want).map(([text, want]) => `${JSON.stringify(text)}: found "${yearsIn(text).join(" ")}", expected "${want}"`)
);

const thFlat = new Map(flat(th));
const loFlat = new Map(flat(lo));

{
  const problems = [];
  for (const lang of LANGS) for (const f of fs.readdirSync(path.join(ROOT, "i18n", lang))) if (!FILES.includes(f.replace(/\.json$/, ""))) problems.push(`i18n/${lang}/${f}: a file this test does not know`);
  for (const f of fs.readdirSync(path.join(ROOT, "i18n"))) if (!LANGS.includes(f)) problems.push(`i18n/${f}: only the folders of the two languages belong here`);
  for (const f of FILES) {
    const a = new Map(flat(words.th[f]));
    const b = new Map(flat(words.lo[f]));
    for (const k of a.keys()) if (!b.has(k)) problems.push(`${f}.json: only in th: ${k}`);
    for (const k of b.keys()) if (!a.has(k)) problems.push(`${f}.json: only in lo: ${k}`);
  }
  for (const lang of LANGS) for (const k of Object.keys(words[lang].economy)) if (k in words[lang].app) problems.push(`${lang}: ${k} is in app.json and in economy.json`);
  check("Thai and Lao have the same files with the same keys; a key lives in one file", problems);
}
check(
  "a text has the same {placeholders} in both languages",
  [...thFlat].filter(([k, v]) => loFlat.has(k) && holes(v) !== holes(loFlat.get(k))).map(([k, v]) => `${k}: th [${holes(v)}] lo [${holes(loFlat.get(k))}]`)
);
check(
  "no year is typed inside a text (2015-2035)",
  [...thFlat].flatMap(([k, v]) => {
    if (ALLOW[k]) return [];
    const years = [...new Set([...yearsIn(v), ...yearsIn(loFlat.get(k) || "")])];
    return years.length ? [`${k}: ${years.join(", ")} - put the year into the data and name it with a {placeholder}`] : [];
  })
);
check(
  "the list of allowed keys names only keys that exist and still hold a year",
  Object.keys(ALLOW).filter((k) => !thFlat.has(k) || !(yearsIn(thFlat.get(k)).length || yearsIn(loFlat.get(k) || "").length)).map((k) => `${k}: not needed in ALLOW any more`)
);

// ---------- the texts the page code asks for ----------
const files = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".js")) files.push(path.relative(ROOT, p).replace(/\\/g, "/"));
  }
})(path.join(ROOT, "js"));
const keys = Object.keys(th);
const keySet = new Set(keys);
const source = new Map(files.map((f) => [f, fs.readFileSync(path.join(ROOT, f), "utf8")]));
const missing = new Map();
const families = new Map();
// file -> the texts it names: t.key, "key" as a string, and the families it builds: "prefix_" + x, `prefix_${x}`,
// x + "_suffix" (every text that starts or ends that way counts as named)
const named = new Map();
for (const [name, src] of source) {
  const note = (map, key) => (map.get(key) || map.set(key, new Set()).get(key)).add(name);
  // t.key / e.t.key / ctx.t.key ...
  for (const m of src.matchAll(/(?<![A-Za-z0-9_$.])(?:[a-z]+\.)?t\.([a-z][a-z0-9_]*)\b/g)) if (!(m[1] in th)) note(missing, m[1]);
  // t["prefix_" + id] and t[`prefix_${id}`]
  for (const m of src.matchAll(/\bt\[\s*["'`]([a-z0-9_]+)["'`]\s*\+/g)) note(families, m[1]);
  for (const m of src.matchAll(/\bt\[`([a-z0-9_]+)\$\{/g)) note(families, m[1]);

  const set = new Set();
  for (const m of src.matchAll(/(?<![A-Za-z0-9_$.])(?:[a-z]+\.)?t\.([a-z][a-z0-9_]*)\b/gi)) if (keySet.has(m[1])) set.add(m[1]);
  for (const m of src.matchAll(/["'`§]([a-z][a-z0-9_]*)["'`.]/g)) if (keySet.has(m[1])) set.add(m[1]);
  // ("eco_" + key inside localStorage.getItem( / setItem( is the name of a remembered choice, not the start of a text's name)
  const starts = [...src.matchAll(/(?<!Item\()["'`]([a-z][a-z0-9_]*_)["'`]\s*\+/g), ...src.matchAll(/`([a-z][a-z0-9_]*_)\$\{/g)].map((m) => m[1]);
  const ends = [...src.matchAll(/\+\s*["'`](_[a-z0-9_]+)["'`]/g), ...src.matchAll(/\}(_[a-z0-9_]+)`/g)].map((m) => m[1]);
  for (const k of keys) if (starts.some((p) => k.startsWith(p)) || ends.some((s) => k.endsWith(s))) set.add(k);
  named.set(name, set);
}
check("every text the page code names exists", [...missing].map(([k, where]) => `${k} (${[...where].join(", ")})`));
check(
  "every family of names the page code builds has texts",
  [...families].filter(([prefix]) => !keys.some((k) => k.startsWith(prefix))).map(([prefix, where]) => `${prefix}... (${[...where].join(", ")})`)
);

// ---------- which page can reach which text ----------
const imports = new Map(
  [...source].map(([name, src]) => [
    name,
    [...src.matchAll(/(?:import|export)\s[^;]*?from\s+["'](\.[^"']+)["']/g), ...src.matchAll(/import\(\s*["'](\.[^"']+)["']\s*\)/g)].map((m) => path.posix.normalize(path.posix.join(path.posix.dirname(name), m[1]))),
  ])
);
const reach = (starts) => {
  const seen = new Set();
  const todo = [...starts];
  while (todo.length) {
    const f = todo.pop();
    if (seen.has(f) || !source.has(f)) continue;
    seen.add(f);
    todo.push(...imports.get(f));
  }
  return seen;
};
// the pages = what js/app.js imports from js/pages/; the shell = app.js and everything else it imports
const pages = imports.get("js/app.js").filter((f) => f.startsWith("js/pages/"));
const shell = new Set(["js/app.js", ...reach(imports.get("js/app.js").filter((f) => !f.startsWith("js/pages/")))]);
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const inPage = new Set([...html.matchAll(/data-i18n(?:-[a-z]+)?="([a-z0-9_]+)"/g)].map((m) => m[1]));
// a data file can name a text (the label of a report): "some_key" as a value
const inData = new Set();
for (const f of fs.readdirSync(path.join(ROOT, "data"))) {
  if (!f.endsWith(".json")) continue;
  for (const m of fs.readFileSync(path.join(ROOT, "data", f), "utf8").matchAll(/"([a-z][a-z0-9]*_[a-z0-9_]*)"/g)) if (keySet.has(m[1])) inData.add(m[1]);
}
{
  const wrongFile = [];
  const usedByApp = new Set(inPage);
  const usedAtAll = new Set([...inPage, ...inData]);
  const users = [["the shell (js/app.js)", shell, ["app"]], ...pages.map((p) => [p, reach([p]), PAGE_FILES[p] || ["app"]])];
  for (const [who, reached, has] of users) {
    for (const f of reached) {
      for (const k of named.get(f)) {
        usedAtAll.add(k);
        if (has.length === 1) usedByApp.add(k);
        if (!has.includes(fileOf.get(k))) wrongFile.push(`${k} is in ${fileOf.get(k)}.json, but ${f} names it and ${who} can reach that file: move the text to app.json`);
      }
    }
  }
  for (const k of Object.keys(words.th.app)) if (usedAtAll.has(k) && !usedByApp.has(k) && !inData.has(k)) wrongFile.push(`${k} is in app.json, but only the economy page names it: move the text to economy.json`);
  check(`the right file: app.json ${Object.keys(words.th.app).length} texts for the first screen, economy.json ${Object.keys(words.th.economy).length} for the economy page`, [...new Set(wrongFile)]);
  check("no text that nothing names", keys.filter((k) => !usedAtAll.has(k)).map((k) => `${k} (${fileOf.get(k)}.json): no page, not index.html and no data file names it - remove it`));
}

let failed = 0;
const finish = () => {
  for (const [name, problems] of results) {
    if (problems.length) failed++;
    console.log(`${problems.length ? "FAIL" : "PASS"}  ${name}${problems.length ? "\n      " + problems.slice(0, 25).join("\n      ") + (problems.length > 25 ? `\n      ... and ${problems.length - 25} more` : "") : ""}`);
  }
  console.log(`\n${thFlat.size} texts per language, ${files.length} page files · ${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
};

// ---------- the index of the economy page ----------
import(pathToFileURL(path.join(ROOT, "js", "pages", "eco-index.js")).href)
  .then((index) => {
    const problems = [];
    // what the code of the economy tabs names (the index itself does not count)
    const tabCode = new Set([...reach(["js/pages/economy.js"])].filter((f) => f !== "js/pages/eco-index.js").flatMap((f) => [...named.get(f)]));
    for (const lang of LANGS) {
      const t = lang === "th" ? th : lo;
      for (const h of index.allHeads(t)) {
        if (!h.title) problems.push(`${lang}: ${h.tab}: "${h.key}" has no text`);
        else if (lang === "th" && !tabCode.has(h.key.split(".")[0])) problems.push(`${h.tab}: "${h.key}" is listed, but the code of the tabs does not name it any more`);
      }
    }
    for (const tab of Object.keys(index.TAB_HEADS)) if (!th["inv_tab_" + tab] || !lo["inv_tab_" + tab]) problems.push(`the tab "${tab}" has no name`);
    check(`the index of the economy page: ${index.allHeads(th).length} headings, each with a text and still named by the code of its tab`, problems);
  })
  .catch((e) => check("the index of the economy page can be read", [e.message]))
  .then(finish);
