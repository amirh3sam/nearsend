'use strict';

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const { spawn } = require('node:child_process');
const { generateQrSvg } = require('./lib/qr');
const { streamZip } = require('./lib/zip');

const PORT = Number(process.env.PORT || 3210);
const ROOT = path.join(__dirname, 'public');
const DATA = process.env.NEARSEND_DATA || path.join(__dirname, 'data');
const FILES_DIR = path.join(DATA, 'files');
fs.mkdirSync(FILES_DIR, { recursive: true });

const certPath = process.env.NEARSEND_CERT || path.join(DATA, 'cert.pem');
const keyPath = process.env.NEARSEND_KEY || path.join(DATA, 'key.pem');
const useHttps = fs.existsSync(certPath) && fs.existsSync(keyPath);
const proto = useHttps ? 'https' : 'http';

const indexPath = path.join(DATA, 'index.json');
let entries = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, 'utf8')) : [];
const secret = crypto.randomBytes(24).toString('hex');
let code = String(crypto.randomInt(100000, 1000000));

const sessions = new Map([
  [secret, { id: 'desktop', token: secret, name: 'This laptop', ip: '127.0.0.1', created: new Date().toISOString(), lastSeen: Date.now(), isDesktop: true }],
]);
const peers = new Map();
const attempts = new Map();
const sseClients = new Set();
const qrCache = new Map();
const MAX_FILE = 2 * 1024 ** 3;

const SAFE_PREVIEW_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif',
  'video/mp4', 'video/webm', 'video/quicktime', 'video/ogg',
  'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg', 'audio/webm',
]);

const save = () => {
  fs.writeFileSync(indexPath + '.tmp', JSON.stringify(entries));
  fs.renameSync(indexPath + '.tmp', indexPath);
};

function getInterfaces() {
  const virtualRe = /vethernet|wsl|docker|virtualbox|vmware|hyper-v|vbox|tailscale|zerotier|loopback|nordlynx|wireguard/i;
  const list = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const n of addrs || []) {
      if (n.family !== 'IPv4' || n.internal || n.address.startsWith('169.254.')) continue;
      list.push({ name, address: n.address, url: `${proto}://${n.address}:${PORT}` });
    }
  }
  const rank = (item) => {
    let score = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(item.address) ? 0 : 2;
    if (virtualRe.test(item.name)) score += 3;
    else if (/wi-?fi|wlan|wireless/i.test(item.name)) score -= 1;
    return score;
  };
  return list.sort((a, b) => rank(a) - rank(b));
}

const addresses = () => getInterfaces().map((i) => i.url);

const json = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
};

const local = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

const token = (req, url) => req.headers.authorization?.replace(/^Bearer /, '') || url.searchParams.get('key');

const authed = (req, url) => {
  const t = token(req, url);
  if (!t || !sessions.has(t)) return false;
  sessions.get(t).lastSeen = Date.now();
  return true;
};

function sameOrigin(req) {
  if (!req.headers.origin) return true;
  return req.headers.origin === `${proto}://${req.headers.host}`;
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''));
  const bufB = Buffer.from(String(b || ''));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

async function body(req, max = 65536) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new Error('Message is too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}

function device(req, url) {
  return String(req.headers['x-device-name'] || url?.searchParams.get('deviceName') || 'Connected device').slice(0, 60);
}

function prunePeers() {
  const now = Date.now();
  const activeSseIds = new Set([...sseClients].map((c) => c.deviceId).filter(Boolean));
  for (const [peerId, peer] of peers) {
    if (!activeSseIds.has(peerId) && now - peer.seen > 15000) peers.delete(peerId);
  }
}

function buildState(isLocal) {
  prunePeers();
  const ifaces = getInterfaces();
  const addrs = ifaces.map((i) => i.url);
  return {
    version: '2.0.0',
    https: useHttps,
    entries,
    peers: [...peers.values()],
    addresses: addrs,
    interfaces: ifaces,
    code: isLocal ? code : null,
    link: isLocal ? `${addrs[0] || `${proto}://localhost:${PORT}`}/#key=${secret}` : null,
    sessions: isLocal
      ? [...sessions.values()].map(({ id, name, ip, created, lastSeen, isDesktop }) => ({ id, name, ip, created, lastSeen, isDesktop }))
      : null,
    maxFile: MAX_FILE,
  };
}

function broadcastState() {
  if (!sseClients.size) return;
  let localPayload = null;
  let remotePayload = null;
  for (const client of sseClients) {
    if (client.res.destroyed) { sseClients.delete(client); continue; }
    if (client.isLocal) {
      if (!localPayload) localPayload = `event: state\ndata: ${JSON.stringify(buildState(true))}\n\n`;
      client.res.write(localPayload);
    } else {
      if (!remotePayload) remotePayload = `event: state\ndata: ${JSON.stringify(buildState(false))}\n\n`;
      client.res.write(remotePayload);
    }
  }
}

function getQrForAddress(addr) {
  const valid = new Set([...addresses(), `${proto}://localhost:${PORT}`, `${proto}://127.0.0.1:${PORT}`]);
  const base = addr && valid.has(addr) ? addr : (addresses()[0] || `${proto}://localhost:${PORT}`);
  const link = `${base}/#key=${secret}`;
  let svg = qrCache.get(link);
  if (!svg) {
    svg = Buffer.from(generateQrSvg(link), 'utf8');
    qrCache.set(link, svg);
  }
  return svg;
}

function sanitizeFolder(raw) {
  if (!raw) return '';
  return String(raw)
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.replace(/[\x00-\x1f<>:"|?*]/g, '_').trim())
    .filter((s) => s && s !== '.' && s !== '..')
    .join('/')
    .slice(0, 240);
}

const requestHandler = async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self'; font-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"
  );

  try {
    const url = new URL(req.url, `${proto}://${req.headers.host}`);
    if (!sameOrigin(req)) return json(res, 403, { error: 'Open Nearsend directly on your device.' });

    if (req.method === 'GET' && url.pathname === '/api/setup') {
      if (!local(req)) return json(res, 200, { desktop: false, https: useHttps });
      return json(res, 200, { desktop: true, key: secret, https: useHttps });
    }

    if (req.method === 'POST' && url.pathname === '/api/pair') {
      const ip = req.socket.remoteAddress;
      const now = Date.now();
      let record = attempts.get(ip);
      if (!record || now - record.start > 60000) record = { start: now, count: 0 };
      record.count++;
      attempts.set(ip, record);
      if (record.count > 10) return json(res, 429, { error: 'Too many attempts. Try again in one minute.' });
      const data = await body(req);
      if (!safeEqual(data.code, code)) return json(res, 401, { error: 'That code does not match. Check your laptop.' });
      const key = crypto.randomBytes(24).toString('hex');
      sessions.set(key, {
        id: crypto.randomUUID().slice(0, 8),
        token: key,
        name: device(req, url),
        ip: String(ip || '').replace(/^::ffff:/, ''),
        created: new Date().toISOString(),
        lastSeen: Date.now(),
        isDesktop: false,
      });
      broadcastState();
      return json(res, 200, { key });
    }

    if (url.pathname.startsWith('/api/')) {
      if (!authed(req, url)) return json(res, 401, { error: 'Pair this device to continue.' });
      const reqToken = token(req, url);
      const isLocal = local(req);

      if (req.method === 'GET' && url.pathname === '/api/events') {
        const deviceId = String(req.headers['x-device-id'] || url.searchParams.get('deviceId') || '').slice(0, 80);
        const deviceName = device(req, url);
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write(': connected\n\n');
        const client = { res, isLocal, token: reqToken, deviceId };
        sseClients.add(client);
        if (deviceId) {
          peers.set(deviceId, { id: deviceId, name: deviceName, seen: Date.now() });
          if (sessions.has(reqToken) && !sessions.get(reqToken).isDesktop) {
            sessions.get(reqToken).name = deviceName;
          }
        }
        res.write(`event: state\ndata: ${JSON.stringify(buildState(isLocal))}\n\n`);
        broadcastState();

        const heartbeat = setInterval(() => {
          if (res.destroyed) { clearInterval(heartbeat); return; }
          if (deviceId && peers.has(deviceId)) peers.get(deviceId).seen = Date.now();
          res.write(': ping\n\n');
        }, 15000);

        req.on('close', () => {
          clearInterval(heartbeat);
          sseClients.delete(client);
          if (deviceId) {
            const stillConnected = [...sseClients].some((c) => c.deviceId === deviceId);
            if (!stillConnected) peers.delete(deviceId);
          }
          broadcastState();
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/state') {
        const id = String(req.headers['x-device-id'] || '').slice(0, 80);
        if (id) peers.set(id, { id, name: device(req, url), seen: Date.now() });
        return json(res, 200, buildState(isLocal));
      }

      if (req.method === 'GET' && url.pathname === '/api/qr') {
        if (!isLocal) return json(res, 404, { error: 'Use the address and pairing code instead.' });
        const svg = getQrForAddress(url.searchParams.get('addr'));
        res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
        return res.end(svg);
      }

      if (req.method === 'POST' && url.pathname === '/api/sessions/revoke') {
        if (!isLocal) return json(res, 403, { error: 'Only available on the host laptop.' });
        const data = await body(req);
        let revokedToken = null;
        for (const [tok, sess] of sessions) {
          if (sess.id === data.id && !sess.isDesktop) {
            revokedToken = tok;
            sessions.delete(tok);
            break;
          }
        }
        if (!revokedToken) return json(res, 404, { error: 'Session not found.' });
        for (const client of sseClients) {
          if (client.token === revokedToken) {
            if (client.deviceId) peers.delete(client.deviceId);
            client.res.write('event: revoked\ndata: {}\n\n');
            client.res.end();
            sseClients.delete(client);
          }
        }
        broadcastState();
        return json(res, 200, { ok: true });
      }

      if (req.method === 'POST' && url.pathname === '/api/pairing/rotate') {
        if (!isLocal) return json(res, 403, { error: 'Only available on the host laptop.' });
        code = String(crypto.randomInt(100000, 1000000));
        broadcastState();
        return json(res, 200, { code });
      }

      if (req.method === 'POST' && url.pathname === '/api/open-folder') {
        if (!isLocal) return json(res, 403, { error: 'Only available on the host laptop.' });
        const target = FILES_DIR;
        if (process.platform === 'win32') {
          spawn('explorer.exe', [target], { detached: true, stdio: 'ignore' }).unref();
        } else if (process.platform === 'darwin') {
          spawn('open', [target], { detached: true, stdio: 'ignore' }).unref();
        } else {
          spawn('xdg-open', [target], { detached: true, stdio: 'ignore' }).unref();
        }
        return json(res, 200, { ok: true, path: target });
      }

      if (req.method === 'POST' && url.pathname === '/api/shutdown') {
        if (!isLocal) return json(res, 403, { error: 'Only available on the host laptop.' });
        json(res, 200, { ok: true });
        for (const client of sseClients) {
          try { client.res.end(); } catch {}
        }
        sseClients.clear();
        setTimeout(() => {
          server.close(() => process.exit(0));
          setTimeout(() => process.exit(0), 500).unref();
        }, 50);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/text') {
        const data = await body(req);
        if (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 50000) {
          return json(res, 400, { error: 'Enter between 1 and 50,000 characters.' });
        }
        const entry = {
          id: crypto.randomUUID(),
          kind: 'text',
          text: data.text,
          name: data.text.trim().split('\n')[0].slice(0, 100),
          size: Buffer.byteLength(data.text),
          created: new Date().toISOString(),
          sender: device(req, url),
          deviceId: req.headers['x-device-id'],
        };
        entries.unshift(entry);
        save();
        broadcastState();
        return json(res, 201, entry);
      }

      if (req.method === 'POST' && url.pathname === '/api/files') {
        const name = (url.searchParams.get('name') || 'Untitled').replace(/[\\/\x00-\x1f]/g, '_').slice(0, 240);
        const folder = sanitizeFolder(url.searchParams.get('folder'));
        const id = crypto.randomUUID();
        const target = path.join(FILES_DIR, id);
        let size = 0;
        if (Number(req.headers['content-length']) > MAX_FILE) {
          return json(res, 413, { error: 'Files must be 2 GB or smaller.' });
        }
        const limiter = new Transform({
          transform(chunk, encoding, callback) {
            size += chunk.length;
            callback(size > MAX_FILE ? new Error('Files must be 2 GB or smaller.') : null, chunk);
          },
        });
        try {
          await pipeline(req, limiter, fs.createWriteStream(target, { flags: 'wx' }));
        } catch (error) {
          await fs.promises.rm(target, { force: true });
          throw error;
        }
        const mime = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0];
        const kind = mime.startsWith('image/')
          ? 'image'
          : mime.startsWith('video/')
          ? 'video'
          : mime.startsWith('audio/')
          ? 'audio'
          : 'document';
        const entry = {
          id,
          kind,
          name,
          folder: folder || undefined,
          mime,
          size,
          created: new Date().toISOString(),
          sender: device(req, url),
          deviceId: req.headers['x-device-id'],
        };
        entries.unshift(entry);
        save();
        broadcastState();
        return json(res, 201, entry);
      }

      if (req.method === 'GET' && url.pathname === '/api/files/zip') {
        const idsParam = url.searchParams.get('ids');
        const idSet = idsParam ? new Set(idsParam.split(',').filter(Boolean)) : null;
        const selected = entries.filter((e) => e.kind !== 'text' && (!idSet || idSet.has(e.id)));
        if (!selected.length) return json(res, 404, { error: 'No files selected for download.' });
        const zipItems = selected.map((e) => ({
          path: path.join(FILES_DIR, e.id),
          name: e.folder ? `${e.folder}/${e.name}` : e.name,
          created: e.created,
        }));
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="nearsend-files.zip"',
          'Cache-Control': 'no-store',
        });
        await streamZip(res, zipItems);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/files/bulk-delete') {
        const data = await body(req);
        const toDelete = data.all
          ? [...entries]
          : entries.filter((e) => Array.isArray(data.ids) && data.ids.includes(e.id));
        const deleteIds = new Set(toDelete.map((e) => e.id));
        for (const entry of toDelete) {
          if (entry.kind !== 'text') await fs.promises.rm(path.join(FILES_DIR, entry.id), { force: true });
        }
        entries = entries.filter((e) => !deleteIds.has(e.id));
        save();
        broadcastState();
        return json(res, 200, { ok: true, deleted: deleteIds.size });
      }

      const pinMatch = url.pathname.match(/^\/api\/files\/([a-f0-9-]{36})\/pin$/);
      if (pinMatch && req.method === 'POST') {
        const entry = entries.find((e) => e.id === pinMatch[1]);
        if (!entry) return json(res, 404, { error: 'This transfer no longer exists.' });
        entry.pinned = !entry.pinned;
        save();
        broadcastState();
        return json(res, 200, { ok: true, pinned: entry.pinned });
      }

      const match = url.pathname.match(/^\/api\/files\/([a-f0-9-]{36})$/);
      if (match) {
        const entry = entries.find((e) => e.id === match[1]);
        if (!entry) return json(res, 404, { error: 'This transfer no longer exists.' });
        if (req.method === 'DELETE') {
          if (entry.kind !== 'text') await fs.promises.rm(path.join(FILES_DIR, entry.id), { force: true });
          entries = entries.filter((e) => e.id !== entry.id);
          save();
          broadcastState();
          return json(res, 200, { ok: true });
        }
        if (req.method === 'GET' && entry.kind !== 'text') {
          const filePath = path.join(FILES_DIR, entry.id);
          if (!fs.existsSync(filePath)) return json(res, 404, { error: 'File is missing from disk.' });
          const inline = url.searchParams.get('preview') === '1' && SAFE_PREVIEW_MIMES.has(entry.mime);
          const contentType = inline ? entry.mime : 'application/octet-stream';
          const disposition = `${inline ? 'inline' : 'attachment'}; filename="download"; filename*=UTF-8''${encodeURIComponent(entry.name).replace(/'/g, '%27')}`;
          const total = entry.size;
          const rangeHeader = req.headers.range;

          if (rangeHeader && total > 0) {
            const rangeMatch = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
            if (rangeMatch) {
              const start = rangeMatch[1] ? parseInt(rangeMatch[1], 10) : 0;
              const end = rangeMatch[2] ? Math.min(parseInt(rangeMatch[2], 10), total - 1) : total - 1;
              if (start > end || start >= total) {
                res.writeHead(416, { 'Content-Range': `bytes */${total}` });
                return res.end();
              }
              res.writeHead(206, {
                'Content-Type': contentType,
                'Content-Length': end - start + 1,
                'Content-Range': `bytes ${start}-${end}/${total}`,
                'Accept-Ranges': 'bytes',
                'Content-Disposition': disposition,
                'Cache-Control': 'no-store',
              });
              fs.createReadStream(filePath, { start, end }).on('error', () => res.destroy()).pipe(res);
              return;
            }
          }

          res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': total,
            'Accept-Ranges': 'bytes',
            'Content-Disposition': disposition,
            'Cache-Control': 'no-store',
          });
          fs.createReadStream(filePath).on('error', () => res.destroy()).pipe(res);
          return;
        }
      }
      return json(res, 404, { error: 'Not found.' });
    }

    if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed.' });
    const routes = {
      '/': ['index.html', 'text/html'],
      '/app.js': ['app.js', 'text/javascript'],
      '/style.css': ['style.css', 'text/css'],
      '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
      '/manifest.json': ['manifest.json', 'application/manifest+json'],
    };
    const asset = routes[url.pathname];
    if (!asset) return json(res, 404, { error: 'Not found.' });
    res.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8`, 'Cache-Control': 'no-cache' });
    fs.createReadStream(path.join(ROOT, asset[0])).pipe(res);
  } catch (error) {
    if (!res.headersSent && !res.destroyed) {
      json(res, 400, { error: error instanceof SyntaxError ? 'Invalid request.' : error.message });
    }
  }
};

const server = useHttps
  ? https.createServer({ cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }, requestHandler)
  : http.createServer(requestHandler);

server.requestTimeout = 0;
server.listen(PORT, '0.0.0.0', () => {
  const addrs = addresses();
  console.log(
    `\n  Nearsend v2 is ready (${proto.toUpperCase()})\n  Laptop: ${proto}://localhost:${PORT}\n  iPhone: ${addrs.join(' or ') || 'Connect to Wi-Fi'}\n  Keep this window open while transferring.\n`
  );
});
