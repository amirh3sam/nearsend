'use strict';

const { generateQrSvg } = require('../lib/qr');

module.exports = (req, res) => {
  const url = new URL(req.url, 'https://localhost');
  const link = String(url.searchParams.get('link') || '');
  if (!/^https:\/\/[a-zA-Z0-9.-]+(:\d+)?\/#room=\d{6}$/.test(link)) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'Invalid pairing link.' }));
    return;
  }
  const svg = generateQrSvg(link);
  res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(svg);
};
