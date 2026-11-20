'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { buildMatrix, generateQrSvg } = require('../lib/qr');

test('pure JS QR generator builds valid matrix and SVG', () => {
  const url = 'http://192.168.1.42:3210/#key=0123456789abcdef0123456789abcdef0123456789abcdef';
  const { size, version, grid } = buildMatrix(url);
  assert.ok(version >= 4 && version <= 10);
  assert.equal(size, version * 4 + 17);
  // Top-left finder pattern corners must be dark
  assert.equal(grid[0][0], 1);
  assert.equal(grid[6][6], 1);
  assert.equal(grid[3][3], 1);
  assert.equal(grid[1][1], 0);
  // Dark module
  assert.equal(grid[size - 8][8], 1);

  const svg = generateQrSvg(url);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /<path fill="#131416" d="M/);
});

test('Nearsend v2: pairing, SSE, QR, Range, ZIP, bulk delete, session revoke, code rotate', async () => {
  const dir = fs.mkdtempSync(path.join(__dirname, 'test-data-'));
  const port = 34219;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), NEARSEND_DATA: dir },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server did not start')), 20000);
      child.stdout.on('data', (chunk) => {
        if (String(chunk).includes('is ready')) { clearTimeout(timer); resolve(); }
      });
      child.on('error', reject);
    });

    assert.equal((await fetch(base)).status, 200);
    assert.equal((await fetch(base + '/manifest.json')).status, 200);
    assert.equal((await fetch(base + '/api/state')).status, 401);

    const setup = await fetch(base + '/api/setup').then((r) => r.json());
    assert.equal(setup.desktop, true);
    const headers = { Authorization: `Bearer ${setup.key}`, 'X-Device-Name': 'Test laptop', 'X-Device-Id': 'test-laptop' };

    // QR SVG endpoint works without Python
    const qrRes = await fetch(base + '/api/qr', { headers });
    assert.equal(qrRes.status, 200);
    assert.match(qrRes.headers.get('content-type'), /image\/svg\+xml/);
    assert.match(await qrRes.text(), /^<svg /);

    // State & interfaces
    const state = await fetch(base + '/api/state', { headers }).then((r) => r.json());
    assert.equal(state.version, '2.0.0');
    assert.match(state.code, /^\d{6}$/);
    assert.ok(Array.isArray(state.interfaces));

    // Pairing
    assert.equal((await fetch(base + '/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: '000000' }) })).status, 401);
    const paired = await fetch(base + '/api/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Name': 'iPhone' },
      body: JSON.stringify({ code: state.code }),
    }).then((r) => r.json());
    assert.ok(paired.key);
    const phoneHeaders = { Authorization: `Bearer ${paired.key}`, 'X-Device-Name': 'iPhone', 'X-Device-Id': 'test-phone' };

    // SSE stream connects and receives initial state event
    const sseController = new AbortController();
    const sseRes = await fetch(`${base}/api/events?key=${setup.key}&deviceId=sse-laptop&deviceName=Laptop`, { signal: sseController.signal });
    assert.equal(sseRes.status, 200);
    assert.match(sseRes.headers.get('content-type'), /text\/event-stream/);
    const reader = sseRes.body.getReader();
    let sseBuf = '';
    while (!sseBuf.includes('event: state')) {
      const { value, done } = await reader.read();
      if (done) break;
      sseBuf += Buffer.from(value).toString('utf8');
    }
    assert.match(sseBuf, /event: state/);
    sseController.abort();

    // Upload with folder metadata & Unicode filename
    const content1 = Buffer.from([0, 1, 2, 255, 10, 23, 99, 100]);
    const upload1 = await fetch(base + '/api/files?name=' + encodeURIComponent('photo 日本.png') + '&folder=' + encodeURIComponent('Trip/Day1'), {
      method: 'POST',
      headers: { ...phoneHeaders, 'Content-Type': 'image/png' },
      body: content1,
    });
    assert.equal(upload1.status, 201);
    const file1 = await upload1.json();
    assert.equal(file1.name, 'photo 日本.png');
    assert.equal(file1.folder, 'Trip/Day1');

    // Pin / star favorite toggle
    const pinRes = await fetch(`${base}/api/files/${file1.id}/pin`, { method: 'POST', headers });
    assert.equal(pinRes.status, 200);
    assert.equal((await pinRes.json()).pinned, true);

    // Full download
    const download = await fetch(base + '/api/files/' + file1.id, { headers });
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), content1);
    assert.match(download.headers.get('content-disposition'), /attachment/);
    assert.equal(download.headers.get('accept-ranges'), 'bytes');
    assert.equal((await fetch(base + '/api/files/' + file1.id)).status, 401);

    // Range request (206 Partial Content for video/audio scrubbing)
    const partial = await fetch(base + '/api/files/' + file1.id + '?preview=1', { headers: { ...headers, Range: 'bytes=2-5' } });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get('content-range'), `bytes 2-5/${content1.length}`);
    assert.deepEqual(Buffer.from(await partial.arrayBuffer()), content1.subarray(2, 6));

    // Upload second file and test streaming ZIP download
    const content2 = Buffer.from('Hello ZIP world!');
    const file2 = await fetch(base + '/api/files?name=notes.txt', {
      method: 'POST',
      headers: { ...phoneHeaders, 'Content-Type': 'text/plain' },
      body: content2,
    }).then((r) => r.json());

    const zipRes = await fetch(`${base}/api/files/zip?ids=${file1.id},${file2.id}`, { headers });
    assert.equal(zipRes.status, 200);
    assert.match(zipRes.headers.get('content-type'), /application\/zip/);
    const zipBuf = Buffer.from(await zipRes.arrayBuffer());
    assert.equal(zipBuf.readUInt32LE(0), 0x04034b50); // Local file header signature
    assert.ok(zipBuf.includes(Buffer.from('Trip/Day1/photo 日本.png', 'utf8')));
    assert.ok(zipBuf.includes(Buffer.from('notes.txt', 'utf8')));
    assert.ok(zipBuf.includes(content2));
    assert.equal(zipBuf.readUInt32LE(zipBuf.length - 22), 0x06054b50); // EOCD signature

    // Text sharing + validation + CSRF check
    const text = '<script>alert(1)</script>\nhttps://example.com';
    const note = await fetch(base + '/api/text', { method: 'POST', headers: { ...phoneHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }).then((r) => r.json());
    assert.equal(note.text, text);
    assert.equal((await fetch(base + '/api/text', { method: 'POST', headers: { ...phoneHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '' }) })).status, 400);
    assert.equal((await fetch(base + '/api/text', { method: 'POST', headers: { ...phoneHeaders, Origin: 'http://evil.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'bad' }) })).status, 403);

    // Bulk delete
    const bulkRes = await fetch(base + '/api/files/bulk-delete', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [file1.id, file2.id] }),
    });
    assert.equal(bulkRes.status, 200);
    assert.equal((await bulkRes.json()).deleted, 2);
    assert.equal(fs.readdirSync(path.join(dir, 'files')).length, 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'index.json'))).length, 1);

    // Rotate pairing code
    const rotated = await fetch(base + '/api/pairing/rotate', { method: 'POST', headers }).then((r) => r.json());
    assert.match(rotated.code, /^\d{6}$/);

    // Session revocation
    const updatedState = await fetch(base + '/api/state', { headers }).then((r) => r.json());
    const phoneSession = updatedState.sessions.find((s) => !s.isDesktop);
    assert.ok(phoneSession);
    const revokeRes = await fetch(base + '/api/sessions/revoke', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: phoneSession.id }),
    });
    assert.equal(revokeRes.status, 200);
    assert.equal((await fetch(base + '/api/state', { headers: phoneHeaders })).status, 401);
  } finally {
    const ended = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await ended;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
