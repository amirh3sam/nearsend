'use strict';

const fs = require('node:fs');
const zlib = require('node:zlib');

// Streaming ZIP archive writer (Store method 0, UTF-8 filenames, CRC32 via zlib.crc32)
function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear()) - 1980;
  const dosDate = (year << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  return { dosDate, dosTime };
}

async function computeFileCrc(filePath) {
  let crc = 0;
  let size = 0;
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) {
    crc = zlib.crc32(chunk, crc);
    size += chunk.length;
  }
  return { crc: crc >>> 0, size };
}

function uniqueZipNames(items) {
  const seen = new Map();
  return items.map((item) => {
    const clean = String(item.name || 'file').replace(/^[/\\]+/, '').replace(/\\/g, '/') || 'file';
    const key = clean.toLowerCase();
    const count = seen.get(key) || 0;
    seen.set(key, count + 1);
    if (count === 0) return { ...item, zipName: clean };
    const dot = clean.lastIndexOf('.');
    const slash = clean.lastIndexOf('/');
    const zipName = dot > slash && dot > 0
      ? `${clean.slice(0, dot)} (${count + 1})${clean.slice(dot)}`
      : `${clean} (${count + 1})`;
    return { ...item, zipName };
  });
}

function writeBuffer(res, buf) {
  if (res.destroyed) return Promise.resolve();
  if (res.write(buf)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onDrain = () => { cleanup(); resolve(); };
    const onError = (err) => { cleanup(); reject(err); };
    const onClose = () => { cleanup(); resolve(); };
    const cleanup = () => {
      res.off('drain', onDrain);
      res.off('error', onError);
      res.off('close', onClose);
    };
    res.once('drain', onDrain);
    res.once('error', onError);
    res.once('close', onClose);
  });
}

async function streamZip(res, items) {
  const named = uniqueZipNames(items);
  const centralEntries = [];
  let offset = 0;

  for (const item of named) {
    if (res.destroyed) return;
    if (!fs.existsSync(item.path)) continue;
    const { crc, size } = await computeFileCrc(item.path);
    const nameBuf = Buffer.from(item.zipName, 'utf8');
    const { dosDate, dosTime } = dosDateTime(item.created ? new Date(item.created) : new Date());

    // Local file header (30 bytes + filename)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4);         // version needed
    localHeader.writeUInt16LE(0x0800, 6);     // UTF-8 filename flag
    localHeader.writeUInt16LE(0, 8);          // method: store
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(size >>> 0, 18);
    localHeader.writeUInt32LE(size >>> 0, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const localOffset = offset;
    await writeBuffer(res, localHeader);
    await writeBuffer(res, nameBuf);
    offset += localHeader.length + nameBuf.length;

    const readStream = fs.createReadStream(item.path);
    for await (const chunk of readStream) {
      if (res.destroyed) { readStream.destroy(); return; }
      await writeBuffer(res, chunk);
      offset += chunk.length;
    }

    centralEntries.push({ nameBuf, crc, size, dosDate, dosTime, localOffset });
  }

  const centralStart = offset;
  let centralSize = 0;

  for (const entry of centralEntries) {
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); // central dir signature
    cd.writeUInt16LE(20, 4);         // version made by
    cd.writeUInt16LE(20, 6);         // version needed
    cd.writeUInt16LE(0x0800, 8);     // UTF-8 flag
    cd.writeUInt16LE(0, 10);         // method: store
    cd.writeUInt16LE(entry.dosTime, 12);
    cd.writeUInt16LE(entry.dosDate, 14);
    cd.writeUInt32LE(entry.crc, 16);
    cd.writeUInt32LE(entry.size >>> 0, 20);
    cd.writeUInt32LE(entry.size >>> 0, 24);
    cd.writeUInt16LE(entry.nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(entry.localOffset >>> 0, 42);

    await writeBuffer(res, cd);
    await writeBuffer(res, entry.nameBuf);
    centralSize += cd.length + entry.nameBuf.length;
  }

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(centralEntries.length, 8);
  eocd.writeUInt16LE(centralEntries.length, 10);
  eocd.writeUInt32LE(centralSize >>> 0, 12);
  eocd.writeUInt32LE(centralStart >>> 0, 16);
  eocd.writeUInt16LE(0, 20);

  await writeBuffer(res, eocd);
  res.end();
}

module.exports = { streamZip };
