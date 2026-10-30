'use strict';

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const PORT = Number(process.env.PORT) || 3210;
const HOST = process.env.HOST || '0.0.0.0';

for (const dir of [DATA_DIR, UPLOAD_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

/* ------------------------------------------------------------------ */
/* Database                                                            */
/* ------------------------------------------------------------------ */

const db = new DatabaseSync(path.join(DATA_DIR, 'anyu.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS photos (
    id         TEXT PRIMARY KEY,
    category   TEXT NOT NULL DEFAULT 'gallery',
    url        TEXT NOT NULL,
    caption    TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS moods (
    id         TEXT PRIMARY KEY,
    date       TEXT NOT NULL UNIQUE,
    mood       TEXT NOT NULL,
    note       TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS records (
    id         TEXT PRIMARY KEY,
    date       TEXT NOT NULL,
    title      TEXT NOT NULL DEFAULT '',
    content    TEXT NOT NULL DEFAULT '',
    mood       TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS media (
    id            TEXT PRIMARY KEY,
    record_id     TEXT NOT NULL,
    type          TEXT NOT NULL,
    url           TEXT NOT NULL,
    original_name TEXT NOT NULL DEFAULT '',
    mime_type     TEXT NOT NULL DEFAULT '',
    size          INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    FOREIGN KEY (record_id) REFERENCES records(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_records_date ON records(date DESC, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_media_record ON media(record_id);
  CREATE INDEX IF NOT EXISTS idx_photos_category ON photos(category, sort_order);
`);

const DEFAULT_SETTINGS = {
  siteTitle: '安妤鱼',
  partnerA: '安',
  partnerB: '妤',
  startDate: '2024-05-20',
  heroEyebrow: 'OUR LITTLE UNIVERSE',
  heroSubtitle: '把每一个平凡的日子，都过成想你的样子。',
  heroQuote: '愿我们在漫长的岁月里，永远是彼此最想回家的人。',
  footerNote: '安妤鱼 · 只属于我们的秘密基地',
};

function inTransaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore rollback failure */
    }
    throw error;
  }
}

function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

function getSettings() {
  return {
    siteTitle: getSetting('siteTitle', DEFAULT_SETTINGS.siteTitle),
    partnerA: getSetting('partnerA', DEFAULT_SETTINGS.partnerA),
    partnerB: getSetting('partnerB', DEFAULT_SETTINGS.partnerB),
    startDate: getSetting('startDate', DEFAULT_SETTINGS.startDate),
    heroEyebrow: getSetting('heroEyebrow', DEFAULT_SETTINGS.heroEyebrow),
    heroSubtitle: getSetting('heroSubtitle', DEFAULT_SETTINGS.heroSubtitle),
    heroQuote: getSetting('heroQuote', DEFAULT_SETTINGS.heroQuote),
    footerNote: getSetting('footerNote', DEFAULT_SETTINGS.footerNote),
  };
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, salt, expected] = String(stored).split('$');
    if (scheme !== 'scrypt' || !salt || !expected) return false;
    const actual = crypto.scryptSync(String(password), salt, 64);
    const expectedBuffer = Buffer.from(expected, 'hex');
    return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer);
  } catch {
    return false;
  }
}

function seedSettings() {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (!db.prepare('SELECT 1 FROM settings WHERE key = ?').get(key)) {
      setSetting(key, value);
    }
  }
  if (!getSetting('adminPasswordHash')) {
    const initialPassword = process.env.ADMIN_PASSWORD || 'anyu520';
    setSetting('adminPasswordHash', hashPassword(initialPassword));
    setSetting('passwordIsDefault', initialPassword === 'anyu520' ? '1' : '0');
  }
}
seedSettings();

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const MOOD_IDS = ['happy', 'sweet', 'calm', 'miss', 'tired', 'sad', 'angry'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value) {
  if (!DATE_RE.test(String(value))) return false;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return false;
  const [y, m, d] = value.split('-').map(Number);
  return date.getFullYear() === y && date.getMonth() + 1 === m && date.getDate() === d;
}

function localDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function daysTogether(startDate) {
  if (!isValidDate(startDate)) return 1;
  const start = new Date(`${startDate}T00:00:00`);
  const today = new Date(`${localDateString()}T00:00:00`);
  return Math.max(1, Math.floor((today - start) / 86400000) + 1);
}

function cleanText(value, maxLength) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, maxLength);
}

function uid() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

function mediaType(mimeType) {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return null;
}

const ALLOWED_EXTENSIONS = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
  ['image/avif', '.avif'],
  ['audio/mpeg', '.mp3'],
  ['audio/mp3', '.mp3'],
  ['audio/wav', '.wav'],
  ['audio/x-wav', '.wav'],
  ['audio/ogg', '.ogg'],
  ['audio/webm', '.webm'],
  ['audio/mp4', '.m4a'],
  ['audio/x-m4a', '.m4a'],
  ['audio/aac', '.aac'],
  ['video/mp4', '.mp4'],
  ['video/webm', '.webm'],
  ['video/quicktime', '.mov'],
  ['video/x-m4v', '.m4v'],
  ['video/ogg', '.ogv'],
]);

function extensionFor(file) {
  const mime = String(file.mimetype || '').toLowerCase().split(';')[0].trim();
  if (ALLOWED_EXTENSIONS.has(mime)) return ALLOWED_EXTENSIONS.get(mime);
  const ext = path.extname(file.originalname || '').toLowerCase();
  return /^\.(jpe?g|png|webp|gif|avif|mp3|wav|ogg|webm|m4a|aac|mp4|mov|m4v|ogv)$/.test(ext) ? ext : '';
}

function removeUploadedFiles(files) {
  for (const file of files || []) {
    try {
      fs.unlinkSync(path.join(UPLOAD_DIR, file.filename));
    } catch {
      /* the file may already be gone */
    }
  }
}

function removeUploadByUrl(url) {
  if (!String(url || '').startsWith('/uploads/')) return;
  const filename = path.basename(url);
  try {
    fs.unlinkSync(path.join(UPLOAD_DIR, filename));
  } catch {
    /* the file may already be gone */
  }
}

function getPhotos() {
  const rows = db.prepare('SELECT * FROM photos ORDER BY sort_order ASC, created_at ASC').all();
  const map = (row) => ({
    id: row.id,
    category: row.category,
    url: row.url,
    caption: row.caption,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  });
  const photos = rows.map(map);
  const hero = photos.filter((photo) => photo.category === 'hero');
  return {
    hero: hero.length
      ? hero
      : [{
          id: 'default-hero',
          category: 'hero',
          url: '/assets/hero-default.jpg',
          caption: '在后台换上属于你们的照片',
          sortOrder: 0,
          isDefault: true,
        }],
    gallery: photos.filter((photo) => photo.category === 'gallery'),
  };
}

function getRecords(limit = 200) {
  const rows = db.prepare(`
    SELECT * FROM records ORDER BY date DESC, created_at DESC LIMIT ?
  `).all(Number(limit) || 200);
  if (!rows.length) return [];
  const mediaRows = db.prepare(`
    SELECT m.* FROM media m
    JOIN records r ON r.id = m.record_id
    WHERE r.id IN (${rows.map(() => '?').join(',')})
    ORDER BY m.created_at ASC
  `).all(...rows.map((row) => row.id));
  const mediaByRecord = new Map();
  for (const media of mediaRows) {
    if (!mediaByRecord.has(media.record_id)) mediaByRecord.set(media.record_id, []);
    mediaByRecord.get(media.record_id).push({
      id: media.id,
      type: media.type,
      url: media.url,
      originalName: media.original_name,
      mimeType: media.mime_type,
      size: media.size,
    });
  }
  return rows.map((row) => ({
    id: row.id,
    date: row.date,
    title: row.title,
    content: row.content,
    mood: row.mood,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    media: mediaByRecord.get(row.id) || [],
  }));
}

function getMoods() {
  return db.prepare('SELECT * FROM moods ORDER BY date DESC').all().map((row) => ({
    id: row.id,
    date: row.date,
    mood: row.mood,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

function getStats() {
  const recordCount = db.prepare('SELECT COUNT(*) AS count FROM records').get().count;
  const moodCount = db.prepare('SELECT COUNT(*) AS count FROM moods').get().count;
  const photoCount = db.prepare('SELECT COUNT(*) AS count FROM photos').get().count;
  const mediaImageCount = db.prepare("SELECT COUNT(*) AS count FROM media WHERE type = 'image'").get().count;
  const mediaCount = db.prepare('SELECT COUNT(*) AS count FROM media').get().count;
  const settings = getSettings();
  return {
    recordCount,
    moodCount,
    photoCount: photoCount + mediaImageCount,
    mediaCount,
    daysTogether: daysTogether(settings.startDate),
    today: localDateString(),
  };
}

function getRecordById(id) {
  const row = db.prepare('SELECT * FROM records WHERE id = ?').get(id);
  if (!row) return null;
  const media = db.prepare('SELECT * FROM media WHERE record_id = ? ORDER BY created_at ASC').all(id).map((item) => ({
    id: item.id,
    type: item.type,
    url: item.url,
    originalName: item.original_name,
    mimeType: item.mime_type,
    size: item.size,
  }));
  return {
    id: row.id,
    date: row.date,
    title: row.title,
    content: row.content,
    mood: row.mood,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    media,
  };
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

const SESSION_COOKIE = 'anyu_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const sessions = new Map();
const loginAttempts = new Map();

function parseCookies(req) {
  const cookies = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

function isAuthenticated(req) {
  pruneSessions();
  const token = parseCookies(req)[SESSION_COOKIE];
  const session = token ? sessions.get(token) : null;
  return Boolean(session && session.expiresAt > Date.now());
}

function pruneSessions() {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(token);
  }
}

function sessionCookie(req, token, maxAgeSeconds) {
  const secure = req.secure || String(req.headers['x-forwarded-proto'] || '') === 'https';
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
    secure ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

function requireAuth(req, res, next) {
  if (!isAuthenticated(req)) {
    return res.status(401).json({ error: '登录已过期，请重新登录。' });
  }
  next();
}

function loginKey(req) {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function isRateLimited(key) {
  const entry = loginAttempts.get(key);
  if (!entry) return false;
  if (entry.resetAt <= Date.now()) {
    loginAttempts.delete(key);
    return false;
  }
  return entry.count >= 8;
}

function noteLoginFailure(key) {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || entry.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return;
  }
  entry.count += 1;
}

/* ------------------------------------------------------------------ */
/* Uploads                                                             */
/* ------------------------------------------------------------------ */

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = extensionFor(file);
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext || ''}`);
  },
});

function uploadFilter(_req, file, cb) {
  const mime = String(file.mimetype || '').toLowerCase().split(';')[0].trim();
  const isAllowedMime = mime.startsWith('image/') || mime.startsWith('audio/') || mime.startsWith('video/');
  if (!isAllowedMime || mime === 'image/svg+xml' || !extensionFor(file)) {
    return cb(new Error('不支持这种文件格式，请上传 JPG/PNG/WebP 图片、音频或视频。'));
  }
  cb(null, true);
}

const mediaUpload = multer({
  storage,
  fileFilter: uploadFilter,
  limits: { fileSize: 150 * 1024 * 1024, files: 12 },
});

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "font-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join('; '));
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// Reject cross-site writes. Local development and same-origin requests pass.
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next();
  try {
    if (new URL(origin).host !== req.get('host')) {
      return res.status(403).json({ error: '请求来源不合法。' });
    }
  } catch {
    return res.status(403).json({ error: '请求来源不合法。' });
  }
  next();
});

app.use('/uploads', express.static(UPLOAD_DIR, {
  index: false,
  dotfiles: 'deny',
  maxAge: '30d',
  setHeaders(res) {
    res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
  },
}));

app.use('/uploads', (_req, res) => {
  res.status(404).type('text/plain').send('文件不存在。');
});

/* ------------------------------- public ------------------------------ */

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: nowIso() });
});

app.get('/api/site', (_req, res) => {
  res.json({ site: getSettings(), photos: getPhotos(), stats: getStats() });
});

app.get('/api/home', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
  res.json({
    site: getSettings(),
    photos: getPhotos(),
    records: getRecords(limit),
    moods: getMoods(),
    stats: getStats(),
    moodsOptions: MOOD_IDS,
  });
});

app.get('/api/moods', (_req, res) => {
  res.json({ moods: getMoods() });
});

app.get('/api/records', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
  res.json({ records: getRecords(limit) });
});

/* -------------------------------- auth ------------------------------- */

app.get('/api/auth/status', (req, res) => {
  res.json({ authenticated: isAuthenticated(req) });
});

app.post('/api/auth/login', (req, res) => {
  const key = loginKey(req);
  if (isRateLimited(key)) {
    return res.status(429).json({ error: '尝试次数过多，请 15 分钟后再试。' });
  }
  const password = String(req.body?.password || '');
  const stored = getSetting('adminPasswordHash');
  if (!password || !verifyPassword(password, stored)) {
    noteLoginFailure(key);
    return res.status(401).json({ error: '暗号不对，再想一想。' });
  }
  loginAttempts.delete(key);
  const token = createSession();
  res.setHeader('Set-Cookie', sessionCookie(req, token, SESSION_TTL_MS / 1000));
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
  res.json({ ok: true });
});

/* ------------------------------- admin ------------------------------- */

app.get('/api/admin/bootstrap', requireAuth, (_req, res) => {
  res.json({
    settings: getSettings(),
    photos: getPhotos(),
    records: getRecords(500),
    moods: getMoods(),
    stats: getStats(),
    passwordIsDefault: getSetting('passwordIsDefault') === '1',
    limits: { fileSizeMb: 150, files: 12 },
  });
});

app.put('/api/admin/settings', requireAuth, (req, res) => {
  const body = req.body || {};
  const next = {
    siteTitle: cleanText(body.siteTitle, 20),
    partnerA: cleanText(body.partnerA, 12),
    partnerB: cleanText(body.partnerB, 12),
    startDate: cleanText(body.startDate, 10),
    heroEyebrow: cleanText(body.heroEyebrow, 60),
    heroSubtitle: cleanText(body.heroSubtitle, 120),
    heroQuote: cleanText(body.heroQuote, 120),
    footerNote: cleanText(body.footerNote, 120),
  };
  if (!next.siteTitle) return res.status(400).json({ error: '网站名称不能为空。' });
  if (!isValidDate(next.startDate)) return res.status(400).json({ error: '恋爱开始日期格式不正确。' });
  if (next.startDate > localDateString()) return res.status(400).json({ error: '恋爱开始日期不能晚于今天。' });
  inTransaction(() => {
    for (const [key, value] of Object.entries(next)) setSetting(key, value);
  });
  res.json({ ok: true, settings: getSettings(), stats: getStats() });
});

app.post('/api/admin/password', requireAuth, (req, res) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  if (!verifyPassword(currentPassword, getSetting('adminPasswordHash'))) {
    return res.status(400).json({ error: '当前密码不正确。' });
  }
  if (newPassword.length < 6 || newPassword.length > 64) {
    return res.status(400).json({ error: '新密码长度需要在 6 到 64 位之间。' });
  }
  setSetting('adminPasswordHash', hashPassword(newPassword));
  setSetting('passwordIsDefault', '0');
  for (const [token, session] of sessions) {
    if (session.expiresAt > Date.now()) sessions.delete(token);
  }
  res.json({ ok: true, message: '密码已更新，请重新登录。' });
});

/* photos */

app.post('/api/admin/photos', requireAuth, mediaUpload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择一张照片。' });
  if (mediaType(req.file.mimetype) !== 'image') {
    removeUploadedFiles([req.file]);
    return res.status(400).json({ error: '这里只能上传照片。' });
  }
  const category = req.body?.category === 'hero' ? 'hero' : 'gallery';
  const caption = cleanText(req.body?.caption, 80);
  const id = uid();
  const sortRow = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM photos WHERE category = ?').get(category);
  db.prepare(`
    INSERT INTO photos (id, category, url, caption, sort_order, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, category, `/uploads/${req.file.filename}`, caption, sortRow.next, nowIso());
  res.status(201).json({
    photo: { id, category, url: `/uploads/${req.file.filename}`, caption, sortOrder: sortRow.next },
    photos: getPhotos(),
  });
});

app.patch('/api/admin/photos/:id', requireAuth, (req, res) => {
  const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(req.params.id);
  if (!photo) return res.status(404).json({ error: '照片不存在。' });
  const caption = req.body?.caption === undefined ? photo.caption : cleanText(req.body.caption, 80);
  const category = req.body?.category === undefined
    ? photo.category
    : (req.body.category === 'hero' ? 'hero' : 'gallery');
  let sortOrder = photo.sort_order;
  if (category !== photo.category) {
    const sortRow = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM photos WHERE category = ?').get(category);
    sortOrder = sortRow.next;
  }
  db.prepare('UPDATE photos SET caption = ?, category = ?, sort_order = ? WHERE id = ?')
    .run(caption, category, sortOrder, photo.id);
  res.json({ ok: true, photos: getPhotos() });
});

app.post('/api/admin/photos/:id/move', requireAuth, (req, res) => {
  const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(req.params.id);
  if (!photo) return res.status(404).json({ error: '照片不存在。' });
  const direction = req.body?.direction === 'up' ? 'up' : 'down';
  const neighbour = direction === 'up'
    ? db.prepare('SELECT * FROM photos WHERE category = ? AND sort_order < ? ORDER BY sort_order DESC LIMIT 1').get(photo.category, photo.sort_order)
    : db.prepare('SELECT * FROM photos WHERE category = ? AND sort_order > ? ORDER BY sort_order ASC LIMIT 1').get(photo.category, photo.sort_order);
  if (!neighbour) return res.json({ ok: true, photos: getPhotos() });
  inTransaction(() => {
    db.prepare('UPDATE photos SET sort_order = ? WHERE id = ?').run(neighbour.sort_order, photo.id);
    db.prepare('UPDATE photos SET sort_order = ? WHERE id = ?').run(photo.sort_order, neighbour.id);
  });
  res.json({ ok: true, photos: getPhotos() });
});

app.delete('/api/admin/photos/:id', requireAuth, (req, res) => {
  const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(req.params.id);
  if (!photo) return res.status(404).json({ error: '照片不存在。' });
  db.prepare('DELETE FROM photos WHERE id = ?').run(photo.id);
  removeUploadByUrl(photo.url);
  res.json({ ok: true, photos: getPhotos() });
});

/* records */

app.post('/api/admin/records', requireAuth, mediaUpload.array('media', 12), (req, res) => {
  const files = req.files || [];
  const fail = (status, message) => {
    removeUploadedFiles(files);
    return res.status(status).json({ error: message });
  };
  const date = cleanText(req.body?.date, 10) || localDateString();
  const title = cleanText(req.body?.title, 80);
  const content = cleanText(req.body?.content, 8000);
  const mood = MOOD_IDS.includes(req.body?.mood) ? req.body.mood : '';
  if (!isValidDate(date)) return fail(400, '日期格式不正确。');
  if (!title && !content && !files.length) return fail(400, '写点什么，或添加一张照片吧。');
  if (content.length > 8000) return fail(400, '文字太长了，请控制在 8000 字以内。');

  const id = uid();
  const createdAt = nowIso();
  try {
    inTransaction(() => {
      db.prepare(`
        INSERT INTO records (id, date, title, content, mood, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, date, title, content, mood, createdAt, createdAt);
      const insertMedia = db.prepare(`
        INSERT INTO media (id, record_id, type, url, original_name, mime_type, size, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const file of files) {
        insertMedia.run(
          uid(), id, mediaType(file.mimetype), `/uploads/${file.filename}`,
          cleanText(file.originalname, 200), String(file.mimetype).split(';')[0], file.size, nowIso(),
        );
      }
    });
  } catch (error) {
    removeUploadedFiles(files);
    throw error;
  }
  res.status(201).json({ ok: true, record: getRecordById(id), stats: getStats() });
});

app.patch('/api/admin/records/:id', requireAuth, (req, res) => {
  const record = db.prepare('SELECT * FROM records WHERE id = ?').get(req.params.id);
  if (!record) return res.status(404).json({ error: '记录不存在。' });
  const body = req.body || {};
  const date = body.date === undefined ? record.date : cleanText(body.date, 10);
  const title = body.title === undefined ? record.title : cleanText(body.title, 80);
  const content = body.content === undefined ? record.content : cleanText(body.content, 8000);
  const mood = body.mood === undefined ? record.mood : (MOOD_IDS.includes(body.mood) ? body.mood : '');
  if (!isValidDate(date)) return res.status(400).json({ error: '日期格式不正确。' });
  db.prepare(`
    UPDATE records SET date = ?, title = ?, content = ?, mood = ?, updated_at = ? WHERE id = ?
  `).run(date, title, content, mood, nowIso(), record.id);
  res.json({ ok: true, record: getRecordById(record.id) });
});

app.post('/api/admin/records/:id/media', requireAuth, mediaUpload.array('media', 12), (req, res) => {
  const record = db.prepare('SELECT id FROM records WHERE id = ?').get(req.params.id);
  if (!record) {
    removeUploadedFiles(req.files);
    return res.status(404).json({ error: '记录不存在。' });
  }
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: '请选择要添加的文件。' });
  try {
    inTransaction(() => {
      const insertMedia = db.prepare(`
        INSERT INTO media (id, record_id, type, url, original_name, mime_type, size, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const file of files) {
        insertMedia.run(
          uid(), record.id, mediaType(file.mimetype), `/uploads/${file.filename}`,
          cleanText(file.originalname, 200), String(file.mimetype).split(';')[0], file.size, nowIso(),
        );
      }
      db.prepare('UPDATE records SET updated_at = ? WHERE id = ?').run(nowIso(), record.id);
    });
  } catch (error) {
    removeUploadedFiles(files);
    throw error;
  }
  res.json({ ok: true, record: getRecordById(record.id) });
});

app.delete('/api/admin/media/:id', requireAuth, (req, res) => {
  const media = db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
  if (!media) return res.status(404).json({ error: '附件不存在。' });
  db.prepare('DELETE FROM media WHERE id = ?').run(media.id);
  removeUploadByUrl(media.url);
  res.json({ ok: true, record: getRecordById(media.record_id) });
});

app.delete('/api/admin/records/:id', requireAuth, (req, res) => {
  const record = db.prepare('SELECT * FROM records WHERE id = ?').get(req.params.id);
  if (!record) return res.status(404).json({ error: '记录不存在。' });
  const media = db.prepare('SELECT * FROM media WHERE record_id = ?').all(record.id);
  db.prepare('DELETE FROM records WHERE id = ?').run(record.id);
  for (const item of media) removeUploadByUrl(item.url);
  res.json({ ok: true, stats: getStats() });
});

/* moods */

app.post('/api/admin/moods', requireAuth, (req, res) => {
  const date = cleanText(req.body?.date, 10) || localDateString();
  const mood = String(req.body?.mood || '');
  const note = cleanText(req.body?.note, 240);
  if (!isValidDate(date)) return res.status(400).json({ error: '日期格式不正确。' });
  if (!MOOD_IDS.includes(mood)) return res.status(400).json({ error: '请选择一种心情。' });
  const existing = db.prepare('SELECT id FROM moods WHERE date = ?').get(date);
  const id = existing ? existing.id : uid();
  const createdAt = existing ? undefined : nowIso();
  db.prepare(`
    INSERT INTO moods (id, date, mood, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET mood = excluded.mood, note = excluded.note, updated_at = excluded.updated_at
  `).run(id, date, mood, note, createdAt || nowIso(), nowIso());
  res.json({ ok: true, moods: getMoods(), stats: getStats() });
});

app.delete('/api/admin/moods/:id', requireAuth, (req, res) => {
  const mood = db.prepare('SELECT * FROM moods WHERE id = ?').get(req.params.id);
  if (!mood) return res.status(404).json({ error: '心情记录不存在。' });
  db.prepare('DELETE FROM moods WHERE id = ?').run(mood.id);
  res.json({ ok: true, moods: getMoods(), stats: getStats() });
});

/* ------------------------------- static ------------------------------ */

app.use(express.static(PUBLIC_DIR, {
  extensions: ['html'],
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));

app.use('/api', (_req, res) => {
  res.status(404).json({ error: '接口不存在。' });
});

app.get('*splat', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

/* ------------------------------ errors ------------------------------- */

app.use((error, req, res, _next) => {
  removeUploadedFiles(req.files || (req.file ? [req.file] : []));
  if (error instanceof multer.MulterError) {
    const messages = {
      LIMIT_FILE_SIZE: '单个文件不能超过 150MB。',
      LIMIT_FILE_COUNT: '一次最多上传 12 个文件。',
      LIMIT_UNEXPECTED_FILE: '上传字段不正确。',
    };
    return res.status(400).json({ error: messages[error.code] || `上传失败：${error.message}` });
  }
  if (error?.message?.includes('不支持这种文件格式')) {
    return res.status(400).json({ error: error.message });
  }
  if (error?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: '请求内容不是有效的 JSON。' });
  }
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({ error: '提交的内容太大了。' });
  }
  if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 500) {
    return res.status(error.status).json({ error: '请求内容不正确。' });
  }
  console.error('[server error]', error);
  res.status(500).json({ error: '服务器开小差了，请稍后再试。' });
});

/* ------------------------------ startup ------------------------------ */

const server = app.listen(PORT, HOST, () => {
  console.log('');
  console.log('  ♥  安妤鱼 · 我们的恋爱小屋');
  console.log(`  →  首页：http://localhost:${PORT}`);
  console.log(`  →  后台：http://localhost:${PORT}/admin`);
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) addresses.push(entry.address);
    }
  }
  for (const address of addresses) {
    console.log(`  →  手机访问（同一 Wi-Fi）：http://${address}:${PORT}`);
  }
  console.log('');
});

function shutdown() {
  server.close(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
