// Minimal ZIP reader (no npm packages): find a file inside an archive held in a Buffer and unpack it.
// Used for FAOSTAT bulk downloads (a 545 MB CSV inside a 34 MB zip: read line by line, never unpacked whole)
// and for the World Bank price workbook (.xlsx = a zip of XML files).
// Only what these files need: "stored" and "deflate" entries, no ZIP64, no encryption.

const zlib = require("zlib");
const readline = require("readline");
const { Readable } = require("stream");

// All entries of the archive: [{ name, method, compressedSize, size, offset }] (from the central directory at the end)
function listEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a ZIP file (no end record)");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Broken ZIP directory");
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    entries.push({
      name: buf.toString("utf8", p + 46, p + 46 + nameLen),
      method: buf.readUInt16LE(p + 10),
      compressedSize: buf.readUInt32LE(p + 20),
      size: buf.readUInt32LE(p + 24),
      offset: buf.readUInt32LE(p + 42),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function findEntry(buf, test) {
  const entry = listEntries(buf).find((e) => test(e.name));
  if (!entry) throw new Error("File not found in the ZIP");
  return entry;
}

// The compressed bytes of one entry (after its local header)
function rawData(buf, entry) {
  const p = entry.offset;
  if (buf.readUInt32LE(p) !== 0x04034b50) throw new Error("Broken ZIP entry");
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  return buf.subarray(start, start + entry.compressedSize);
}

// Unpack one (small) entry completely. test(name) picks the entry.
function unpack(buf, test) {
  const entry = findEntry(buf, test);
  const data = rawData(buf, entry);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method !== 8) throw new Error(`ZIP method ${entry.method} is not supported`);
  return zlib.inflateRawSync(data);
}

// Read one (big) text entry line by line without unpacking it whole. onLine(line) is called for every line.
async function eachLine(buf, test, onLine) {
  const entry = findEntry(buf, test);
  if (entry.method !== 8 && entry.method !== 0) throw new Error(`ZIP method ${entry.method} is not supported`);
  const data = rawData(buf, entry);
  const CHUNK = 1 << 20; // feed 1 MB at a time
  const chunks = (function* () {
    for (let i = 0; i < data.length; i += CHUNK) yield data.subarray(i, Math.min(data.length, i + CHUNK));
  })();
  const source = Readable.from(chunks);
  const text = entry.method === 8 ? source.pipe(zlib.createInflateRaw()) : source;
  const rl = readline.createInterface({ input: text, crlfDelay: Infinity });
  for await (const line of rl) onLine(line);
}

module.exports = { listEntries, unpack, eachLine };
