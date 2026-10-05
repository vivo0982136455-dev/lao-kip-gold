// Read the tables of an Excel workbook (.xlsx = a zip of XML files) - only what the statistics files of the Bank
// of the Lao PDR need: text and number cells of a sheet, and their "one indicator per row, one period per column"
// layout (the bank publishes the files it reports to the IMF: a row "Country code | Descriptor | ALT_Descriptor |
// INDICATOR | 2015-01 | 2015-02 ..." and below it one row per series, its code in column A).
// No packages: scripts/lib/zip.js unpacks, the XML is read with patterns.
const { unpack } = require("./zip");

const unescapeXml = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, "&");

// buffer of the .xlsx -> { names: [sheet names in the workbook's order], rows(n): rows of sheet n (from 1) }
// A row is a Map: column letters -> cell text (numbers as the text the file holds; empty cells are absent).
function workbook(buffer) {
  const xml = (name) => unpack(buffer, (n) => n === name).toString("utf8");
  let strings = [];
  try {
    strings = [...xml("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unescapeXml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join("")));
  } catch {
    /* a workbook without texts */
  }
  const names = [...xml("xl/workbook.xml").matchAll(/<sheet [^>]*?name="([^"]*)"/g)].map((m) => unescapeXml(m[1]));
  const rows = (n) => {
    const out = [];
    for (const m of xml(`xl/worksheets/sheet${n}.xml`).matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = new Map();
      for (const c of m[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const v = /<v>([\s\S]*?)<\/v>/.exec(c[3] || "");
        const inline = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(c[3] || "");
        if (v) cells.set(c[1], /t="s"/.test(c[2]) ? strings[Number(v[1])] : unescapeXml(v[1]));
        else if (inline) cells.set(c[1], unescapeXml(inline[1]));
      }
      if (cells.size) out.push(cells);
    }
    return out;
  };
  return { names, rows };
}

// The rows of one sheet -> { periods: [...], byCode: Map(code -> Map(period -> number)), byName: Map(name -> ...) }
// period = a column whose heading matches `periodPattern` (e.g. /^\d{4}-\d{2}$/ for months, /^\d{4}-Q[1-4]$/).
// A series is found by its code (column A) and by its English name (column B, spaces tidied): a few rows of the
// bank's files carry no code. A cell that is not a number is left out.
function periodTable(rows, periodPattern, what) {
  let head = null;
  const byCode = new Map();
  const byName = new Map();
  const tidy = (s) => String(s || "").replace(/\s+/g, " ").trim();
  for (const cells of rows) {
    if (!head) {
      if ([...cells.values()].some((v) => tidy(v) === "INDICATOR")) head = new Map([...cells].filter(([, text]) => periodPattern.test(tidy(text))).map(([col, text]) => [col, tidy(text)]));
      continue;
    }
    const values = new Map();
    for (const [col, period] of head) {
      const text = cells.get(col);
      if (text === undefined || tidy(text) === "") continue;
      const v = Number(text);
      if (Number.isFinite(v)) values.set(period, v);
    }
    if (!values.size) continue;
    const code = tidy(cells.get("A"));
    const name = tidy(cells.get("B"));
    if (code && !byCode.has(code)) byCode.set(code, values);
    if (name && !byName.has(name)) byName.set(name, values);
  }
  if (!head || !head.size) throw new Error(`${what}: no heading row with "INDICATOR" and periods`);
  return { periods: [...head.values()], byCode, byName };
}

module.exports = { workbook, periodTable };
