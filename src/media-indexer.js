import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import ffmpegPathStatic from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import { db, isoNow } from './db.js';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const thumbnailRoot = path.join(projectRoot, 'data', 'thumbnails');

const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mkv',
  '.webm',
  '.mov',
  '.avi',
  '.m4v',
  '.flv',
  '.wmv',
  '.ts',
  '.m2ts'
]);
const FINGERPRINT_SAMPLE_BYTES = 1024 * 1024;

function toPosixRelative(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function qualityFromHeight(height) {
  if (height >= 2160) return '2160p+';
  if (height >= 1440) return '1440p+';
  if (height >= 1080) return '1080p+';
  if (height >= 720) return '720p+';
  if (height >= 480) return '480p+';
  if (height > 0) return 'SD';
  return 'unknown';
}

async function ensureLibraryRoot(rootDir) {
  const root = path.resolve(rootDir);
  const stat = await fs.stat(root).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Library root does not exist or is not a directory: ${root}`);
  }
  return root;
}

async function walkVideoFiles(rootDir, currentDir = rootDir, acc = []) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const absPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      await walkVideoFiles(rootDir, absPath, acc);
      continue;
    }

    if (!entry.isFile()) continue;
    if (entry.name.startsWith('._')) continue;

    const ext = path.extname(entry.name).toLowerCase();
    if (!VIDEO_EXTENSIONS.has(ext)) continue;

    const relative = toPosixRelative(path.relative(rootDir, absPath));
    acc.push({ absPath, relative, fileName: entry.name });
  }

  return acc;
}

function normalizeFileMtime(fileStat) {
  const mtime = fileStat?.mtime;
  if (mtime?.toISOString) {
    return mtime.toISOString();
  }

  const mtimeMs = Number(fileStat?.mtimeMs || 0);
  return mtimeMs > 0 ? new Date(mtimeMs).toISOString() : null;
}

async function readFileSample(fileHandle, length, position) {
  const safeLength = Math.max(0, Math.floor(Number(length) || 0));
  if (safeLength <= 0) {
    return Buffer.alloc(0);
  }

  const buffer = Buffer.allocUnsafe(safeLength);
  const { bytesRead } = await fileHandle.read(buffer, 0, safeLength, position);
  return buffer.subarray(0, bytesRead);
}

async function buildFileFingerprint(absPath, fileStat) {
  const fileSize = Math.max(0, Math.floor(Number(fileStat?.size || 0)));
  const hash = createHash('sha1');
  hash.update(String(fileSize));
  hash.update(':');

  const fileHandle = await fs.open(absPath, 'r');

  try {
    if (fileSize <= FINGERPRINT_SAMPLE_BYTES * 2) {
      hash.update(await readFileSample(fileHandle, fileSize, 0));
    } else {
      hash.update(await readFileSample(fileHandle, FINGERPRINT_SAMPLE_BYTES, 0));
      hash.update(await readFileSample(fileHandle, FINGERPRINT_SAMPLE_BYTES, fileSize - FINGERPRINT_SAMPLE_BYTES));
    }
  } finally {
    await fileHandle.close();
  }

  return hash.digest('hex').slice(0, 24);
}

let ffprobePathCache;

async function resolveFfprobePath() {
  if (ffprobePathCache !== undefined) {
    return ffprobePathCache;
  }

  const override = String(process.env.FFPROBE_PATH || '').trim();
  if (override) {
    try {
      await fs.access(override);
      ffprobePathCache = override;
      return ffprobePathCache;
    } catch {
      // fall through to bundled / system candidates
    }
  }

  const staticPath = ffprobe?.path;
  if (staticPath) {
    try {
      await fs.access(staticPath);
      ffprobePathCache = staticPath;
      return ffprobePathCache;
    } catch {
      // bundled ffprobe is missing for this platform/arch (e.g. linux/arm64)
    }
  }

  try {
    const locatorBin = process.platform === 'win32' ? 'where' : 'which';
    const { stdout } = await execFileAsync(locatorBin, ['ffprobe']);
    const firstMatch = String(stdout || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);

    ffprobePathCache = firstMatch || null;
    return ffprobePathCache;
  } catch {
    ffprobePathCache = null;
    return ffprobePathCache;
  }
}

async function probeVideo(absPath) {
  const ffprobePath = await resolveFfprobePath();
  if (!ffprobePath) {
    return { width: 0, height: 0, duration: 0, qualityBucket: 'unknown' };
  }

  try {
    const { stdout } = await execFileAsync(ffprobePath, [
      '-v',
      'error',
      '-show_streams',
      '-show_format',
      '-print_format',
      'json',
      absPath
    ]);

    const parsed = JSON.parse(stdout || '{}');
    const videoStream = (parsed.streams || []).find((stream) => stream.codec_type === 'video') || {};
    const width = Number(videoStream.width || 0);
    const height = Number(videoStream.height || 0);
    const duration = Number(parsed.format?.duration || 0);

    return { width, height, duration, qualityBucket: qualityFromHeight(height) };
  } catch {
    return { width: 0, height: 0, duration: 0, qualityBucket: 'unknown' };
  }
}

let ffmpegPathCache;
let quickLookPathCache;

async function resolveFfmpegPath() {
  if (ffmpegPathCache !== undefined) {
    return ffmpegPathCache;
  }

  const override = String(process.env.FFMPEG_PATH || '').trim();
  if (override) {
    try {
      await fs.access(override);
      ffmpegPathCache = override;
      return ffmpegPathCache;
    } catch {
      // fall through to bundled / system candidates
    }
  }

  if (ffmpegPathStatic) {
    try {
      await fs.access(ffmpegPathStatic);
      ffmpegPathCache = ffmpegPathStatic;
      return ffmpegPathCache;
    } catch {
      // continue to other candidates
    }
  }

  const ffprobePath = ffprobe?.path;
  if (ffprobePath) {
    const bundledCandidate = path.join(path.dirname(ffprobePath), process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    try {
      await fs.access(bundledCandidate);
      ffmpegPathCache = bundledCandidate;
      return ffmpegPathCache;
    } catch {
      // no bundled ffmpeg
    }
  }

  try {
    const locatorBin = process.platform === 'win32' ? 'where' : 'which';
    const { stdout } = await execFileAsync(locatorBin, ['ffmpeg']);
    const firstMatch = String(stdout || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);

    ffmpegPathCache = firstMatch || null;
    return ffmpegPathCache;
  } catch {
    ffmpegPathCache = null;
    return ffmpegPathCache;
  }
}

async function resolveQuickLookPath() {
  if (quickLookPathCache !== undefined) {
    return quickLookPathCache;
  }

  if (process.platform !== 'darwin') {
    quickLookPathCache = null;
    return quickLookPathCache;
  }

  const quickLookPath = '/usr/bin/qlmanage';

  try {
    await fs.access(quickLookPath);
    quickLookPathCache = quickLookPath;
    return quickLookPathCache;
  } catch {
    quickLookPathCache = null;
    return quickLookPathCache;
  }
}

const selectActiveRelativePathsStmt = db.prepare('SELECT relative_path FROM videos WHERE is_missing = 0');
const selectActiveVideoByRelativePathStmt = db.prepare(`
  SELECT
    id,
    relative_path AS relativePath,
    thumbnail_path AS thumbnailPath,
    content_fingerprint AS contentFingerprint,
    file_size AS fileSize,
    file_mtime AS fileMtime
  FROM videos
  WHERE relative_path = ?
    AND is_missing = 0
  ORDER BY id DESC
  LIMIT 1
`);
const selectUnmatchedVideosByFingerprintStmt = db.prepare(`
  SELECT
    id,
    relative_path AS relativePath,
    is_missing AS isMissing,
    thumbnail_path AS thumbnailPath,
    content_fingerprint AS contentFingerprint,
    file_size AS fileSize,
    file_mtime AS fileMtime
  FROM videos
  WHERE scan_session_id IS NULL
    AND content_fingerprint = ?
  ORDER BY is_missing DESC, updated_at DESC, id DESC
`);
const selectUnmatchedVideosByFileSignatureStmt = db.prepare(`
  SELECT
    id,
    relative_path AS relativePath,
    is_missing AS isMissing,
    thumbnail_path AS thumbnailPath,
    content_fingerprint AS contentFingerprint,
    file_size AS fileSize,
    file_mtime AS fileMtime
  FROM videos
  WHERE scan_session_id IS NULL
    AND file_size = ?
    AND file_mtime = ?
  ORDER BY is_missing DESC, updated_at DESC, id DESC
`);
const selectThumbnailMissingRelativePathsStmt = db.prepare(`
  SELECT relative_path
  FROM videos
  WHERE is_missing = 0
    AND (thumbnail_path IS NULL OR TRIM(thumbnail_path) = '')
`);
const updateVideoThumbnailStmt = db.prepare('UPDATE videos SET thumbnail_path = ?, thumbnail_time = ?, updated_at = ? WHERE id = ?');
const clearInterruptedScanSessionsStmt = db.prepare('UPDATE videos SET scan_session_id = NULL WHERE scan_session_id IS NOT NULL');
const markVideoMissingStmt = db.prepare(`
  UPDATE videos
  SET
    is_missing = 1,
    scan_session_id = NULL,
    updated_at = ?
  WHERE id = ?
`);
const updateMatchedVideoStmt = db.prepare(`
  UPDATE videos
  SET
    relative_path = @relativePath,
    file_name = @fileName,
    original_created_at = @originalCreatedAt,
    duration = CASE WHEN @duration > 0 THEN @duration ELSE duration END,
    width = CASE WHEN @width > 0 THEN @width ELSE width END,
    height = CASE WHEN @height > 0 THEN @height ELSE height END,
    quality_bucket = CASE WHEN @height > 0 THEN @qualityBucket ELSE quality_bucket END,
    scan_session_id = @scanSessionId,
    is_missing = 0,
    file_size = @fileSize,
    file_mtime = @fileMtime,
    content_fingerprint = @contentFingerprint,
    updated_at = @now
  WHERE id = @id
`);
const insertVideoStmt = db.prepare(`
  INSERT INTO videos (
    relative_path,
    file_name,
    display_title,
    original_created_at,
    duration,
    width,
    height,
    quality_bucket,
    scan_session_id,
    last_scanned_at,
    is_missing,
    file_size,
    file_mtime,
    content_fingerprint,
    created_at,
    updated_at
  )
  VALUES (
    @relativePath,
    @fileName,
    @displayTitle,
    @originalCreatedAt,
    @duration,
    @width,
    @height,
    @qualityBucket,
    @scanSessionId,
    NULL,
    0,
    @fileSize,
    @fileMtime,
    @contentFingerprint,
    @now,
    @now
  )
`);
const finalizeScanStmt = db.transaction((scanSessionId, completedAt) => {
  const missingResult = db.prepare(`
    UPDATE videos
    SET
      is_missing = 1,
      scan_session_id = NULL,
      updated_at = CASE WHEN is_missing = 0 THEN ? ELSE updated_at END
    WHERE scan_session_id IS NULL
      AND is_missing = 0
  `).run(completedAt);
  const activeResult = db.prepare(`
    UPDATE videos
    SET
      is_missing = 0,
      last_scanned_at = ?,
      scan_session_id = NULL
    WHERE scan_session_id = ?
  `).run(completedAt, scanSessionId);
  db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM video_tags)').run();
  db.prepare('DELETE FROM starrings WHERE id NOT IN (SELECT DISTINCT starring_id FROM video_starrings)').run();
  return {
    missingCount: missingResult.changes,
    activeCount: activeResult.changes
  };
});

function createScanSessionId(startedAt) {
  const startedAtKey = String(startedAt || isoNow()).replaceAll(/[^0-9TZ]/g, '');
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `scan-${startedAtKey}-${randomPart}`;
}

function logScanInfo(message, details = '') {
  const suffix = details ? ` ${details}` : '';
  console.info(`[library-scan] ${message}${suffix}`);
}

function calculateScanDiff(files) {
  const existingRows = selectActiveRelativePathsStmt.all();
  const existingSet = new Set(existingRows.map((row) => row.relative_path));
  const currentSet = new Set(files.map((file) => file.relative));
  const addedFiles = files.filter((file) => !existingSet.has(file.relative));
  let missingCount = 0;

  for (const row of existingRows) {
    if (!currentSet.has(row.relative_path)) {
      missingCount += 1;
    }
  }

  return {
    addedFiles,
    addedCount: addedFiles.length,
    missingCount,
    deletedCount: missingCount
  };
}

function calculateThumbnailBackfillCount(files) {
  const thumbnailMissingSet = new Set(
    selectThumbnailMissingRelativePathsStmt.all().map((row) => row.relative_path)
  );

  let missingThumbnailCount = 0;

  for (const file of files) {
    if (thumbnailMissingSet.has(file.relative)) {
      missingThumbnailCount += 1;
    }
  }

  return missingThumbnailCount;
}

async function captureAutoThumbnailWithFfmpeg(absPath, videoId, durationSec) {
  const ffmpegPath = await resolveFfmpegPath();
  if (!ffmpegPath) {
    return null;
  }

  const centerSec = Number.isFinite(durationSec) && durationSec > 0 ? Math.max(0, durationSec / 2) : 0;
  const outputName = `video-${videoId}-auto-${Date.now()}.jpg`;
  const outputAbsPath = path.join(thumbnailRoot, outputName);

  await fs.mkdir(thumbnailRoot, { recursive: true });

  try {
    await execFileAsync(ffmpegPath, [
      '-y',
      '-ss',
      centerSec.toFixed(3),
      '-i',
      absPath,
      '-frames:v',
      '1',
      '-q:v',
      '4',
      outputAbsPath
    ]);

    await fs.access(outputAbsPath);

    return {
      thumbnailPath: `/thumbnails/${outputName}`,
      thumbnailTime: centerSec
    };
  } catch {
    await fs.unlink(outputAbsPath).catch(() => {});
    return null;
  }
}

async function captureAutoThumbnailWithQuickLook(absPath, videoId) {
  const quickLookPath = await resolveQuickLookPath();
  if (!quickLookPath) {
    return null;
  }

  await fs.mkdir(thumbnailRoot, { recursive: true });

  const tempDir = await fs.mkdtemp(path.join(thumbnailRoot, 'ql-thumb-'));
  const outputName = `video-${videoId}-auto-${Date.now()}.png`;
  const outputAbsPath = path.join(thumbnailRoot, outputName);

  try {
    await execFileAsync(quickLookPath, ['-t', '-s', '1024', '-o', tempDir, absPath]);

    const generatedName = (await fs.readdir(tempDir)).find((fileName) => fileName.toLowerCase().endsWith('.png'));
    if (!generatedName) {
      return null;
    }

    await fs.rename(path.join(tempDir, generatedName), outputAbsPath);

    return {
      thumbnailPath: `/thumbnails/${outputName}`,
      thumbnailTime: null
    };
  } catch {
    await fs.unlink(outputAbsPath).catch(() => {});
    return null;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function captureAutoThumbnail(absPath, videoId, durationSec) {
  const ffmpegCapture = await captureAutoThumbnailWithFfmpeg(absPath, videoId, durationSec);
  if (ffmpegCapture) {
    return ffmpegCapture;
  }

  return captureAutoThumbnailWithQuickLook(absPath, videoId);
}

function hasStoredIdentity(row) {
  return Boolean(String(row?.contentFingerprint || '').trim()) || (
    Number(row?.fileSize || 0) > 0 && Boolean(String(row?.fileMtime || '').trim())
  );
}

function isSameFileIdentity(row, payload) {
  const existingFingerprint = String(row?.contentFingerprint || '').trim();
  const nextFingerprint = String(payload?.contentFingerprint || '').trim();

  if (existingFingerprint && nextFingerprint) {
    return existingFingerprint === nextFingerprint;
  }

  if (!hasStoredIdentity(row)) {
    return true;
  }

  return (
    Number(row?.fileSize || 0) === Number(payload?.fileSize || 0) &&
    String(row?.fileMtime || '').trim() === String(payload?.fileMtime || '').trim()
  );
}

function candidateCanMoveToPath(candidate, payload, currentFileIdentitiesByPath) {
  if (candidate.relativePath === payload.relativePath) {
    return true;
  }

  const fileAtCandidatePath = currentFileIdentitiesByPath.get(candidate.relativePath);
  if (!fileAtCandidatePath) {
    return true;
  }

  return !isSameFileIdentity(candidate, fileAtCandidatePath);
}

function findSingleUnmatchedCandidate(payload, currentFileIdentitiesByPath, excludedIds = []) {
  const excludeSet = new Set(
    excludedIds
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0)
  );

  let candidates = [];
  const fingerprint = String(payload?.contentFingerprint || '').trim();

  if (fingerprint) {
    candidates = selectUnmatchedVideosByFingerprintStmt
      .all(fingerprint)
      .filter((row) => !excludeSet.has(Number(row.id)))
      .filter((row) => candidateCanMoveToPath(row, payload, currentFileIdentitiesByPath));
  }

  if (candidates.length === 0 && Number(payload?.fileSize || 0) > 0 && String(payload?.fileMtime || '').trim()) {
    candidates = selectUnmatchedVideosByFileSignatureStmt
      .all(Number(payload.fileSize), String(payload.fileMtime).trim())
      .filter((row) => !excludeSet.has(Number(row.id)))
      .filter((row) => candidateCanMoveToPath(row, payload, currentFileIdentitiesByPath));
  }

  const samePathCandidates = candidates.filter((row) => row.relativePath === payload.relativePath);
  if (samePathCandidates.length === 1) {
    return samePathCandidates[0];
  }

  const activeCandidates = candidates.filter((row) => !row.isMissing);
  if (activeCandidates.length === 1) {
    return activeCandidates[0];
  }

  return candidates.length === 1 ? candidates[0] : null;
}

const syncScannedVideoStmt = db.transaction((payload, currentFileIdentitiesByPath) => {
  const activeByPath = selectActiveVideoByRelativePathStmt.get(payload.relativePath);

  if (activeByPath && isSameFileIdentity(activeByPath, payload)) {
    updateMatchedVideoStmt.run({
      ...payload,
      id: activeByPath.id
    });

    return {
      videoId: Number(activeByPath.id),
      thumbnailPath: activeByPath.thumbnailPath || null,
      addedCount: 0,
      missingCount: 0
    };
  }

  const candidate = findSingleUnmatchedCandidate(
    payload,
    currentFileIdentitiesByPath,
    activeByPath ? [activeByPath.id] : []
  );
  let missingCount = 0;

  if (candidate) {
    if (activeByPath && Number(activeByPath.id) !== Number(candidate.id)) {
      markVideoMissingStmt.run(payload.now, activeByPath.id);
      missingCount += 1;
    }

    updateMatchedVideoStmt.run({
      ...payload,
      id: candidate.id
    });

    return {
      videoId: Number(candidate.id),
      thumbnailPath: candidate.thumbnailPath || null,
      addedCount: 0,
      missingCount
    };
  }

  if (activeByPath) {
    markVideoMissingStmt.run(payload.now, activeByPath.id);
    missingCount += 1;
  }

  const insertResult = insertVideoStmt.run(payload);

  return {
    videoId: Number(insertResult.lastInsertRowid),
    thumbnailPath: null,
    addedCount: 1,
    missingCount
  };
});

export function cleanupInterruptedLibraryScanState() {
  const result = clearInterruptedScanSessionsStmt.run();

  if (result.changes > 0) {
    logScanInfo(`successfully reset ${result.changes} interrupted scan(s) from last session`);
  }

  return result.changes;
}

export async function previewLibraryScan(libraryRoot) {
  const root = await ensureLibraryRoot(libraryRoot);
  const files = await walkVideoFiles(root);
  const diff = calculateScanDiff(files);
  const missingThumbnailCount = calculateThumbnailBackfillCount(files);

  return {
    scannedCount: files.length,
    addedCount: diff.addedCount,
    missingCount: diff.missingCount,
    deletedCount: diff.deletedCount,
    missingThumbnailCount,
    scannedAt: isoNow()
  };
}

export async function scanLibrary(libraryRoot, options = {}) {
  const { onProgress } = options;
  const root = await ensureLibraryRoot(libraryRoot);
  cleanupInterruptedLibraryScanState();
  onProgress?.({
    phase: 'discovering',
    scannedCount: 0,
    totalCount: null
  });
  const startAt = isoNow();
  const scanSessionId = createScanSessionId(startAt);
  const files = await walkVideoFiles(root);
  const scannedFiles = [];
  let autoThumbnailsCreated = 0;
  let addedCount = 0;
  let missingCount = 0;
  logScanInfo('started', `session=${scanSessionId} files=${files.length}`);

  for (const file of files) {
    const fileStat = await fs.stat(file.absPath);
    const contentFingerprint = await buildFileFingerprint(file.absPath, fileStat).catch(() => null);
    const fileMtime = normalizeFileMtime(fileStat);

    scannedFiles.push({
      ...file,
      fileStat,
      fileSize: Math.max(0, Math.floor(Number(fileStat.size || 0))),
      fileMtime,
      contentFingerprint
    });
  }

  const currentFileIdentitiesByPath = new Map(
    scannedFiles.map((file) => [
      file.relative,
      {
        contentFingerprint: file.contentFingerprint,
        fileSize: file.fileSize,
        fileMtime: file.fileMtime
      }
    ])
  );

  onProgress?.({
    phase: 'processing',
    scannedCount: 0,
    totalCount: files.length
  });

  for (const [index, file] of scannedFiles.entries()) {
    const probed = await probeVideo(file.absPath);
    const displayTitle = path.parse(file.fileName).name;
    const now = isoNow();

    const scanResult = syncScannedVideoStmt({
      relativePath: file.relative,
      fileName: file.fileName,
      displayTitle,
      originalCreatedAt: file.fileStat.birthtime?.toISOString?.() || file.fileStat.mtime.toISOString(),
      duration: probed.duration,
      width: probed.width,
      height: probed.height,
      qualityBucket: probed.qualityBucket,
      scanSessionId,
      fileSize: file.fileSize,
      fileMtime: file.fileMtime,
      contentFingerprint: file.contentFingerprint,
      now
    }, currentFileIdentitiesByPath);
    addedCount += Number(scanResult.addedCount || 0);
    missingCount += Number(scanResult.missingCount || 0);

    if (scanResult?.videoId && !scanResult.thumbnailPath) {
      const captured = await captureAutoThumbnail(file.absPath, scanResult.videoId, probed.duration);
      if (captured) {
        updateVideoThumbnailStmt.run(captured.thumbnailPath, captured.thumbnailTime, isoNow(), scanResult.videoId);
        autoThumbnailsCreated += 1;
      }
    }

    onProgress?.({
      phase: 'processing',
      scannedCount: index + 1,
      totalCount: files.length,
      currentFile: file.relative
    });
  }

  onProgress?.({
    phase: 'finalizing',
    scannedCount: files.length,
    totalCount: files.length
  });

  const finalizeResult = finalizeScanStmt(scanSessionId, startAt);
  missingCount += Number(finalizeResult?.missingCount || 0);
  logScanInfo('finished', `session=${scanSessionId} files=${files.length} autoThumbnailsCreated=${autoThumbnailsCreated}`);

  return {
    scannedCount: files.length,
    addedCount,
    missingCount,
    deletedCount: missingCount,
    autoThumbnailsCreated,
    scannedAt: startAt
  };
}

export function resolveAbsolutePath(libraryRoot, relativePath) {
  return path.resolve(libraryRoot, relativePath);
}
