// A very small PDF text reader for simple, machine-made PDFs - no packages.
// Made for the monthly tables of Viet Nam Customs (Crystal Reports, PDF 1.2): plain objects, FlateDecode streams,
// fonts with a /ToUnicode map (one or two bytes per character), text placed with Tm / Td and shown with Tj / TJ.
// It is NOT a general PDF library: no encryption, no object streams. When a file does not fit, an error is
// thrown - never a silently wrong text.
//
// readPdf(buffer) -> [ { texts: [ { x, y, text, font, size } ... ], lines: [x ...] } per page ]
//   x, y   position of the start of the text in page points (1/72 inch): x from the left edge, y from the
//          BOTTOM edge (a bigger y is higher on the page). Pieces come in drawing order.
//   lines  x positions of the vertical lines drawn on the page (the column borders of a table), in points

const zlib = require("zlib");

// ---------- objects ----------
function readObjects(buf) {
  const raw = buf.toString("latin1");
  if (!raw.startsWith("%PDF-")) throw new Error("not a PDF file");
  if (/\/Encrypt\b/.test(raw.slice(-2000))) throw new Error("encrypted PDF is not supported");
  const objects = new Map();
  const head = /(\d+)\s+0\s+obj\b/g;
  let m;
  while ((m = head.exec(raw))) {
    const start = head.lastIndex;
    const endDict = raw.indexOf("endobj", start);
    const streamAt = raw.indexOf("stream", start);
    if (endDict < 0) break;
    if (streamAt < 0 || streamAt > endDict) {
      objects.set(Number(m[1]), { dict: raw.slice(start, endDict).trim(), stream: null });
      head.lastIndex = endDict + 6;
      continue;
    }
    // an object with a stream: the bytes start after "stream" + line break and are /Length long
    const dict = raw.slice(start, streamAt).trim();
    const len = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
    let from = streamAt + 6;
    if (raw[from] === "\r") from++;
    if (raw[from] === "\n") from++;
    let to;
    if (len) to = from + Number(len[1]);
    else {
      to = raw.indexOf("endstream", from);
      if (to < 0) throw new Error(`object ${m[1]}: stream without end`);
    }
    objects.set(Number(m[1]), { dict, stream: buf.subarray(from, to) });
    const after = raw.indexOf("endobj", to);
    head.lastIndex = after < 0 ? raw.length : after + 6;
  }
  if (!objects.size) throw new Error("no objects found (compressed object streams are not supported)");
  return objects;
}

function streamBytes(obj) {
  if (!obj || !obj.stream) return Buffer.alloc(0);
  if (/\/Filter\s*\[?\s*\/FlateDecode/.test(obj.dict)) return zlib.inflateSync(obj.stream);
  if (/\/Filter/.test(obj.dict)) throw new Error("stream filter not supported: " + obj.dict.slice(0, 80));
  return obj.stream;
}

const refOf = (dict, key) => {
  const m = new RegExp(`/${key}\\s+(\\d+)\\s+0\\s+R`).exec(dict);
  return m ? Number(m[1]) : null;
};
const refsIn = (text) => [...text.matchAll(/(\d+)\s+0\s+R/g)].map((m) => Number(m[1]));

// ---------- fonts: character code -> text ----------
function hexToText(hex) {
  let out = "";
  for (let i = 0; i + 3 < hex.length; i += 4) out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
  return out;
}
// -> Map(code -> text); map.bytes = how many bytes one character code has in this font (1 or 2)
function readCMap(text) {
  const map = new Map();
  let digits = 0;
  const codeLength = (hex) => {
    if (hex.length !== 2 && hex.length !== 4) throw new Error(`character codes of ${hex.length / 2} bytes are not supported`);
    if (digits && digits !== hex.length) throw new Error("a font that mixes 1-byte and 2-byte character codes is not supported");
    digits = hex.length;
  };
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) {
      codeLength(m[1]);
      map.set(parseInt(m[1], 16), hexToText(m[2]));
    }
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]*>|\[[^\]]*\])/g)) {
      codeLength(m[1]);
      const first = parseInt(m[1], 16);
      const last = parseInt(m[2], 16);
      if (m[3].startsWith("[")) {
        const list = [...m[3].matchAll(/<([0-9A-Fa-f]*)>/g)].map((x) => hexToText(x[1]));
        for (let c = first; c <= last; c++) map.set(c, list[c - first] || "");
      } else {
        const base = parseInt(m[3].slice(1, -1), 16);
        for (let c = first; c <= last; c++) map.set(c, String.fromCharCode(base + (c - first)));
      }
    }
  }
  map.bytes = digits === 4 ? 2 : 1;
  return map;
}

// ---------- page content: a tiny reader for the drawing commands ----------
// Yields [operator, operands]. Operands: numbers, "/names", { str: bytes } for (strings) and <hex strings>, arrays.
function* commands(bytes) {
  const s = bytes.toString("latin1");
  let i = 0;
  let stack = [];
  const space = /[\s\0]/;
  const readString = () => {
    // s[i] is "(" - returns the bytes up to the matching ")"
    const out = [];
    let depth = 1;
    i++;
    while (i < s.length && depth > 0) {
      const ch = s[i];
      if (ch === "\\") {
        const n = s[i + 1];
        if (/[0-7]/.test(n)) {
          const oct = /^[0-7]{1,3}/.exec(s.slice(i + 1, i + 4))[0];
          out.push(parseInt(oct, 8) & 255);
          i += 1 + oct.length;
          continue;
        }
        const esc = { n: 10, r: 13, t: 9, b: 8, f: 12 };
        if (n === "\n" || n === "\r") {
          i += n === "\r" && s[i + 2] === "\n" ? 3 : 2; // line continuation
          continue;
        }
        out.push(n in esc ? esc[n] : n.charCodeAt(0));
        i += 2;
        continue;
      }
      if (ch === "(") depth++;
      if (ch === ")") {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
      out.push(ch.charCodeAt(0));
      i++;
    }
    return { str: out };
  };
  const readValue = () => {
    while (i < s.length && space.test(s[i])) i++;
    if (i >= s.length) return undefined;
    const ch = s[i];
    if (ch === "(") return readString();
    if (ch === "<" && s[i + 1] !== "<") {
      const end = s.indexOf(">", i);
      const hex = s.slice(i + 1, end).replace(/\s+/g, "");
      i = end + 1;
      const out = [];
      for (let k = 0; k + 1 < hex.length; k += 2) out.push(parseInt(hex.slice(k, k + 2), 16));
      return { str: out };
    }
    if (ch === "[") {
      i++;
      const list = [];
      for (;;) {
        while (i < s.length && space.test(s[i])) i++;
        if (i >= s.length || s[i] === "]") {
          i++;
          break;
        }
        list.push(readValue());
      }
      return list;
    }
    if (ch === "%") {
      while (i < s.length && s[i] !== "\n") i++;
      return readValue();
    }
    const m = /^[^\s\0()<>\[\]{}%]+|^<<|^>>|^[{}]/.exec(s.slice(i, i + 200));
    if (!m) {
      i++;
      return readValue();
    }
    i += m[0].length;
    const word = m[0];
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return Number(word);
    if (word.startsWith("/")) return word;
    return { op: word };
  };
  for (;;) {
    const v = readValue();
    if (v === undefined) break;
    if (v && v.op) {
      yield [v.op, stack];
      stack = [];
    } else stack.push(v);
  }
}

function readPage(objects, pageDict, fontCache) {
  // fonts of this page: resource name -> code map
  let resources = pageDict;
  const resRef = refOf(pageDict, "Resources");
  if (resRef && objects.get(resRef)) resources = objects.get(resRef).dict;
  const fonts = new Map();
  const fontDict = /\/Font\s*<<([\s\S]*?)>>/.exec(resources);
  if (fontDict) {
    for (const m of fontDict[1].matchAll(/\/([^\s/]+)\s+(\d+)\s+0\s+R/g)) {
      const num = Number(m[2]);
      if (!fontCache.has(num)) {
        const font = objects.get(num);
        const uni = font && refOf(font.dict, "ToUnicode");
        fontCache.set(num, uni && objects.get(uni) ? readCMap(streamBytes(objects.get(uni)).toString("latin1")) : null);
      }
      fonts.set(m[1], fontCache.get(num));
    }
  }
  // the drawing commands (one or several streams)
  const contents = /\/Contents\s*(\[[^\]]*\]|\d+\s+0\s+R)/.exec(pageDict);
  const data = Buffer.concat((contents ? refsIn(contents[1]) : []).map((n) => Buffer.concat([streamBytes(objects.get(n)), Buffer.from("\n")])));

  const texts = [];
  const lineXs = new Map();
  let font = null;
  let size = 0;
  let tm = [1, 0, 0, 1, 0, 0]; // start of the current text line
  let move = null; // last "x y m" (for vertical lines)
  let ctm = [1, 0, 0, 1, 0, 0]; // the page's transformation ("cm"): drawing units -> page points
  const saved = []; // "q" saves the drawing state, "Q" brings it back - font and transformation are part of it
  const toPage = (x, y) => [x * ctm[0] + y * ctm[2] + ctm[4], x * ctm[1] + y * ctm[3] + ctm[5]];
  const UNKNOWN = String.fromCharCode(0xfffd); // a character the font's map does not know
  const decode = (bytes) => {
    const map = fonts.get(font);
    let out = "";
    if (!map) for (const b of bytes) out += String.fromCharCode(b);
    else if (map.bytes === 2) for (let k = 0; k + 1 < bytes.length; k += 2) out += map.has(bytes[k] * 256 + bytes[k + 1]) ? map.get(bytes[k] * 256 + bytes[k + 1]) : UNKNOWN;
    else for (const b of bytes) out += map.has(b) ? map.get(b) : UNKNOWN;
    return out;
  };
  const show = (bytes) => {
    const text = decode(bytes);
    const [x, y] = toPage(tm[4], tm[5]);
    if (text) texts.push({ x, y, text, font, size });
  };
  for (const [op, a] of commands(data)) {
    if (op === "BT") tm = [1, 0, 0, 1, 0, 0];
    else if (op === "q") saved.push([font, size, ctm]);
    else if (op === "Q") {
      if (saved.length) [font, size, ctm] = saved.pop();
    } else if (op === "cm") {
      // new = given matrix, then the current one
      const [m0, m1, m2, m3, m4, m5] = a.slice(0, 6);
      ctm = [m0 * ctm[0] + m1 * ctm[2], m0 * ctm[1] + m1 * ctm[3], m2 * ctm[0] + m3 * ctm[2], m2 * ctm[1] + m3 * ctm[3], m4 * ctm[0] + m5 * ctm[2] + ctm[4], m4 * ctm[1] + m5 * ctm[3] + ctm[5]];
    } else if (op === "Tf") {
      font = String(a[0]).slice(1);
      size = a[1];
    } else if (op === "Tm") tm = a.slice(0, 6);
    else if (op === "Td" || op === "TD") tm = [tm[0], tm[1], tm[2], tm[3], tm[4] + a[0] * tm[0] + a[1] * tm[2], tm[5] + a[0] * tm[1] + a[1] * tm[3]];
    else if (op === "Tj" || op === "'" || op === '"') show(a[a.length - 1].str || []);
    else if (op === "TJ") show((a[0] || []).filter((p) => p && p.str).flatMap((p) => p.str));
    else if (op === "m") move = toPage(a[0], a[1]);
    else if (op === "l") {
      const to = toPage(a[0], a[1]);
      if (move && Math.abs(move[0] - to[0]) < 0.5 && Math.abs(move[1] - to[1]) > 1) lineXs.set(Math.round(to[0]), (lineXs.get(Math.round(to[0])) || 0) + 1);
      move = to;
    }
  }
  return { texts, lines: [...lineXs.keys()].sort((x, y) => x - y) };
}

function readPdf(buf) {
  const objects = readObjects(buf);
  const catalog = [...objects.values()].find((o) => /\/Type\s*\/Catalog/.test(o.dict));
  if (!catalog) throw new Error("no catalog in the PDF");
  const pages = [];
  const fontCache = new Map();
  const walk = (num, depth) => {
    const obj = objects.get(num);
    if (!obj || depth > 8) return;
    if (/\/Type\s*\/Pages\b/.test(obj.dict)) {
      const kids = /\/Kids\s*\[([^\]]*)\]/.exec(obj.dict);
      for (const kid of kids ? refsIn(kids[1]) : []) walk(kid, depth + 1);
    } else if (/\/Type\s*\/Page\b/.test(obj.dict)) pages.push(readPage(objects, obj.dict, fontCache));
  };
  walk(refOf(catalog.dict, "Pages"), 0);
  if (!pages.length) throw new Error("no pages in the PDF");
  return pages;
}

module.exports = { readPdf };
