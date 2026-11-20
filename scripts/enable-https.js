'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { generateSelfSignedCert } = require('../lib/cert');

const dataDir = process.env.NEARSEND_DATA || path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const { cert, key, ips } = generateSelfSignedCert();
fs.writeFileSync(path.join(dataDir, 'cert.pem'), cert, 'utf8');
fs.writeFileSync(path.join(dataDir, 'key.pem'), key, 'utf8');

console.log('\n  HTTPS enabled for Nearsend!');
console.log('  Saved data/cert.pem and data/key.pem');
console.log('  Included IPs:', ips.join(', '));
console.log('  Restart Nearsend, then open https:// on your iPhone to unlock 1-tap Save to Gallery.\n');
