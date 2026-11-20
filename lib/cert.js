'use strict';

const crypto = require('node:crypto');
const os = require('node:os');

// Minimal pure-Node.js X.509 v3 self-signed certificate generator (RSA-2048, SHA-256, SANs)
function derLen(len) {
  if (len < 0x80) return Buffer.from([len]);
  const bytes = [];
  let n = len;
  while (n > 0) { bytes.unshift(n & 0xff); n >>>= 8; }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function derTag(tag, content) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.concat(content);
  return Buffer.concat([Buffer.from([tag]), derLen(buf.length), buf]);
}

const seq = (...items) => derTag(0x30, items);
const set = (...items) => derTag(0x31, items);
const ctx = (num, item, constructed = true) => derTag((constructed ? 0xa0 : 0x80) | num, item);

function derInt(bufOrNum) {
  let buf = typeof bufOrNum === 'number'
    ? Buffer.from(bufOrNum.toString(16).padStart(bufOrNum.toString(16).length + (bufOrNum.toString(16).length % 2), '0'), 'hex')
    : Buffer.from(bufOrNum);
  if (buf[0] & 0x80) buf = Buffer.concat([Buffer.from([0x00]), buf]);
  return derTag(0x02, buf);
}

function derBitString(buf) {
  return derTag(0x03, Buffer.concat([Buffer.from([0x00]), buf]));
}

function derOctet(buf) {
  return derTag(0x04, buf);
}

function derOid(oidStr) {
  const parts = oidStr.split('.').map(Number);
  const out = [parts[0] * 40 + parts[1]];
  for (let i = 2; i < parts.length; i++) {
    let v = parts[i];
    const enc = [v & 0x7f];
    while (v >>>= 7) enc.unshift((v & 0x7f) | 0x80);
    out.push(...enc);
  }
  return derTag(0x06, Buffer.from(out));
}

function derUtcTime(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const s =
    pad(date.getUTCFullYear() % 100) +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    'Z';
  return derTag(0x17, Buffer.from(s, 'ascii'));
}

function derUtf8(str) {
  return derTag(0x0c, Buffer.from(str, 'utf8'));
}

function derNull() {
  return Buffer.from([0x05, 0x00]);
}

function toPem(label, derBuf) {
  const b64 = derBuf.toString('base64').match(/.{1,64}/g).join('\n');
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`;
}

function getLocalIps() {
  const ips = new Set(['127.0.0.1']);
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const n of addrs || []) {
      if (n.family === 'IPv4' && !n.address.startsWith('169.254.')) ips.add(n.address);
    }
  }
  return [...ips];
}

function generateSelfSignedCert(extraIps = []) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const sha256RsaAlg = seq(derOid('1.2.840.113549.1.1.11'), derNull());
  const serial = crypto.randomBytes(16);
  serial[0] &= 0x7f;
  if (serial[0] === 0) serial[0] = 1;

  const dn = seq(set(seq(derOid('2.5.4.3'), derUtf8('Nearsend Local'))));
  const now = new Date(Date.now() - 3600_000);
  const expires = new Date(Date.now() + 730 * 86400_000); // ~2 years

  const ips = [...new Set([...getLocalIps(), ...extraIps])];
  const sanEntries = [
    ctx(2, Buffer.from('localhost', 'ascii'), false),
    ...ips.map((ip) => ctx(7, Buffer.from(ip.split('.').map(Number)), false)),
  ];
  const sanExt = seq(derOid('2.5.29.17'), derOctet(seq(...sanEntries)));
  const basicConstraintsExt = seq(derOid('2.5.29.19'), derOctet(seq()));

  const tbs = seq(
    ctx(0, derInt(2)), // v3
    derInt(serial),
    sha256RsaAlg,
    dn,
    seq(derUtcTime(now), derUtcTime(expires)),
    dn,
    publicKey,
    ctx(3, seq(basicConstraintsExt, sanExt))
  );

  const signature = crypto.sign('sha256', tbs, privateKey);
  const certDer = seq(tbs, sha256RsaAlg, derBitString(signature));
  return {
    cert: toPem('CERTIFICATE', certDer),
    key: privateKey,
    ips,
  };
}

module.exports = { generateSelfSignedCert };
