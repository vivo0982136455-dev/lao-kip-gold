// Lint without packages: the mistakes that only showed up minutes later in a browser test (or not at all).
//   1. syntax        every script of the site (js/: ES modules), of the fetchers (scripts/) and of the tests parses
//   2. imports       an import names a file that exists and a name that file exports; no import is left unused
//   3. names         no name is used that the file neither declares nor imports (a helper called without its import)
//   0. itself        the name checks, on pieces of code with a known answer (a check that finds nothing must not
//                    pass for that reason)
//   4. dead code     no top-level function or constant that nothing uses and nothing exports; no export of the site
//                    that no other file mentions
//   5. styles        every var(--x) is defined; the text colours keep a contrast of 4.5:1 on the surfaces they sit on,
//                    in both themes; no sentence text (notes, sources, dates) below 0.8rem - only the short labels listed
//                    in SMALL_OK may be smaller
//   6. series        every yearly / monthly series the fetchers store is used by a page (or listed in KEPT with the reason)
//   7. page          index.html preloads every module (scripts/update-preload.js check); a workflow runs only scripts that exist
// The name checks read the source with a small tokenizer (strings, templates, comments and regular expressions are
// skipped); they know one scope per file, which is enough for "never declared anywhere in this file".
// Usage: node scripts/lint.js      (a few seconds; the first step of tests/all.js)
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
function walk(dir, out = []) {
  for (const f of fs.readdirSync(path.join(ROOT, dir))) {
    const p = dir + "/" + f;
    if (fs.statSync(path.join(ROOT, p)).isDirectory()) {
      if (f !== "shots" && f !== "node_modules") walk(p, out);
    } else if (f.endsWith(".js")) out.push(p);
  }
  return out;
}

const results = [];
const check = (name, problems) => results.push([name, problems]);

// ---------- tokenizer ----------
const KEYWORDS = new Set(
  "break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new return static super switch this throw try typeof var void while with yield await async of get set static from as null true false undefined NaN Infinity".split(" ")
);
// words that are only sometimes keywords: a function or a method may carry one of them as its name
const CONTEXTUAL = new Set("get set static async of from as".split(" "));
// after one of these a "/" starts a regular expression, not a division
const REGEX_AFTER_WORD = new Set("return typeof case in of delete void throw new else do instanceof yield await".split(" "));
const PUNCT3 = ["...", "===", "!==", "**=", "<<=", ">>=", "&&=", "||=", "??="];
const PUNCT2 = ["=>", "?.", "??", "==", "!=", "<=", ">=", "&&", "||", "++", "--", "+=", "-=", "*=", "/=", "%=", "**", "<<", ">>", "|=", "&=", "^="];

// source -> [{ t: "id" | "kw" | "num" | "str" | "re" | "p", v }]   (the code inside `${...}` of a template is tokenized too)
function tokenize(src, file) {
  const out = [];
  let i = 0;
  const n = src.length;
  const fail = (what) => {
    throw new Error(`${file}: ${what} near line ${src.slice(0, i).split("\n").length}`);
  };
  const regexAllowed = () => {
    const last = out[out.length - 1];
    if (!last) return true;
    if (last.t === "kw") return REGEX_AFTER_WORD.has(last.v);
    if (last.t === "p") return ![")", "]", "}"].includes(last.v);
    return false; // after a name, a number, a string: a division
  };
  function template() {
    // src[i] is the opening backtick
    i++;
    for (;;) {
      if (i >= n) fail("template without an end");
      const ch = src[i];
      if (ch === "\\") i += 2;
      else if (ch === "`") {
        i++;
        return;
      } else if (ch === "$" && src[i + 1] === "{") {
        i += 2;
        out.push({ t: "p", v: "${" });
        code("}");
        out.push({ t: "p", v: "}$" });
      } else i++;
    }
  }
  // until: the closing "}" of a `${`, or null for the whole file
  function code(until) {
    let depth = 0;
    while (i < n) {
      const ch = src[i];
      if (/\s/.test(ch)) {
        i++;
        continue;
      }
      if (ch === "/" && src[i + 1] === "/") {
        while (i < n && src[i] !== "\n") i++;
        continue;
      }
      if (ch === "/" && src[i + 1] === "*") {
        const end = src.indexOf("*/", i + 2);
        if (end < 0) fail("comment without an end");
        i = end + 2;
        continue;
      }
      if (ch === '"' || ch === "'") {
        const start = i++;
        while (i < n && src[i] !== ch) {
          if (src[i] === "\\") i++;
          if (src[i] === "\n") fail("string without an end");
          i++;
        }
        i++;
        out.push({ t: "str", v: src.slice(start + 1, i - 1) });
        continue;
      }
      if (ch === "`") {
        const at = out.length;
        const start = i;
        template();
        out.splice(at, 0, { t: "str", v: src.slice(start + 1, i - 1), tpl: true });
        continue;
      }
      if (ch === "/" && regexAllowed()) {
        const start = i++;
        let inClass = false;
        for (;;) {
          if (i >= n || src[i] === "\n") fail("regular expression without an end");
          if (src[i] === "\\") i++;
          else if (src[i] === "[") inClass = true;
          else if (src[i] === "]") inClass = false;
          else if (src[i] === "/" && !inClass) break;
          i++;
        }
        i++;
        while (i < n && /[a-z]/.test(src[i])) i++;
        out.push({ t: "re", v: src.slice(start, i) });
        continue;
      }
      if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] || ""))) {
        const start = i;
        while (i < n && /[0-9a-zA-Z_.]/.test(src[i])) {
          if ((src[i] === "e" || src[i] === "E") && /[+-]/.test(src[i + 1] || "") && !/^0x/i.test(src.slice(start, i))) i++;
          i++;
        }
        out.push({ t: "num", v: src.slice(start, i) });
        continue;
      }
      if (/[A-Za-z_$]/.test(ch)) {
        const start = i;
        while (i < n && /[A-Za-z0-9_$]/.test(src[i])) i++;
        const v = src.slice(start, i);
        out.push({ t: KEYWORDS.has(v) ? "kw" : "id", v });
        continue;
      }
      if (ch === "#" && /[A-Za-z_]/.test(src[i + 1] || "")) {
        i++; // a private field: its name follows
        continue;
      }
      if (until && ch === "}" && depth === 0) {
        i++;
        return;
      }
      if (ch === "{") depth++;
      if (ch === "}") depth--;
      const three = src.slice(i, i + 3);
      const two = src.slice(i, i + 2);
      const v = PUNCT3.includes(three) ? three : PUNCT2.includes(two) ? two : ch;
      i += v.length;
      out.push({ t: "p", v });
    }
    if (until) fail("${ without an end");
  }
  code(null);
  return out;
}

// ---------- names of one file ----------
const BROWSER = "window document navigator location history localStorage sessionStorage console fetch performance caches self globalThis Chart Tesseract Image Blob File FileReader FormData Response Request Headers URL URLSearchParams AbortController AbortSignal crypto TextEncoder TextDecoder Node Event CustomEvent HTMLElement Element getComputedStyle matchMedia alert confirm prompt structuredClone requestAnimationFrame cancelAnimationFrame requestIdleCallback setTimeout clearTimeout setInterval clearInterval queueMicrotask IntersectionObserver ResizeObserver MutationObserver innerWidth innerHeight scrollTo scrollY scrollX devicePixelRatio createImageBitmap OffscreenCanvas Worker ServiceWorker Notification DOMParser XMLSerializer CSS";
const LANGUAGE = "Object Array String Number Boolean Symbol BigInt Math JSON Date RegExp Error TypeError RangeError SyntaxError Map Set WeakMap WeakSet Promise Proxy Reflect Intl parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent encodeURI decodeURI escape unescape btoa atob Uint8Array Uint16Array Uint32Array Int8Array Int16Array Int32Array Float32Array Float64Array ArrayBuffer SharedArrayBuffer DataView Atomics arguments eval WebAssembly";
const NODE = "require module exports process __dirname __filename Buffer global setImmediate clearImmediate";
const GLOBALS = { browser: new Set(`${BROWSER} ${LANGUAGE}`.split(" ")), node: new Set(`${NODE} ${LANGUAGE} console fetch URL URLSearchParams AbortController AbortSignal setTimeout clearTimeout setInterval clearInterval performance TextEncoder TextDecoder structuredClone queueMicrotask Blob Response Request Headers crypto globalThis WebSocket`.split(" ")) };

// { declared: Map name -> "import" | "top" | "inner", used: Map name -> count, imports: [{ from, names: [[imported, local]] }], exports: Set }
function analyse(tokens) {
  const declared = new Map();
  const used = new Map();
  const imports = [];
  const exports = new Set();
  let reexportAll = false;
  const declare = (name, kind) => {
    if (!declared.has(name) || kind === "import") declared.set(name, kind);
  };
  const use = (name) => used.set(name, (used.get(name) || 0) + 1);
  const closing = { "(": ")", "[": "]", "{": "}", "${": "}$" };
  // index of the bracket that closes the one at index a
  const matchOf = (a) => {
    const open = tokens[a].v;
    let depth = 0;
    for (let k = a; k < tokens.length; k++) {
      const tk = tokens[k];
      if (tk.t !== "p") continue;
      if (tk.v === "(" || tk.v === "[" || tk.v === "{" || tk.v === "${") depth++;
      else if (tk.v === ")" || tk.v === "]" || tk.v === "}" || tk.v === "}$") {
        depth--;
        if (depth === 0) return tk.v === closing[open] ? k : -1;
      }
    }
    return -1;
  };
  // index of the bracket that opens the one closed at index b
  const openOf = (b) => {
    let depth = 0;
    for (let k = b; k >= 0; k--) {
      const tk = tokens[k];
      if (tk.t !== "p") continue;
      if (tk.v === ")" || tk.v === "]" || tk.v === "}" || tk.v === "}$") depth++;
      else if (tk.v === "(" || tk.v === "[" || tk.v === "{" || tk.v === "${") {
        depth--;
        if (depth === 0) return k;
      }
    }
    return -1;
  };
  const is = (k, t, v) => tokens[k] && tokens[k].t === t && (v === undefined || tokens[k].v === v);
  const p = (k, v) => is(k, "p", v);
  const kw = (k, v) => is(k, "kw", v);
  const skip = new Set(); // token indexes that are not uses (names in a declaration, keys, parameters)
  // The names a parameter list or a destructuring pattern binds (the tokens from..to, between its brackets). A name
  // is bound unless it is a key ("key: name") or part of a default value ("= expression", up to the next "," of the
  // same depth) - a default value is an ordinary expression, and what it names is used, not declared.
  const bindAll = (from, to, kind) => {
    let depth = 0;
    let valueAt = null; // the depth at which a default value started
    for (let k = from; k <= to; k++) {
      const tk = tokens[k];
      if (tk.t === "p") {
        if (tk.v === "(" || tk.v === "[" || tk.v === "{" || tk.v === "${") depth++;
        else if (tk.v === ")" || tk.v === "]" || tk.v === "}" || tk.v === "}$") {
          depth--;
          if (valueAt !== null && depth < valueAt) valueAt = null;
        } else if (tk.v === "=" && valueAt === null) valueAt = depth;
        else if (tk.v === "," && valueAt !== null && depth === valueAt) valueAt = null;
        continue;
      }
      if (tk.t !== "id" || valueAt !== null) continue;
      if (p(k - 1, ".") || p(k - 1, "?.")) continue;
      skip.add(k);
      if (!p(k + 1, ":")) declare(tk.v, kind); // "key: name" - the key is not bound
    }
  };
  // a name, or one of the words that are only sometimes keywords, used as a name
  const nameAt = (k) => is(k, "id") || (tokens[k] && tokens[k].t === "kw" && CONTEXTUAL.has(tokens[k].v) && p(k + 1, "("));
  // depth of { ( [ at every token, to tell the top level of the file
  const depthAt = [];
  let d = 0;
  for (let k = 0; k < tokens.length; k++) {
    const tk = tokens[k];
    if (tk.t === "p" && (tk.v === ")" || tk.v === "]" || tk.v === "}" || tk.v === "}$")) d--;
    depthAt.push(d);
    if (tk.t === "p" && (tk.v === "(" || tk.v === "[" || tk.v === "{" || tk.v === "${")) d++;
  }

  for (let k = 0; k < tokens.length; k++) {
    const tk = tokens[k];
    // ----- import -----
    if (kw(k, "import") && !p(k + 1, "(") && !p(k + 1, ".")) {
      let j = k + 1;
      const names = [];
      if (is(j, "str")) {
        imports.push({ from: tokens[j].v, names });
        k = j;
        continue;
      }
      if (is(j, "id")) {
        names.push(["default", tokens[j].v]);
        declare(tokens[j].v, "import");
        skip.add(j);
        j++;
        if (p(j, ",")) j++;
      }
      if (p(j, "*") && tokens[j + 1] && tokens[j + 1].v === "as") {
        names.push(["*", tokens[j + 2].v]);
        declare(tokens[j + 2].v, "import");
        skip.add(j + 2);
        j += 3;
      }
      if (p(j, "{")) {
        const end = matchOf(j);
        for (let m = j + 1; m < end; m++) {
          if (!is(m, "id") && !kw(m, "default")) continue;
          const imported = tokens[m].v;
          let local = imported;
          skip.add(m);
          if (tokens[m + 1] && tokens[m + 1].v === "as") {
            local = tokens[m + 2].v;
            skip.add(m + 2);
            m += 2;
          }
          names.push([imported, local]);
          declare(local, "import");
        }
        j = end + 1;
      }
      if (tokens[j] && tokens[j].v === "from" && is(j + 1, "str")) imports.push({ from: tokens[j + 1].v, names });
      k = j + 1;
      continue;
    }
    // ----- export -----
    if (kw(k, "export")) {
      if (p(k + 1, "*")) {
        reexportAll = true;
        continue;
      }
      if (p(k + 1, "{")) {
        const end = matchOf(k + 1);
        const from = tokens[end + 1] && tokens[end + 1].v === "from";
        for (let m = k + 2; m < end; m++) {
          if (!is(m, "id") && !kw(m, "default")) continue;
          let name = tokens[m].v;
          if (from) skip.add(m);
          if (tokens[m + 1] && tokens[m + 1].v === "as") {
            name = tokens[m + 2].v;
            skip.add(m + 2);
            m += 2;
          }
          exports.add(name);
        }
        continue;
      }
      if (kw(k + 1, "default")) {
        exports.add("default");
        continue;
      }
      // export function / const / class: the name is found by the declaration below; remember that it is exported
      let m = k + 1;
      if (kw(m, "async")) m++;
      if (kw(m, "function")) {
        if (p(m + 1, "*")) m++;
        if (is(m + 1, "id")) exports.add(tokens[m + 1].v);
      } else if (kw(m, "class") && is(m + 1, "id")) exports.add(tokens[m + 1].v);
      else if (kw(m, "const") || kw(m, "let") || kw(m, "var")) {
        if (is(m + 1, "id")) exports.add(tokens[m + 1].v);
        else if (p(m + 1, "{") || p(m + 1, "[")) for (let q = m + 2; q < matchOf(m + 1); q++) if (is(q, "id")) exports.add(tokens[q].v);
      }
      continue;
    }
    // ----- function name(params) / function (params) -----
    if (kw(k, "function")) {
      let j = k + 1;
      if (p(j, "*")) j++;
      if (nameAt(j)) {
        if (is(j, "id")) declare(tokens[j].v, depthAt[k] === 0 ? "top" : "inner");
        skip.add(j);
        j++;
      }
      if (p(j, "(")) bindAll(j + 1, matchOf(j) - 1, "inner");
      continue;
    }
    if (kw(k, "class") && is(k + 1, "id")) {
      declare(tokens[k + 1].v, depthAt[k] === 0 ? "top" : "inner");
      skip.add(k + 1);
      continue;
    }
    if (kw(k, "catch") && p(k + 1, "(")) {
      bindAll(k + 2, matchOf(k + 1) - 1, "inner");
      continue;
    }
    // ----- const / let / var: every declarator of the statement -----
    if (kw(k, "const") || kw(k, "let") || kw(k, "var")) {
      const kind = depthAt[k] === 0 ? "top" : "inner";
      let j = k + 1;
      for (;;) {
        if (is(j, "id")) {
          declare(tokens[j].v, kind);
          skip.add(j);
          j++;
        } else if (p(j, "{") || p(j, "[")) {
          const end = matchOf(j);
          bindAll(j + 1, end - 1, kind);
          j = end + 1;
        } else break;
        if (p(j, ",")) {
          j++; // "let y, m, d;" - no initializer, the next declarator follows
          continue;
        }
        // the initializer: up to a "," at the depth of the declaration (next declarator) or the end of the statement
        if (!p(j, "=")) break;
        let m = j + 1;
        const base = depthAt[j];
        while (m < tokens.length && !(depthAt[m] === base && (p(m, ",") || p(m, ";"))) && depthAt[m] >= base) m++;
        if (p(m, ",") && depthAt[m] === base) j = m + 1;
        else break;
      }
      continue;
    }
    // ----- arrow functions: x => ... and (params) => ... -----
    if (p(k, "=>")) {
      if (is(k - 1, "id")) {
        declare(tokens[k - 1].v, "inner");
        skip.add(k - 1);
      } else if (p(k - 1, ")")) {
        const open = openOf(k - 1);
        if (open >= 0) bindAll(open + 1, k - 2, "inner");
      }
      continue;
    }
    // ----- method(params) { ... } in a class or an object: the name is a key, the parameters are declared -----
    if (nameAt(k) && p(k + 1, "(") && !p(k - 1, ".") && !p(k - 1, "?.") && !kw(k - 1, "function") && !kw(k - 1, "new")) {
      const end = matchOf(k + 1);
      if (end > 0 && p(end + 1, "{")) {
        skip.add(k);
        bindAll(k + 2, end - 1, "inner");
      }
    }
  }

  // uses: every name that is not a declaration, not a property (.name), and not the key of an object ("name:")
  const ternary = []; // open "?" per bracket depth
  for (let k = 0; k < tokens.length; k++) {
    const tk = tokens[k];
    const depth = depthAt[k];
    if (tk.t === "p" && tk.v === "?") ternary[depth] = (ternary[depth] || 0) + 1;
    if (tk.t === "p" && tk.v === ":" && ternary[depth] > 0) ternary[depth]--;
    if (tk.t === "p" && (tk.v === ";" || tk.v === ",")) ternary[depth] = ternary[depth] || 0;
    if (tk.t !== "id" || skip.has(k)) continue;
    if (p(k - 1, ".") || p(k - 1, "?.")) continue;
    if (p(k + 1, ":") && !(ternary[depth] > 0) && !kw(k - 1, "case")) continue; // a key (or a label)
    use(tk.v);
  }
  return { declared, used, imports, exports, reexportAll };
}

// every word of a file: its names (properties too) and the words inside its strings - "is this name mentioned at all?"
function wordsOf(tokens) {
  const words = new Set();
  for (const tk of tokens) {
    if (tk.t === "id" || tk.t === "kw") words.add(tk.v);
    else if (tk.t === "str") for (const w of tk.v.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || []) words.add(w);
  }
  return words;
}

// ---------- 0. the lint itself, on code with a known answer ----------
// A check that finds nothing must not pass for that reason: every rule is tried on a line that breaks it and on
// lines that look alike and are fine.
{
  const KNOWN = [
    // [code, names used without a declaration, imports and top-level names never used]
    ['import { a, b as c } from "./x.js";\nc(a);', "", ""],
    ['import { a, b } from "./x.js";\na();', "", "b"],
    ['import { a } from "./x.js";\nhelper(a);', "helper", ""],
    ["const LIMIT = 5;\nfunction f(n = LIMIT) { return n; }\nf();", "", ""],
    ["const UNUSED = 5;\nfunction f(n) { return n; }\nf(1);", "", "UNUSED"],
    ["let y, m, d;\n[, y, m, d] = String(1).split(\"-\");\nconsole.log(y, m, d);", "", ""],
    ["const { a, b: { c }, ...rest } = window;\nconsole.log(a, c, rest, b);", "b", ""],
    ["const o = { key: 1, get(k, fallback) { return k ? fallback : missing; } };\nconsole.log(o);", "missing", ""],
    ["const pick = (x) => (x ? one : two);\nconsole.log(pick);", "one two", ""],
    ["const o = { a: x ? y : z, b: 2 };\nconsole.log(o);", "x y z", ""],
    ["const s = `${first} and ${`${second}`} / not a regex`;\nconsole.log(s);", "first second", ""],
    ["const r = /[/\"'`]+/g.test(\"a\") ? 1 / 2 : total / count;\nconsole.log(r);", "total count", ""],
    ["for (const [k, v] of Object.entries({})) console.log(k, v, other);", "other", ""],
    ["try { run(); } catch (err) { console.log(err); }\nfunction run() {}", "", ""],
    ["export function shown() {}\nfunction hidden() {}\nexport const kept = 1;", "", "hidden"],
    ["switch (kind) { case FIRST: break; default: }", "kind FIRST", ""],
    ["class A { go(x) { return x + this.y; } }\nconsole.log(new A());", "", ""],
    ["const a = 1, b = a + 1;\nconsole.log(b); // helper(a) in a comment, 'helper(a)' in a string", "", ""],
  ];
  const problems = [];
  for (const [code, wantUnknown, wantUnused] of KNOWN) {
    let got;
    try {
      const a = analyse(tokenize(code, "known code"));
      const unknown = [...a.used.keys()].filter((n) => !a.declared.has(n) && !GLOBALS.browser.has(n));
      const unused = [...a.declared].filter(([n, kind]) => (kind === "import" || kind === "top") && !a.used.get(n) && !a.exports.has(n)).map(([n]) => n);
      got = [unknown.join(" "), unused.join(" ")];
    } catch (e) {
      got = ["error: " + e.message, ""];
    }
    if (got[0] !== wantUnknown || got[1] !== wantUnused) problems.push(`${JSON.stringify(code)}: unknown "${got[0]}" (expected "${wantUnknown}"), unused "${got[1]}" (expected "${wantUnused}")`);
  }
  check(`the lint itself: ${KNOWN.length} pieces of code with a known answer`, problems);
}

// ---------- 1. syntax ----------
const siteModules = walk("js").filter((f) => f !== "js/chart-backup.js");
const classic = ["sw.js", "js/chart-backup.js", ...walk("scripts"), ...walk("tests")];
{
  const problems = [];
  for (const file of siteModules) {
    const r = spawnSync(process.execPath, ["--input-type=module", "--check"], { input: read(file), encoding: "utf8" });
    if (r.status !== 0) problems.push(`${file}: ${(r.stderr || "").split("\n").filter((l) => /Error/.test(l))[0] || "does not parse"} (line ${((r.stderr || "").match(/\[stdin\]:(\d+)/) || [])[1] || "?"})`);
  }
  for (const file of classic) {
    const r = spawnSync(process.execPath, ["--check", path.join(ROOT, file)], { encoding: "utf8" });
    if (r.status !== 0) problems.push(`${file}: ${(r.stderr || "").split("\n").filter((l) => /Error/.test(l))[0] || "does not parse"}`);
  }
  check(`syntax: ${siteModules.length} modules of the site, ${classic.length} other scripts`, problems);
}

// ---------- 2-4. imports, names, dead code ----------
const info = new Map();
const words = new Map();
{
  const broken = [];
  for (const file of [...siteModules, ...classic]) {
    try {
      const tokens = tokenize(read(file), file);
      info.set(file, analyse(tokens));
      words.set(file, wordsOf(tokens));
    } catch (e) {
      broken.push(e.message);
    }
  }
  check("every script can be read by the tokenizer of this lint", broken);

  const importProblems = [];
  const unusedImports = [];
  for (const file of siteModules) {
    const a = info.get(file);
    if (!a) continue;
    for (const imp of a.imports) {
      if (!imp.from.startsWith(".")) {
        importProblems.push(`${file}: imports "${imp.from}" - only files of this site can be imported`);
        continue;
      }
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), imp.from));
      const b = info.get(target);
      if (!b) {
        importProblems.push(`${file}: imports ${imp.from}, which does not exist`);
        continue;
      }
      for (const [imported, local] of imp.names) {
        if (imported !== "*" && !b.exports.has(imported) && !b.reexportAll) importProblems.push(`${file}: imports { ${imported} } from ${imp.from}, which does not export it`);
        if (!a.used.get(local)) unusedImports.push(`${file}: imports ${local} from ${imp.from} and never uses it`);
      }
    }
  }
  check("imports: every imported file exists and exports the names asked for", importProblems);
  check("imports: none is left unused", unusedImports);

  const unknown = [];
  const dead = [];
  for (const file of [...siteModules, ...classic]) {
    const a = info.get(file);
    if (!a) continue;
    const globals = siteModules.includes(file) || file === "sw.js" || file === "js/chart-backup.js" ? GLOBALS.browser : GLOBALS.node;
    for (const name of a.used.keys()) if (!a.declared.has(name) && !globals.has(name)) unknown.push(`${file}: "${name}" is used, but the file neither declares nor imports it`);
    for (const [name, kind] of a.declared) if (kind === "top" && !a.used.get(name) && !a.exports.has(name)) dead.push(`${file}: "${name}" is declared and never used`);
  }
  // an export of the site that no other file mentions (not a page, not a test) and that its own file does not use
  for (const file of siteModules) {
    const a = info.get(file);
    if (!a) continue;
    for (const name of a.exports) {
      if (name === "default" || a.used.get(name)) continue;
      const elsewhere = [...words].some(([other, set]) => other !== file && set.has(name));
      if (!elsewhere) dead.push(`${file}: exports "${name}", which nothing uses`);
    }
  }
  check("names: nothing is used that the file neither declares nor imports", unknown);
  check("dead code: no top-level name without a use, no export that nothing uses", dead);
}

// ---------- 5. styles ----------
// css text -> [{ selector, media, decl: Map }]   (@keyframes and the like are skipped)
function cssRules(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  const block = (from, to, media) => {
    let i = from;
    while (i < to) {
      const open = text.indexOf("{", i);
      if (open < 0 || open >= to) break;
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth) {
        if (text[j] === "{") depth++;
        else if (text[j] === "}") depth--;
        j++;
      }
      const head = text.slice(i, open).trim().replace(/\s+/g, " ");
      if (head.startsWith("@media") || head.startsWith("@supports")) block(open + 1, j - 1, head);
      else if (!head.startsWith("@")) {
        const decl = new Map();
        for (const d of text.slice(open + 1, j - 1).split(";")) {
          const at = d.indexOf(":");
          if (at > 0) decl.set(d.slice(0, at).trim(), d.slice(at + 1).trim());
        }
        rules.push({ selector: head, media, decl });
      }
      i = j;
    }
  };
  block(0, text.length, null);
  return rules;
}
// Text below 0.8rem: only these short labels - never a sentence, a source or a date (audit 2026-10-02, P3-1)
const MIN_TEXT_REM = 0.8;
const SMALL_OK = {
  ".nav-group": "the heading of a menu group, in capitals",
  ".chip": "the kind of a number (official / market ...), one or two words in a pill",
  ".badge": "a state in a pill",
  ".value .unit": "the unit next to a large number",
  ".delta": "the up / down pill",
  th: "the head of a table column",
  "td .sub": "the name or unit next to the first cell of a table row",
  "td .delta": "the up / down pill inside a table on a phone",
  ".readout-since": "the change next to a value in a chart's read-out",
  ".table-wrap.scroll-y table": "the table of a chart on a phone: four or five columns of numbers have to fit",
  ".choice-label": "the word in front of a row of choice buttons",
  ".status": "the state of a target in a pill",
  ".pyramid": "the numbers along the bars of the age pyramid",
  ".policy-affects": "the row of tags of a policy card",
  ".tag-auto": "a tag",
  ".bottom-nav a": "the five labels of the phone's bottom bar",
};
// [text colour, the surfaces it sits on - the last one painted over the one before]
const CONTRAST_MIN = 4.5;
const CONTRAST = [
  ["--text", ["--page"]], ["--text", ["--surface"]], ["--text-2", ["--page"]], ["--text-2", ["--surface"]], ["--text-2", ["--surface-2"]],
  ["--muted", ["--page"]], ["--muted", ["--surface"]], ["--muted", ["--surface-2"]], ["--muted", ["--sidebar"]],
  ["--flat", ["--surface", "--flat-bg"]], ["--up", ["--surface", "--up-bg"]], ["--down", ["--surface", "--down-bg"]],
  ["--warn-text", ["--surface", "--warn-bg"]], ["--bad-text", ["--surface", "--bad-bg"]], ["--ok", ["--surface", "--ok-bg"]],
  ["--warn-text", ["--surface"]], ["--bad-text", ["--surface"]], ["--up", ["--surface"]], ["--down", ["--surface"]], ["--ok", ["--surface"]],
  ["--accent", ["--surface"]], ["--accent", ["--sidebar"]], ["--on-accent", ["--accent"]], ["--page", ["--text"]],
  // (the grey of small text never sits on the accent tint: a selected row or a marked item switches it to --text-2)
  ["--text", ["--surface", "--accent-soft"]], ["--text-2", ["--surface", "--accent-soft"]],
];
{
  const css = read("css/style.css");
  const rules = cssRules(css);
  const root = (selector) => new Map(rules.filter((r) => r.selector === selector && !r.media).flatMap((r) => [...r.decl]));
  const dark = root(":root");
  const light = new Map([...dark, ...root(':root[data-theme="light"]')]);
  const problems = [];

  // custom properties: every one that is used is defined, every one that is defined is used
  const defined = new Set([...dark.keys()].filter((k) => k.startsWith("--")));
  const usedVars = new Set(css.match(/var\(\s*(--[a-z0-9-]+)/g).map((m) => m.replace(/var\(\s*/, "")));
  // the page code names colours too ("--cat-3"), sometimes by their start ("--kind-" + kind)
  const starts = new Set();
  for (const file of siteModules) for (const m of read(file).match(/--[a-z][a-z0-9-]*/g) || []) (m.endsWith("-") ? starts : usedVars).add(m);
  for (const v of defined) if ([...starts].some((start) => v.startsWith(start))) usedVars.add(v);
  for (const v of usedVars) if (!defined.has(v) && v !== "--kind-color") problems.push(`var(${v}) is used, but :root does not define it`);
  for (const v of defined) if (!usedVars.has(v)) problems.push(`${v} is defined in :root and never used`);
  for (const k of root(':root[data-theme="light"]').keys()) if (k.startsWith("--") && !dark.has(k)) problems.push(`${k} is set for the light theme only`);
  check(`styles: ${defined.size} custom properties, each defined and used`, problems);

  // text sizes
  const sizeProblems = [];
  const rem = (value) => {
    const v = value.replace(/var\((--[a-z0-9-]+)\)/, (m, name) => dark.get(name) || m);
    const m = v.match(/^([\d.]+)(rem|px)$/);
    return m ? Number(m[1]) / (m[2] === "px" ? 16 : 1) : null;
  };
  const smallSeen = new Set();
  let sized = 0;
  for (const r of rules) {
    const size = r.decl.has("font-size") ? rem(r.decl.get("font-size")) : null;
    const short = r.decl.has("font") ? rem((r.decl.get("font").match(/([\d.]+(?:rem|px))/) || [""])[0]) : null;
    const value = size !== null ? size : short;
    if (value === null) continue;
    sized++;
    if (value >= MIN_TEXT_REM) continue;
    for (const part of r.selector.split(",").map((s) => s.trim())) {
      if (SMALL_OK[part]) smallSeen.add(part);
      else sizeProblems.push(`${part} { font-size: ${value}rem } - text below ${MIN_TEXT_REM}rem is for the short labels listed in SMALL_OK only`);
    }
  }
  for (const part of Object.keys(SMALL_OK)) if (!smallSeen.has(part)) sizeProblems.push(`SMALL_OK lists "${part}", which is not smaller than ${MIN_TEXT_REM}rem any more: take it off the list`);
  check(`styles: no sentence below ${MIN_TEXT_REM}rem (${sized} sizes, ${smallSeen.size} short labels smaller)`, sizeProblems);

  // contrast
  const colour = (theme, name) => {
    let v = theme.get(name);
    for (let n = 0; n < 5 && v && /^var\(/.test(v); n++) v = theme.get(v.match(/var\((--[a-z0-9-]+)\)/)[1]);
    let m = v && v.match(/^#([0-9a-f]{6})$/i);
    if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16), 1];
    m = v && v.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
      const c = m[1].split(",").map((x) => Number(x.trim()));
      return [c[0], c[1], c[2], c[3] === undefined ? 1 : c[3]];
    }
    return null;
  };
  const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
  const lum = (c) => {
    const f = (x) => (x / 255 <= 0.04045 ? x / 255 / 12.92 : ((x / 255 + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const contrastProblems = [];
  let lowest = Infinity;
  for (const [themeName, theme] of [["dark", dark], ["light", light]]) {
    for (const [fg, bgs] of CONTRAST) {
      const layers = [fg, ...bgs].map((name) => colour(theme, name));
      if (layers.some((c) => !c)) {
        contrastProblems.push(`${themeName}: the colour of ${[fg, ...bgs][layers.findIndex((c) => !c)]} is not understood`);
        continue;
      }
      let bg = layers[1];
      for (const b of layers.slice(2)) bg = over(b, bg);
      const [hi, lo] = [lum(over(layers[0], bg)), lum(bg)].sort((x, y) => y - x);
      const ratio = (hi + 0.05) / (lo + 0.05);
      lowest = Math.min(lowest, ratio);
      if (ratio < CONTRAST_MIN) contrastProblems.push(`${themeName}: ${fg} on ${bgs.join(" + ")} has a contrast of ${ratio.toFixed(2)}:1 (at least ${CONTRAST_MIN}:1)`);
    }
  }
  check(`styles: text colours on their surfaces, both themes - at least ${CONTRAST_MIN}:1 (lowest ${lowest.toFixed(2)}:1)`, contrastProblems);
}

// ---------- 6. series ----------
// A series the weekly fetchers store and no page reads is a download for nothing - and one more thing that can fail
// (audit 2026-10-02, P3-6). KEPT: "file id" -> why a series that no page names is stored all the same.
const KEPT = {};
{
  const LISTS = [
    ["economy.json", "scripts/fetch-economy.js", ["INDICATORS", "MONTHLY"]],
    ["invest.json", "scripts/fetch-invest.js", ["INDICATORS"]],
    ["population.json", "scripts/fetch-population.js", ["INDICATORS"]],
    ["compare.json", "scripts/fetch-compare.js", ["INDICATORS"]],
  ];
  // what the pages (and the two scripts that build files for them) can name
  const readers = [...siteModules, "scripts/build-summary.js", "scripts/build-long.js"];
  const strings = [];
  const names = new Set();
  for (const file of readers) {
    for (const tk of tokenize(read(file), file)) {
      if (tk.t === "str") strings.push(tk.v);
      else if (tk.t === "id") names.add(tk.v);
    }
  }
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const plain = new Set(strings);
  const families = strings.filter((s) => /[._]$/.test(s) && s.length > 3); // "cpi_cat_" + code, id.startsWith("cpi_cat_")
  // `bol_${cur}_mid` names bol_usd_mid ... - but only a template with a real piece of a name in it (`${a}.${b}` would fit everything)
  const templates = strings
    .filter((s) => s.includes("${") && s.split(/\$\{[^}]*\}/).some((part) => /[a-z0-9]{3,}/i.test(part)))
    .map((s) => new RegExp("^" + s.split(/\$\{[^}]*\}/).map(esc).join(".+") + "$"));
  const named = (id) => plain.has(id) || names.has(id) || families.some((f) => id.startsWith(f)) || templates.some((re) => re.test(id));
  const problems = [];
  // the check itself, on ids with a known answer (the four series the audit named were of this kind)
  for (const [id, want] of [["wb.NY.GDP.MKTP.CD", true], ["cpi_cat_CP01", true], ["bol_cny_mid", true], ["wb.SL.UEM.TOTL.ZS", false], ["a_series_no_page_reads", false]]) {
    if (named(id) !== want) problems.push(`the check itself: "${id}" counts as ${named(id) ? "named" : "not named"} by a page`);
  }
  let count = 0;
  for (const [dataFile, script, lists] of LISTS) {
    const mod = require(path.join(ROOT, script));
    for (const list of lists) {
      if (!mod[list]) {
        problems.push(`${script} does not export ${list}`);
        continue;
      }
      for (const id of Object.keys(mod[list])) {
        count++;
        const key = `${dataFile} ${id}`;
        if (named(id) === !!KEPT[key]) problems.push(KEPT[key] ? `${key} is on the KEPT list, but a page names it: take it off the list` : `${key}: fetched every week, but no page names it - use it, stop fetching it, or say in KEPT why it is stored`);
      }
    }
  }
  check(`series: each of the ${count} yearly and monthly series the fetchers store is named by a page`, problems);
}

// ---------- 7. page and workflows ----------
{
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "update-preload.js"), "check"], { encoding: "utf8" });
  check("page: index.html preloads every module of the site", r.status === 0 ? [] : [(r.stdout || r.stderr || "").trim()]);
  const problems = [];
  const dir = ".github/workflows";
  let runs = 0;
  for (const f of fs.readdirSync(path.join(ROOT, dir))) {
    for (const m of read(`${dir}/${f}`).matchAll(/\bnode\s+((?:scripts|tests)\/[\w./-]+\.js)/g)) {
      runs++;
      if (!fs.existsSync(path.join(ROOT, m[1]))) problems.push(`${dir}/${f} runs ${m[1]}, which does not exist`);
    }
    for (const m of read(`${dir}/${f}`).matchAll(/^\s*-\s*"((?:scripts|tests)\/[^"*]+)"/gm)) if (!fs.existsSync(path.join(ROOT, m[1]))) problems.push(`${dir}/${f} watches ${m[1]}, which does not exist`);
  }
  check(`workflows: every script they run or watch exists (${runs} runs)`, problems);
}

let failed = 0;
for (const [name, problems] of results) {
  if (problems.length) failed++;
  console.log(`${problems.length ? "FAIL" : "PASS"}  ${name}${problems.length ? "\n      " + problems.slice(0, 40).join("\n      ") + (problems.length > 40 ? `\n      ... and ${problems.length - 40} more` : "") : ""}`);
}
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
