'use strict';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

let key = sessionStorage.getItem('nearsend-key');
const fragment = new URLSearchParams(location.hash.slice(1));
if (fragment.has('key')) {
  key = fragment.get('key');
  sessionStorage.setItem('nearsend-key', key);
  history.replaceState(null, '', location.pathname);
}

let id = sessionStorage.getItem('nearsend-id');
if (!id) {
  id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  sessionStorage.setItem('nearsend-id', id);
}

const phone = /iPhone|iPad|Android/i.test(navigator.userAgent);
const deviceName = /iPhone/i.test(navigator.userAgent)
  ? 'iPhone'
  : /iPad/i.test(navigator.userAgent)
  ? 'iPad'
  : /Android/i.test(navigator.userAgent)
  ? 'Android phone'
  : 'Windows laptop';

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
const VIDEO_MIMES = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/ogg']);
const AUDIO_MIMES = new Set(['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg', 'audio/webm']);

let state = { entries: [], peers: [], addresses: [], interfaces: [], sessions: [] };
let filter = 'all';
let navView = 'all';
let viewMode = localStorage.getItem('nearsend-view') || 'list';
let soundEnabled = localStorage.getItem('nearsend-sound') !== 'off';
let desktop = false;
let p2pMode = false;
let currentUpload = null;
let uploading = false;
let lastEntriesSig = '';
let knownIds = null;
let arrivingIds = new Set();
let selectedIds = new Set();
let selectedAddr = '';
let qrBlobUrl = null;
let eventSource = null;
let pollTimer = null;
let toastTimer = null;
let mediaList = [];
let mediaIndex = -1;
let dragDepth = 0;

const ICONS = {
  sun: '<svg class="ic-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>',
  moon: '<svg class="ic-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  bell: '<svg class="ic-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
  bellOff: '<svg class="ic-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0 1 18 8"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.33-5"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
  star: '<svg class="ic-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  play: '<svg class="ic" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>',
  text: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h4"/></svg>',
  video: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
  audio: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
  doc: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8"/></svg>',
  download: '<svg class="ic-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  trash: '<svg class="ic-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  swap: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3l4 4-4 4"/><path d="M3 7h18"/><path d="M7 21l-4-4 4-4"/><path d="M21 17H3"/></svg>',
};

// Arrival chime via Web Audio API (zero external audio files)
function applySoundUI() {
  $('#sound-toggle').innerHTML = soundEnabled ? ICONS.bell : ICONS.bellOff;
  $('#sound-toggle').title = soundEnabled ? 'Arrival chime: ON' : 'Arrival chime: OFF';
}
applySoundUI();
$('#sound-toggle').onclick = () => {
  soundEnabled = !soundEnabled;
  localStorage.setItem('nearsend-sound', soundEnabled ? 'on' : 'off');
  applySoundUI();
  if (soundEnabled) playChime();
  toast(soundEnabled ? 'Arrival chime enabled.' : 'Arrival chime muted.');
};

function playChime() {
  if (!soundEnabled) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    [[1046.5, 0], [1318.5, 0.11]].forEach(([freq, delay]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + delay);
      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.08, now + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.36);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + delay);
      osc.stop(now + delay + 0.38);
    });
    setTimeout(() => ctx.close().catch(() => {}), 700);
  } catch {}
}

// Theme management
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('#theme-toggle').innerHTML = theme === 'dark' ? ICONS.sun : ICONS.moon;
  $('#theme-meta').content = theme === 'dark' ? '#080c10' : '#eef3f6';
}
{
  const saved = localStorage.getItem('nearsend-theme');
  const initial = saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(initial);
}
$('#theme-toggle').onclick = () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('nearsend-theme', next);
  applyTheme(next);
};

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('#toast').hidden = true), 4500);
}

function setStatus(text, level = 'ok') {
  $('#server-status').textContent = text;
  const cls = level === 'ok' ? '' : level;
  $('#status-dot').className = cls;
  $('#live-dot').className = cls;
}

function headers() {
  return { Authorization: `Bearer ${key}`, 'X-Device-Id': id, 'X-Device-Name': deviceName };
}

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...headers(), ...options.headers } });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) handleUnauthorized();
    throw new Error(data.error || 'Something went wrong. Try again.');
  }
  return data;
}

function handleUnauthorized(msg) {
  sessionStorage.removeItem('nearsend-key');
  key = null;
  if (eventSource) { eventSource.close(); eventSource = null; }
  $('#pair-gate').hidden = false;
  $('#app-content').hidden = true;
  setStatus('Pairing required', 'warn');
  if (msg) toast(msg);
}

function bytes(n) {
  if (!n) return '0 B';
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), 3);
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${['B', 'KB', 'MB', 'GB'][i]}`;
}

function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return `~${Math.ceil(seconds)}s left`;
  const m = Math.floor(seconds / 60);
  const s = Math.ceil(seconds % 60);
  return `~${m}m ${s}s left`;
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function extractUrls(text) {
  const matches = String(text || '').match(/https?:\/\/[^\s<>"'`)\]]+/g) || [];
  return [...new Set(matches)].slice(0, 6);
}

function linkify(text) {
  const escaped = escapeHTML(text);
  return escaped.replace(/(https?:\/\/[^\s<>"'`)\]]+)/g, (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
}

function isPreviewable(entry) {
  return entry.kind !== 'text' && (IMAGE_MIMES.has(entry.mime) || VIDEO_MIMES.has(entry.mime) || AUDIO_MIMES.has(entry.mime));
}

function fileURL(entry, preview = false) {
  if (entry._blobUrl) return entry._blobUrl;
  return `/api/files/${entry.id}?key=${encodeURIComponent(key)}${preview ? '&preview=1' : ''}`;
}

async function copy(text) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error();
    await navigator.clipboard.writeText(text);
    toast('Copied to your clipboard.');
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.top = '0';
    document.body.append(area);
    area.select();
    area.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    area.remove();
    if (ok) toast('Copied to your clipboard.');
    else {
      showText({ text });
      toast('Press and hold the text to select and copy it.');
    }
  }
}

function showText(entry) {
  $('#text-preview').value = entry.text;
  const urls = extractUrls(entry.text);
  const linksEl = $('#text-links');
  if (urls.length) {
    linksEl.innerHTML = urls.map((u) => `<a href="${escapeHTML(u)}" target="_blank" rel="noopener noreferrer">Open ${escapeHTML(u.length > 42 ? u.slice(0, 42) + '…' : u)} ↗</a>`).join('');
    linksEl.hidden = false;
  } else {
    linksEl.hidden = true;
    linksEl.innerHTML = '';
  }
  $('#text-dialog').showModal();
}

function openMedia(entryId) {
  mediaList = getFilteredEntries().filter(isPreviewable);
  mediaIndex = mediaList.findIndex((e) => e.id === entryId);
  if (mediaIndex < 0) return;
  renderMediaStage();
  $('#media-dialog').showModal();
}

function renderMediaStage() {
  const entry = mediaList[mediaIndex];
  if (!entry) return;
  $('#media-title').textContent = entry.name;
  $('#media-download').href = fileURL(entry);
  $('#media-download').setAttribute('download', entry.name);
  $('#media-download').textContent = phone ? 'Save to Files ↓' : 'Download ↓';
  $('#media-meta').textContent = `${mediaIndex + 1} / ${mediaList.length} · ${bytes(entry.size)} · ${entry.sender}`;
  $('#media-prev').disabled = mediaIndex <= 0;
  $('#media-next').disabled = mediaIndex >= mediaList.length - 1;
  const stage = $('#media-stage');
  const src = fileURL(entry, true);
  const isImg = IMAGE_MIMES.has(entry.mime);
  const isVid = VIDEO_MIMES.has(entry.mime);
  if (isImg) {
    stage.innerHTML = `<img src="${src}" alt="${escapeHTML(entry.name)}">`;
  } else if (isVid) {
    stage.innerHTML = `<video src="${src}" controls playsinline autoplay></video>`;
  } else if (AUDIO_MIMES.has(entry.mime)) {
    stage.innerHTML = `<audio src="${src}" controls autoplay></audio>`;
  }
  const shareBtn = $('#media-share');
  const hint = $('#media-hint');
  if (isImg || isVid) {
    shareBtn.hidden = false;
    shareBtn.textContent = 'Save to Gallery';
    hint.hidden = !phone;
    if (phone) {
      hint.textContent = navigator.share
        ? 'Tap "Save to Gallery" to save directly to your Photos app.'
        : isImg
        ? 'Tap "Save to Gallery" (or press & hold the photo) → Save to Photos.'
        : 'Tap "Save to Gallery" to open in Safari, then tap Share (↑) → Save Video.';
    }
  } else {
    shareBtn.hidden = true;
    hint.hidden = true;
  }
}

async function saveToGallery(entry, btn) {
  if (!entry) return;
  const origText = btn ? btn.textContent : '';
  if (navigator.share) {
    if (btn) { btn.disabled = true; btn.textContent = 'Opening…'; }
    try {
      const blob = entry._blob || (await (await fetch(fileURL(entry, true))).blob());
      const file = new File([blob], entry.name, { type: entry.mime || blob.type });
      if (navigator.canShare && !navigator.canShare({ files: [file] })) throw new Error('unsupported');
      await navigator.share({ files: [file], title: entry.name });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = origText; }
    }
  }
  // Over plain HTTP, iPhone Safari disables navigator.share (1-tap Save Image/Video).
  // Open the lightbox so the user can press & hold the image -> Save to Photos.
  if (!$('#media-dialog').open) openMedia(entry.id);
  $('#media-hint').hidden = false;
  $('#media-hint').textContent = IMAGE_MIMES.has(entry.mime)
    ? 'Press & hold the photo above → "Save to Photos". (Run Enable HTTPS on your laptop for 1-tap Save to Gallery.)'
    : 'iPhone requires HTTPS for 1-tap Save Video to Gallery. Run "Enable HTTPS" on your laptop and reconnect.';
}

function shareCurrentMedia() {
  saveToGallery(mediaList[mediaIndex], $('#media-share'));
}

function closeMedia() {
  $('#media-stage').innerHTML = '';
  $('#media-dialog').close();
}

function getFilteredEntries() {
  const query = $('#search').value.toLowerCase().trim();
  const filtered = state.entries.filter((e) => {
    const matchFilter =
      filter === 'all' ||
      (filter === 'image' ? ['image', 'video'].includes(e.kind) : e.kind === filter);
    if (!matchFilter) return false;
    if (!query) return true;
    return `${e.name} ${e.folder || ''} ${e.text || ''} ${e.sender || ''}`.toLowerCase().includes(query);
  });
  return filtered.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
}

function setViewMode(mode, savePref = true) {
  viewMode = mode === 'grid' ? 'grid' : 'list';
  if (savePref) localStorage.setItem('nearsend-view', viewMode);
  $('#view-list').classList.toggle('active', viewMode === 'list');
  $('#view-grid').classList.toggle('active', viewMode === 'grid');
  renderFiles();
}

function updateStats() {
  const totalPeers = Math.max(1, (state.peers || []).length);
  const others = (state.peers || []).filter((p) => p.id !== id);
  $('#stat-devices').textContent = totalPeers;
  $('#stat-devices-sub').textContent = others.length ? others.map((p) => p.name).join(', ') : 'Waiting for phone';
  const pinnedCount = state.entries.filter((e) => e.pinned).length;
  $('#stat-transfers').textContent = state.entries.length;
  $('#stat-pinned').textContent = pinnedCount ? `${pinnedCount} pinned` : 'Ready to share';
  const files = state.entries.filter((e) => e.kind !== 'text');
  $('#stat-storage').textContent = bytes(files.reduce((sum, e) => sum + e.size, 0));
  $('#stat-files').textContent = `${files.length} file${files.length === 1 ? '' : 's'} on laptop`;
  const secEl = $('#stat-security');
  if (state.https || location.protocol === 'https:') {
    secEl.textContent = 'HTTPS';
    secEl.classList.add('secure');
    $('#stat-security-sub').textContent = 'Encrypted · 1-tap Gallery';
  } else {
    secEl.textContent = 'Local Wi-Fi';
    secEl.classList.remove('secure');
    $('#stat-security-sub').textContent = 'Direct LAN · No cloud';
  }
}

function updateBulkBar(matches) {
  const validIds = new Set(matches.map((e) => e.id));
  for (const sid of [...selectedIds]) if (!validIds.has(sid)) selectedIds.delete(sid);
  const count = selectedIds.size;
  $('#bulk-bar').hidden = count === 0;
  $('#selected-count').textContent = `${count} selected`;
  $('#select-all').checked = matches.length > 0 && count === matches.length;
  const selectedFiles = matches.filter((e) => selectedIds.has(e.id) && e.kind !== 'text');
  $('#download-zip').hidden = p2pMode || selectedFiles.length === 0;
}

function renderFiles() {
  const matches = getFilteredEntries();
  $('#file-count').textContent = matches.length;
  updateBulkBar(matches);
  updateStats();

  const renderItem = (e) => {
    const preview = isPreviewable(e);
    const isMedia = IMAGE_MIMES.has(e.mime) || VIDEO_MIMES.has(e.mime);
    const checked = selectedIds.has(e.id) ? 'checked' : '';
    const arriving = arrivingIds.has(e.id) ? ' arriving' : '';
    const pinCls = e.pinned ? ' pinned' : '';

    if (viewMode === 'grid') {
      const thumb =
        e.kind === 'image' && IMAGE_MIMES.has(e.mime)
          ? `<img loading="lazy" src="${fileURL(e, true)}" alt="">`
          : e.kind === 'video'
          ? `${ICONS.video}<span class="play-badge">${ICONS.play}</span>`
          : e.kind === 'text'
          ? ICONS.text
          : e.kind === 'audio'
          ? ICONS.audio
          : ICONS.doc;
      return `<div class="media-card${arriving}">
        <div class="media-card-thumb" ${preview ? `data-preview="${e.id}"` : e.kind === 'text' ? `data-open="${e.id}"` : ''}>
          ${thumb}
          <div class="media-card-top">
            <label class="media-card-check"><input type="checkbox" class="row-check" data-check="${e.id}" ${checked} aria-label="Select ${escapeHTML(e.name)}"></label>
            <button class="media-card-pin${pinCls}" data-pin="${e.id}" title="${e.pinned ? 'Unpin' : 'Pin to top'}" aria-label="Pin">${ICONS.star}</button>
          </div>
        </div>
        <div class="media-card-body">
          <div class="media-card-name" title="${escapeHTML(e.name)}">${escapeHTML(e.name || 'Shared text')}</div>
          <div class="media-card-meta">${escapeHTML(e.sender)} · ${bytes(e.size)}</div>
          <div class="media-card-actions">
            ${
              e.kind === 'text'
                ? `<button class="gallery-btn" data-copy-text="${e.id}">Copy text</button>`
                : phone && isMedia
                ? `<button class="gallery-btn" data-gallery="${e.id}">Save to Gallery</button>`
                : `<a href="${fileURL(e)}" download="${escapeHTML(e.name)}" title="Download">${ICONS.download}</a>`
            }
            ${e.kind !== 'text' && phone && isMedia ? `<a href="${fileURL(e)}" download="${escapeHTML(e.name)}" title="Save to Files">${ICONS.download}</a>` : ''}
            <button data-delete="${e.id}" title="Delete" aria-label="Delete">${ICONS.trash}</button>
          </div>
        </div>
      </div>`;
    }

    const symbol =
      e.kind === 'image' && IMAGE_MIMES.has(e.mime)
        ? `<img loading="lazy" src="${fileURL(e, true)}" alt="">`
        : e.kind === 'text'
        ? ICONS.text
        : e.kind === 'video'
        ? ICONS.video
        : e.kind === 'audio'
        ? ICONS.audio
        : ICONS.doc;
    const folderTag = e.folder ? `<span class="folder-tag" title="${escapeHTML(e.folder)}">${escapeHTML(e.folder)}</span>` : '';
    const firstUrl = e.kind === 'text' ? extractUrls(e.text)[0] : null;
    const urlHint = firstUrl ? ` · <a href="${escapeHTML(firstUrl)}" target="_blank" rel="noopener noreferrer">Open link ↗</a>` : '';
    return `<div class="file-row${arriving}">
      <input type="checkbox" class="row-check" data-check="${e.id}" ${checked} aria-label="Select ${escapeHTML(e.name)}">
      <div class="file-symbol${preview ? ' clickable' : ''}" ${preview ? `data-preview="${e.id}" title="Preview"` : ''}>${symbol}</div>
      <div class="file-info">
        <div class="file-name" title="${escapeHTML(e.name)}">${folderTag}<span>${escapeHTML(e.name || 'Shared text')}</span></div>
        <div class="file-meta">${escapeHTML(e.sender)} · ${bytes(e.size)} · ${new Date(e.created).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${urlHint}</div>
      </div>
      <div class="row-actions">
        ${
          e.kind === 'text'
            ? `<button data-copy-text="${e.id}" title="Copy text" aria-label="Copy shared text">Copy</button><button data-open="${e.id}" aria-label="Open shared text">View</button>`
            : `${phone && isMedia ? `<button class="gallery-btn" data-gallery="${e.id}" title="Save to Gallery" aria-label="Save ${escapeHTML(e.name)} to Gallery">Save to Gallery</button>` : ''}${preview ? `<button data-preview="${e.id}" title="Preview" aria-label="Preview ${escapeHTML(e.name)}">View</button>` : ''}<a href="${fileURL(e)}" download="${escapeHTML(e.name)}" aria-label="Download ${escapeHTML(e.name)}" title="Save to Files">${ICONS.download}</a>`
        }
        <button class="pin-btn${pinCls}" data-pin="${e.id}" title="${e.pinned ? 'Unpin' : 'Pin to top'}" aria-label="Pin">${ICONS.star}</button>
        <button data-delete="${e.id}" aria-label="Delete ${escapeHTML(e.name)}" title="Delete">${ICONS.trash}</button>
      </div>
    </div>`;
  };

  $('#file-list').innerHTML = matches.length
    ? viewMode === 'grid'
      ? `<div class="file-grid">${matches.map(renderItem).join('')}</div>`
      : matches.map(renderItem).join('')
    : `<div class="empty"><div class="empty-orb">${ICONS.swap}</div><div><strong>${
        $('#search').value ? 'No matching transfers' : 'A fresh start. Ready for your first file.'
      }</strong><p>${
        $('#search').value ? 'Try another name or filter.' : 'Files and shared text will land right here.'
      }</p></div></div>`;

  const files = state.entries.filter((e) => e.kind !== 'text');
  $('#storage').textContent = `${files.length} file${files.length === 1 ? '' : 's'} · ${bytes(files.reduce((sum, e) => sum + e.size, 0))} stored`;
  $('#download-all-zip').hidden = p2pMode || files.length < 2;
  $('#clear-all').hidden = state.entries.length === 0;

  const textEntries = state.entries.filter((e) => e.kind === 'text');
  const latest = textEntries[0];
  $('#latest-text').hidden = navView === 'text';
  $('#latest-text').innerHTML = latest
    ? `<div class="text-snippet"><div class="text-snippet-body">${linkify(latest.text)}</div><button class="text-button" id="copy-latest" type="button">Copy ↗</button></div>`
    : '';
  $('#copy-latest')?.addEventListener('click', () => copy(latest.text));

  // Full clipboard history in dedicated Shared Clipboard view
  const clipHistory = $('#clipboard-history');
  if (navView === 'text') {
    clipHistory.hidden = false;
    clipHistory.innerHTML = textEntries.length
      ? `<div class="clip-history">${textEntries
          .map(
            (t) => `<div class="clip-card">
            <div class="clip-card-body">${linkify(t.text)}</div>
            <div class="clip-card-foot">
              <span>${escapeHTML(t.sender)} · ${new Date(t.created).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              <div class="clip-card-actions">
                <button class="text-button" data-copy-text="${t.id}" type="button">Copy</button>
                <button class="text-button" data-open="${t.id}" type="button">Expand</button>
                <button class="text-button danger-link" data-delete="${t.id}" type="button">Delete</button>
              </div>
            </div>
          </div>`
          )
          .join('')}</div>`
      : `<div class="empty"><span>▱</span><div><strong>No shared text yet</strong><p>Paste a link or note above to share it across your devices.</p></div></div>`;
  } else {
    clipHistory.hidden = true;
  }

  // Bind row interactions
  $$('[data-check]').forEach((cb) => {
    cb.onchange = () => {
      if (cb.checked) selectedIds.add(cb.dataset.check);
      else selectedIds.delete(cb.dataset.check);
      updateBulkBar(matches);
    };
  });
  $$('[data-preview]').forEach((el) => (el.onclick = () => openMedia(el.dataset.preview)));
  $$('[data-gallery]').forEach((b) => {
    b.onclick = () => {
      const item = state.entries.find((e) => e.id === b.dataset.gallery);
      if (item) saveToGallery(item, b);
    };
  });
  $$('[data-copy-text]').forEach((b) => {
    b.onclick = () => {
      const item = state.entries.find((e) => e.id === b.dataset.copyText);
      if (item) copy(item.text);
    };
  });
  $$('[data-open]').forEach((b) => {
    b.onclick = () => {
      const item = state.entries.find((e) => e.id === b.dataset.open);
      if (item) showText(item);
    };
  });
  $$('.media-card-check').forEach((el) => (el.onclick = (ev) => ev.stopPropagation()));
  $$('[data-pin]').forEach((b) => {
    b.onclick = async (ev) => {
      ev.stopPropagation();
      if (p2pMode) {
        const item = state.entries.find((e) => e.id === b.dataset.pin);
        if (!item) return;
        item.pinned = !item.pinned;
        window.NearsendP2P.sendPin(item.id, item.pinned);
        renderFiles();
        return;
      }
      try {
        await api(`/api/files/${b.dataset.pin}/pin`, { method: 'POST' });
        await refresh();
      } catch (error) {
        toast(error.message);
      }
    };
  });
  $$('[data-delete]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('Delete this transfer?')) return;
      if (p2pMode) {
        const targetId = b.dataset.delete;
        state.entries = state.entries.filter((e) => e.id !== targetId);
        selectedIds.delete(targetId);
        window.NearsendP2P.sendDelete([targetId]);
        renderFiles();
        toast('Transfer deleted.');
        return;
      }
      try {
        await api(`/api/files/${b.dataset.delete}`, { method: 'DELETE' });
        selectedIds.delete(b.dataset.delete);
        await refresh();
        toast('Transfer deleted.');
      } catch (error) {
        toast(error.message);
      }
    };
  });
}

async function loadQr(addr) {
  if (!desktop || !key) return;
  try {
    const query = addr ? `&addr=${encodeURIComponent(addr)}` : '';
    const response = await fetch(`/api/qr?key=${encodeURIComponent(key)}${query}`);
    if (!response.ok) throw new Error();
    const blob = await response.blob();
    if (qrBlobUrl) URL.revokeObjectURL(qrBlobUrl);
    qrBlobUrl = URL.createObjectURL(blob);
    $('#qr').src = qrBlobUrl;
    $('#qr').hidden = false;
    $('#qr-fallback').hidden = true;
    $('#welcome-qr').src = qrBlobUrl;
    $('#welcome-qr').hidden = false;
    $('#welcome-qr-fallback').hidden = true;
  } catch {
    $('#qr').hidden = true;
    $('#qr-fallback').hidden = false;
    $('#qr-fallback').textContent = 'Open the address below in Safari, then enter the pairing code.';
  }
}

function renderInterfaces() {
  if (!desktop) return;
  const ifaces = state.interfaces || [];
  const select = $('#interface-select');
  if (ifaces.length > 1) {
    $('#interface-wrap').hidden = false;
    const prev = selectedAddr;
    select.innerHTML = ifaces
      .map((i) => `<option value="${escapeHTML(i.url)}">${escapeHTML(i.name)} (${escapeHTML(i.address)})</option>`)
      .join('');
    if (prev && ifaces.some((i) => i.url === prev)) {
      select.value = prev;
    } else {
      selectedAddr = ifaces[0].url;
      select.value = selectedAddr;
    }
  } else {
    $('#interface-wrap').hidden = true;
    selectedAddr = ifaces[0]?.url || state.addresses?.[0] || '';
  }
  const displayAddr = selectedAddr || 'No Wi-Fi address found';
  $('#address').value = displayAddr;
  $('#welcome-address').textContent = selectedAddr || 'Connect your laptop to Wi-Fi first.';
}

function renderSessions() {
  if (!desktop) return;
  const list = state.sessions || [];
  const remoteCount = list.filter((s) => !s.isDesktop).length;
  $('#session-badge').textContent = remoteCount ? `(${remoteCount})` : '';
  const container = $('#sessions-list');
  if (!list.length) {
    container.innerHTML = '<p>No paired devices.</p>';
    return;
  }
  container.innerHTML = list
    .map(
      (s) => `<div class="session-row">
      <div>
        <strong>${escapeHTML(s.name)} ${s.isDesktop ? '(Host)' : ''}</strong>
        <small>${escapeHTML(s.ip)} · Paired ${new Date(s.created).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
      </div>
      ${
        s.isDesktop
          ? '<span class="quiet-label">This laptop</span>'
          : `<button class="button small danger" data-revoke="${escapeHTML(s.id)}" type="button">Revoke</button>`
      }
    </div>`
    )
    .join('');

  $$('[data-revoke]').forEach((btn) => {
    btn.onclick = async () => {
      try {
        await api('/api/sessions/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: btn.dataset.revoke }),
        });
        await refresh();
        toast('Device disconnected.');
      } catch (err) {
        toast(err.message);
      }
    };
  });
}

function applyState(nextState) {
  const prevAddr = selectedAddr;
  state = nextState;
  $('#app-content').hidden = false;
  $('#pair-gate').hidden = true;
  if (state.https) $('#proto-label').textContent = 'Encrypted HTTPS';

  const others = (state.peers || []).filter((p) => p.id !== id);
  $('#welcome-status').textContent = others.length
    ? `${others[0].name} connected. You're ready to transfer.`
    : 'Waiting for your iPhone…';
  $('#peer-status').textContent = others.length
    ? `${others.length} device${others.length > 1 ? 's' : ''} connected`
    : 'Waiting for a connection';
  $('#other-device').textContent = others[0]?.name || (phone ? 'Your laptop' : 'Your iPhone');
  $('#route-status').textContent = others.length ? 'Connected over Wi-Fi' : 'Ready to connect';
  $('#device-route')?.classList.toggle('connected', others.length > 0);

  if (desktop) {
    renderInterfaces();
    $('#code').textContent = state.code || '—';
    $('#welcome-code').textContent = state.code || '';
    if (!qrBlobUrl || prevAddr !== selectedAddr) loadQr(selectedAddr);
    renderSessions();
  }

  const sig = JSON.stringify(state.entries);
  if (sig !== lastEntriesSig) {
    // Detect newly arrived entries from other devices for AirDrop chime & glow
    const currentIds = new Set(state.entries.map((e) => e.id));
    if (knownIds !== null) {
      const fresh = state.entries.filter((e) => !knownIds.has(e.id));
      if (fresh.length) {
        fresh.forEach((e) => arrivingIds.add(e.id));
        if (fresh.some((e) => e.deviceId && e.deviceId !== id)) playChime();
        setTimeout(() => fresh.forEach((e) => arrivingIds.delete(e.id)), 900);
      }
    }
    knownIds = currentIds;
    lastEntriesSig = sig;
    renderFiles();
  } else {
    updateStats();
  }
}

async function refresh() {
  if (!key) return;
  try {
    const next = await api('/api/state');
    applyState(next);
  } catch {
    if (key) setStatus('Connection interrupted · retrying', 'warn');
  }
}

function connectEvents() {
  if (!key) return;
  if (eventSource) { eventSource.close(); eventSource = null; }
  const url = `/api/events?key=${encodeURIComponent(key)}&deviceId=${encodeURIComponent(id)}&deviceName=${encodeURIComponent(deviceName)}`;
  eventSource = new EventSource(url);
  eventSource.onopen = () => {
    setStatus('Live · Local server online', 'ok');
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  };
  eventSource.addEventListener('state', (event) => {
    setStatus('Live · Local server online', 'ok');
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    applyState(JSON.parse(event.data));
  });
  eventSource.addEventListener('revoked', () => {
    handleUnauthorized('This device was disconnected by the laptop.');
  });
  eventSource.onerror = () => {
    if (!key) return;
    setStatus('Local server online', 'warn');
    if (!pollTimer) pollTimer = setInterval(refresh, 3000);
  };
}

function setFilter(value, fromNav = false) {
  filter = value;
  $$('[data-filter]').forEach((b) => {
    b.classList.toggle('selected', b.dataset.filter === value);
    b.setAttribute('aria-pressed', b.dataset.filter === value);
  });
  if (fromNav) {
    navView = value;
    document.body.classList.toggle('focus-list', value !== 'all' && value !== 'text');
    $$('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === value));
    const title = { all: 'Transfer desk', image: 'Photos & videos', document: 'Documents', text: 'Shared clipboard' }[value];
    $('.breadcrumb strong').textContent = title;
    if (value === 'text') {
      document.body.classList.remove('focus-list');
      $('#transfer-grid').hidden = true;
      $('.history-panel').hidden = true;
      $('.bottom-grid').style.gridTemplateColumns = '1fr';
    } else {
      $('#transfer-grid').hidden = value !== 'all';
      $('.history-panel').hidden = false;
      $('.bottom-grid').style.gridTemplateColumns = '';
      if (value === 'image') setViewMode('grid', false);
    }
  }
  renderFiles();
}

function upload(file, folder = '') {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    currentUpload = xhr;
    const started = performance.now();
    const folderQuery = folder ? `&folder=${encodeURIComponent(folder)}` : '';
    xhr.open('POST', `/api/files?name=${encodeURIComponent(file.name)}${folderQuery}`);
    Object.entries(headers()).forEach(([name, value]) => xhr.setRequestHeader(name, value));
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      $('#progress').value = pct;
      $('#upload-pct').textContent = `${pct}%`;
      const elapsed = (performance.now() - started) / 1000;
      if (elapsed > 0.15) {
        const bps = e.loaded / elapsed;
        const eta = formatEta((e.total - e.loaded) / Math.max(bps, 1));
        $('#upload-stats').textContent = `${bytes(bps)}/s${eta ? ` · ${eta}` : ''}`;
      }
    };
    xhr.onload = () => {
      try {
        const result = JSON.parse(xhr.responseText);
        xhr.status < 300 ? resolve(result) : reject(new Error(result.error));
      } catch {
        reject(new Error('Transfer failed. Please try again.'));
      }
    };
    xhr.onerror = () => reject(new Error('Connection lost. Keep both devices on the same Wi-Fi.'));
    xhr.onabort = () => reject(new Error('Transfer cancelled.'));
    xhr.send(file);
  });
}

async function sendFiles(items) {
  if (!key) return toast('Pair this device first.');
  if (uploading) return toast('Please wait for the current transfer.');
  if (!items.length) return;
  uploading = true;
  $('#device-route')?.classList.add('transferring');
  $('#browse').disabled = true;
  $('#browse-folder').disabled = true;
  $('#upload-progress').hidden = false;
  let completed = 0;
  try {
    for (const item of items) {
      const file = item.file || item;
      let folder = item.folder || '';
      if (!folder && file.webkitRelativePath && file.webkitRelativePath.includes('/')) {
        folder = file.webkitRelativePath.split('/').slice(0, -1).join('/');
      }
      if (file.size > (state.maxFile || 2 * 1024 ** 3)) throw new Error(`${file.name} is larger than 2 GB.`);
      $('#upload-label').textContent = `${completed + 1}/${items.length} · ${folder ? `${folder}/` : ''}${file.name}`;
      $('#upload-stats').textContent = '';
      $('#progress').value = 0;
      $('#upload-pct').textContent = '0%';
      if (p2pMode) {
        await window.NearsendP2P.sendFile(file, folder, (loaded, total, bps) => {
          const pct = total ? Math.round((loaded / total) * 100) : 100;
          $('#progress').value = pct;
          $('#upload-pct').textContent = `${pct}%`;
          if (bps > 0) {
            const eta = formatEta((total - loaded) / Math.max(bps, 1));
            $('#upload-stats').textContent = `${bytes(bps)}/s${eta ? ` · ${eta}` : ''}`;
          }
        });
        completed++;
      } else {
        await upload(file, folder);
        completed++;
        await refresh();
      }
    }
    toast(`${completed} file${completed === 1 ? '' : 's'} transferred. Ready on your other device.`);
  } catch (error) {
    toast(`${error.message}${completed ? ` ${completed} file(s) already saved.` : ''}`);
  } finally {
    uploading = false;
    $('#device-route')?.classList.remove('transferring');
    currentUpload = null;
    $('#browse').disabled = false;
    $('#browse-folder').disabled = false;
    $('#upload-progress').hidden = true;
    $('#file-input').value = '';
    $('#folder-input').value = '';
  }
}

async function readEntryTree(entry, basePath = '') {
  if (entry.isFile) {
    return new Promise((resolve) => {
      entry.file((file) => resolve([{ file, folder: basePath }]), () => resolve([]));
    });
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    const entries = [];
    const readBatch = () =>
      new Promise((resolve) => {
        reader.readEntries((batch) => resolve(batch), () => resolve([]));
      });
    let batch;
    while ((batch = await readBatch()).length) entries.push(...batch);
    const nextPath = basePath ? `${basePath}/${entry.name}` : entry.name;
    const nested = [];
    for (const child of entries) nested.push(...(await readEntryTree(child, nextPath)));
    return nested;
  }
  return [];
}

async function handleDrop(dataTransfer) {
  const dtItems = [...(dataTransfer.items || [])];
  if (dtItems.length && typeof dtItems[0].webkitGetAsEntry === 'function') {
    const collected = [];
    for (const item of dtItems) {
      const entry = item.webkitGetAsEntry();
      if (entry) collected.push(...(await readEntryTree(entry)));
    }
    if (collected.length) return sendFiles(collected);
  }
  sendFiles([...dataTransfer.files]);
}

// Event bindings
$('#browse').onclick = (e) => { e.stopPropagation(); $('#file-input').click(); };
$('#browse-folder').onclick = (e) => { e.stopPropagation(); $('#folder-input').click(); };
$('#browse-camera').onclick = (e) => { e.stopPropagation(); $('#camera-input').click(); };
$('#dropzone').onclick = () => $('#file-input').click();
$('#dropzone').onkeydown = (e) => {
  if (e.target === $('#dropzone') && ['Enter', ' '].includes(e.key)) {
    e.preventDefault();
    $('#file-input').click();
  }
};
$('#file-input').onchange = (e) => sendFiles([...e.target.files]);
$('#folder-input').onchange = (e) => sendFiles([...e.target.files]);
$('#camera-input').onchange = (e) => { sendFiles([...e.target.files]); e.target.value = ''; };
$('#cancel-upload').onclick = () => currentUpload?.abort();
$('#view-list').onclick = () => setViewMode('list');
$('#view-grid').onclick = () => setViewMode('grid');

// Fullscreen drag-anywhere drop overlay
window.addEventListener('dragenter', (e) => {
  if (!key || !e.dataTransfer?.types?.includes('Files')) return;
  e.preventDefault();
  dragDepth++;
  $('#drop-overlay').hidden = false;
});
window.addEventListener('dragover', (e) => {
  if (!key || !e.dataTransfer?.types?.includes('Files')) return;
  e.preventDefault();
});
window.addEventListener('dragleave', (e) => {
  if (!dragDepth) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) $('#drop-overlay').hidden = true;
});
window.addEventListener('drop', (e) => {
  if (!dragDepth) return;
  e.preventDefault();
  dragDepth = 0;
  $('#drop-overlay').hidden = true;
  if (e.dataTransfer?.files?.length || e.dataTransfer?.items?.length) handleDrop(e.dataTransfer);
});

['dragenter', 'dragover'].forEach((name) =>
  $('#dropzone').addEventListener(name, (e) => {
    e.preventDefault();
    $('#dropzone').classList.add('dragging');
  })
);
['dragleave', 'drop'].forEach((name) =>
  $('#dropzone').addEventListener(name, (e) => {
    e.preventDefault();
    $('#dropzone').classList.remove('dragging');
    if (name === 'drop') handleDrop(e.dataTransfer);
  })
);

document.addEventListener('paste', (e) => {
  if (e.clipboardData?.files.length) {
    e.preventDefault();
    sendFiles([...e.clipboardData.files]);
  }
});

$('#text-form').onsubmit = async (e) => {
  e.preventDefault();
  const text = $('#shared-text').value;
  if (!text.trim()) return toast('Paste or type some text first.');
  if (p2pMode) {
    window.NearsendP2P.sendText(text);
    $('#shared-text').value = '';
    toast('Text shared with connected devices.');
    return;
  }
  const button = $('#text-form button');
  button.disabled = true;
  try {
    await api('/api/text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    $('#shared-text').value = '';
    await refresh();
    toast('Text shared with your devices.');
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
};

$('#pair-form').onsubmit = async (e) => {
  e.preventDefault();
  try {
    const data = await api('/api/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: $('#pair-code').value.trim() }),
    });
    key = data.key;
    sessionStorage.setItem('nearsend-key', key);
    await refresh();
    connectEvents();
    toast('Connected. Your transfer desk is ready.');
  } catch (error) {
    toast(error.message);
  }
};

$('#interface-select').onchange = (e) => {
  selectedAddr = e.target.value;
  $('#address').value = selectedAddr;
  $('#welcome-address').textContent = selectedAddr;
  loadQr(selectedAddr);
};

async function rotateCode() {
  if (p2pMode) {
    await window.NearsendP2P.startHost();
    toast('New room code generated.');
    return;
  }
  try {
    const data = await api('/api/pairing/rotate', { method: 'POST' });
    $('#code').textContent = data.code;
    $('#welcome-code').textContent = data.code;
    toast('New pairing code generated.');
  } catch (error) {
    toast(error.message);
  }
}
$('#rotate-code').onclick = rotateCode;
$('#dialog-rotate-code').onclick = rotateCode;

$('#p2p-join-form').onsubmit = async (e) => {
  e.preventDefault();
  const codeVal = $('#p2p-join-code').value.trim();
  const btn = $('#p2p-join-form button');
  btn.disabled = true;
  try {
    await window.NearsendP2P.joinRoom(codeVal);
    $('#p2p-join-code').value = '';
    toast('Connected to device!');
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
  }
};

$('#select-all').onchange = (e) => {
  const matches = getFilteredEntries();
  if (e.target.checked) matches.forEach((item) => selectedIds.add(item.id));
  else selectedIds.clear();
  renderFiles();
};

$('#download-zip').onclick = () => {
  const ids = [...selectedIds].filter((sid) => {
    const entry = state.entries.find((e) => e.id === sid);
    return entry && entry.kind !== 'text';
  });
  if (!ids.length) return toast('Select at least one file to download as ZIP.');
  location.href = `/api/files/zip?key=${encodeURIComponent(key)}&ids=${encodeURIComponent(ids.join(','))}`;
};

$('#download-all-zip').onclick = () => {
  location.href = `/api/files/zip?key=${encodeURIComponent(key)}`;
};

$('#bulk-delete').onclick = async () => {
  const ids = [...selectedIds];
  if (!ids.length) return;
  if (!confirm(`Delete ${ids.length} selected transfer${ids.length === 1 ? '' : 's'}?`)) return;
  if (p2pMode) {
    const delSet = new Set(ids);
    state.entries = state.entries.filter((e) => !delSet.has(e.id));
    selectedIds.clear();
    window.NearsendP2P.sendDelete(ids);
    renderFiles();
    toast(`Deleted ${ids.length} transfer${ids.length === 1 ? '' : 's'}.`);
    return;
  }
  try {
    await api('/api/files/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    selectedIds.clear();
    await refresh();
    toast(`Deleted ${ids.length} transfer${ids.length === 1 ? '' : 's'}.`);
  } catch (error) {
    toast(error.message);
  }
};

$('#clear-all').onclick = async () => {
  if (!confirm('Delete ALL files and shared text?')) return;
  if (p2pMode) {
    const allIds = state.entries.map((e) => e.id);
    state.entries = [];
    selectedIds.clear();
    window.NearsendP2P.sendDelete(allIds);
    renderFiles();
    toast('All transfers cleared.');
    return;
  }
  try {
    await api('/api/files/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    });
    selectedIds.clear();
    await refresh();
    toast('All transfers cleared.');
  } catch (error) {
    toast(error.message);
  }
};

$('#open-folder').onclick = async () => {
  try {
    await api('/api/open-folder', { method: 'POST' });
    toast('Opened files folder.');
  } catch (error) {
    toast(error.message);
  }
};

$('#manage-devices').onclick = $('#header-devices').onclick = () => {
  renderSessions();
  $('#devices-dialog').showModal();
};
$('#close-devices').onclick = $('#done-devices').onclick = () => $('#devices-dialog').close();

$('#stop-server').onclick = async () => {
  if (!confirm('Stop the Nearsend background server? Paired devices will disconnect.')) return;
  try {
    await api('/api/shutdown', { method: 'POST' });
    if (eventSource) eventSource.close();
    setStatus('Server stopped', 'err');
    toast('Nearsend server stopped. You can close this window.');
  } catch (error) {
    toast(error.message);
  }
};

$('#copy-address').onclick = () => copy($('#address').value);
$('#copy-preview').onclick = () => copy($('#text-preview').value);
$('#close-dialog').onclick = () => $('#text-dialog').close();
$('#close-media').onclick = closeMedia;
$('#media-share').onclick = shareCurrentMedia;
$('#media-dialog').addEventListener('cancel', closeMedia);
$('#media-prev').onclick = () => { if (mediaIndex > 0) { mediaIndex--; renderMediaStage(); } };
$('#media-next').onclick = () => { if (mediaIndex < mediaList.length - 1) { mediaIndex++; renderMediaStage(); } };
document.addEventListener('keydown', (e) => {
  if (!$('#media-dialog').open) return;
  if (e.key === 'ArrowLeft' && mediaIndex > 0) { mediaIndex--; renderMediaStage(); }
  if (e.key === 'ArrowRight' && mediaIndex < mediaList.length - 1) { mediaIndex++; renderMediaStage(); }
});

$('#help').onclick = () => $('#help-dialog').showModal();
$('#close-help').onclick = () => $('#help-dialog').close();
$('#close-welcome').onclick = $('#welcome-done').onclick = () => $('#welcome-dialog').close();
$('#connect').onclick = () => {
  setFilter('all', true);
  $('#connection-panel').classList.add('show', 'highlight');
  $('#connection-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => $('#connection-panel').classList.remove('highlight'), 2500);
};
$('#search').oninput = renderFiles;
$$('[data-filter]').forEach((b) => (b.onclick = () => setFilter(b.dataset.filter)));
$$('[data-view]').forEach((b) => (b.onclick = () => setFilter(b.dataset.view, true)));

async function init() {
  $('#this-device').textContent = `This ${deviceName}`;
  if (phone) {
    $('.clipboard-actions > span').textContent = 'Press and hold to paste';
    $('.dropzone > strong').textContent = 'Send files to your laptop';
    $('#browse-folder').hidden = true;
    $('#browse-camera').hidden = false;
  }
  $('#view-list').classList.toggle('active', viewMode === 'list');
  $('#view-grid').classList.toggle('active', viewMode === 'grid');
  try {
    const setup = await fetch('/api/setup').then((r) => r.json());
    if (setup.mode === 'p2p') {
      p2pMode = true;
      desktop = true;
      key = 'p2p';
      state.https = true;
      $('#app-content').hidden = false;
      $('#pair-gate').hidden = true;
      $('#p2p-join-form').hidden = false;
      $('#proto-label').textContent = 'Encrypted WebRTC P2P';
      $('.panel-foot span:first-child').textContent = 'Direct peer-to-peer · Zero cloud storage';
      $('#download-all-zip').hidden = true;
      $('#download-zip').hidden = true;
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = '/p2p.js';
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
      await window.NearsendP2P.init({
        deviceId: id,
        deviceName,
        getEntries: () => state.entries,
        onRoomReady: async (code, link) => {
          $('#code').textContent = code;
          $('#address').value = link;
          try {
            const r = await fetch(`/api/qr?link=${encodeURIComponent(link)}`);
            if (r.ok) {
              const blob = await r.blob();
              if (qrBlobUrl) URL.revokeObjectURL(qrBlobUrl);
              qrBlobUrl = URL.createObjectURL(blob);
              $('#qr').src = qrBlobUrl;
              $('#qr').hidden = false;
              $('#qr-fallback').hidden = true;
            }
          } catch {}
        },
        onPeers: (peerList) => {
          state.peers = peerList;
          const others = peerList.filter((p) => p.id !== id);
          $('#peer-status').textContent = others.length ? `${others.length} device${others.length > 1 ? 's' : ''} connected` : 'Waiting for a connection';
          $('#other-device').textContent = others[0]?.name || (phone ? 'Your laptop' : 'Your iPhone');
          $('#route-status').textContent = others.length ? 'Connected via WebRTC' : 'Scan QR or enter code';
          $('#device-route')?.classList.toggle('connected', others.length > 0);
          updateStats();
        },
        onEntry: (entry, fromRemote) => {
          if (state.entries.some((e) => e.id === entry.id)) return;
          state.entries.unshift(entry);
          if (fromRemote) {
            arrivingIds.add(entry.id);
            playChime();
            setTimeout(() => arrivingIds.delete(entry.id), 900);
          }
          renderFiles();
        },
        onPinRemote: (entryId, pinned) => {
          const item = state.entries.find((e) => e.id === entryId);
          if (item) { item.pinned = pinned; renderFiles(); }
        },
        onDeleteRemote: (ids) => {
          const del = new Set(ids);
          state.entries = state.entries.filter((e) => !del.has(e.id));
          renderFiles();
        },
        onReceiveProgress: (name, pct) => {
          $('#upload-progress').hidden = false;
          $('#upload-label').textContent = `Receiving · ${name}`;
          $('#upload-pct').textContent = `${pct}%`;
          $('#progress').value = pct;
        },
        onReceiveDone: () => {
          $('#upload-progress').hidden = true;
        },
        onStatus: (text, level) => setStatus(text, level),
        onToast: (msg) => toast(msg),
      });
      renderFiles();
      return;
    }

    desktop = setup.desktop;
    if (desktop) {
      key = setup.key;
      sessionStorage.setItem('nearsend-key', key);
      $$('.desktop-only').forEach((el) => (el.hidden = false));
    } else {
      $('.qr-frame').hidden = true;
      $('#desktop-pairing').hidden = true;
      $('#phone-pairing').hidden = false;
      $('.connection-copy').textContent = 'Your devices share a single transfer inbox.';
    }
    if (key) {
      await refresh();
      connectEvents();
    } else {
      $('#pair-gate').hidden = false;
      setStatus('Pairing required', 'warn');
    }
    if (desktop && new URLSearchParams(location.search).has('connect')) {
      $('#welcome-dialog').showModal();
    }
    renderFiles();
  } catch {
    setStatus('Server unavailable', 'err');
    toast('Start Nearsend on your laptop, then reload this page.');
  }
}

init();
