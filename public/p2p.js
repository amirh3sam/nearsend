'use strict';

// Nearsend Cloud P2P Engine (WebRTC DataChannels via PeerJS signaling)
// Loaded only when running on Vercel / static HTTPS hosting (zero impact on local Node.js mode).
window.NearsendP2P = (() => {
  const CHUNK_SIZE = 64 * 1024;
  let peer = null;
  let roomCode = '';
  let connections = new Map(); // peerId -> { conn, deviceId, name }
  let incoming = new Map();    // fileId -> { meta, chunks, received }
  let hooks = null;

  function loadPeerJS() {
    if (window.Peer) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Could not load P2P signaling client.'));
      document.head.appendChild(s);
    });
  }

  function randomCode() {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return String(100000 + (arr[0] % 900000));
  }

  function roomLink(code) {
    return `${location.origin}/#room=${code}`;
  }

  function syncPeers() {
    const list = [{ id: hooks.deviceId, name: hooks.deviceName }];
    for (const info of connections.values()) {
      if (info.deviceId) list.push({ id: info.deviceId, name: info.name || 'Connected device' });
    }
    hooks.onPeers(list);
  }

  function broadcast(payload) {
    for (const { conn } of connections.values()) {
      if (conn.open) conn.send(payload);
    }
  }

  function bindConnection(conn) {
    const key = conn.peer;
    conn.on('open', () => {
      connections.set(key, { conn, deviceId: '', name: 'Connected device' });
      conn.send({ type: 'hello', deviceId: hooks.deviceId, name: hooks.deviceName });
      // Sync existing text entries to newly joined peer
      for (const e of hooks.getEntries().filter((x) => x.kind === 'text').slice(0, 20)) {
        conn.send({ type: 'text', entry: e, silent: true });
      }
      syncPeers();
      hooks.onStatus('P2P Encrypted · Connected', 'ok');
    });

    conn.on('data', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'hello') {
        const info = connections.get(key);
        if (info) {
          info.deviceId = msg.deviceId;
          info.name = msg.name;
          syncPeers();
          hooks.onToast(`${msg.name} connected via encrypted WebRTC.`);
        }
      } else if (msg.type === 'text') {
        hooks.onEntry(msg.entry, !msg.silent);
      } else if (msg.type === 'file-start') {
        incoming.set(msg.meta.id, { meta: msg.meta, chunks: [], received: 0 });
        hooks.onReceiveProgress(msg.meta.name, 0);
      } else if (msg.type === 'file-chunk') {
        const rec = incoming.get(msg.id);
        if (!rec) return;
        rec.chunks.push(msg.chunk);
        rec.received += msg.chunk.byteLength || msg.chunk.size || 0;
        const pct = rec.meta.size ? Math.min(100, Math.round((rec.received / rec.meta.size) * 100)) : 100;
        hooks.onReceiveProgress(rec.meta.name, pct);
      } else if (msg.type === 'file-end') {
        const rec = incoming.get(msg.id);
        if (!rec) return;
        incoming.delete(msg.id);
        const blob = new Blob(rec.chunks, { type: rec.meta.mime || 'application/octet-stream' });
        const entry = { ...rec.meta, _blobUrl: URL.createObjectURL(blob), _blob: blob };
        hooks.onReceiveDone();
        hooks.onEntry(entry, true);
      } else if (msg.type === 'pin') {
        hooks.onPinRemote(msg.id, msg.pinned);
      } else if (msg.type === 'delete') {
        hooks.onDeleteRemote(msg.ids);
      }
    });

    conn.on('close', () => {
      connections.delete(key);
      syncPeers();
      if (!connections.size) hooks.onStatus('P2P Ready · Waiting for device', 'ok');
    });

    conn.on('error', () => {
      connections.delete(key);
      syncPeers();
    });
  }

  function startHost(code) {
    return new Promise((resolve, reject) => {
      if (peer) { try { peer.destroy(); } catch {} }
      connections.clear();
      roomCode = code || randomCode();
      const peerId = `nearsend-v2-${roomCode}`;
      peer = new window.Peer(peerId, {
        debug: 0,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
          ],
        },
      });
      peer.on('open', () => {
        hooks.onRoomReady(roomCode, roomLink(roomCode));
        hooks.onStatus('P2P Ready · Encrypted', 'ok');
        syncPeers();
        resolve(roomCode);
      });
      peer.on('connection', (conn) => bindConnection(conn));
      peer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
          startHost(randomCode()).then(resolve, reject);
        } else {
          hooks.onStatus('P2P signaling reconnecting…', 'warn');
        }
      });
    });
  }

  function joinRoom(targetCode) {
    const clean = String(targetCode || '').replace(/\D/g, '').slice(0, 6);
    if (clean.length !== 6) return Promise.reject(new Error('Enter a 6-digit pairing code.'));
    return new Promise((resolve, reject) => {
      const connect = () => {
        hooks.onStatus('Connecting to device…', 'warn');
        const conn = peer.connect(`nearsend-v2-${clean}`, { reliable: true });
        const timer = setTimeout(() => {
          if (!conn.open) reject(new Error('Could not reach that code. Make sure Nearsend is open on the other device.'));
        }, 12000);
        conn.on('open', () => { clearTimeout(timer); resolve(); });
        conn.on('error', (e) => { clearTimeout(timer); reject(e); });
        bindConnection(conn);
      };
      if (peer && !peer.destroyed && peer.open) {
        connect();
      } else {
        peer = new window.Peer(undefined, {
          debug: 0,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' },
            ],
          },
        });
        peer.on('open', connect);
        peer.on('error', (e) => reject(new Error(e.message || 'Connection failed.')));
      }
    });
  }

  async function sendFile(file, folder, onProgress) {
    const mime = file.type || 'application/octet-stream';
    const kind = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'document';
    const meta = {
      id: crypto.randomUUID(),
      kind,
      name: file.name,
      folder: folder || undefined,
      mime,
      size: file.size,
      created: new Date().toISOString(),
      sender: hooks.deviceName,
      deviceId: hooks.deviceId,
    };

    const localEntry = { ...meta, _blobUrl: URL.createObjectURL(file), _blob: file };
    const activeConns = [...connections.values()].filter((c) => c.conn.open);

    if (activeConns.length) {
      broadcast({ type: 'file-start', meta });
      let offset = 0;
      const started = performance.now();
      while (offset < file.size) {
        const slice = file.slice(offset, offset + CHUNK_SIZE);
        const buf = await slice.arrayBuffer();
        // Backpressure check on WebRTC dataChannel
        for (const { conn } of activeConns) {
          const dc = conn.dataChannel;
          while (dc && dc.bufferedAmount > 4 * 1024 * 1024) {
            await new Promise((r) => setTimeout(r, 25));
          }
          if (conn.open) conn.send({ type: 'file-chunk', id: meta.id, chunk: buf });
        }
        offset += buf.byteLength;
        const elapsed = (performance.now() - started) / 1000;
        onProgress(offset, file.size, elapsed > 0.1 ? offset / elapsed : 0);
      }
      broadcast({ type: 'file-end', id: meta.id });
    } else {
      onProgress(file.size, file.size, 0);
    }

    hooks.onEntry(localEntry, false);
    return localEntry;
  }

  function sendText(text) {
    const entry = {
      id: crypto.randomUUID(),
      kind: 'text',
      text,
      name: text.trim().split('\n')[0].slice(0, 100),
      size: new TextEncoder().encode(text).length,
      created: new Date().toISOString(),
      sender: hooks.deviceName,
      deviceId: hooks.deviceId,
    };
    broadcast({ type: 'text', entry });
    hooks.onEntry(entry, false);
    return entry;
  }

  function sendPin(id, pinned) { broadcast({ type: 'pin', id, pinned }); }
  function sendDelete(ids) { broadcast({ type: 'delete', ids }); }

  async function init(callbacks) {
    hooks = callbacks;
    await loadPeerJS();
    const hashParams = new URLSearchParams(location.hash.slice(1));
    const joinCode = hashParams.get('room');
    if (joinCode) {
      history.replaceState(null, '', location.pathname);
      await startHost();
      try {
        await joinRoom(joinCode);
        hooks.onToast('Connected! Ready for encrypted P2P transfers.');
      } catch (err) {
        hooks.onToast(err.message);
      }
    } else {
      await startHost();
    }
  }

  return { init, startHost, joinRoom, sendFile, sendText, sendPin, sendDelete, getCode: () => roomCode };
})();
