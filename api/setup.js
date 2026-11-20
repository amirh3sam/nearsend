'use strict';

module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ mode: 'p2p', desktop: true, https: true, version: '2.0.0' });
};
