'use strict';

// Pure Node.js ISO/IEC 18004 QR Code SVG generator (Byte mode, ECC Level M, Versions 1-10)
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
}

function gfMul(a, b) {
  return a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecCount) {
  const gen = rsGeneratorPoly(ecCount);
  const rem = new Uint8Array(ecCount);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.copyWithin(0, 1);
    rem[ecCount - 1] = 0;
    if (factor !== 0) {
      for (let i = 0; i < ecCount; i++) rem[i] ^= gfMul(gen[i + 1], factor);
    }
  }
  return rem;
}

// [version, ecPerBlock, g1Blocks, g1Data, g2Blocks, g2Data, alignCoords]
const VERSIONS = [
  null,
  [1, 10, 1, 16, 0, 0, []],
  [2, 16, 1, 28, 0, 0, [6, 18]],
  [3, 26, 1, 44, 0, 0, [6, 22]],
  [4, 18, 2, 32, 0, 0, [6, 26]],
  [5, 24, 2, 43, 0, 0, [6, 30]],
  [6, 16, 4, 27, 0, 0, [6, 34]],
  [7, 18, 4, 31, 0, 0, [6, 22, 38]],
  [8, 22, 2, 38, 2, 39, [6, 24, 42]],
  [9, 22, 3, 36, 2, 37, [6, 26, 46]],
  [10, 26, 4, 43, 1, 44, [6, 28, 50]],
];

function selectVersion(byteLength) {
  for (let v = 1; v <= 10; v++) {
    const [, , g1b, g1d, g2b, g2d] = VERSIONS[v];
    const dataCap = g1b * g1d + g2b * g2d;
    const headerBits = 4 + (v <= 9 ? 8 : 16);
    if (Math.ceil((headerBits + byteLength * 8) / 8) <= dataCap) return v;
  }
  throw new Error('QR payload is too large.');
}

function encodeCodewords(bytes, version) {
  const [, ecPerBlock, g1b, g1d, g2b, g2d] = VERSIONS[version];
  const totalData = g1b * g1d + g2b * g2d;
  const bits = [];
  const push = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  push(0b0100, 4); // Byte mode
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const maxBits = totalData * 8;
  for (let i = 0; i < 4 && bits.length < maxBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const data = new Uint8Array(totalData);
  let idx = 0;
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    data[idx++] = byte;
  }
  const pad = [0xec, 0x11];
  for (let p = 0; idx < totalData; p++) data[idx++] = pad[p & 1];

  const blocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (let i = 0; i < g1b; i++) {
    const slice = data.subarray(offset, offset + g1d);
    blocks.push(slice);
    ecBlocks.push(rsEncode(slice, ecPerBlock));
    offset += g1d;
  }
  for (let i = 0; i < g2b; i++) {
    const slice = data.subarray(offset, offset + g2d);
    blocks.push(slice);
    ecBlocks.push(rsEncode(slice, ecPerBlock));
    offset += g2d;
  }

  const out = [];
  const maxDataLen = Math.max(g1d, g2d);
  for (let i = 0; i < maxDataLen; i++) {
    for (const blk of blocks) if (i < blk.length) out.push(blk[i]);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const ec of ecBlocks) out.push(ec[i]);
  }
  return out;
}

function formatBits(mask) {
  // ECC Level M = 00
  const data = (0b00 << 3) | mask;
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function versionBits(version) {
  let rem = version << 12;
  for (let i = 17; i >= 12; i--) {
    if ((rem >>> i) & 1) rem ^= 0x1f25 << (i - 12);
  }
  return (version << 12) | rem;
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function penalty(grid, size) {
  let score = 0;
  // Rule 1: runs of 5+ same color
  for (let r = 0; r < size; r++) {
    let run = 1;
    for (let c = 1; c < size; c++) {
      if (grid[r][c] === grid[r][c - 1]) {
        run++;
        if (run === 5) score += 3;
        else if (run > 5) score += 1;
      } else run = 1;
    }
  }
  for (let c = 0; c < size; c++) {
    let run = 1;
    for (let r = 1; r < size; r++) {
      if (grid[r][c] === grid[r - 1][c]) {
        run++;
        if (run === 5) score += 3;
        else if (run > 5) score += 1;
      } else run = 1;
    }
  }
  // Rule 2: 2x2 blocks
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = grid[r][c];
      if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) score += 3;
    }
  }
  // Rule 3: finder-like pattern
  const p1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const p2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c <= size - 11; c++) {
      let m1 = true, m2 = true;
      for (let k = 0; k < 11; k++) {
        if (grid[r][c + k] !== p1[k]) m1 = false;
        if (grid[r][c + k] !== p2[k]) m2 = false;
      }
      if (m1 || m2) score += 40;
    }
  }
  for (let c = 0; c < size; c++) {
    for (let r = 0; r <= size - 11; r++) {
      let m1 = true, m2 = true;
      for (let k = 0; k < 11; k++) {
        if (grid[r + k][c] !== p1[k]) m1 = false;
        if (grid[r + k][c] !== p2[k]) m2 = false;
      }
      if (m1 || m2) score += 40;
    }
  }
  // Rule 4: balance
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (grid[r][c]) dark++;
  const pct = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return score;
}

function buildMatrix(text) {
  const bytes = Buffer.from(String(text), 'utf8');
  const version = selectVersion(bytes.length);
  const size = version * 4 + 17;
  const codewords = encodeCodewords(bytes, version);
  const base = Array.from({ length: size }, () => new Uint8Array(size));
  const reserved = Array.from({ length: size }, () => new Uint8Array(size));

  const setFunc = (r, c, val) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      base[r][c] = val ? 1 : 0;
      reserved[r][c] = 1;
    }
  };

  // Finder patterns + separators
  const placeFinder = (tr, tc) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const inside = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const border = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const core = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFunc(tr + dr, tc + dc, inside && (border || core));
      }
    }
  };
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFunc(6, i, i % 2 === 0);
    setFunc(i, 6, i % 2 === 0);
  }

  // Alignment patterns
  const align = VERSIONS[version][6];
  for (const ar of align) {
    for (const ac of align) {
      if (reserved[ar][ac]) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dist = Math.max(Math.abs(dr), Math.abs(dc));
          setFunc(ar + dr, ac + dc, dist === 2 || dist === 0);
        }
      }
    }
  }

  // Reserve format info areas + dark module
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      setFunc(8, i, 0);
      setFunc(i, 8, 0);
    }
  }
  for (let i = 0; i < 8; i++) setFunc(8, size - 1 - i, 0);
  for (let i = 0; i < 7; i++) setFunc(size - 1 - i, 8, 0);
  setFunc(size - 8, 8, 1); // Dark module

  // Version info (versions >= 7)
  if (version >= 7) {
    const vBits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = (vBits >>> i) & 1;
      const a = Math.floor(i / 3);
      const b = size - 11 + (i % 3);
      setFunc(a, b, bit);
      setFunc(b, a, bit);
    }
  }

  // Place data bits
  const dataBits = [];
  for (const cw of codewords) {
    for (let i = 7; i >= 0; i--) dataBits.push((cw >>> i) & 1);
  }
  let bitIdx = 0;
  let upward = true;
  for (let col = size - 1; col >= 1; col -= 2) {
    if (col === 6) col--;
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;
      for (let dc = 0; dc < 2; dc++) {
        const c = col - dc;
        if (!reserved[row][c]) {
          base[row][c] = bitIdx < dataBits.length ? dataBits[bitIdx++] : 0;
        }
      }
    }
    upward = !upward;
  }

  // Evaluate all 8 masks and pick lowest penalty
  let bestGrid = null;
  let bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    const grid = base.map((row) => Uint8Array.from(row));
    const fn = MASKS[m];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!reserved[r][c] && fn(r, c)) grid[r][c] ^= 1;
      }
    }
    const fBits = formatBits(m);
    const bit = (i) => (fBits >>> i) & 1;
    // Top-left format strip
    for (let i = 0; i <= 5; i++) grid[8][i] = bit(14 - i);
    grid[8][7] = bit(8);
    grid[8][8] = bit(7);
    grid[7][8] = bit(6);
    for (let i = 0; i <= 5; i++) grid[5 - i][8] = bit(5 - i);
    // Split format strip (bottom-left & top-right)
    for (let i = 0; i <= 6; i++) grid[size - 1 - i][8] = bit(14 - i);
    for (let i = 0; i <= 7; i++) grid[8][size - 8 + i] = bit(7 - i);

    const score = penalty(grid, size);
    if (score < bestScore) {
      bestScore = score;
      bestGrid = grid;
    }
  }

  return { size, version, grid: bestGrid };
}

function generateQrSvg(text, quietZone = 4) {
  const { size, grid } = buildMatrix(text);
  const full = size + quietZone * 2;
  const paths = [];
  for (let r = 0; r < size; r++) {
    let c = 0;
    while (c < size) {
      if (grid[r][c]) {
        const start = c;
        while (c < size && grid[r][c]) c++;
        const len = c - start;
        paths.push(`M${start + quietZone} ${r + quietZone}h${len}v1h-${len}z`);
      } else {
        c++;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" shape-rendering="crispEdges"><rect width="${full}" height="${full}" fill="#fff"/><path fill="#131416" d="${paths.join('')}"/></svg>`;
}

module.exports = { buildMatrix, generateQrSvg };
