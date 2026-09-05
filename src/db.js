import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
export const dataDir = path.join(projectRoot, 'data');
export const userDataSchemaVersion = 1;

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'videoplayer.db');
export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const existingSchemaVersion = Number(db.pragma('user_version', { simple: true }) || 0);
if (existingSchemaVersion > userDataSchemaVersion) {
  throw new Error(
    `This CornField data uses schema version ${existingSchemaVersion}, but this app supports up to ${userDataSchemaVersion}.`
  );
}

db.exec(`
CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  relative_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  display_title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  upload_date TEXT,
  original_created_at TEXT,
  duration REAL NOT NULL DEFAULT 0,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  quality_bucket TEXT NOT NULL DEFAULT 'unknown',
  scan_session_id TEXT,
  category TEXT NOT NULL DEFAULT '',
  view_count INTEGER NOT NULL DEFAULT 0,
  thumbnail_path TEXT,
  thumbnail_time REAL,
  is_missing INTEGER NOT NULL DEFAULT 0,
  last_scanned_at TEXT,
  file_size INTEGER NOT NULL DEFAULT 0,
  file_mtime TEXT,
  content_fingerprint TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS video_tags (
  video_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY(video_id, tag_id),
  FOREIGN KEY(video_id) REFERENCES videos(id) ON DELETE CASCADE,
  FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS starrings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS video_starrings (
  video_id INTEGER NOT NULL,
  starring_id INTEGER NOT NULL,
  PRIMARY KEY(video_id, starring_id),
  FOREIGN KEY(video_id) REFERENCES videos(id) ON DELETE CASCADE,
  FOREIGN KEY(starring_id) REFERENCES starrings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  rating REAL NOT NULL DEFAULT 0,
  rated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(video_id) REFERENCES videos(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS timeline_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL,
  timestamp_sec REAL NOT NULL,
  memo TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(video_id) REFERENCES videos(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS watch_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  media_duration_sec REAL NOT NULL DEFAULT 0,
  watched_seconds REAL NOT NULL DEFAULT 0,
  last_position_sec REAL NOT NULL DEFAULT 0,
  max_position_sec REAL NOT NULL DEFAULT 0,
  completion_ratio REAL NOT NULL DEFAULT 0,
  ended_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(video_id) REFERENCES videos(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_watch_sessions_video_id ON watch_sessions(video_id);
CREATE INDEX IF NOT EXISTS idx_watch_sessions_started_at ON watch_sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_watch_sessions_updated_at ON watch_sessions(updated_at);
`);

function getVideoColumns() {
  return db.prepare('PRAGMA table_info(videos)').all();
}

function getVideosTableSql() {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'videos'").get();
  return String(row?.sql || '');
}

function ensureVideoIndexes() {
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_videos_active_relative_path ON videos(relative_path) WHERE is_missing = 0');
  db.exec('CREATE INDEX IF NOT EXISTS idx_videos_search ON videos(display_title, file_name, category)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_videos_height ON videos(height)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_videos_upload_date ON videos(upload_date)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_videos_view_count ON videos(view_count)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_videos_is_missing ON videos(is_missing)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_videos_scan_session_id ON videos(scan_session_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_videos_fingerprint_missing ON videos(content_fingerprint, is_missing)');
}

function buildLegacyVideoSelect(columns) {
  const hasColumn = (name) => columns.some((column) => column.name === name);
  const pick = (name, fallbackSql) => (hasColumn(name) ? name : `${fallbackSql} AS ${name}`);

  return [
    pick('id', 'NULL'),
    pick('relative_path', "''"),
    pick('file_name', "''"),
    pick('display_title', "''"),
    pick('description', "''"),
    pick('upload_date', 'NULL'),
    pick('original_created_at', 'NULL'),
    pick('duration', '0'),
    pick('width', '0'),
    pick('height', '0'),
    pick('quality_bucket', "'unknown'"),
    pick('scan_session_id', 'NULL'),
    pick('category', "''"),
    pick('view_count', '0'),
    pick('thumbnail_path', 'NULL'),
    pick('thumbnail_time', 'NULL'),
    pick('is_missing', '0'),
    pick('last_scanned_at', 'NULL'),
    pick('file_size', '0'),
    pick('file_mtime', 'NULL'),
    pick('content_fingerprint', 'NULL'),
    pick('created_at', 'CURRENT_TIMESTAMP'),
    pick('updated_at', 'CURRENT_TIMESTAMP')
  ].join(',\n      ');
}

function rebuildVideosTable(columns) {
  const previousForeignKeys = Number(db.pragma('foreign_keys', { simple: true }) || 0);
  const legacySelectSql = buildLegacyVideoSelect(columns);

  db.pragma('foreign_keys = OFF');

  try {
    db.exec('BEGIN');
    db.exec(`
      CREATE TABLE videos_rebuild (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        relative_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        display_title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        upload_date TEXT,
        original_created_at TEXT,
        duration REAL NOT NULL DEFAULT 0,
        width INTEGER NOT NULL DEFAULT 0,
        height INTEGER NOT NULL DEFAULT 0,
        quality_bucket TEXT NOT NULL DEFAULT 'unknown',
        scan_session_id TEXT,
        category TEXT NOT NULL DEFAULT '',
        view_count INTEGER NOT NULL DEFAULT 0,
        thumbnail_path TEXT,
        thumbnail_time REAL,
        is_missing INTEGER NOT NULL DEFAULT 0,
        last_scanned_at TEXT,
        file_size INTEGER NOT NULL DEFAULT 0,
        file_mtime TEXT,
        content_fingerprint TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    db.exec(`
      INSERT INTO videos_rebuild (
        id,
        relative_path,
        file_name,
        display_title,
        description,
        upload_date,
        original_created_at,
        duration,
        width,
        height,
        quality_bucket,
        scan_session_id,
        category,
        view_count,
        thumbnail_path,
        thumbnail_time,
        is_missing,
        last_scanned_at,
        file_size,
        file_mtime,
        content_fingerprint,
        created_at,
        updated_at
      )
      SELECT
        ${legacySelectSql}
      FROM videos
    `);
    db.exec('DROP TABLE videos');
    db.exec('ALTER TABLE videos_rebuild RENAME TO videos');
    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback failure
    }
    throw error;
  } finally {
    db.pragma(`foreign_keys = ${previousForeignKeys ? 'ON' : 'OFF'}`);
  }
}

function ensureVideosTableSchema() {
  const videoColumns = getVideoColumns();
  const tableSql = getVideosTableSql();
  const hasColumn = (name) => videoColumns.some((column) => column.name === name);
  const needsRebuild =
    /relative_path\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(tableSql) ||
    !hasColumn('scan_session_id') ||
    !hasColumn('file_size') ||
    !hasColumn('file_mtime') ||
    !hasColumn('content_fingerprint');

  if (needsRebuild) {
    rebuildVideosTable(videoColumns);
  }

  ensureVideoIndexes();
}

ensureVideosTableSchema();
db.exec(`
  UPDATE videos
  SET created_at = CASE
    WHEN length(TRIM(created_at)) > 10 THEN TRIM(upload_date) || substr(TRIM(created_at), 11)
    ELSE TRIM(upload_date) || 'T00:00:00.000Z'
  END
  WHERE upload_date IS NOT NULL
    AND TRIM(upload_date) <> ''
    AND (
      created_at IS NULL
      OR TRIM(created_at) = ''
      OR substr(TRIM(created_at), 1, 10) <> TRIM(upload_date)
    )
`);

function nowIso() {
  return new Date().toISOString();
}

const setSettingStmt = db.prepare(`
  INSERT INTO settings (key, value)
  VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);

const getSettingStmt = db.prepare('SELECT value FROM settings WHERE key = ?');

export function getSetting(key, fallback = null) {
  const row = getSettingStmt.get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  setSettingStmt.run(key, String(value));
}

export function getSettingsObject() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return rows.reduce((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});
}

export function ensureDefaultSettings() {
  if (getSetting('skipSeconds') === null) setSetting('skipSeconds', '10');
  if (getSetting('libraryRows') === null) setSetting('libraryRows', '3');
  if (getSetting('controlsHideMs') === null) setSetting('controlsHideMs', '2500');
}

const insertTagStmt = db.prepare('INSERT OR IGNORE INTO tags(name) VALUES (?)');
const selectTagStmt = db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE');
const insertVideoTagStmt = db.prepare('INSERT OR IGNORE INTO video_tags(video_id, tag_id) VALUES (?, ?)');

const insertStarringStmt = db.prepare('INSERT OR IGNORE INTO starrings(name) VALUES (?)');
const selectStarringStmt = db.prepare('SELECT id FROM starrings WHERE name = ?');
const insertVideoStarringStmt = db.prepare('INSERT OR IGNORE INTO video_starrings(video_id, starring_id) VALUES (?, ?)');

const deleteVideoTagsStmt = db.prepare('DELETE FROM video_tags WHERE video_id = ?');
const deleteVideoStarringsStmt = db.prepare('DELETE FROM video_starrings WHERE video_id = ?');
const updateVideoTagToPrimaryStmt = db.prepare('UPDATE OR IGNORE video_tags SET tag_id = ? WHERE tag_id = ?');
const deleteTagStmt = db.prepare('DELETE FROM tags WHERE id = ?');
const updateTagNameStmt = db.prepare('UPDATE tags SET name = ? WHERE id = ?');
const selectTagIdByExactNameStmt = db.prepare('SELECT id FROM tags WHERE name = ?');
const deleteSystemShadowVideosStmt = db.prepare("DELETE FROM videos WHERE file_name LIKE '._%' OR relative_path LIKE '%/._%'");
const deleteOrphanTagsStmt = db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM video_tags)');
const deleteOrphanStarringsStmt = db.prepare('DELETE FROM starrings WHERE id NOT IN (SELECT DISTINCT starring_id FROM video_starrings)');

function normalizeEntityName(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u02BC\uFF07\u2032]/g, "'")
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-')
    .replace(/[\p{Cf}\p{Cc}]/gu, '')
    .replace(/\s*-\s*/g, '-')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizedTagKey(value) {
  return normalizeEntityName(value).toLowerCase();
}

function toTitleCaseWords(value) {
  return normalizeEntityName(value)
    .split(' ')
    .map((word) =>
      word
        .split('-')
        .map((part) => {
          if (!part) return part;
          if (/^[A-Z0-9]+$/.test(part) && part.length <= 4) return part;
          return `${part.charAt(0).toLocaleUpperCase()}${part.slice(1).toLocaleLowerCase()}`;
        })
        .join('-')
    )
    .join(' ');
}

function mergeDuplicateTags() {
  const rows = db.prepare('SELECT id, name FROM tags ORDER BY id ASC').all();
  const primaryByKey = new Map();

  for (const row of rows) {
    const key = normalizedTagKey(row.name);
    if (!key) {
      deleteTagStmt.run(row.id);
      continue;
    }

    if (!primaryByKey.has(key)) {
      primaryByKey.set(key, row.id);
      const canonicalName = toTitleCaseWords(row.name);
      if (canonicalName && canonicalName !== row.name) {
        const sameNameRow = selectTagIdByExactNameStmt.get(canonicalName);
        if (!sameNameRow || sameNameRow.id === row.id) {
          updateTagNameStmt.run(canonicalName, row.id);
        }
      }
      continue;
    }

    const primaryId = primaryByKey.get(key);
    updateVideoTagToPrimaryStmt.run(primaryId, row.id);
    deleteTagStmt.run(row.id);
  }
}

export const replaceVideoTags = db.transaction((videoId, rawTags) => {
  deleteVideoTagsStmt.run(videoId);
  const deduped = [];
  const seen = new Set();

  for (const rawTag of rawTags) {
    const normalized = normalizeEntityName(rawTag);
    if (!normalized) continue;
    const key = normalizedTagKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(toTitleCaseWords(normalized));
  }

  for (const tag of deduped) {
    let row = selectTagStmt.get(tag);
    if (!row) {
      insertTagStmt.run(tag);
      row = selectTagStmt.get(tag);
    }
    if (row) {
      insertVideoTagStmt.run(videoId, row.id);
    }
  }
});

export const replaceVideoStarrings = db.transaction((videoId, rawStarrings) => {
  deleteVideoStarringsStmt.run(videoId);
  const starrings = [...new Set(rawStarrings.map((s) => s.trim()).filter(Boolean))];

  for (const starring of starrings) {
    insertStarringStmt.run(starring);
    const row = selectStarringStmt.get(starring);
    if (row) {
      insertVideoStarringStmt.run(videoId, row.id);
    }
  }
});

export function touchVideo(videoId) {
  db.prepare('UPDATE videos SET updated_at = ? WHERE id = ?').run(nowIso(), videoId);
}

export function isoNow() {
  return nowIso();
}

function cleanupSystemShadowVideos() {
  deleteSystemShadowVideosStmt.run();
  deleteOrphanTagsStmt.run();
  deleteOrphanStarringsStmt.run();
}

// ratings are stored as REAL (0–5 in 0.5 steps); SQLite affinity on older DBs remains fine for reads/writes
function ensureCommentRatingColumns() {
  const columns = new Set(db.prepare('PRAGMA table_info(comments)').all().map((row) => row.name));

  if (!columns.has('rating')) {
    db.exec('ALTER TABLE comments ADD COLUMN rating REAL NOT NULL DEFAULT 0');
  }

  if (!columns.has('rated_at')) {
    db.exec('ALTER TABLE comments ADD COLUMN rated_at TEXT');
  }
}

ensureDefaultSettings();
ensureCommentRatingColumns();
cleanupSystemShadowVideos();
mergeDuplicateTags();
db.pragma(`user_version = ${userDataSchemaVersion}`);
