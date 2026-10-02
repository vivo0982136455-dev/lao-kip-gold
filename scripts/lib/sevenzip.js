// Minimal 7z reader (no npm packages): unpack the files of a .7z archive held in a Buffer.
// Used for UNCTAD's bulk downloads (one CSV packed with LZMA2).
// Only what such files need: one coder per folder (LZMA2 or LZMA), no encryption, no filters (BCJ, delta ...).
// Anything else throws - a part that cannot be read keeps its old numbers and is marked stale.
// Every unpacked file is checked against the CRC stored in the archive, so a mistake here cannot pass unnoticed.
// Written from the format descriptions that come with 7-Zip (7zFormat.txt, lzma-specification.txt) and the
// description of LZMA2 in the .xz file format.

// ---------- CRC32 ----------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------- LZMA ----------
const STATES = 12;
const POS_BITS_MAX = 4;
const LEN_TO_POS_STATES = 4;
const ALIGN_BITS = 4;
const END_POS_MODEL = 14;
const FULL_DISTANCES = 128;
const MATCH_MIN_LEN = 2;
const PROB_INIT = 1024; // a probability of one half, in 11 bits

const probs = (n) => new Uint16Array(n).fill(PROB_INIT);
// length decoder: choice, choice2, 16 x low (3 bits), 16 x mid (3 bits), high (8 bits)
const lenProbs = () => ({ choice: probs(2), low: probs(16 << 3), mid: probs(16 << 3), high: probs(256) });

// The probabilities and the "last distances" of one LZMA stream. props = the byte (pb * 5 + lp) * 9 + lc.
function lzmaState(props) {
  let d = props;
  if (d >= 9 * 5 * 5) throw new Error("7z: bad LZMA properties");
  const lc = d % 9;
  d = Math.floor(d / 9);
  const lp = d % 5;
  const pb = Math.floor(d / 5);
  return {
    lc, lp, pb,
    lit: probs(0x300 << (lc + lp)),
    isMatch: probs(STATES << POS_BITS_MAX),
    isRep: probs(STATES),
    isRepG0: probs(STATES),
    isRepG1: probs(STATES),
    isRepG2: probs(STATES),
    isRep0Long: probs(STATES << POS_BITS_MAX),
    posSlot: probs(LEN_TO_POS_STATES << 6),
    pos: probs(1 + FULL_DISTANCES - END_POS_MODEL),
    align: probs(1 << ALIGN_BITS),
    len: lenProbs(),
    repLen: lenProbs(),
    state: 0,
    rep0: 0, rep1: 0, rep2: 0, rep3: 0,
  };
}

// Decode one range-coded piece: exactly `size` bytes into out[at ...]. dictStart = first byte a match may reach back to.
// st carries over to the next piece (LZMA2 cuts one stream into pieces). endMark: the stream may end with the
// "end of stream" marker instead of after `size` bytes (plain LZMA with unknown size is not needed here).
function lzmaPiece(st, src, from, to, out, at, size, dictStart) {
  let p = from;
  if (to - from < 5 || src[p] !== 0) throw new Error("7z: bad LZMA data (start)");
  let code = src.readUInt32BE(p + 1);
  let range = 0xffffffff;
  p += 5;
  const bit = (table, i) => {
    const v = table[i];
    const bound = (range >>> 11) * v;
    let b;
    if (code < bound) {
      range = bound;
      table[i] = v + ((2048 - v) >>> 5);
      b = 0;
    } else {
      range = (range - bound) >>> 0;
      code = (code - bound) >>> 0;
      table[i] = v - (v >>> 5);
      b = 1;
    }
    if (range < 0x1000000) {
      range = (range << 8) >>> 0;
      code = ((code << 8) | (p < to ? src[p] : 0)) >>> 0;
      p++;
    }
    return b;
  };
  const direct = (count) => {
    let res = 0;
    for (let i = 0; i < count; i++) {
      range >>>= 1;
      let b = 0;
      if (code >= range) {
        code = (code - range) >>> 0;
        b = 1;
      }
      if (range < 0x1000000) {
        range = (range << 8) >>> 0;
        code = ((code << 8) | (p < to ? src[p] : 0)) >>> 0;
        p++;
      }
      res = res * 2 + b;
    }
    return res;
  };
  const tree = (table, offset, bits) => {
    let m = 1;
    for (let i = 0; i < bits; i++) m = (m << 1) | bit(table, offset + m);
    return m - (1 << bits);
  };
  const reverse = (table, offset, bits) => {
    let m = 1;
    let sym = 0;
    for (let i = 0; i < bits; i++) {
      const b = bit(table, offset + m);
      m = (m << 1) | b;
      sym |= b << i;
    }
    return sym;
  };
  const length = (L, posState) => {
    if (bit(L.choice, 0) === 0) return tree(L.low, posState << 3, 3);
    if (bit(L.choice, 1) === 0) return 8 + tree(L.mid, posState << 3, 3);
    return 16 + tree(L.high, 0, 8);
  };

  const { lc, lit } = st;
  const lpMask = (1 << st.lp) - 1;
  const pbMask = (1 << st.pb) - 1;
  let { state, rep0, rep1, rep2, rep3 } = st;
  let o = at;
  const end = at + size;
  while (o < end) {
    const done = o - dictStart; // bytes since the dictionary was last emptied
    const posState = done & pbMask;
    if (bit(st.isMatch, (state << POS_BITS_MAX) + posState) === 0) {
      // a literal byte
      const prev = done > 0 ? out[o - 1] : 0;
      const base = 0x300 * (((done & lpMask) << lc) + (prev >>> (8 - lc)));
      let symbol = 1;
      if (state >= 7) {
        let match = out[o - rep0 - 1];
        do {
          const matchBit = (match >>> 7) & 1;
          match = (match << 1) & 0xff;
          const b = bit(lit, base + ((1 + matchBit) << 8) + symbol);
          symbol = (symbol << 1) | b;
          if (matchBit !== b) break;
        } while (symbol < 0x100);
      }
      while (symbol < 0x100) symbol = (symbol << 1) | bit(lit, base + symbol);
      out[o++] = symbol & 0xff;
      state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
      continue;
    }
    let len;
    if (bit(st.isRep, state) !== 0) {
      if (done === 0) throw new Error("7z: bad LZMA data (repeat at the start)");
      if (bit(st.isRepG0, state) === 0) {
        if (bit(st.isRep0Long, (state << POS_BITS_MAX) + posState) === 0) {
          state = state < 7 ? 9 : 11;
          out[o] = out[o - rep0 - 1];
          o++;
          continue;
        }
      } else {
        let dist;
        if (bit(st.isRepG1, state) === 0) dist = rep1;
        else {
          if (bit(st.isRepG2, state) === 0) dist = rep2;
          else {
            dist = rep3;
            rep3 = rep2;
          }
          rep2 = rep1;
        }
        rep1 = rep0;
        rep0 = dist;
      }
      len = length(st.repLen, posState);
      state = state < 7 ? 8 : 11;
    } else {
      rep3 = rep2;
      rep2 = rep1;
      rep1 = rep0;
      len = length(st.len, posState);
      state = state < 7 ? 7 : 10;
      const slot = tree(st.posSlot, Math.min(len, LEN_TO_POS_STATES - 1) << 6, 6);
      if (slot < 4) rep0 = slot;
      else {
        const directBits = (slot >> 1) - 1;
        let dist = (2 | (slot & 1)) * 2 ** directBits;
        if (slot < END_POS_MODEL) dist += reverse(st.pos, dist - slot, directBits);
        else dist += direct(directBits - ALIGN_BITS) * (1 << ALIGN_BITS) + reverse(st.align, 0, ALIGN_BITS);
        rep0 = dist;
      }
      if (rep0 === 0xffffffff) throw new Error("7z: bad LZMA data (end marker inside a piece)");
    }
    len += MATCH_MIN_LEN;
    if (rep0 >= done) throw new Error("7z: bad LZMA data (distance outside the dictionary)");
    if (o + len > end) throw new Error("7z: bad LZMA data (match longer than the piece)");
    for (let i = 0, from2 = o - rep0 - 1; i < len; i++) out[o + i] = out[from2 + i]; // may overlap: byte by byte
    o += len;
  }
  if (p !== to || code !== 0) throw new Error("7z: bad LZMA data (piece does not end cleanly)");
  Object.assign(st, { state, rep0, rep1, rep2, rep3 });
}

// LZMA2: a row of pieces, each with a small head (see the .xz format, "LZMA2")
function lzma2(src, size) {
  const out = Buffer.alloc(size);
  let p = 0;
  let o = 0;
  let dictStart = 0;
  let st = null;
  let needProps = true;
  let needDictReset = true;
  for (;;) {
    if (p >= src.length) throw new Error("7z: LZMA2 data ends too early");
    const control = src[p++];
    if (control === 0) break;
    if (control === 1 || control >= 0xe0) {
      dictStart = o;
      needProps = true;
      needDictReset = false;
    } else if (needDictReset) throw new Error("7z: bad LZMA2 data (no dictionary reset at the start)");
    if (control >= 0x80) {
      const unpacked = (((control & 0x1f) << 16) | (src[p] << 8) | src[p + 1]) + 1;
      const packed = ((src[p + 2] << 8) | src[p + 3]) + 1;
      p += 4;
      if (control >= 0xc0) {
        st = lzmaState(src[p++]);
        if (st.lc + st.lp > 4) throw new Error("7z: bad LZMA2 properties");
        needProps = false;
      } else if (needProps) throw new Error("7z: bad LZMA2 data (properties missing)");
      else if (control >= 0xa0) st = lzmaState((st.pb * 5 + st.lp) * 9 + st.lc); // state reset, same properties
      if (o + unpacked > size || p + packed > src.length) throw new Error("7z: bad LZMA2 data (sizes)");
      lzmaPiece(st, src, p, p + packed, out, o, unpacked, dictStart);
      p += packed;
      o += unpacked;
    } else {
      if (control > 2) throw new Error("7z: bad LZMA2 data (control byte)");
      const n = ((src[p] << 8) | src[p + 1]) + 1;
      p += 2;
      if (o + n > size || p + n > src.length) throw new Error("7z: bad LZMA2 data (sizes)");
      src.copy(out, o, p, p + n);
      p += n;
      o += n;
    }
  }
  if (o !== size) throw new Error(`7z: LZMA2 gave ${o} bytes, ${size} expected`);
  return out;
}

// Plain LZMA as 7z stores it: properties = 1 byte + dictionary size (4 bytes); the size is known from the archive
function lzma1(src, size, props) {
  if (props.length < 5) throw new Error("7z: bad LZMA properties");
  const out = Buffer.alloc(size);
  lzmaPiece(lzmaState(props[0]), src, 0, src.length, out, 0, size, 0);
  return out;
}

// ---------- the 7z container ----------
const ID = { end: 0, header: 1, mainStreams: 4, files: 5, packInfo: 6, unpackInfo: 7, subStreams: 8, size: 9, crc: 10, folder: 11, codersUnpackSize: 12, numUnpackStream: 13, emptyStream: 14, names: 17, encodedHeader: 23 };

function reader(buf) {
  let p = 0;
  const r = {
    byte: () => {
      if (p >= buf.length) throw new Error("7z: header ends too early");
      return buf[p++];
    },
    // 7z's own way of writing a number: the leading 1-bits of the first byte say how many more bytes follow
    number: () => {
      const first = r.byte();
      let mask = 0x80;
      let value = 0;
      for (let i = 0; i < 8; i++) {
        if ((first & mask) === 0) return value + (first & (mask - 1)) * 2 ** (8 * i);
        value += r.byte() * 2 ** (8 * i);
        mask >>>= 1;
      }
      return value;
    },
    bytes: (n) => {
      if (p + n > buf.length) throw new Error("7z: header ends too early");
      p += n;
      return buf.subarray(p - n, p);
    },
    uint32: () => r.bytes(4).readUInt32LE(0),
    // "which of these n items has a value": one byte "all of them", else a row of bits
    defined: (n) => {
      if (r.byte() !== 0) return new Array(n).fill(true);
      const out = [];
      let b = 0;
      let mask = 0;
      for (let i = 0; i < n; i++) {
        if (mask === 0) {
          b = r.byte();
          mask = 0x80;
        }
        out.push((b & mask) !== 0);
        mask >>>= 1;
      }
      return out;
    },
    digests: (n) => r.defined(n).map((has) => (has ? r.uint32() : null)),
  };
  return r;
}

// -> { packPos, packSizes, folders: [{ coder: { id, props }, unpackSize, crc, files: [{ size, crc }] }] }
function readStreams(r) {
  const info = { packPos: 0, packSizes: [], folders: [] };
  let id = r.byte();
  if (id === ID.packInfo) {
    info.packPos = r.number();
    const n = r.number();
    for (id = r.byte(); id !== ID.end; id = r.byte()) {
      if (id === ID.size) for (let i = 0; i < n; i++) info.packSizes.push(r.number());
      else if (id === ID.crc) r.digests(n);
      else throw new Error("7z: unexpected field in the pack info");
    }
    id = r.byte();
  }
  if (id === ID.unpackInfo) {
    if (r.byte() !== ID.folder) throw new Error("7z: folders expected");
    const n = r.number();
    if (r.byte() !== 0) throw new Error("7z: external folder data is not supported");
    for (let f = 0; f < n; f++) {
      if (r.number() !== 1) throw new Error("7z: a folder with more than one coder (a filter?) is not supported");
      const flag = r.byte();
      if (flag & 0xd0) throw new Error("7z: complex coder is not supported");
      const coder = { id: r.bytes(flag & 0x0f).toString("hex"), props: flag & 0x20 ? Buffer.from(r.bytes(r.number())) : Buffer.alloc(0) };
      info.folders.push({ coder, unpackSize: 0, crc: null, files: null });
    }
    if (r.byte() !== ID.codersUnpackSize) throw new Error("7z: unpack sizes expected");
    for (const folder of info.folders) folder.unpackSize = r.number();
    for (id = r.byte(); id !== ID.end; id = r.byte()) {
      if (id === ID.crc) r.digests(n).forEach((crc, i) => (info.folders[i].crc = crc));
      else throw new Error("7z: unexpected field in the unpack info");
    }
    id = r.byte();
  }
  // without this block every folder holds exactly one file
  for (const folder of info.folders) folder.files = [{ size: folder.unpackSize, crc: folder.crc }];
  if (id === ID.subStreams) {
    let counts = info.folders.map(() => 1);
    id = r.byte();
    if (id === ID.numUnpackStream) {
      counts = info.folders.map(() => r.number());
      id = r.byte();
    }
    // the sizes of all files of a folder but the last one are written down; the last one is what is left
    info.folders.forEach((folder, f) => {
      const sizes = [];
      let rest = folder.unpackSize;
      for (let i = 0; i < counts[f] - 1; i++) {
        if (id !== ID.size) throw new Error("7z: file sizes expected");
        sizes.push(r.number());
        rest -= sizes[i];
      }
      if (counts[f] > 0) sizes.push(rest);
      folder.files = sizes.map((size) => ({ size, crc: counts[f] === 1 ? folder.crc : null }));
    });
    if (id === ID.size) id = r.byte();
    if (id === ID.crc) {
      // one checksum for every file that has none yet (a folder with one file and its own checksum already has it)
      const open = info.folders.flatMap((folder) => folder.files.filter((file) => file.crc === null));
      r.digests(open.length).forEach((crc, i) => (open[i].crc = crc));
      id = r.byte();
    }
    if (id !== ID.end) throw new Error("7z: unexpected field in the substreams info");
    id = r.byte();
  }
  if (id !== ID.end) throw new Error("7z: unexpected field in the streams info");
  return info;
}

// Unpack one folder (all its files in one piece)
function unpackFolder(buf, info, index) {
  let at = 32 + info.packPos;
  for (let i = 0; i < index; i++) at += info.packSizes[i];
  const folder = info.folders[index];
  const packed = buf.subarray(at, at + info.packSizes[index]);
  if (packed.length !== info.packSizes[index]) throw new Error("7z: the file is cut off");
  let data;
  if (folder.coder.id === "21") data = lzma2(packed, folder.unpackSize);
  else if (folder.coder.id === "030101") data = lzma1(packed, folder.unpackSize, folder.coder.props);
  else if (folder.coder.id === "00") data = Buffer.from(packed);
  else throw new Error(`7z: packing method ${folder.coder.id} is not supported`);
  if (folder.crc !== null && crc32(data) !== folder.crc) throw new Error("7z: checksum of the unpacked data is wrong");
  return data;
}

// Every file of the archive: [{ name, data }] (files without content are left out)
function unpack7z(buf) {
  if (buf.length < 32 || buf.readUInt32BE(0) !== 0x377abcaf || buf.readUInt16BE(4) !== 0x271c) throw new Error("Not a 7z file");
  const next = 32 + Number(buf.readBigUInt64LE(12));
  let head = buf.subarray(next, next + Number(buf.readBigUInt64LE(20)));
  if (crc32(head) !== buf.readUInt32LE(28)) throw new Error("7z: checksum of the header is wrong");
  let r = reader(head);
  let id = r.byte();
  if (id === ID.encodedHeader) {
    head = unpackFolder(buf, readStreams(r), 0); // the header itself is packed
    r = reader(head);
    id = r.byte();
  }
  if (id !== ID.header) throw new Error("7z: header expected");
  let info = null;
  let names = [];
  let empty = [];
  for (id = r.byte(); id !== ID.end; id = r.byte()) {
    if (id === ID.mainStreams) info = readStreams(r);
    else if (id === ID.files) {
      const count = r.number();
      for (let type = r.byte(); type !== ID.end; type = r.byte()) {
        const size = r.number();
        const body = reader(r.bytes(size));
        if (type === ID.names) {
          if (body.byte() !== 0) throw new Error("7z: external names are not supported");
          names = body.bytes(size - 1).toString("utf16le").split("\0").slice(0, count);
        } else if (type === ID.emptyStream) {
          empty = [];
          let b = 0;
          let mask = 0;
          for (let i = 0; i < count; i++) {
            if (mask === 0) {
              b = body.byte();
              mask = 0x80;
            }
            empty.push((b & mask) !== 0);
            mask >>>= 1;
          }
        } // dates, attributes ...: not needed
      }
    } else throw new Error("7z: this kind of archive is not supported");
  }
  if (!info) return [];
  const withData = names.filter((name, i) => !empty[i]);
  const out = [];
  info.folders.forEach((folder, f) => {
    const data = unpackFolder(buf, info, f);
    let at = 0;
    for (const file of folder.files) {
      const part = data.subarray(at, at + file.size);
      at += file.size;
      if (file.crc !== null && crc32(part) !== file.crc) throw new Error("7z: checksum of an unpacked file is wrong");
      out.push({ name: withData[out.length] || "", data: part });
    }
  });
  return out;
}

module.exports = { unpack7z, crc32 };
