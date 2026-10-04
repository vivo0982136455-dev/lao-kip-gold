// The two word files (i18n/th.json, i18n/lo.json), checked without a browser:
//   1. both languages have exactly the same keys
//   2. a text has the same {placeholders} in both languages
//   3. no year is typed inside a text (audit 2026-10-02, P2-4): a year belongs to a fact, and a fact lives in the
//      data (data/invest-static.json or a fetched file) and reaches the sentence through a {placeholder} - a typed
//      year goes stale without anybody noticing. Checked: every year from 2015 to 2035, in both languages.
//      ALLOW lists the keys that may hold one, each with its reason (empty today).
//   4. every text the page code asks for by name (t.key) exists, and every family of names it builds
//      (t["prefix_" + id]) has at least one text
// Usage: node tests/words.js
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (lang) => JSON.parse(fs.readFileSync(path.join(ROOT, "i18n", lang + ".json"), "utf8"));
const th = read("th");
const lo = read("lo");

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

check(
  "Thai and Lao have the same keys",
  [...[...thFlat.keys()].filter((k) => !loFlat.has(k)).map((k) => `only in th: ${k}`), ...[...loFlat.keys()].filter((k) => !thFlat.has(k)).map((k) => `only in lo: ${k}`)]
);
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
    else if (p.endsWith(".js")) files.push(p);
  }
})(path.join(ROOT, "js"));
const missing = new Map();
const families = new Map();
for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  const name = path.relative(ROOT, file).replace(/\\/g, "/");
  const note = (map, key) => (map.get(key) || map.set(key, new Set()).get(key)).add(name);
  // t.key / e.t.key / ctx.t.key ...
  for (const m of src.matchAll(/(?<![A-Za-z0-9_$.])(?:[a-z]+\.)?t\.([a-z][a-z0-9_]*)\b/g)) if (!(m[1] in th)) note(missing, m[1]);
  // t["prefix_" + id] and t[`prefix_${id}`]
  for (const m of src.matchAll(/\bt\[\s*["'`]([a-z0-9_]+)["'`]\s*\+/g)) note(families, m[1]);
  for (const m of src.matchAll(/\bt\[`([a-z0-9_]+)\$\{/g)) note(families, m[1]);
}
check("every text the page code names exists", [...missing].map(([k, where]) => `${k} (${[...where].join(", ")})`));
check(
  "every family of names the page code builds has texts",
  [...families].filter(([prefix]) => !Object.keys(th).some((k) => k.startsWith(prefix))).map(([prefix, where]) => `${prefix}... (${[...where].join(", ")})`)
);

let failed = 0;
for (const [name, problems] of results) {
  if (problems.length) failed++;
  console.log(`${problems.length ? "FAIL" : "PASS"}  ${name}${problems.length ? "\n      " + problems.slice(0, 25).join("\n      ") + (problems.length > 25 ? `\n      ... and ${problems.length - 25} more` : "") : ""}`);
}
console.log(`\n${thFlat.size} texts per language, ${files.length} page files · ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
