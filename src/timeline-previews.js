import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import ffmpegPathStatic from 'ffmpeg-static';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

export const timelinePreviewRoot = path.join(projectRoot, 'data', 'timeline-previews');

const PREVIEW_VERSION = 1;
const PREVIEW_WIDTH = 248;
const TARGET_FRAME_COUNT = 90;
const MIN_INTERVAL_SEC = 5;
const MAX_CONCURRENT_GENERATIONS = 1;
const TEMP_PREVIEW_DIR_PATTERN = /^video-\d+-tmp-\d+$/;
const generationLocks = new Map();
const generationQueue = [];

let ffmpegPathCache;
let activeGenerationCount = 0;

function logPreviewInfo(message, details = '') {
  const suffix = details ? ` ${details}` : '';
  console.info(`[timeline-preview] ${message}${suffix}`);
}

function logPreviewWarn(message, details = '') {
  const suffix = details ? ` ${details}` : '';
  console.warn(`[timeline-preview] ${message}${suffix}`);
}

function getQueueStateText({ afterCurrentJob = false } = {}) {
  const nextActiveCount = afterCurrentJob ? Math.max(0, activeGenerationCount - 1) : activeGenerationCount;
  return `queue=${generationQueue.length} active=${nextActiveCount}`;
}

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
      // continue to bundled / PATH lookup
    }
  }

  if (ffmpegPathStatic) {
    try {
      await fs.access(ffmpegPathStatic);
      ffmpegPathCache = ffmpegPathStatic;
      return ffmpegPathCache;
    } catch {
      // continue to PATH lookup
    }
  }

  try {
    await execFileAsync('ffmpeg', ['-version'], {
      timeout: 4000,
      maxBuffer: 1024 * 1024
    });
    ffmpegPathCache = 'ffmpeg';
    return ffmpegPathCache;
  } catch {
    ffmpegPathCache = null;
    return ffmpegPathCache;
  }
}

function getPreviewIntervalSec(durationSec) {
  const safeDuration = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0;
  if (safeDuration <= 0) {
    return MIN_INTERVAL_SEC;
  }

  return Math.max(MIN_INTERVAL_SEC, Math.ceil(safeDuration / TARGET_FRAME_COUNT));
}

function getPreviewDir(videoId) {
  return path.join(timelinePreviewRoot, `video-${videoId}`);
}

function getManifestPath(videoId) {
  return path.join(getPreviewDir(videoId), 'manifest.json');
}

function buildSourceHash({ stat, durationSec }) {
  return createHash('sha1')
    .update(`${stat.size}:${Math.round(stat.mtimeMs)}:${Math.round(Math.max(0, Number(durationSec) || 0) * 1000)}`)
    .digest('hex')
    .slice(0, 16);
}

function buildImageUrl(videoId, fileName, sourceHash) {
  return `/timeline-previews/video-${videoId}/${fileName}?v=${sourceHash}`;
}

function buildScaleFilter() {
  return `scale='min(${PREVIEW_WIDTH},iw)':-2:force_original_aspect_ratio=decrease`;
}

async function captureSingleFrame({ ffmpegPath, absPath, outputAbsPath, seekSec }) {
  await execFileAsync(
    ffmpegPath,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-y',
      '-ss',
      Math.max(0, Number(seekSec) || 0).toFixed(3),
      '-i',
      absPath,
      '-frames:v',
      '1',
      '-vf',
      buildScaleFilter(),
      '-q:v',
      '6',
      outputAbsPath
    ],
    {
      maxBuffer: 8 * 1024 * 1024
    }
  );
}

async function readManifest(videoId) {
  const manifestPath = getManifestPath(videoId);

  try {
    const raw = await fs.readFile(manifestPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function validateManifest(videoId, manifest, sourceHash) {
  if (!manifest || manifest.version !== PREVIEW_VERSION || manifest.sourceHash !== sourceHash) {
    return null;
  }

  if (!Array.isArray(manifest.items) || manifest.items.length === 0) {
    return null;
  }

  const previewDir = getPreviewDir(videoId);
  const expectedPaths = manifest.items
    .map((item) => item?.fileName)
    .filter(Boolean)
    .map((fileName) => path.join(previewDir, fileName));

  try {
    await Promise.all(expectedPaths.map((absPath) => fs.access(absPath)));
    return manifest;
  } catch {
    return null;
  }
}

function createManifestResponse(manifest) {
  return {
    duration: Number(manifest.durationSec || 0),
    intervalSec: Number(manifest.intervalSec || MIN_INTERVAL_SEC),
    width: Number(manifest.width || PREVIEW_WIDTH),
    items: manifest.items.map((item) => ({
      timeSec: Number(item.timeSec || 0),
      imageUrl: item.imageUrl
    }))
  };
}

async function generateManifest({ videoId, absPath, durationSec, sourceHash }) {
  const ffmpegPath = await resolveFfmpegPath();
  if (!ffmpegPath) {
    logPreviewWarn('ffmpeg unavailable', `video=${videoId} file="${path.basename(absPath)}"`);
    return null;
  }

  const intervalSec = getPreviewIntervalSec(durationSec);
  const previewDir = getPreviewDir(videoId);
  const tempDir = path.join(timelinePreviewRoot, `video-${videoId}-tmp-${Date.now()}`);
  const outputPattern = path.join(tempDir, 'frame-%05d.jpg');
  const generationStartedAt = Date.now();


  await fs.mkdir(timelinePreviewRoot, { recursive: true });
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(tempDir, { recursive: true });

  try {
    await execFileAsync(
      ffmpegPath,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-y',
        '-i',
        absPath,
        '-vf',
        `fps=1/${intervalSec},${buildScaleFilter()}`,
        '-q:v',
        '6',
        outputPattern
      ],
      {
        maxBuffer: 8 * 1024 * 1024
      }
    );

    let frameNames = (await fs.readdir(tempDir))
      .filter((fileName) => /^frame-\d+\.jpg$/i.test(fileName))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (frameNames.length === 0) {
      const fallbackName = 'frame-00001.jpg';
      await captureSingleFrame({
        ffmpegPath,
        absPath,
        outputAbsPath: path.join(tempDir, fallbackName),
        seekSec: durationSec > 0 ? durationSec / 2 : 0
      });
      frameNames = [fallbackName];
    }

    const manifest = {
      version: PREVIEW_VERSION,
      sourceHash,
      durationSec: Math.max(0, Number(durationSec) || 0),
      intervalSec,
      width: PREVIEW_WIDTH,
      createdAt: new Date().toISOString(),
      items: frameNames.map((fileName, index) => ({
        fileName,
        timeSec: Math.min(Math.max(0, Number(durationSec) || 0), index * intervalSec),
        imageUrl: buildImageUrl(videoId, fileName, sourceHash)
      }))
    };

    await fs.writeFile(path.join(tempDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    await fs.rm(previewDir, { recursive: true, force: true }).catch(() => {});
    await fs.rename(tempDir, previewDir);
    logPreviewInfo('done', `video=${videoId} ${getQueueStateText({ afterCurrentJob: true })}`);
    return manifest;
  } catch (error) {
    logPreviewWarn(
      'generation failed',
      `video=${videoId} file="${path.basename(absPath)}" error="${error?.message || 'unknown error'}" ${getQueueStateText({ afterCurrentJob: true })}`
    );
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    return null;
  }
}

function pumpGenerationQueue() {
  while (activeGenerationCount < MAX_CONCURRENT_GENERATIONS && generationQueue.length > 0) {
    const job = generationQueue.shift();
    activeGenerationCount += 1;

    void (async () => {
      try {
        const manifest = await generateManifest(job);
        job.resolve(manifest);
      } finally {
        activeGenerationCount = Math.max(0, activeGenerationCount - 1);
        pumpGenerationQueue();
      }
    })();
  }
}

function enqueuePreviewGeneration(job) {
  return new Promise((resolve) => {
    generationQueue.push({
      ...job,
      resolve
    });

    pumpGenerationQueue();
    logPreviewInfo('enqueued', getQueueStateText());
  });
}

export async function cleanupStaleTimelinePreviewTemps() {
  await fs.mkdir(timelinePreviewRoot, { recursive: true });

  const entries = await fs.readdir(timelinePreviewRoot, { withFileTypes: true }).catch(() => []);
  const staleDirs = entries
    .filter((entry) => entry.isDirectory() && TEMP_PREVIEW_DIR_PATTERN.test(entry.name))
    .map((entry) => path.join(timelinePreviewRoot, entry.name));

  await Promise.all(staleDirs.map((dirPath) => fs.rm(dirPath, { recursive: true, force: true }).catch(() => {})));

  if (staleDirs.length > 0) {
    logPreviewInfo(`successfully cleaned up ${staleDirs.length} incomplete preview(s) from last session`);
  }
}

export async function ensureTimelinePreviewManifest({ videoId, absPath, durationSec }) {
  const key = String(videoId);
  const inFlight = generationLocks.get(key);
  if (inFlight) {
    logPreviewInfo('awaiting in-flight generation', `video=${videoId} file="${path.basename(absPath)}"`);
    return inFlight;
  }

  const generationPromise = (async () => {
    const stat = await fs.stat(absPath);
    const sourceHash = buildSourceHash({ stat, durationSec });
    const cached = await validateManifest(videoId, await readManifest(videoId), sourceHash);

    if (cached) {
      return createManifestResponse(cached);
    }

    logPreviewInfo('cache miss', `video=${videoId} file="${path.basename(absPath)}"`);
    const generated = await enqueuePreviewGeneration({ videoId, absPath, durationSec, sourceHash });
    return generated ? createManifestResponse(generated) : null;
  })();

  generationLocks.set(key, generationPromise);

  try {
    return await generationPromise;
  } finally {
    if (generationLocks.get(key) === generationPromise) {
      generationLocks.delete(key);
    }
  }
}

export async function deleteTimelinePreviewCache(videoId) {
  await fs.rm(getPreviewDir(videoId), { recursive: true, force: true }).catch(() => {});
}
