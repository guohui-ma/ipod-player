// ===== DOM References =====
const $ = (sel) => document.querySelector(sel);
const songTitle = $('#song-title');
const songArtist = $('#song-artist');
const songAlbum = $('#song-album');
const songLyric = $('#song-lyric');
const albumCover = $('#album-cover');
const screenBg = $('#screen-bg');
const timeCurrent = $('#time-current');
const timeTotal = $('#time-total');
const progressFill = $('#progress-fill');
const progressBg = $('#progress-bg');
const sourceLabel = $('#source-label');
const trackCount = $('#track-count');
const statusTimeEl = $('#status-time');
const playModeIcon = $('#play-mode-icon');
const batteryText = $('#battery-text');
const spectrumCanvas = $('#spectrum-canvas');
const spectrumCtx = spectrumCanvas.getContext('2d');

// Songs view
const viewNowPlaying = $('#view-now-playing');
const viewSongs = $('#view-songs');
const viewSettings = $('#view-settings');
const songsList = $('#songs-list');
const songsInfo = $('#songs-info');
const songsBreadcrumb = $('#songs-breadcrumb');
const songsBackBtn = $('#songs-back-btn');
const searchInput = $('#search-input');
const searchClearBtn = $('#search-clear-btn');
const settingsContent = $('#settings-content');
const settingsBackBtn = $('#settings-back-btn');
const sourceList = $('#source-list');
const btnShowAddSource = $('#btn-show-add-source');
const addSourceForm = $('#add-source-form');
const newSourceName = $('#new-source-name');
const newSourcePath = $('#new-source-path');

// Click wheel
const wheelCenter = $('#wheel-center');
const wTop = $('#w-top');
const wLeft = $('#w-left');
const wRight = $('#w-right');
const wBottom = $('#w-bottom');

// Action icons
const btnSettings = $('#btn-settings');
const btnPlaylist = $('#btn-playlist');
const landscapeToggleBtn = $('#landscape-toggle');


// ===== State =====
const state = {
  root: '',
  currentDir: '',
  folders: [],
  files: [],
  currentFile: null,
  currentIndex: 0,
  currentPage: 1,
  totalPages: 1,
  pageSize: 1000,
  searchQuery: "",
  searchResults: [],
  searchTotal: 0,
  searchPage: 1,
  searchTotalPages: 0,
  isSearching: false,
  totalItems: 0,
  isPlaying: false,
  audio: null,
  metadata: null,
  duration: 0,
  coverUrl: null,
  playMode: 'sequential',
  shuffleOrder: [],
  shuffleIndex: 0,
  sources: [],
  activeSourceId: null,
  currentView: 'now-playing',
  audioCtx: null,
  analyser: null,
  sourceNode: null,
  spectrumData: new Uint8Array(128),
  barHeights: new Float32Array(32).fill(0),
  animationId: null,
  lrcLines: [],
  lrcCurrentIndex: -1,
  isLandscape: false
};

// ===== Helpers =====
function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function startMarquee(el) {
  el.classList.remove('scroll');
  // Force reflow to restart animation
  void el.offsetWidth;
  if (el.scrollWidth > el.parentElement.clientWidth + 1) {
    el.classList.add('scroll');
    const duration = Math.max(6, el.scrollWidth / 30);
    el.style.animationDuration = duration + 's';
  }
}

function api(url) {
  return fetch(url).then(r => {
    if (!r.ok) throw new Error(r.statusText);
    return r.json();
  });
}

function buildApiUrl(endpoint, params = {}) {
  const url = new URL(endpoint, window.location.origin);
  if (state.root) url.searchParams.set('root', state.root);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  });
  return url.toString();
}

// ===== View Switching =====
function switchView(view) {
  state.currentView = view;
  viewNowPlaying.classList.toggle('hidden', view !== 'now-playing');
  viewSongs.classList.toggle('hidden', view !== 'songs');
  viewSettings.classList.toggle('hidden', view !== 'settings');

  if (view === 'songs' && state.root) browseDirectory(state.currentDir || '');
  if (view === 'settings') renderSettings();
}

function toggleLandscape() {
  state.isLandscape = !state.isLandscape;
  document.body.classList.toggle('landscape', state.isLandscape);
  void document.body.offsetHeight;
  resizeSpectrum();
}

// ===== Source Management =====
async function loadSources() {
  try {
    const data = await api('/api/sources');
    state.sources = data.sources;
    if (data.lastUsed && state.sources.find(s => s.id === data.lastUsed)) {
      selectSource(data.lastUsed, false);
      browseDirectory('');
    } else if (state.sources.length > 0) {
      selectSource(state.sources[0].id, false);
      browseDirectory('');
    }
  } catch {
    browseDirectory('');
  }
}

function selectSource(id, reload) {
  const source = state.sources.find(s => s.id === id);
  if (!source) return;
  state.activeSourceId = id;
  state.root = source.path;
  state.currentDir = '';
  state.currentFile = null;
  state.files = [];
  try { fetch(`/api/sources/${id}/use`, { method: 'POST' }); } catch {}
  updateSourceLabel();
  if (reload !== false) browseDirectory('');
}

function updateSourceLabel() {
  const s = state.sources.find(s => s.id === state.activeSourceId);
  sourceLabel.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z"></path></svg><span>${s ? s.name : 'No Source'}</span>`;
}

async function addSource() {
  const name = newSourceName.value.trim();
  const path = newSourcePath.value.trim();
  if (!name || !path) return;
  try {
    const res = await fetch('/api/sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type: 'local', path })
    });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
    await loadSources();
    addSourceForm.style.display = 'none';
    newSourceName.value = '';
    newSourcePath.value = '';
    renderSettings();
    switchView('now-playing');
  } catch (e) { alert('Add source failed: ' + e.message); }
}

async function deleteSource(id) {
  if (!confirm('Delete this source?')) return;
  try {
    const res = await fetch(`/api/sources/${id}`, { method: 'DELETE' });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
    await loadSources();
    if (state.sources.length === 0) {
      state.root = '';
      state.files = [];
      state.currentFile = null;
      updateSourceLabel();
      updateNowPlayingUI();
    }
    renderSettings();
    switchView('now-playing');
  } catch (e) { alert('Delete failed: ' + e.message); }
}

async function refreshSource(id) {
  try {
    await fetch('/api/refresh', { method: 'POST' });
    if (id === state.activeSourceId && state.currentDir) {
      await browseDirectory(state.currentDir, state.currentPage);
    }
    await loadSources();
    renderSettings();
  } catch (e) { alert('Refresh failed: ' + e.message); }
}

function renderSettings() {
  sourceList.innerHTML = '';
  if (state.sources.length === 0) {
    sourceList.innerHTML = '<div class="empty-msg">No sources configured</div>';
  }
  state.sources.forEach(s => {
    const div = document.createElement('div');
    div.className = 'source-item' + (s.id === state.activeSourceId ? ' active' : '');
    div.innerHTML = `
      <div class="source-item-info">
        <div class="source-item-name">${escapeHtml(s.name)}</div>
        <div class="source-item-path">${escapeHtml(s.path)}</div>
      </div>
      <div class="source-item-actions">
        <button class="src-btn select-src">Select</button>
        <button class="src-btn refresh-src">🔄</button>
        <button class="src-btn danger del-src">🗑</button>
      </div>
    `;
    div.querySelector('.select-src').addEventListener('click', () => {
      selectSource(s.id, true);
      renderSettings();
    });
    div.querySelector('.refresh-src').addEventListener('click', (e) => { e.stopPropagation(); refreshSource(s.id); });
    div.querySelector('.del-src').addEventListener('click', () => deleteSource(s.id));
    sourceList.appendChild(div);
  });
}

// ===== File Browsing =====
async function browseDirectory(dirPath, page) {
  try {
    const url = buildApiUrl('/api/browse', { path: dirPath || '', page: page || 1, pageSize: state.pageSize });
    const data = await api(url);
    if (!state.root) state.root = data.root;
    state.currentDir = data.currentPath;
    state.folders = data.folders;
    state.files = data.files;
    state.currentPage = data.page;
    state.totalPages = data.totalPages;
    state.totalItems = data.totalItems;
    updateSourceLabel();
    renderSongs();
    updateTrackCount();
  } catch {}
}

async function searchSongs(query, page) {
  if (!query.trim()) {
    state.isSearching = false;
    state.searchResults = [];
    return browseDirectory(state.currentDir, 1);
  }
  try {
    const url = buildApiUrl('/api/search', { q: query, page: page || 1, pageSize: state.pageSize });
    const data = await api(url);
    state.isSearching = true;
    state.searchQuery = query;
    state.searchResults = data.results;
    state.searchTotal = data.total;
    state.searchPage = data.page;
    state.searchTotalPages = data.totalPages;
    songsInfo.textContent = data.total ? 'Search: ' + data.total + ' results' : 'No results';
    songsBreadcrumb.innerHTML = '';
    renderSearchResults();
  } catch {}
}

function renderSearchResults() {
  songsList.innerHTML = '';
  if (state.searchResults.length === 0) {
    songsList.innerHTML = '<div class="empty-msg">No songs found</div>';
    return;
  }
  state.searchResults.forEach((f, i) => {
    const isActive = state.currentFile === f.path;
    const ext = f.ext ? f.ext.replace('.', '').toUpperCase() : '';
    const dur = f.duration ? formatTime(f.duration) : '';
    const meta = [ext, dur].filter(Boolean).join(' · ');
    const num = (state.searchPage - 1) * state.pageSize + i + 1;
    const div = document.createElement('div');
    div.className = 'song-item' + (isActive ? ' active' : '');
    div.innerHTML = '<span class="song-item-num">' + num + '</span><span class="song-item-icon">' + (isActive ? '▶' : '♫') + '</span><span class="song-item-name">' + escapeHtml(f.name) + '</span><span class="song-item-meta">' + meta + '</span>';
    div.addEventListener('click', () => {
      state.currentFile = f.path;
      state.files = state.searchResults;
      state.currentIndex = (state.searchPage - 1) * state.pageSize + i;
      state.currentDir = f.directory;
      playFile(f);
    });
    songsList.appendChild(div);
  });
}

function renderSongs() {
  songsList.innerHTML = '';
  songsInfo.textContent = state.totalItems ? `${state.totalItems} items` : '';
  renderBreadcrumb();

  if (state.folders.length === 0 && state.files.length === 0) {
    songsList.innerHTML = '<div class="empty-msg">Empty directory</div>';
    return;
  }

  state.folders.forEach(f => {
    const div = document.createElement('div');
    div.className = 'song-item folder';
    div.innerHTML = `
      <span class="song-item-icon">📁</span>
      <span class="song-item-name">${escapeHtml(f.name)}</span>
    `;
    div.addEventListener('click', () => browseDirectory(f.path));
    songsList.appendChild(div);
  });

  state.files.forEach((f, i) => {
    const num = (state.currentPage - 1) * state.pageSize + i + 1;
    const isActive = state.currentFile === f.path;
    const ext = f.ext ? f.ext.replace('.', '').toUpperCase() : '';
    const dur = f.duration ? formatTime(f.duration) : '';
    const meta = [ext, dur].filter(Boolean).join(' · ');
    const div = document.createElement('div');
    div.className = 'song-item' + (isActive ? ' active' : '');
    div.innerHTML = `
      <span class="song-item-num">${num}</span>
      <span class="song-item-icon">${isActive ? '▶' : '♫'}</span>
      <span class="song-item-name">${escapeHtml(f.name)}</span>
      <span class="song-item-meta">${meta}</span>
    `;
    div.addEventListener('click', () => {
      state.currentIndex = (state.currentPage - 1) * state.pageSize + i;
      playFile(f);
    });
    songsList.appendChild(div);
  });
}

function renderBreadcrumb() {
  songsBreadcrumb.innerHTML = '';
  if (!state.currentDir) {
    songsBreadcrumb.innerHTML = '<span class="breadcrumb-seg">/ (root)</span>';
    return;
  }
  const parts = state.currentDir.split('/');
  let accum = '';
  parts.forEach((part, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'breadcrumb-sep';
      sep.textContent = ' › ';
      songsBreadcrumb.appendChild(sep);
    }
    accum = accum ? `${accum}/${part}` : part;
    const seg = document.createElement('span');
    seg.className = 'breadcrumb-seg';
    seg.textContent = part;
    seg.addEventListener('click', () => browseDirectory(accum));
    songsBreadcrumb.appendChild(seg);
  });
}

function updateTrackCount() {
  trackCount.textContent = state.totalItems ? `${state.totalItems} tracks` : '0 tracks';
}

// ===== Playback =====
function createAudioElement() {
  if (state.audio) return;
  state.audio = new Audio();
  state.audio.addEventListener('loadedmetadata', () => {
    state.duration = state.audio.duration || 0;
    timeTotal.textContent = formatTime(state.duration);
  });
  state.audio.addEventListener('timeupdate', () => {
    const t = state.audio.currentTime || 0;
    timeCurrent.textContent = formatTime(t);
    if (state.duration > 0) {
      progressFill.style.width = (t / state.duration * 100) + '%';
    }
    updateLrcHighlight(t);
  });
  state.audio.addEventListener('ended', onEnded);
  state.audio.addEventListener('error', () => {});
}

function initAudioContext() {
  if (state.audioCtx) return;
  state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  state.analyser = state.audioCtx.createAnalyser();
  state.analyser.fftSize = 256;
  state.analyser.smoothingTimeConstant = 0.8;
  state.analyser.connect(state.audioCtx.destination);
}

async function playFile(file) {
  createAudioElement();
  initAudioContext();

  if (!state.sourceNode) {
    state.sourceNode = state.audioCtx.createMediaElementSource(state.audio);
    state.sourceNode.connect(state.analyser);
  }

  state.currentFile = file.path;
  switchView('now-playing');
  const streamUrl = buildApiUrl('/api/stream', { path: file.path });
  state.audio.src = streamUrl;
  state.audio.load();
  state.audio.play().catch(() => {});
  state.isPlaying = true;
  updatePlayPauseIcon();
  updateNowPlayingUI();

  // Fetch metadata
  try {
    const metaUrl = buildApiUrl('/api/metadata', { path: file.path });
    state.metadata = await api(metaUrl);
  } catch { state.metadata = null; }

  // Load cover art
  if (state.metadata && state.metadata.hasCover) {
    const coverUrl = buildApiUrl('/api/cover', { path: file.path });
    state.coverUrl = coverUrl;
    albumCover.style.backgroundImage = `url(${coverUrl})`;
    screenBg.style.backgroundImage = `url(${coverUrl})`;
  } else {
    state.coverUrl = null;
    albumCover.style.backgroundImage = '';
    screenBg.style.backgroundImage = '';
  }

  updateNowPlayingUI();
  renderSongs();
  startSpectrum();
}

function updateNowPlayingUI() {
  // Lyrics
  if (state.metadata && state.metadata.lyrics) {
    state.lrcLines = parseLrcLyrics(state.metadata.lyrics);
    if (state.lrcLines.length === 0) {
      // Plain text lyrics — show first line
      const firstLine = state.metadata.lyrics.split(/\r?\n/)[0].trim();
      songLyric.textContent = firstLine;
      state.lrcCurrentIndex = -1;
      if (firstLine) startMarquee(songLyric);
    } else {
      // Sync to current playback position (or show first line)
      state.lrcCurrentIndex = -1;
      const t = state.audio ? (state.audio.currentTime || 0) : 0;
      updateLrcHighlight(t);
      // If no line active yet, show first timed line
      if (state.lrcCurrentIndex === -1) {
        const first = state.lrcLines.find(l => l.time >= 0);
        if (first) { songLyric.textContent = first.text; startMarquee(songLyric); }
      }
    }
  } else {
    state.lrcLines = [];
    state.lrcCurrentIndex = -1;
    songLyric.textContent = '';
    songLyric.classList.remove('scroll');
  }

  if (state.metadata) {
    const title = state.metadata.title || 'Unknown';
    songTitle.textContent = title;
    songArtist.textContent = state.metadata.artist || 'Unknown Artist';
    songAlbum.textContent = state.metadata.album || '';
  } else {
    songTitle.textContent = state.currentFile ? state.currentFile.split('/').pop() : 'No Track';
    songArtist.textContent = 'Unknown Artist';
    songAlbum.textContent = '';
  }
  startMarquee(songTitle);
  timeCurrent.textContent = '0:00';
  timeTotal.textContent = state.duration ? formatTime(state.duration) : '--:--';
  progressFill.style.width = '0%';
}

function parseLrcLyrics(lrc) {
  const lines = [];
  const regex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/;
  const parts = lrc.split(/\r?\n/);
  for (const line of parts) {
    const match = line.match(regex);
    if (!match) continue;
    const text = line.replace(regex, '').trim();
    if (!text) continue;
    // Skip metadata tags
    if (/^\[(ti|ar|al|by|hash|sign|qq|total|offset|id):/i.test(line)) continue;
    const mm = parseInt(match[1]);
    const ss = parseInt(match[2]);
    const ms = match[3] ? parseInt(match[3].padEnd(3, '0')) / 1000 : 0;
    lines.push({ time: mm * 60 + ss + ms, text });
  }
  lines.sort((a, b) => a.time - b.time);
  return lines;
}

function updateLrcHighlight(currentTime) {
  if (state.lrcLines.length === 0) return;
  let idx = -1;
  for (let i = 0; i < state.lrcLines.length; i++) {
    if (state.lrcLines[i].time <= currentTime) {
      idx = i;
    } else {
      break;
    }
  }
  if (idx !== state.lrcCurrentIndex) {
    state.lrcCurrentIndex = idx;
    if (idx >= 0) {
      songLyric.textContent = state.lrcLines[idx].text;
      startMarquee(songLyric);
    }
  }
}

function togglePlay() {
  if (!state.audio) return;
  if (state.isPlaying) {
    state.audio.pause();
    state.isPlaying = false;
  } else {
    state.audio.play().catch(() => {});
    state.isPlaying = true;
  }
  updatePlayPauseIcon();
}

function updatePlayPauseIcon() {
  const pauseEl = wBottom.querySelector('path');
  if (state.isPlaying) {
    pauseEl.setAttribute('d', 'M6 4h4v16H6V4zm8 0h4v16h-4V4z');
  } else {
    pauseEl.setAttribute('d', 'M8 5v14l11-7z');
  }
}

function onEnded() {
  if (state.playMode === 'repeat') {
    state.audio.currentTime = 0;
    state.audio.play().catch(() => {});
    return;
  }
  if (state.playMode === 'shuffle') {
    playNextShuffle();
    return;
  }
  playNext();
}

function playNext() {
  if (state.files.length === 0) return;
  const total = state.totalItems || state.files.length;
  let nextIdx = state.currentIndex + 1;
  if (nextIdx >= total) {
    if (state.currentPage < state.totalPages) {
      browseDirectory(state.currentDir, state.currentPage + 1).then(() => {
        state.currentIndex = (state.currentPage - 1) * state.pageSize;
        if (state.files.length > 0) playFile(state.files[0]);
      });
      return;
    }
    return;
  }
  state.currentIndex = nextIdx;
  const localIdx = nextIdx - (state.currentPage - 1) * state.pageSize;
  if (localIdx >= 0 && localIdx < state.files.length) {
    playFile(state.files[localIdx]);
  }
}

function playPrev() {
  if (state.files.length === 0) return;
  let prevIdx = state.currentIndex - 1;
  if (prevIdx < 0) {
    if (state.currentPage > 1) {
      browseDirectory(state.currentDir, state.currentPage - 1).then(() => {
        state.currentIndex = state.currentPage * state.pageSize - 1;
        if (state.files.length > 0) playFile(state.files[state.files.length - 1]);
      });
      return;
    }
    return;
  }
  state.currentIndex = prevIdx;
  const localIdx = prevIdx - (state.currentPage - 1) * state.pageSize;
  if (localIdx >= 0 && localIdx < state.files.length) {
    playFile(state.files[localIdx]);
  }
}

function playNextShuffle() {
  if (state.files.length === 0) return;
  if (state.shuffleOrder.length === 0) buildShuffleOrder();
  state.shuffleIndex++;
  if (state.shuffleIndex >= state.shuffleOrder.length) {
    buildShuffleOrder();
    state.shuffleIndex = 0;
  }
  const idx = state.shuffleOrder[state.shuffleIndex] % state.files.length;
  playFile(state.files[idx]);
}

function buildShuffleOrder() {
  const len = state.files.length;
  state.shuffleOrder = Array.from({ length: len }, (_, i) => i);
  for (let i = len - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [state.shuffleOrder[i], state.shuffleOrder[j]] = [state.shuffleOrder[j], state.shuffleOrder[i]];
  }
  state.shuffleIndex = -1;
}

function cyclePlayMode() {
  const modes = ['sequential', 'shuffle', 'repeat'];
  const icons = ['▶', '🔀', '🔂'];
  const idx = modes.indexOf(state.playMode);
  state.playMode = modes[(idx + 1) % 3];
  playModeIcon.textContent = icons[(idx + 1) % 3];
  if (state.playMode === 'shuffle') buildShuffleOrder();
}

// ===== Progress Seeking =====
progressBg.addEventListener('click', (e) => {
  if (!state.audio || !state.duration) return;
  const rect = progressBg.getBoundingClientRect();
  const ratio = (e.clientX - rect.left) / rect.width;
  state.audio.currentTime = ratio * state.duration;
});

// ===== Spectrum =====
function resizeSpectrum() {
  if (state.currentView !== 'now-playing') return;
  const rect = spectrumCanvas.parentElement.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const dpr = window.devicePixelRatio || 1;
  const w = rect.width * dpr;
  const h = rect.height * dpr;
  if (spectrumCanvas.width !== w || spectrumCanvas.height !== h) {
    spectrumCanvas.width = w;
    spectrumCanvas.height = h;
  }
}

function drawSpectrum() {
  resizeSpectrum();
  const ctx = spectrumCtx;
  const w = spectrumCanvas.width;
  const h = spectrumCanvas.height;
  ctx.clearRect(0, 0, w, h);

  if (!state.analyser) return;

  state.analyser.getByteFrequencyData(state.spectrumData);
  const bars = state.barHeights.length;
  const barW = (w / bars) * 0.7;
  const gap = (w / bars) * 0.3;

  for (let i = 0; i < bars; i++) {
    const idx = Math.floor(Math.pow(i / bars, 1.2) * state.spectrumData.length);
    const value = state.spectrumData[idx] / 255;
    state.barHeights[i] = state.barHeights[i] * 0.65 + value * 0.35;
    const barH = Math.max(1, state.barHeights[i] * h * 0.9);
    const x = i * (barW + gap);
    const y = h - barH;

    const alpha = 0.3 + state.barHeights[i] * 0.7;
    ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(2)})`;
    ctx.beginPath();
    ctx.roundRect(x, y, barW, barH, [1]);
    ctx.fill();
  }
}

function startSpectrum() {
  if (state.animationId) return;
  function loop() {
    drawSpectrum();
    state.animationId = requestAnimationFrame(loop);
  }
  loop();
}

// ===== Status Bar Clock =====
function updateStatusTime() {
  const now = new Date();
  statusTimeEl.textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// ===== Event Handlers =====

// Click wheel: center (Play/Pause or double-click for mode)
let wheelClickTimer = null;
wheelCenter.addEventListener('click', () => {
  if (state.currentView !== 'now-playing') {
    switchView('now-playing');
    return;
  }
  if (wheelClickTimer) {
    // Double click → cycle play mode
    clearTimeout(wheelClickTimer);
    wheelClickTimer = null;
    cyclePlayMode();
  } else {
    // Single click (delayed) → play/pause
    wheelClickTimer = setTimeout(() => {
      wheelClickTimer = null;
      togglePlay();
    }, 300);
  }
});

// Click wheel: top (Menu → Songs)
wTop.addEventListener('click', () => {
  if (state.currentView === 'songs') {
    switchView('now-playing');
  } else {
    switchView('songs');
  }
});

// Click wheel: left (Previous)
wLeft.addEventListener('click', () => {
  if (state.currentView !== 'now-playing') return;
  playPrev();
});

// Click wheel: right (Next)
wRight.addEventListener('click', () => {
  if (state.currentView !== 'now-playing') return;
  if (state.playMode === 'shuffle') playNextShuffle();
  else playNext();
});

// Click wheel: bottom (Play/Pause)
wBottom.addEventListener('click', () => {
  if (state.currentView !== 'now-playing') {
    switchView('now-playing');
    return;
  }
  togglePlay();
});

// (Double-click detection handled in wheelCenter click above)

// Settings button (gear icon)
btnSettings.addEventListener('click', (e) => {
  e.stopPropagation();
  switchView('settings');
});

// Playlist button (list icon)
btnPlaylist.addEventListener('click', (e) => {
  e.stopPropagation();
  switchView('songs');
});

// Back buttons
songsBackBtn.addEventListener('click', () => switchView('now-playing'));
settingsBackBtn.addEventListener('click', () => switchView('now-playing'));

// Landscape toggle
landscapeToggleBtn.addEventListener('click', toggleLandscape);

// Search
let searchDebounce = null;
searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    const q = searchInput.value.trim();
    searchClearBtn.style.display = q ? 'block' : 'none';
    searchSongs(q);
  }, 300);
});
searchClearBtn.addEventListener('click', () => {
  searchInput.value = '';
  searchClearBtn.style.display = 'none';
  state.isSearching = false;
  state.searchResults = [];
  browseDirectory(state.currentDir, 1);
});

// Add source form
btnShowAddSource.addEventListener('click', () => {
  addSourceForm.style.display = 'block';
  btnShowAddSource.style.display = 'none';
});

$('#btn-add-source-save').addEventListener('click', addSource);
$('#btn-add-source-cancel').addEventListener('click', () => {
  addSourceForm.style.display = 'none';
  btnShowAddSource.style.display = 'block';
  newSourceName.value = '';
  newSourcePath.value = '';
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  switch (e.code) {
    case 'Space':
      e.preventDefault();
      if (state.currentView !== 'now-playing') switchView('now-playing');
      else togglePlay();
      break;
    case 'ArrowLeft':
      if (state.currentView === 'now-playing') playPrev();
      break;
    case 'ArrowRight':
      if (state.currentView === 'now-playing') {
        if (state.playMode === 'shuffle') playNextShuffle();
        else playNext();
      }
      break;
    case 'Escape':
      switchView('now-playing');
      break;
    case 'KeyL':
      toggleLandscape();
      break;
  }
});

// ===== Init =====
async function init() {
  updateStatusTime();
  setInterval(updateStatusTime, 30000);
  resizeSpectrum();
  startSpectrum();
  await loadSources();

  if (state.sources.length === 0) {
    try {
      const url = buildApiUrl('/api/browse');
      const data = await api(url);
      await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Default Library', type: 'local', path: data.root })
      });
      await loadSources();
    } catch {
      browseDirectory('');
    }
  }

  updateTrackCount();
}

init();
