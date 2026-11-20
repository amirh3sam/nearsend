'use strict';

const http = require('node:http');
const https = require('node:https');

const proto = process.argv[2] === 'https' ? 'https' : 'http';
const port = Number(process.env.PORT || 3210);
const mod = proto === 'https' ? https : http;

const req = mod.request(
  { hostname: '127.0.0.1', port, path: '/api/setup', method: 'GET', timeout: 1500, rejectUnauthorized: false },
  (res) => {
    let data = '';
    res.on('data', (c) => (data += c));
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        process.exit(json.desktop === true && typeof json.key === 'string' && json.key.length === 48 ? 0 : 1);
      } catch {
        process.exit(1);
      }
    });
  }
);
req.on('error', () => process.exit(1));
req.on('timeout', () => { req.destroy(); process.exit(1); });
req.end();
