// Keep the <link rel="modulepreload"> lines of index.html in step with the files in js/.
// Why: without these lines the browser finds the modules one level at a time (app.js -> pages -> their helpers),
// one network round trip per level. With them every module is asked for at once - the app opens faster on a phone.
// Usage: node scripts/update-preload.js          (run it after adding, renaming or removing a file in js/)
//        node scripts/update-preload.js check    (only says whether index.html is up to date; exit code 1 if not)
// A missing line is not an error on the site: that module just loads a little later.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PAGE = path.join(ROOT, "index.html");
const START = "  <!-- modulepreload:start";
const END = "  <!-- modulepreload:end -->\n";
const ANCHOR = '  <script type="module" src="js/app.js"></script>\n';

// Every module reached from js/app.js through "import ... from './x.js'", with its distance from app.js
function modules() {
  const seen = new Map();
  const queue = [["js/app.js", 0]];
  while (queue.length) {
    const [file, depth] = queue.shift();
    if (seen.has(file)) continue;
    seen.set(file, depth);
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    for (const m of src.matchAll(/(?:import|export)\s[^"']*?from\s+["'](\.[^"']+)["']|import\s+["'](\.[^"']+)["']/g)) {
      queue.push([path.posix.join(path.posix.dirname(file), m[1] || m[2]), depth + 1]);
    }
  }
  return [...seen].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([file]) => file);
}

function block(list) {
  return (
    START +
    " - every module of the app is asked for at once. Without these lines the browser finds the modules\n" +
    "       one level at a time (app.js -> pages -> their helpers), one network round trip per level.\n" +
    "       Made by scripts/update-preload.js - run it after adding or removing a file in js/. -->\n" +
    list.map((file) => `  <link rel="modulepreload" href="${file}">\n`).join("") +
    END
  );
}

const list = modules();
const html = fs.readFileSync(PAGE, "utf8");
let next;
if (html.includes(START) && html.includes(END)) next = html.slice(0, html.indexOf(START)) + block(list) + html.slice(html.indexOf(END) + END.length);
else if (html.split(ANCHOR).length === 2) next = html.replace(ANCHOR, () => block(list) + ANCHOR);
else throw new Error("index.html: the app.js script line was not found");

if (process.argv[2] === "check") {
  if (next === html) console.log(`index.html is up to date (${list.length} modules).`);
  else {
    console.log("index.html is NOT up to date: run  node scripts/update-preload.js");
    process.exit(1);
  }
} else if (next === html) console.log(`Nothing to change (${list.length} modules).`);
else {
  fs.writeFileSync(PAGE, next);
  console.log(`index.html: ${list.length} modulepreload lines written.`);
}
