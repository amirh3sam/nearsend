'use strict';

const { generateQrSvg } = require('../lib/qr');

module.exports = (req, res) => {
  const link = String(req.query?.link || '');
  if (!/^https:\/\/[a-zA-Z0-9.-]+(:\d+)?\/#room=\d{6}$/.test(link)) {
    res.status(400).json({ error: 'Invalid pairing link.' });
    return;
  }
  const svg = generateQrSvg(link);
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(svg);
};
