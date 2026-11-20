'use strict';

module.exports = (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify({ mode: 'p2p', desktop: true, https: true, version: '2.0.0' }));
};
