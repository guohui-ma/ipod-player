const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execSync, spawn } = require('child_process');
const { parseFile } = require('music-metadata');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const CONFIG_FILE = path.join(os.homedir(), '.music-player-sources.json');
const MOUNT_BASE = path.join(os.tmpdir(), 'music-player-mounts');

const MUSIC_EXTS = new Set([
  '.mp3', '.flac', '.wav', '.ogg', '.m4a', '.aac',
  '.wma', '.aiff', '.ape', '.opus', '.mp4', '.webm'
]);

const MIME_TYPES = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wma': 'audio/x-ms-wma',
  '.aiff': 'audio/aiff',
  '.ape': 'audio/ape',
  '.opus': 'audio/opus',
  '.mp4': 'audio/mp4',
  '.webm': 'audio/webm'
};

// ===== Config Management =====

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch { /* ignore corrupt config */ }
  return { sources: [], lastUsed: null };
}

function saveConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

// ===== Path Helpers =====

function getMusicRoot(rootParam) {
  if (rootParam) return path.resolve(rootParam);
  const config = loadConfig();
  if (config.lastUsed) {
    const src = config.sources.find(s => s.id === config.lastUsed);
    if (src) {
      const base = src.mountedAt || src.path;
      return src.subPath ? path.join(base, src.subPath) : base;
    }
  }
  return path.resolve(process.env.MUSIC_ROOT || path.join(os.homedir(), 'Music'));
}

function getMountRoot(sourceId) {
  const config = loadConfig();
  const src = config.sources.find(s => s.id === sourceId);
  if (!src || !src.mountedAt) return null;
  return src.mountedAt;
}

function safePath(root, subPath) {
  if (!subPath) return path.resolve(root);
  if (subPath.includes('..')) return null;
  const resolved = path.resolve(root, subPath);
  if (!resolved.startsWith(path.resolve(root) + path.sep) && resolved !== path.resolve(root)) return null;
  return resolved;
}

function isMusicFile(filename) {
  return MUSIC_EXTS.has(path.extname(filename).toLowerCase());
}

function getMimeType(filename) {
  return MIME_TYPES[path.extname(filename).toLowerCase()] || 'application/octet-stream';
}

// ===== Mount / Unmount =====

function ensureMountBase() {
  fs.mkdirSync(MOUNT_BASE, { recursive: true });
}

function mountSmb(source) {
  const mountPoint = path.join(MOUNT_BASE, `smb-${source.id}`);
  fs.mkdirSync(mountPoint, { recursive: true });

  // Normalise URL: strip smb:// prefix for mount_smbfs
  let hostPath = source.url.replace(/^smb:\/\//, '');
  let smbUrl = 'smb://' + hostPath;

  // Build mount_smbfs path: //user:pass@host/share
  let mountPath = '//';
  if (source.username) {
    mountPath += encodeURIComponent(source.username);
    if (source.password) mountPath += ':' + encodeURIComponent(source.password);
    mountPath += '@';
  }
  mountPath += hostPath;

  // Try mount_smbfs first
  try {
    execSync(`mount_smbfs "${mountPath}" "${mountPoint}"`, {
      timeout: 15000,
      stdio: 'pipe'
    });
    return { mountPoint };
  } catch (e1) {
    // Fallback: use osascript Finder mount
    try {
      if (source.username) {
        execSync(`osascript -e 'mount volume "${smbUrl}" as user name "${source.username}" with password "${source.password || ""}"'`, { timeout: 30000, stdio: 'pipe' });
      } else {
        execSync(`osascript -e 'mount volume "${smbUrl}"'`, { timeout: 30000, stdio: 'pipe' });
      }
      // Find mounted volume in /Volumes
      const shareName = hostPath.split('/').pop() || hostPath;
      const vols = fs.readdirSync('/Volumes');
      const mounted = vols.find(v => v === shareName || v === decodeURIComponent(shareName));
      if (mounted) {
        return { mountPoint: path.join('/Volumes', mounted) };
      }
      throw new Error('Mounted but volume not found in /Volumes');
    } catch (e2) {
      try { fs.rmdirSync(mountPoint); } catch {}
      throw new Error(`SMB mount failed: ${(e2.message || '').slice(0, 100)}`);
    }
  }
}

function mountWebdav(source) {
  const mountPoint = path.join(MOUNT_BASE, `webdav-${source.id}`);
  fs.mkdirSync(mountPoint, { recursive: true });

  try {
    execSync(`mount_webdav -s "${source.url}" "${mountPoint}"`, {
      timeout: 15000,
      stdio: 'pipe'
    });
  } catch (e) {
    try { fs.rmdirSync(mountPoint); } catch {}
    throw new Error(`WebDAV mount failed: ${e.message || 'Unknown error'}`);
  }

  return { mountPoint };
}

function unmountSource(source) {
  if (!source.mountedAt) return;
  try {
    execSync(`umount "${source.mountedAt}"`, { timeout: 10000, stdio: 'pipe' });
  } catch {
    // Force unmount
    try { execSync(`umount -f "${source.mountedAt}"`, { timeout: 5000, stdio: 'pipe' }); } catch {}
    // Diskutil unmount for /Volumes mounts
    try { execSync(`diskutil unmount "${source.mountedAt}"`, { timeout: 5000, stdio: 'pipe' }); } catch {}
  }
  // Clean up mount point if under our base
  if (source.mountedAt.startsWith(MOUNT_BASE)) {
    try { fs.rmdirSync(source.mountedAt); } catch {}
  }
}

// ===== Source Management API =====

// List all sources
app.get('/api/sources', (req, res) => {
  try {
    const config = loadConfig();
    res.json({
      sources: config.sources.map(s => ({
        id: s.id,
        name: s.name,
        type: s.type,
        path: s.type === 'local' ? s.path : (s.mountedAt || null),
        url: s.type !== 'local' ? s.url : null,
        subPath: s.subPath || '',
        mounted: s.type === 'local' ? true : !!s.mountedAt,
        hasCredentials: !!(s.username)
      })),
      lastUsed: config.lastUsed || (config.sources[0]?.id || null)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add a new source
app.post('/api/sources', (req, res) => {
  try {
    const { name, type, path: srcPath, url, username, password } = req.body;

    if (!name || !type) {
      return res.status(400).json({ error: 'Name and type are required' });
    }
    if (type === 'local' && !srcPath) {
      return res.status(400).json({ error: 'Path is required for local source' });
    }
    if ((type === 'smb' || type === 'webdav') && !url) {
      return res.status(400).json({ error: 'URL is required for remote source' });
    }

    if (type === 'local') {
      const resolved = path.resolve(srcPath);
      if (!fs.existsSync(resolved)) {
        return res.status(400).json({ error: `Path does not exist: ${resolved}` });
      }
    }

    const config = loadConfig();
    const id = crypto.randomUUID();

    const source = {
      id,
      name: name.trim(),
      type,
      path: type === 'local' ? path.resolve(srcPath) : null,
      url: type !== 'local' ? url : null,
      username: username || null,
      password: password || null,
      mountedAt: null,
      subPath: '',
      createdAt: new Date().toISOString()
    };

    // Auto-mount remote sources
    if (type === 'smb') {
      try {
        ensureMountBase();
        const result = mountSmb(source);
        source.mountedAt = result.mountPoint;
      } catch (e) {
        // Store without mount — user can mount later
        source.mountedAt = null;
      }
    } else if (type === 'webdav') {
      try {
        ensureMountBase();
        const result = mountWebdav(source);
        source.mountedAt = result.mountPoint;
      } catch (e) {
        source.mountedAt = null;
      }
    }

    config.sources.push(source);
    config.lastUsed = id;
    saveConfig(config);

    res.json({
      id: source.id,
      name: source.name,
      type: source.type,
      path: source.type === 'local' ? source.path : source.mountedAt,
      mounted: source.type === 'local' ? true : !!source.mountedAt,
      mountError: (!source.mountedAt && type !== 'local') ? 'Auto-mount failed; use Mount button to retry' : null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a source
app.delete('/api/sources/:id', (req, res) => {
  try {
    const config = loadConfig();
    const idx = config.sources.findIndex(s => s.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Source not found' });
    }

    // Unmount if mounted
    unmountSource(config.sources[idx]);

    config.sources.splice(idx, 1);
    if (config.lastUsed === req.params.id) {
      config.lastUsed = config.sources[0]?.id || null;
    }
    saveConfig(config);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mount a remote source
app.post('/api/sources/:id/mount', (req, res) => {
  try {
    const config = loadConfig();
    const source = config.sources.find(s => s.id === req.params.id);
    if (!source) {
      return res.status(404).json({ error: 'Source not found' });
    }
    if (source.type === 'local') {
      return res.json({ mounted: true, path: source.path });
    }

    // Unmount first if already mounted
    unmountSource(source);
    source.mountedAt = null;

    ensureMountBase();
    let result;
    if (source.type === 'smb') {
      result = mountSmb(source);
    } else if (source.type === 'webdav') {
      result = mountWebdav(source);
    } else {
      return res.status(400).json({ error: 'Unknown source type' });
    }

    source.mountedAt = result.mountPoint;
    saveConfig(config);

    res.json({ mounted: true, path: source.mountedAt });
  } catch (err) {
    res.status(500).json({ error: `Mount failed: ${err.message}` });
  }
});

// Unmount a remote source
app.post('/api/sources/:id/unmount', (req, res) => {
  try {
    const config = loadConfig();
    const source = config.sources.find(s => s.id === req.params.id);
    if (!source) {
      return res.status(404).json({ error: 'Source not found' });
    }

    unmountSource(source);
    source.mountedAt = null;
    saveConfig(config);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Set last used source
app.post('/api/sources/:id/use', (req, res) => {
  try {
    const config = loadConfig();
    const source = config.sources.find(s => s.id === req.params.id);
    if (!source) {
      return res.status(404).json({ error: 'Source not found' });
    }
    config.lastUsed = req.params.id;
    saveConfig(config);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Refresh current browsing context (used as signal to re-read directory)
app.post('/api/refresh', (req, res) => {
  res.json({ success: true });
});

// Browse within a mounted remote source (for sub-directory picking)
app.get('/api/mount-browse/:id', (req, res) => {
  try {
    const mountRoot = getMountRoot(req.params.id);
    if (!mountRoot) {
      return res.status(404).json({ error: 'Source not found or not mounted' });
    }

    const subPath = req.query.path || '';
    const fullPath = safePath(mountRoot, subPath);
    if (!fullPath || !fs.existsSync(fullPath)) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    const folders = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({
        name: e.name,
        path: subPath ? `${subPath}/${e.name}` : e.name
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Build breadcrumb from subPath
    const breadcrumb = [];
    if (subPath) {
      const parts = subPath.split('/');
      let accum = '';
      for (const part of parts) {
        accum = accum ? `${accum}/${part}` : part;
        breadcrumb.push({ name: part, path: accum });
      }
    }

    res.json({ mountRoot, currentPath: subPath, breadcrumb, folders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Set sub-path for a remote source
app.post('/api/sources/:id/subpath', (req, res) => {
  try {
    const config = loadConfig();
    const source = config.sources.find(s => s.id === req.params.id);
    if (!source) {
      return res.status(404).json({ error: 'Source not found' });
    }
    if (source.type === 'local') {
      return res.status(400).json({ error: 'Sub-path only applies to remote sources' });
    }

    source.subPath = req.body.subPath || '';
    saveConfig(config);

    const base = source.mountedAt || source.path;
    const effectivePath = source.subPath ? path.join(base, source.subPath) : base;
    res.json({ success: true, path: effectivePath, subPath: source.subPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== Music Browsing API =====

app.get('/api/browse', async (req, res) => {
  try {
    const root = getMusicRoot(req.query.root);
    const dir = req.query.path || '';
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(2000, Math.max(1, parseInt(req.query.pageSize) || 20));

    if (!fs.existsSync(root)) {
      return res.status(404).json({ error: `Directory not found: ${root}` });
    }

    const fullPath = safePath(root, dir);
    if (!fullPath) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    const stat = fs.statSync(fullPath);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' });
    }

    const entries = fs.readdirSync(fullPath, { withFileTypes: true });

    const folders = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({
        name: e.name,
        type: 'folder',
        path: dir ? `${dir}/${e.name}` : e.name
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const allFiles = entries
      .filter(e => e.isFile() && isMusicFile(e.name))
      .map(e => ({
        name: e.name,
        type: 'file',
        path: dir ? `${dir}/${e.name}` : e.name,
        ext: path.extname(e.name).toLowerCase()
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const totalItems = allFiles.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const clampedPage = Math.min(page, totalPages);
    const start = (clampedPage - 1) * pageSize;
    const files = allFiles.slice(start, start + pageSize);

    // Enrich current page files with duration
    await Promise.all(files.map(async (file) => {
      try {
        const fileFullPath = path.join(fullPath, file.name);
        const meta = await parseFile(fileFullPath, { duration: true, skipCovers: true, skipPostHeaders: true });
        file.duration = meta.format.duration || 0;
      } catch {
        file.duration = 0;
      }
    }));

    const breadcrumb = [];
    if (dir) {
      const parts = dir.split('/');
      let accum = '';
      for (const part of parts) {
        accum = accum ? `${accum}/${part}` : part;
        breadcrumb.push({ name: part, path: accum });
      }
    }

    res.json({
      root,
      currentPath: dir,
      breadcrumb,
      folders,
      files,
      page: clampedPage,
      pageSize,
      totalItems,
      totalPages
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/search', async (req, res) => {
  try {
    const root = getMusicRoot(req.query.root);
    const query = (req.query.q || '').toLowerCase().trim();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(2000, Math.max(1, parseInt(req.query.pageSize) || 20));

    if (!query) {
      return res.json({ results: [], total: 0, page: 1, pageSize, totalPages: 0 });
    }

    if (!fs.existsSync(root)) {
      return res.status(404).json({ error: `Directory not found: ${root}` });
    }

    const results = [];

    function searchDir(currentPath, relativePath) {
      let entries;
      try {
        entries = fs.readdirSync(currentPath, { withFileTypes: true });
      } catch { return; }

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(currentPath, entry.name);
        const rel = relativePath ? `${relativePath}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          searchDir(full, rel);
        } else if (entry.isFile() && isMusicFile(entry.name)) {
          if (entry.name.toLowerCase().includes(query)) {
            results.push({
              name: entry.name,
              path: rel,
              directory: relativePath || '',
              ext: path.extname(entry.name).toLowerCase()
            });
          }
        }
      }
    }

    searchDir(root, '');

    results.sort((a, b) => a.name.localeCompare(b.name));

    const total = results.length;
    const totalPages = Math.max(0, Math.ceil(total / pageSize));
    const clampedPage = totalPages > 0 ? Math.min(page, totalPages) : 1;
    const start = (clampedPage - 1) * pageSize;
    const paged = results.slice(start, start + pageSize);

    // Enrich current page results with duration
    await Promise.all(paged.map(async (result) => {
      try {
        const fileFullPath = path.join(root, result.path);
        const meta = await parseFile(fileFullPath, { duration: true, skipCovers: true, skipPostHeaders: true });
        result.duration = meta.format.duration || 0;
      } catch {
        result.duration = 0;
      }
    }));

    res.json({
      results: paged,
      total,
      page: clampedPage,
      pageSize,
      totalPages
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stream', (req, res) => {
  try {
    const root = getMusicRoot(req.query.root);
    const filePath = req.query.path || '';

    const fullPath = safePath(root, filePath);
    if (!fullPath || !fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const stat = fs.statSync(fullPath);
    const fileSize = stat.size;
    const mimeType = getMimeType(fullPath);
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      const stream = fs.createReadStream(fullPath, { start, end });
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': mimeType
      });
      stream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes'
      });
      fs.createReadStream(fullPath).pipe(res);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/metadata', async (req, res) => {
  try {
    const root = getMusicRoot(req.query.root);
    const filePath = req.query.path || '';

    const fullPath = safePath(root, filePath);
    if (!fullPath || !fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    try {
      const metadata = await parseFile(fullPath);
      const common = metadata.common;
      const lyrics = extractLyrics(common, fullPath);

      res.json({
        title: common.title || path.basename(fullPath, path.extname(fullPath)),
        artist: common.artist || 'Unknown Artist',
        album: common.album || '',
        year: common.year || '',
        genre: Array.isArray(common.genre) ? common.genre.join(', ') : (common.genre || ''),
        duration: metadata.format.duration || 0,
        bitrate: metadata.format.bitrate || 0,
        sampleRate: metadata.format.sampleRate || 0,
        track: common.track?.no || '',
        hasCover: !!(common.picture && common.picture.length > 0),
        lyrics
      });
    } catch {
      res.json({
        title: path.basename(fullPath, path.extname(fullPath)),
        artist: 'Unknown Artist',
        album: '',
        year: '',
        genre: '',
        duration: 0,
        bitrate: 0,
        sampleRate: 0,
        track: '',
        hasCover: false,
        lyrics: ''
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== Cover Art Endpoint =====
app.get('/api/cover', async (req, res) => {
  try {
    const root = getMusicRoot(req.query.root);
    const filePath = req.query.path || '';

    const fullPath = safePath(root, filePath);
    if (!fullPath || !fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    try {
      const metadata = await parseFile(fullPath, { skipCovers: false });
      const pictures = metadata.common.picture;
      if (pictures && pictures.length > 0) {
        const cover = pictures[0];
        res.set({
          'Content-Type': cover.format || 'image/jpeg',
          'Cache-Control': 'public, max-age=86400',
          'Content-Length': cover.data.length
        });
        return res.send(Buffer.from(cover.data));
      }
      return res.status(404).json({ error: 'No cover art' });
    } catch {
      return res.status(404).json({ error: 'Cannot parse metadata' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function extractLyrics(common, filePath) {
  // 1. Embedded lyrics from audio tags
  if (common.lyrics && common.lyrics.length > 0) {
    return common.lyrics.join('\n');
  }
  // 2. Same-name .lrc file
  if (filePath) {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath, path.extname(filePath));
    const lrcPath = path.join(dir, base + '.lrc');
    if (fs.existsSync(lrcPath)) {
      try {
        return fs.readFileSync(lrcPath, 'utf8');
      } catch {}
    }
  }
  return '';
}

// ===== Start =====
app.listen(PORT, () => {
  console.log(`Music Player running at http://localhost:${PORT}`);
  const config = loadConfig();
  console.log(`Sources: ${config.sources.length}, mounted base: ${MOUNT_BASE}`);
});
