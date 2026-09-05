import { readAudioPreferences, saveAudioPreferences } from './player-preferences.js';
import './select-menu.js';

const mainEl = document.getElementById('main');
const settingsDialog = document.getElementById('settingsDialog');
const settingsForm = document.getElementById('settingsForm');
const libraryRootInput = document.getElementById('libraryRootInput');
const browseLibraryRootBtn = document.getElementById('browseLibraryRootBtn');
const skipSecondsInput = document.getElementById('skipSecondsInput');
const libraryRowsInput = document.getElementById('libraryRowsInput');
const controlsHideMsInput = document.getElementById('controlsHideMsInput');
const scanNowBtn = document.getElementById('scanNowBtn');
const scanProceedBtn = document.getElementById('scanProceedBtn');
const scanCancelBtn = document.getElementById('scanCancelBtn');
const scanPreviewBox = document.getElementById('scanPreviewBox');
const scanPreviewText = document.getElementById('scanPreviewText');
const scanStatusText = document.getElementById('scanStatusText');
const closeSettingsBtn = document.getElementById('closeSettings');
const noteEditDialog = document.getElementById('noteEditDialog');
const noteEditForm = document.getElementById('noteEditForm');
const noteEditTimestampInput = document.getElementById('noteEditTimestampInput');
const noteEditMemoInput = document.getElementById('noteEditMemoInput');
const noteEditUseCurrentBtn = document.getElementById('noteEditUseCurrentBtn');
const noteEditCancelBtn = document.getElementById('noteEditCancelBtn');
const commentEditDialog = document.getElementById('commentEditDialog');
const commentEditForm = document.getElementById('commentEditForm');
const commentEditContentInput = document.getElementById('commentEditContentInput');
const commentEditRatingEditor = document.getElementById('commentEditRatingEditor');
const commentEditRatingInput = document.getElementById('commentEditRatingInput');
const commentEditRatingLabel = document.getElementById('commentEditRatingLabel');
const commentEditCancelBtn = document.getElementById('commentEditCancelBtn');
const confirmDialog = document.getElementById('confirmDialog');
const confirmDialogMessage = document.getElementById('confirmDialogMessage');
const confirmDialogOk = document.getElementById('confirmDialogOk');
const confirmDialogCancel = document.getElementById('confirmDialogCancel');
const deleteConfirmDialog = document.getElementById('deleteConfirmDialog');
const deleteConfirmTitle = document.getElementById('deleteConfirmTitle');
const deleteConfirmMessage = document.getElementById('deleteConfirmMessage');
const deleteConfirmDetails = document.getElementById('deleteConfirmDetails');
const deleteConfirmCancelBtn = document.getElementById('deleteConfirmCancelBtn');
const deleteConfirmMetadataBtn = document.getElementById('deleteConfirmMetadataBtn');
const deleteConfirmProceedBtn = document.getElementById('deleteConfirmProceedBtn');

const initialAudio = readAudioPreferences(localStorage);
const savedSort = localStorage.getItem('librarySort');
const savedTheaterMode = localStorage.getItem('theaterMode');


const state = {
  settings: null,
  route: { name: 'library' },
  filters: {
    q: '',
    qualityMin: '',
    sort: savedSort || 'random',
    tag: '',
    starring: ''
  },
  page: 1,
  dbFilters: {
    q: '',
    page: 1
  },
  dbSummary: null,
  playerPrefs: {
    ...initialAudio,
    theaterOn: savedTheaterMode === null ? true : savedTheaterMode === '1'
  },
  pendingScanRoot: '',
  layout: {
    libraryColumns: null,
    libraryPageSize: null,
    relatedLimit: null
  },
  libraryRandomSeed: Date.now(),
  pendingVideoPlayback: null,
  libraryScanCheckInProgress: false,
  libraryScanInProgress: false,
  libraryScanScannedCount: null,
  libraryScanTotalCount: null
};

const noteEditState = {
  noteId: null,
  videoId: null,
  getCurrentTime: null
};

const commentEditState = {
  commentId: null,
  videoId: null
};

const deleteConfirmState = {
  resolve: null
};

const activeVideoView = {
  videoId: null,
  refreshNotes: null
};

let currentRenderToken = 0;
let cleanups = [];
let libraryScanStatusTimer = null;
let libraryScanStatusRequest = null;

const LIBRARY_SCAN_STATUS_POLL_MS = 900;
const LIBRARY_SCAN_STATUS_IDLE_POLL_MS = 4000;
const DB_SUMMARY_TTL_MS = 30000;

const ICON_VOLUME_ON =
  '<svg class="player-icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true" focusable="false"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
const ICON_VOLUME_OFF =
  '<svg class="player-icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true" focusable="false"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>';

function cleanupActiveView() {
  for (const fn of cleanups) {
    try {
      fn();
    } catch {
      // ignore cleanup failure
    }
  }
  cleanups = [];
}

function savePlayerPrefs() {
  localStorage.setItem('theaterMode', state.playerPrefs.theaterOn ? '1' : '0');
}

function addCleanup(fn) {
  cleanups.push(fn);
}

function resetNoteEditState() {
  noteEditState.noteId = null;
  noteEditState.videoId = null;
  noteEditState.getCurrentTime = null;
  noteEditForm.reset();
}

function closeNoteEditDialog() {
  if (noteEditDialog.open) {
    noteEditDialog.close();
    return;
  }

  resetNoteEditState();
}

function openNoteEditDialog({ note, videoId, getCurrentTime }) {
  noteEditState.noteId = note.id;
  noteEditState.videoId = videoId;
  noteEditState.getCurrentTime = getCurrentTime;
  noteEditTimestampInput.value = formatMarkerTimeValue(note.timestampSec ?? 0);
  noteEditMemoInput.value = note.memo || '';

  if (!noteEditDialog.open) {
    noteEditDialog.showModal();
  }

  noteEditMemoInput.focus();
  noteEditMemoInput.setSelectionRange(noteEditMemoInput.value.length, noteEditMemoInput.value.length);
}

function resetCommentEditState() {
  commentEditState.commentId = null;
  commentEditState.videoId = null;
  commentEditForm.reset();
  syncRatingEditor(commentEditRatingEditor, null);
}

function closeCommentEditDialog() {
  if (commentEditDialog.open) {
    commentEditDialog.close();
    return;
  }

  resetCommentEditState();
}

function openCommentEditDialog({ comment, videoId }) {
  commentEditState.commentId = comment.id;
  commentEditState.videoId = videoId;
  commentEditContentInput.value = comment.content || '';
  syncRatingEditor(commentEditRatingEditor, getCommentRatingValue(comment));

  if (!commentEditDialog.open) {
    commentEditDialog.showModal();
  }

  commentEditContentInput.focus();
  commentEditContentInput.setSelectionRange(commentEditContentInput.value.length, commentEditContentInput.value.length);
}

function settleDeleteConfirm(result) {
  const resolve = deleteConfirmState.resolve;
  deleteConfirmState.resolve = null;

  if (deleteConfirmDialog.open) {
    deleteConfirmDialog.close();
  }

  if (typeof resolve === 'function') {
    resolve(result);
  }
}

function confirmVideoDeletion({ videoId, displayTitle, fileName }) {
  if (typeof deleteConfirmState.resolve === 'function') {
    deleteConfirmState.resolve(false);
    deleteConfirmState.resolve = null;
  }

  deleteConfirmTitle.textContent = 'Delete Video?';
  deleteConfirmMessage.textContent =
    'Delete Video removes the original file and all CornField metadata. Delete Metadata Only keeps the original file, removes all CornField data for this video, and Scan Library will import it again as a new video later.';
  deleteConfirmDetails.innerHTML = `
    <div><strong>ID:</strong> ${escapeHtml(videoId)}</div>
    <div><strong>Display Title:</strong> ${escapeHtml(displayTitle || '-')}</div>
    <div><strong>File Name:</strong> ${escapeHtml(fileName || '-')}</div>
  `;

  if (!deleteConfirmDialog.open) {
    deleteConfirmDialog.showModal();
  }

  return new Promise((resolve) => {
    deleteConfirmState.resolve = resolve;
  });
}

function setHash(hash) {
  if (window.location.hash === hash) {
    renderRoute();
    return;
  }
  window.location.hash = hash;
}

function parseHash() {
  const hash = window.location.hash.replace(/^#/, '');
  const parts = hash.split('/').filter(Boolean);

  if (parts[0] === 'video' && parts[1]) {
    return { name: 'video', id: Number(parts[1]) };
  }

  if (parts[0] === 'tag' && parts[1]) {
    return { name: 'tag', value: decodeURIComponent(parts.slice(1).join('/')) };
  }

  if (parts[0] === 'starring' && parts[1]) {
    return { name: 'starring', value: decodeURIComponent(parts.slice(1).join('/')) };
  }

  if (parts[0] === 'starrings') {
    return { name: 'starrings' };
  }

  if (parts[0] === 'tags') {
    return { name: 'tags' };
  }

  if (parts[0] === 'database') {
    return { name: 'database' };
  }

  return { name: 'library' };
}

async function api(path, options = {}) {
  const headers = {
    ...(options.headers || {})
  };

  const hasExplicitBody = Object.prototype.hasOwnProperty.call(options, 'body');
  const body = options.body;
  const isFormDataBody = typeof FormData !== 'undefined' && body instanceof FormData;
  const hasContentTypeHeader = Object.keys(headers).some((key) => key.toLowerCase() === 'content-type');

  if (hasExplicitBody && body !== undefined && body !== null && !isFormDataBody && !hasContentTypeHeader) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(path, {
    headers,
    ...options
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof payload === 'string' ? payload : payload.error || 'Request failed';
    throw new Error(message);
  }

  return payload;
}

async function loadMetadataSuggestionNames(path) {
  try {
    const data = await api(path);
    return (data.items || []).map((item) => item.name).filter(Boolean);
  } catch (error) {
    console.warn(`Could not load metadata suggestions from ${path}`, error);
    return [];
  }
}

function getCommaSegments(value) {
  const segments = [];
  let start = 0;
  for (let i = 0; i <= value.length; i += 1) {
    if (i === value.length || value[i] === ',') {
      segments.push({ text: value.slice(start, i), start, end: i });
      start = i + 1;
    }
  }
  return segments;
}

function getActiveSegmentIndex(value, caret) {
  const segments = getCommaSegments(value);
  const pos = Math.max(0, Math.min(Number(caret) || 0, value.length));
  for (let i = 0; i < segments.length; i += 1) {
    if (pos >= segments[i].start && pos <= segments[i].end) {
      return i;
    }
  }
  return segments.length - 1;
}

function getActiveCommaQuery(value, caret = value.length) {
  const segments = getCommaSegments(value);
  const index = getActiveSegmentIndex(value, caret);
  return segments[index]?.text.trim() || '';
}

function applyCommaSuggestion(value, suggestion, caret = value.length) {
  const segments = getCommaSegments(value);
  const activeIndex = getActiveSegmentIndex(value, caret);
  const isLast = activeIndex === segments.length - 1;
  const names = segments.map((segment) => segment.text.replace(/\s+/g, ' ').trim());
  names[activeIndex] = suggestion;

  const seen = new Set();
  const kept = [];
  let activeKeptIndex = 0;
  names.forEach((name, index) => {
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) {
      if (index === activeIndex) {
        activeKeptIndex = kept.findIndex((entry) => entry.toLowerCase() === key);
      }
      return;
    }
    seen.add(key);
    kept.push(name);
    if (index === activeIndex) {
      activeKeptIndex = kept.length - 1;
    }
  });

  if (kept.length === 0) {
    return { value: '', caret: 0 };
  }

  // Completing the last word keeps the old behaviour: append ", " so the user can
  // keep typing the next entry. Editing an earlier word replaces it in place and
  // drops the caret right after it.
  if (isLast) {
    const nextValue = `${kept.join(', ')}, `;
    return { value: nextValue, caret: nextValue.length };
  }

  const nextValue = kept.join(', ');
  const caretPos = kept.slice(0, activeKeptIndex + 1).join(', ').length;
  return { value: nextValue, caret: caretPos };
}

function attachCommaAutocomplete(input, suggestions) {
  if (!input || !suggestions.length) return;

  const wrapper = input.closest('.metadata-autocomplete');
  if (!wrapper) return;

  const menu = document.createElement('div');
  menu.className = 'metadata-autocomplete-menu';
  menu.hidden = true;
  wrapper.appendChild(menu);

  let matches = [];
  let activeIndex = 0;

  const getCaret = () => input.selectionStart ?? input.value.length;

  const getCompletedKeys = (caret) => {
    const activeIndex = getActiveSegmentIndex(input.value, caret);
    return new Set(
      getCommaSegments(input.value)
        .map((segment) => segment.text.replace(/\s+/g, ' ').trim().toLowerCase())
        .filter((name, index) => Boolean(name) && index !== activeIndex)
    );
  };

  const updateMatches = () => {
    const caret = getCaret();
    const query = getActiveCommaQuery(input.value, caret).toLowerCase();
    const selectedKeys = getCompletedKeys(caret);

    if (!query) {
      matches = [];
      return;
    }

    matches = suggestions
      .filter((name) => !selectedKeys.has(name.toLowerCase()))
      .map((name) => ({
        name,
        startsWith: name.toLowerCase().startsWith(query),
        includes: name.toLowerCase().includes(query)
      }))
      .filter((item) => item.startsWith || item.includes)
      .sort((a, b) => {
        if (a.startsWith !== b.startsWith) return a.startsWith ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      })
      .slice(0, 8)
      .map((item) => item.name);
  };

  const selectSuggestion = (suggestion) => {
    const result = applyCommaSuggestion(input.value, suggestion, getCaret());
    input.value = result.value;
    input.focus();
    input.setSelectionRange(result.caret, result.caret);
    hideMenu();
  };

  const renderMenu = () => {
    updateMatches();
    activeIndex = Math.min(activeIndex, Math.max(matches.length - 1, 0));

    if (!matches.length) {
      hideMenu();
      return;
    }

    menu.innerHTML = matches
      .map(
        (name, index) =>
          `<button type="button" class="metadata-autocomplete-option ${
            index === activeIndex ? 'is-active' : ''
          }" data-index="${index}">${escapeHtml(name)}</button>`
      )
      .join('');
    menu.hidden = false;
  };

  function hideMenu() {
    menu.hidden = true;
    menu.innerHTML = '';
  }

  const refreshMenu = () => {
    activeIndex = 0;
    renderMenu();
  };

  input.addEventListener('input', refreshMenu);
  input.addEventListener('focus', refreshMenu);
  input.addEventListener('click', refreshMenu);

  // Moving the caret into a different word should re-base suggestions on that word.
  input.addEventListener('keyup', (event) => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      refreshMenu();
    }
  });

  input.addEventListener('blur', () => {
    window.setTimeout(hideMenu, 120);
  });

  input.addEventListener('keydown', (event) => {
    if (menu.hidden || matches.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      activeIndex = (activeIndex + 1) % matches.length;
      renderMenu();
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex = (activeIndex - 1 + matches.length) % matches.length;
      renderMenu();
      return;
    }

    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      selectSuggestion(matches[activeIndex] || matches[0]);
      return;
    }

    if (event.key === 'Escape') {
      hideMenu();
    }
  });

  menu.addEventListener('mousedown', (event) => {
    event.preventDefault();
  });

  menu.addEventListener('click', (event) => {
    const option = event.target.closest('[data-index]');
    if (!option) return;

    const suggestion = matches[Number(option.getAttribute('data-index'))];
    if (suggestion) {
      selectSuggestion(suggestion);
    }
  });
}

function normalizeScanCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.floor(parsed);
}

function getLibraryScanMessage() {
  const totalCount = normalizeScanCount(state.libraryScanTotalCount);
  const scannedCount = normalizeScanCount(state.libraryScanScannedCount);

  if (totalCount !== null) {
    return `Scanning library... ${Math.min(scannedCount ?? 0, totalCount)} / ${totalCount}`;
  }

  return 'Scanning library...';
}

function syncLibraryScanControls() {
  const isScanning = state.libraryScanInProgress;
  const isChecking = state.libraryScanCheckInProgress;

  scanNowBtn.disabled = isScanning || isChecking;
  scanNowBtn.textContent = isScanning ? 'Scanning...' : isChecking ? 'Checking...' : 'Scan Library';
  scanProceedBtn.disabled = isScanning;
  scanCancelBtn.disabled = isScanning;
}

function applyLibraryScanStatus(status = {}) {
  state.libraryScanInProgress = Boolean(status?.inProgress);
  state.libraryScanScannedCount = normalizeScanCount(status?.scannedCount);
  state.libraryScanTotalCount = normalizeScanCount(status?.totalCount);
  syncLibraryScanControls();
  syncLibraryScanningIndicator();
}

async function refreshLibraryScanStatus({ silent = false } = {}) {
  if (libraryScanStatusRequest) {
    return libraryScanStatusRequest;
  }

  libraryScanStatusRequest = (async () => {
    try {
      const status = await api('/api/library/scan/status');
      applyLibraryScanStatus(status);
      return status;
    } catch (error) {
      if (!silent) {
        throw error;
      }
      return null;
    } finally {
      libraryScanStatusRequest = null;
    }
  })();

  return libraryScanStatusRequest;
}

function stopLibraryScanStatusPolling() {
  if (!libraryScanStatusTimer) {
    return;
  }

  clearTimeout(libraryScanStatusTimer);
  libraryScanStatusTimer = null;
}

function shouldMonitorLibraryScanStatus() {
  return state.libraryScanInProgress || ['library', 'tag', 'starring'].includes(state.route?.name);
}

function scheduleLibraryScanStatusPolling(delayMs = null) {
  stopLibraryScanStatusPolling();

  if (!shouldMonitorLibraryScanStatus()) {
    return;
  }

  const nextDelay = delayMs ?? (state.libraryScanInProgress ? LIBRARY_SCAN_STATUS_POLL_MS : LIBRARY_SCAN_STATUS_IDLE_POLL_MS);
  libraryScanStatusTimer = setTimeout(async () => {
    const wasInProgress = state.libraryScanInProgress;

    try {
      await refreshLibraryScanStatus({ silent: true });
    } finally {
      const scanJustFinished = wasInProgress && !state.libraryScanInProgress;

      if (shouldMonitorLibraryScanStatus()) {
        scheduleLibraryScanStatusPolling();
      }

      if (scanJustFinished && ['library', 'tag', 'starring'].includes(state.route?.name)) {
        renderRoute();
      }
    }
  }, nextDelay);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDateTime(iso) {
  if (!iso) return '-';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleString();
}

function formatDate(iso) {
  if (!iso) return '-';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleDateString();
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '--:--';

  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';
  return Math.round(num).toLocaleString();
}

function formatBytes(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unitIndex = 0;
  let value = size;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function formatCollectionDuration(seconds) {
  const safeSeconds = Number(seconds);
  if (!Number.isFinite(safeSeconds) || safeSeconds <= 0) return '0m';

  const totalMinutes = Math.max(1, Math.round(safeSeconds / 60));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `${formatNumber(days)}d ${hours}h`;
  }

  if (totalMinutes >= 60) {
    return `${formatNumber(Math.floor(totalMinutes / 60))}h ${minutes}m`;
  }

  return `${totalMinutes}m`;
}

function formatPercent(part, total) {
  const numerator = Number(part);
  const denominator = Number(total);

  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return '0%';
  }

  return `${Math.round((numerator / denominator) * 100)}%`;
}

function formatMarkerTimeValue(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';

  const rounded = Math.round(seconds * 10) / 10;
  let wholeSeconds = Math.floor(rounded);
  let fractionalTenths = Math.round((rounded - wholeSeconds) * 10);

  if (fractionalTenths === 10) {
    wholeSeconds += 1;
    fractionalTenths = 0;
  }

  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const secs = wholeSeconds % 60;

  const base = hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  return fractionalTenths > 0 ? `${base}.${fractionalTenths}` : base;
}

function parseMarkerTimeValue(rawValue, { fallback = null } = {}) {
  const value = String(rawValue ?? '').trim();
  if (!value) return fallback;

  if (/^\d+(\.\d+)?$/.test(value)) {
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
  }

  const parts = value.split(':').map((part) => part.trim());
  if (parts.length < 2 || parts.length > 3) {
    return null;
  }

  if (parts.some((part) => !/^\d+(\.\d+)?$/.test(part))) {
    return null;
  }

  const secondsPart = Number(parts.at(-1));
  const minutesPart = Number(parts.at(-2));
  const hoursPart = parts.length === 3 ? Number(parts[0]) : 0;

  if (![secondsPart, minutesPart, hoursPart].every((part) => Number.isFinite(part) && part >= 0)) {
    return null;
  }

  if (secondsPart >= 60 || (parts.length === 3 && minutesPart >= 60)) {
    return null;
  }

  return hoursPart * 3600 + minutesPart * 60 + secondsPart;
}

function normalizeMarkerLabel(value) {
  const label = String(value ?? '').trim();
  return label || 'Corn';
}

function bindMarkerTimeInput(input, getFallbackSeconds) {
  if (!input) return;

  input.addEventListener('keydown', (event) => {
    if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();

    const fallbackSeconds = Number(getFallbackSeconds?.() ?? 0);
    const currentSeconds = parseMarkerTimeValue(input.value, { fallback: fallbackSeconds });
    if (!Number.isFinite(currentSeconds) || currentSeconds < 0) {
      showToast('Enter a valid time.', true);
      return;
    }

    const delta = event.key === 'ArrowUp' ? 1 : -1;
    const nextSeconds = Math.max(0, Math.round(currentSeconds) + delta);
    input.value = formatMarkerTimeValue(nextSeconds);
  });

  input.addEventListener('blur', () => {
    if (!input.value.trim()) return;
    const parsed = parseMarkerTimeValue(input.value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      input.value = formatMarkerTimeValue(parsed);
    }
  });
}

function getAddedDate(video) {
  return video.createdAt;
}

function showConfirm(message, { okLabel = 'Delete' } = {}) {
  return new Promise((resolve) => {
    confirmDialogMessage.textContent = message;
    confirmDialogOk.textContent = okLabel;
    const cleanup = () => {
      confirmDialogOk.removeEventListener('click', onOk);
      confirmDialogCancel.removeEventListener('click', onCancel);
      confirmDialog.removeEventListener('close', onClose);
      confirmDialog.close();
    };
    const onOk = () => { cleanup(); resolve(true); };
    const onCancel = () => { cleanup(); resolve(false); };
    const onClose = () => { cleanup(); resolve(false); };
    confirmDialogOk.addEventListener('click', onOk);
    confirmDialogCancel.addEventListener('click', onCancel);
    confirmDialog.addEventListener('close', onClose);
    confirmDialog.showModal();
  });
}

function showToast(message, isError = false) {
  const toast = document.createElement('div');
  toast.className = isError ? 'warning error' : 'warning';
  toast.textContent = message;
  toast.style.position = 'fixed';
  toast.style.right = '14px';
  toast.style.bottom = '14px';
  toast.style.zIndex = '3000';
  toast.style.maxWidth = '420px';
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 2300);
}

function invalidateDatabaseSummary() {
  state.dbSummary = null;
}

async function getDatabaseSummary({ force = false } = {}) {
  const now = Date.now();
  if (!force && state.dbSummary && now - state.dbSummary.loadedAt < DB_SUMMARY_TTL_MS) {
    return state.dbSummary.data;
  }

  try {
    const data = await api('/api/database/summary');
    state.dbSummary = {
      data,
      loadedAt: Date.now()
    };
    return data;
  } catch {
    state.dbSummary = null;
    return null;
  }
}

function syncLibraryScanningIndicator() {
  if (!['library', 'tag', 'starring'].includes(state.route?.name)) {
    return;
  }

  const libraryStatus = document.getElementById('libraryStatus');
  const videoGrid = document.getElementById('videoGrid');
  if (!libraryStatus || !videoGrid) {
    return;
  }

  const baseStatus = libraryStatus.dataset.baseStatus || libraryStatus.textContent || '';
  const scanMessage = getLibraryScanMessage();
  libraryStatus.textContent = state.libraryScanInProgress ? `${baseStatus} | ${scanMessage}` : baseStatus;

  if (!state.libraryScanInProgress) {
    return;
  }

  if (!videoGrid.querySelector('.video-card') && !videoGrid.querySelector('.warning.error')) {
    const warningEl = videoGrid.querySelector('.warning');
    if (warningEl) {
      warningEl.textContent = scanMessage;
      return;
    }

    videoGrid.innerHTML = `<div class="warning">${escapeHtml(scanMessage)}</div>`;
  }
}

async function loadSettings() {
  state.settings = await api('/api/settings');
}

function updateSettingsDialogInputs() {
  libraryRootInput.value = state.settings?.libraryRoot || '';
  browseLibraryRootBtn.hidden = state.settings?.folderPickerAvailable === false;
  skipSecondsInput.value = String(state.settings?.skipSeconds || 10);
  libraryRowsInput.value = String(state.settings?.libraryRows || 3);
  const controlsHideValue = String(state.settings?.controlsHideMs ?? 2500);
  controlsHideMsInput.value = controlsHideMsInput.querySelector(`option[value="${controlsHideValue}"]`) ? controlsHideValue : '2500';
  hideScanPreview();
}

function buildSettingsPayload() {
  return {
    libraryRoot: libraryRootInput.value.trim(),
    skipSeconds: Number(skipSecondsInput.value),
    libraryRows: Number(libraryRowsInput.value),
    controlsHideMs: Number(controlsHideMsInput.value)
  };
}

function settingsPayloadMatchesState(payload) {
  if (!state.settings) return false;

  return (
    payload.libraryRoot === String(state.settings.libraryRoot || '') &&
    payload.skipSeconds === Number(state.settings.skipSeconds || 10) &&
    payload.libraryRows === Number(state.settings.libraryRows || 3) &&
    payload.controlsHideMs === Number(state.settings.controlsHideMs ?? 2500)
  );
}

async function persistSettingsFromDialog() {
  const payload = buildSettingsPayload();

  if (!payload.libraryRoot) {
    throw new Error('Please enter Library Folder Path.');
  }

  if (settingsPayloadMatchesState(payload)) {
    return false;
  }

  const result = await api('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(payload)
  });

  state.settings = result.settings;
  hideScanPreview();
  return true;
}

async function autosaveSettingsAndRefresh() {
  const changed = await persistSettingsFromDialog();
  if (!changed) return;

  if (state.route?.name === 'video') {
    rerenderPreservingPlayback();
    return;
  }

  renderRoute();
}

async function browseForLibraryRoot() {
  const previousLabel = browseLibraryRootBtn.textContent;
  browseLibraryRootBtn.disabled = true;
  browseLibraryRootBtn.textContent = 'Opening...';

  try {
    const result = await api('/api/system/select-folder', {
      method: 'POST',
      body: JSON.stringify({
        initialPath: libraryRootInput.value.trim()
      })
    });

    if (result?.cancelled) {
      return;
    }

    if (result?.path) {
      libraryRootInput.value = result.path;
      await autosaveSettingsAndRefresh();
    }
  } catch (error) {
    showToast(error.message, true);
    updateSettingsDialogInputs();
  } finally {
    browseLibraryRootBtn.disabled = false;
    browseLibraryRootBtn.textContent = previousLabel;
  }
}

function hideScanPreview() {
  state.pendingScanRoot = '';
  scanPreviewText.textContent = '';
  scanPreviewBox.hidden = true;
  scanStatusText.textContent = '';
  scanStatusText.hidden = true;
}

function showScanPreview(addedCount, missingCount, missingThumbnailCount, rootPath) {
  scanStatusText.hidden = true;
  state.pendingScanRoot = rootPath;
  const parts = [
    `Est. ${addedCount} videos added`,
    `Est. ${missingCount} videos marked missing`
  ];

  if (missingThumbnailCount > 0) {
    parts.push(`${missingThumbnailCount} thumbnails to generate`);
  }

  scanPreviewText.textContent = parts.join(' / ');
  scanPreviewBox.hidden = false;
}

function buildVideoHash(videoId) {
  return `#/video/${videoId}`;
}

function getFileNameExtension(fileName) {
  const value = String(fileName || '');
  const dotIndex = value.lastIndexOf('.');
  if (dotIndex <= 0) return '';
  return value.slice(dotIndex);
}

function getFileNameBaseName(fileName) {
  const value = String(fileName || '');
  const ext = getFileNameExtension(value);
  return ext ? value.slice(0, -ext.length) : value;
}

function snapRatingHalf(value) {
  const rating = Number(value);
  if (!Number.isFinite(rating)) return null;
  return Math.round(Math.max(0, Math.min(5, rating)) * 2) / 2;
}

function normalizeOptionalRating(value) {
  if (value === null || value === undefined || value === '') return null;
  return snapRatingHalf(value);
}

function clampRating(value) {
  const rating = normalizeOptionalRating(value);
  return rating === null ? 0 : rating;
}

function formatAverageRating(value) {
  const rating = Number(value);
  if (!Number.isFinite(rating)) return null;
  return (Math.round(rating * 10) / 10).toFixed(1);
}

function formatRatingLabelNumber(rating) {
  return Number.isInteger(rating) ? String(rating) : String(rating);
}

function formatSelectedRating(value) {
  const rating = normalizeOptionalRating(value);
  return rating === null ? 'No rating' : `${formatRatingLabelNumber(rating)}/5`;
}

function ratingFromPointer(clientX, trackEl) {
  const rect = trackEl.getBoundingClientRect();
  if (rect.width <= 0) return 0.5;
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const raw = ratio * 5;
  const snapped = Math.max(0.5, Math.round(raw * 2) / 2);
  return Math.min(5, snapped);
}

function createStarsFillHtml(rating, extraClass = '') {
  const safe = clampRating(rating);
  const pct = (safe / 5) * 100;
  const className = ['rating-stars-fill', extraClass].filter(Boolean).join(' ');
  return `
    <span class="${className}" style="--rating-fill: ${pct}%;" aria-label="${formatRatingLabelNumber(safe)} of 5 stars" role="img">
      <span class="rating-stars-base" aria-hidden="true">★★★★★</span>
      <span class="rating-stars-painted" aria-hidden="true">★★★★★</span>
    </span>
  `;
}

function updateRangeVisual(inputEl, ratio) {
  if (!inputEl) return;
  const safeRatio = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  inputEl.style.setProperty('--range-percent', `${safeRatio * 100}%`);
}

function refreshLibraryRandomSeed() {
  state.libraryRandomSeed = Date.now();
}

function capturePlaybackForNextRender() {
  if (state.route?.name !== 'video' || !Number.isInteger(state.route.id)) {
    state.pendingVideoPlayback = null;
    return;
  }

  const videoEl = document.getElementById('videoEl');
  if (!videoEl) {
    state.pendingVideoPlayback = null;
    return;
  }

  state.pendingVideoPlayback = {
    videoId: state.route.id,
    currentTime: Number.isFinite(videoEl.currentTime) ? videoEl.currentTime : 0,
    wasPaused: videoEl.paused
  };
}

function rerenderPreservingPlayback() {
  capturePlaybackForNextRender();
  renderRoute();
}

function getCommentRatingValue(comment) {
  return comment?.ratedAt ? clampRating(comment.rating) : null;
}

function getCommentDisplayDateTime(comment) {
  return formatDateTime(comment?.ratedAt || comment?.createdAt);
}

function createRatingButtonsHtml(rating, buttonAttrs = '') {
  const safeRating = normalizeOptionalRating(rating);
  const fillHtml = createStarsFillHtml(safeRating === null ? 0 : safeRating, 'rating-stars-track');
  return `
    <button type="button" class="rating-clear${safeRating === null ? ' is-active' : ''}" ${buttonAttrs} data-rating-value="" aria-label="Leave unrated">No rating</button>
    <button type="button" class="rating-clear${safeRating === 0 ? ' is-active' : ''}" ${buttonAttrs} data-rating-value="0" aria-label="Set 0 star rating">0</button>
    <div class="rating-stars rating-stars-interactive" ${buttonAttrs} data-rating-track="1" role="slider" aria-valuemin="0.5" aria-valuemax="5" aria-valuenow="${safeRating ?? ''}" tabindex="0">${fillHtml}</div>
  `;
}

function setStarsFill(containerOrTrack, rating) {
  const track = containerOrTrack?.matches?.('[data-rating-track]')
    ? containerOrTrack
    : containerOrTrack?.querySelector?.('[data-rating-track]');
  const fill = track?.querySelector?.('.rating-stars-fill') || containerOrTrack?.querySelector?.('.rating-stars-fill');
  if (!fill) return;
  const safe = rating === null || rating === undefined || rating === '' ? 0 : clampRating(rating);
  fill.style.setProperty('--rating-fill', `${(safe / 5) * 100}%`);
}

function syncRatingEditor(container, rating) {
  if (!container) return;

  const safeRating = normalizeOptionalRating(rating);
  container.dataset.rating = safeRating === null ? '' : String(safeRating);

  container.querySelectorAll('.rating-clear[data-rating-value]').forEach((button) => {
    const rawValue = button.getAttribute('data-rating-value');
    const isActive = rawValue === '' ? safeRating === null : safeRating === 0 && rawValue === '0';
    button.classList.toggle('is-active', isActive);
  });

  setStarsFill(container, safeRating === null ? 0 : safeRating);
  const track = container.querySelector('[data-rating-track]');
  if (track) {
    if (safeRating === null) {
      track.removeAttribute('aria-valuenow');
    } else {
      track.setAttribute('aria-valuenow', String(safeRating));
    }
  }

  const label = container.querySelector('[data-rating-label]');
  if (label) {
    label.textContent = formatSelectedRating(safeRating);
  }

  const hiddenInput = container.querySelector('[data-rating-input]');
  if (hiddenInput) {
    hiddenInput.value = safeRating === null ? '' : String(safeRating);
  }
}

function bindRatingEditorControls(container, buttonSelector) {
  if (!container || container.dataset.ratingBound === '1') return;
  container.dataset.ratingBound = '1';

  container.querySelectorAll(buttonSelector).forEach((button) => {
    if (!button.matches('.rating-clear')) return;
    button.addEventListener('click', (event) => {
      const nextRating = normalizeOptionalRating(event.currentTarget.getAttribute('data-rating-value'));
      syncRatingEditor(container, nextRating);
    });
  });

  const track = container.querySelector('[data-rating-track]');
  if (!track) return;

  const previewFromEvent = (event) => {
    const next = ratingFromPointer(event.clientX, track);
    setStarsFill(track, next);
    const label = container.querySelector('[data-rating-label]');
    if (label) label.textContent = formatSelectedRating(next);
  };

  track.addEventListener('mousemove', previewFromEvent);
  track.addEventListener('mouseleave', () => {
    const committed = normalizeOptionalRating(container.dataset.rating);
    syncRatingEditor(container, committed);
  });
  track.addEventListener('click', (event) => {
    const next = ratingFromPointer(event.clientX, track);
    syncRatingEditor(container, next);
  });
}

function createCommentRatingDisplayHtml(comment) {
  const rating = getCommentRatingValue(comment);
  if (rating === null) {
    return '';
  }

  return `
    <div class="comment-rating-display">
      ${createStarsFillHtml(rating, 'rating-stars-static')}
      <span class="rating-label">${formatRatingLabelNumber(rating)}/5</span>
    </div>
  `;
}

function createCommentBodyHtml(comment) {
  const hasContent = Boolean(comment?.content);
  const ratingHtml = createCommentRatingDisplayHtml(comment);
  const dateHtml = `
    <div class="comment-meta">
      <span class="muted">${escapeHtml(getCommentDisplayDateTime(comment))}</span>
    </div>
  `;

  if (ratingHtml && hasContent) {
    return `
      <div class="comment-stack">
        ${ratingHtml}
        <div>${escapeHtml(comment.content)}</div>
        ${dateHtml}
      </div>
    `;
  }

  if (ratingHtml) {
    return `
      <div class="comment-stack">
        ${ratingHtml}
        ${dateHtml}
      </div>
    `;
  }

  if (hasContent) {
    return `
      <div class="comment-stack">
        <div>${escapeHtml(comment.content)}</div>
        ${dateHtml}
      </div>
    `;
  }

  return dateHtml;
}

function createNotesListHtml(notes) {
  return (notes || [])
    .map(
      (note) => `
        <div class="note-item" data-note-id="${note.id}">
          <div><strong>${formatDuration(note.timestampSec)}</strong> - ${escapeHtml(note.memo)}</div>
          <div class="row-actions">
            <button data-note-jump="${note.id}">Jump</button>
            <button data-note-edit="${note.id}">Edit</button>
            <button data-note-delete="${note.id}">Delete</button>
          </div>
        </div>
      `
    )
    .join('') || '<div class="muted">No jump markers yet.</div>';
}

function getCardRatingRowHtml(video, options = {}) {
  const ratingCount = Number(video.ratingCount || 0);
  if (!ratingCount && options.hideWhenEmpty) {
    return '';
  }

  if (!ratingCount) {
    return `
      <div class="meta-row rating-row">
        <span class="muted">No ratings yet</span>
      </div>
    `;
  }

  return `
    <div class="meta-row rating-row">
      <span class="rating-summary">&#9733; ${formatAverageRating(video.averageRating)}</span>
      <span>${ratingCount} rating${ratingCount === 1 ? '' : 's'}</span>
    </div>
  `;
}

function attachVideoCardLink(card, video, source) {
  const link = card.querySelector('[data-video-card-link]');
  if (!link) return;

  link.addEventListener('click', (event) => {
    if (event.defaultPrevented) return;

    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      if (source === 'library' || source === 'related') {
        api(`/api/videos/${video.id}/view`, { method: 'POST' }).catch(() => {});
      }
      return;
    }

    event.preventDefault();
    openVideoFromSource(video.id, source);
  });

  link.addEventListener('auxclick', (event) => {
    if (event.button !== 1) return;
    if (source === 'library' || source === 'related') {
      api(`/api/videos/${video.id}/view`, { method: 'POST' }).catch(() => {});
    }
  });
}

function openVideoFromSource(videoId, source) {
  if (!Number.isInteger(videoId) || videoId <= 0) return;
  const shouldIncrementView = source === 'library' || source === 'related';

  if (shouldIncrementView) {
    api(`/api/videos/${videoId}/view`, { method: 'POST' }).catch(() => {
      // ignore view increment failure on navigation click
    });
  }

  setHash(buildVideoHash(videoId));
}

function renderNoLibraryConfigured() {
  mainEl.innerHTML = `
    <div class="warning">
      Library folder is not configured. Open Settings (⚙), set <strong>Library Folder Path</strong>, then run
      <strong>Scan Library</strong>.
    </div>
  `;
}

function createVideoCard(video) {
  const card = document.createElement('article');
  card.className = 'video-card clickable-card';

  const thumb = video.thumbnailPath
    ? `<img class="thumb" src="${escapeHtml(video.thumbnailPath)}" alt="thumbnail" loading="lazy" />`
    : '<div class="thumb-placeholder"></div>';

  const tags = (video.tags || [])
    .slice(0, 5)
    .map((tag) => `<button class="chip" data-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</button>`)
    .join('');

  const starrings = (video.starrings || [])
    .slice(0, 3)
    .map((name) => `<button class="chip" data-starring="${escapeHtml(name)}">${escapeHtml(name)}</button>`)
    .join('');

  card.innerHTML = `
    <a class="video-card-link" data-video-card-link href="${escapeHtml(buildVideoHash(video.id))}" aria-label="Open ${escapeHtml(video.displayTitle || video.fileName)}"></a>
    ${thumb}
    <div class="content">
      <h3>${escapeHtml(video.displayTitle || video.fileName)}</h3>
      <div class="meta-row">
        <span>${escapeHtml(video.qualityBucket || 'unknown')}</span>
        <span>${formatDuration(Number(video.duration))}</span>
      </div>
      <div class="meta-row">
        <span>${formatDate(getAddedDate(video))}</span>
        <span>Views ${Number(video.viewCount || 0)}</span>
      </div>
      ${getCardRatingRowHtml(video, { hideWhenEmpty: true })}
      ${video.category ? `<div class="muted">Category: ${escapeHtml(video.category)}</div>` : ''}
      <div class="chips">${tags}</div>
      <div class="chips">${starrings}</div>
    </div>
  `;

  attachVideoCardLink(card, video, 'library');

  card.querySelectorAll('[data-tag]').forEach((el) => {
    el.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const value = event.currentTarget.getAttribute('data-tag');
      setHash(`#/tag/${encodeURIComponent(value)}`);
    });
  });

  card.querySelectorAll('[data-starring]').forEach((el) => {
    el.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const value = event.currentTarget.getAttribute('data-starring');
      setHash(`#/starring/${encodeURIComponent(value)}`);
    });
  });

  return card;
}

function getGridColumnCount(gridEl, minCardWidth) {
  if (!gridEl) return 1;

  const styles = getComputedStyle(gridEl);
  const gap = parseFloat(styles.columnGap || styles.gap || '12') || 12;
  const width = gridEl.clientWidth || gridEl.getBoundingClientRect().width;

  if (!Number.isFinite(width) || width <= 0) {
    return 1;
  }

  return Math.max(1, Math.floor((width + gap) / (minCardWidth + gap)));
}

function getEffectiveLibraryPageSize(videoGrid) {
  const configuredRowsRaw = Number(state.settings?.libraryRows || 3);
  const configuredRows = Number.isInteger(configuredRowsRaw) ? Math.max(1, Math.min(8, configuredRowsRaw)) : 3;
  const columns = getGridColumnCount(videoGrid, 208);
  return Math.max(1, Math.min(100, columns * configuredRows));
}

function getRelatedVideoLimit(gridEl = null) {
  const minCardWidth = 190;
  const fallbackWidth = Math.max(0, (mainEl.clientWidth || window.innerWidth || 0) - 28);
  const columns = gridEl ? getGridColumnCount(gridEl, minCardWidth) : Math.max(1, Math.floor((fallbackWidth + 12) / (minCardWidth + 12)));
  return Math.max(2, Math.min(48, columns * 2));
}

function buildLibraryQuery(options = {}) {
  const q = new URLSearchParams();
  q.set('page', String(state.page));
  q.set('pageSize', String(options.pageSize || 24));

  if (state.filters.q) q.set('q', state.filters.q);
  if (state.filters.qualityMin) q.set('qualityMin', state.filters.qualityMin);
  if (state.filters.sort) q.set('sort', state.filters.sort);
  q.set('randomSeed', String(state.libraryRandomSeed));
  if (state.filters.tag) q.set('tag', state.filters.tag);
  if (state.filters.starring) q.set('starring', state.filters.starring);

  return q.toString();
}

function bindLibraryToolbar(options = {}) {
  const searchInput = document.getElementById('searchInput');
  const qualityFilter = document.getElementById('qualityFilter');
  const sortSelect = document.getElementById('sortSelect');

  if (!searchInput || !qualityFilter || !sortSelect) {
    return null;
  }

  searchInput.value = state.filters.q;
  qualityFilter.value = state.filters.qualityMin;
  sortSelect.value = state.filters.sort;

  const applyFilters = () => {
    state.page = 1;
    const nextSort = sortSelect.value;
    if (nextSort === 'random') {
      refreshLibraryRandomSeed();
    }
    const scopedTag = options.lockTag || state.filters.tag || '';
    const scopedStarring = options.lockStarring || state.filters.starring || '';
    state.filters = {
      q: searchInput.value.trim(),
      qualityMin: qualityFilter.value,
      sort: nextSort,
      tag: scopedTag,
      starring: scopedStarring
    };
    localStorage.setItem('librarySort', nextSort);

    if (options.navigateToLibrary) {
      setHash('#/library');
      return;
    }

    renderRoute();
  };

  searchInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    applyFilters();
  });

  qualityFilter.addEventListener('change', applyFilters);
  sortSelect.addEventListener('change', applyFilters);

  return { searchInput, qualityFilter, sortSelect };
}

async function renderLibraryView(options = {}) {
  const token = currentRenderToken;
  const template = document.getElementById('libraryViewTemplate');
  mainEl.innerHTML = '';
  mainEl.appendChild(template.content.cloneNode(true));

  const tagScroller = document.getElementById('tagScroller');
  const libraryStatus = document.getElementById('libraryStatus');
  const videoGrid = document.getElementById('videoGrid');
  const pager = document.getElementById('pager');

  if (options.lockTag) {
    state.filters.tag = options.lockTag;
    state.filters.starring = '';
  }
  if (options.lockStarring) {
    state.filters.starring = options.lockStarring;
  }

  const bannerParts = [];
  if (state.filters.starring) bannerParts.push({ label: 'Starring', value: state.filters.starring });
  if (bannerParts.length) {
    const banner = document.createElement('div');
    banner.className = 'route-banner';
    banner.innerHTML = bannerParts
      .map(
        (part) =>
          `<span class="route-banner-label">${part.label}:</span> <span class="route-banner-value">${escapeHtml(part.value)}</span>`
      )
      .join('<span class="route-banner-sep">·</span>');
    mainEl.prepend(banner);
  }

  bindLibraryToolbar({
    lockTag: options.lockTag,
    lockStarring: options.lockStarring
  });

  tagScroller.addEventListener(
    'wheel',
    (event) => {
      if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
        event.preventDefault();
        tagScroller.scrollLeft += event.deltaY;
      }
    },
    { passive: false }
  );

  libraryStatus.textContent = 'Loading videos...';

  try {
    const effectivePageSize = getEffectiveLibraryPageSize(videoGrid);
    const queryString = buildLibraryQuery({
      pageSize: effectivePageSize
    });
    const tagsPath = state.filters.starring
      ? `/api/tags?starring=${encodeURIComponent(state.filters.starring)}`
      : '/api/tags';
    const [data, tagsData] = await Promise.all([api(`/api/videos?${queryString}`), api(tagsPath)]);
    if (token !== currentRenderToken) return;

    const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
    state.page = Math.min(data.page, totalPages);
    state.layout.libraryColumns = getGridColumnCount(videoGrid, 208);
    state.layout.libraryPageSize = data.pageSize;

    tagScroller.innerHTML = '';
    const allTagBtn = document.createElement('button');
    allTagBtn.className = `tag-filter-btn ${!state.filters.tag ? 'is-active' : ''}`;
    allTagBtn.textContent = 'All Tags';
    allTagBtn.addEventListener('click', () => {
      state.page = 1;
      state.filters.tag = '';
      renderRoute();
    });
    tagScroller.appendChild(allTagBtn);

    (tagsData.items || []).forEach((tagItem) => {
      const btn = document.createElement('button');
      btn.className = `tag-filter-btn ${state.filters.tag === tagItem.name ? 'is-active' : ''}`;
      btn.textContent = `${tagItem.name} (${tagItem.videoCount})`;
      btn.addEventListener('click', () => {
        state.page = 1;
        state.filters.tag = tagItem.name;
        renderRoute();
      });
      tagScroller.appendChild(btn);
    });

    libraryStatus.dataset.baseStatus = `${data.total} videos | page ${state.page}/${totalPages}`;
    syncLibraryScanningIndicator();

    if (data.items.length === 0) {
      const scanMessage = getLibraryScanMessage();
      videoGrid.innerHTML = state.libraryScanInProgress
        ? `<div class="warning">${escapeHtml(scanMessage)}</div>`
        : '<div class="warning">No videos matched your filters.</div>';
    } else {
      videoGrid.innerHTML = '';
      data.items.forEach((video, index) => {
        const card = createVideoCard(video);
        card.style.setProperty('--stagger', String(index));
        videoGrid.appendChild(card);
      });
    }

    pager.innerHTML = '';
    const prevBtn = document.createElement('button');
    prevBtn.textContent = 'Prev';
    prevBtn.disabled = state.page <= 1;
    prevBtn.addEventListener('click', () => {
      state.page -= 1;
      renderRoute();
    });

    const nextBtn = document.createElement('button');
    nextBtn.textContent = 'Next';
    nextBtn.disabled = state.page >= totalPages;
    nextBtn.addEventListener('click', () => {
      state.page += 1;
      renderRoute();
    });

    const pageLabel = document.createElement('span');
    pageLabel.textContent = `Page ${state.page} / ${totalPages}`;

    pager.append(prevBtn, pageLabel, nextBtn);
  } catch (error) {
    libraryStatus.innerHTML = `<span class="error">${escapeHtml(error.message)}</span>`;
  }
}

function createRelatedCard(video) {
  const wrapper = document.createElement('article');
  wrapper.className = 'video-card clickable-card';
  const ratingSummary = Number(video.ratingCount || 0)
    ? ` · <span class="rating-summary">&#9733; ${formatAverageRating(video.averageRating)} (${Number(video.ratingCount || 0)})</span>`
    : '';

  wrapper.innerHTML = `
    <a class="video-card-link" data-video-card-link href="${escapeHtml(buildVideoHash(video.id))}" aria-label="Open ${escapeHtml(video.displayTitle || video.fileName)}"></a>
    ${
      video.thumbnailPath
        ? `<img class="thumb" src="${escapeHtml(video.thumbnailPath)}" alt="thumbnail" loading="lazy" />`
        : '<div class="thumb-placeholder"></div>'
    }
    <div class="content">
      <h3>${escapeHtml(video.displayTitle || video.fileName)}</h3>
      <div class="muted">${escapeHtml(video.qualityBucket || 'unknown')} · Views ${Number(video.viewCount || 0)}${ratingSummary}</div>
    </div>
  `;
  attachVideoCardLink(wrapper, video, 'related');
  return wrapper;
}

async function renderVideoView(videoId) {
  const token = currentRenderToken;
  mainEl.innerHTML = '<div class="status">Loading video...</div>';

  try {
    const [videoRes, commentsRes, notesRes] = await Promise.all([
      api(`/api/videos/${videoId}`),
      api(`/api/videos/${videoId}/comments`),
      api(`/api/videos/${videoId}/notes`)
    ]);

    if (token !== currentRenderToken) return;

    const video = videoRes.video;
    const comments = commentsRes.items || [];
    let notes = notesRes.items || [];
    const playbackToRestore = state.pendingVideoPlayback?.videoId === videoId ? state.pendingVideoPlayback : null;
    if (playbackToRestore) {
      state.pendingVideoPlayback = null;
    }

    const tagsHtml = (video.tags || [])
      .map((tag) => `<button class="chip" data-video-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</button>`)
      .join('');

    const starringsHtml = (video.starrings || [])
      .map((name) => `<button class="chip" data-video-starring="${escapeHtml(name)}">${escapeHtml(name)}</button>`)
      .join('');

    const videoRatingCount = Number(video.ratingCount || 0);
    const videoRatingText = videoRatingCount
      ? `Rating ${formatAverageRating(video.averageRating)}/5 (${videoRatingCount})`
      : 'No ratings yet';

    const commentsHtml = comments
      .map(
        (comment) => `
        <div class="comment-item" data-comment-id="${comment.id}">
          ${createCommentBodyHtml(comment)}
          <div class="row-actions">
            <button data-comment-edit="${comment.id}">Edit</button>
            <button data-comment-delete="${comment.id}">Delete</button>
          </div>
        </div>
      `
      )
      .join('');

    mainEl.innerHTML = `
      <div class="video-view ${state.playerPrefs.theaterOn ? 'theater-on' : 'theater-off'}" id="videoView">
      <div class="video-content">
        <div class="video-content-main">
      <section class="player-panel video-slot-player">
        <div class="player-shell" id="playerShell">
          <video id="videoEl" src="${escapeHtml(video.mediaUrl)}" preload="metadata"></video>
          <div class="player-controls" id="playerControls">
            <div class="progress-wrap">
              <div id="timelinePreview" class="timeline-preview" aria-hidden="true">
                <img id="timelinePreviewImage" class="timeline-preview-image" alt="" />
              </div>
              <input id="progressRange" class="progress" type="range" min="0" max="1000" value="0" step="1" />
              <div id="noteMarkerLayer" class="note-marker-layer"></div>
            </div>
            <div class="control-row">
              <button id="playPauseBtn">Play</button>
              <button id="fullscreenBtn">Fullscreen</button>
              <button id="theaterBtn" type="button" title="Theater mode (t)">Theater</button>
              <button id="addMarkerBtn">Add Marker</button>
              <button id="muteBtn" type="button" class="icon-btn" aria-label="Mute" title="Mute">${ICON_VOLUME_ON}</button>
              <input id="volumeRange" class="volume-slider" type="range" min="0" max="1" step="0.01" value="1" />
              <span id="timeLabel" class="time-label">00:00 / --:--</span>
            </div>
          </div>
        </div>
        <div class="panel-body">
          <h2 class="section-title">${escapeHtml(video.displayTitle || video.fileName)}</h2>
          <div class="muted">${escapeHtml(video.fileName)}</div>
          <div class="meta-row" style="margin-top: .55rem;">
            <span>${escapeHtml(video.qualityBucket || 'unknown')} (${video.width || 0}x${video.height || 0})</span>
            <span>Views ${video.viewCount || 0}</span>
            <span>Added ${formatDate(getAddedDate(video))}</span>
          </div>
          <div class="meta-row rating-row" style="margin-top: .35rem;">
            <span class="${videoRatingCount ? 'rating-summary' : 'muted'}">${videoRatingText}</span>
          </div>
          <div class="chips" style="margin-top: .6rem;">${tagsHtml}</div>
          <div class="chips" style="margin-top: .35rem;">${starringsHtml}</div>
        </div>
      </section>

      <section class="section-panel video-slot-related">
        <div class="panel-body">
          <h3 class="section-title">Related Videos</h3>
          <div id="relatedGrid" class="video-grid compact-grid" style="margin-top: .75rem;"></div>
        </div>
      </section>
        </div>
        <div class="video-content-side">
      <section class="section-panel video-slot-meta">
        <div class="panel-body">
          <h3 class="section-title">Video Metadata</h3>
          <button id="metaToggleBtn" class="subtle-btn primary" type="button">Edit Video Data</button>

          <div id="metaEditor" class="collapsible">
            <form id="metaForm" class="form-grid meta-editor-form">
              <label>Tags (comma separated)
                <span class="metadata-autocomplete">
                  <input id="metaTags" value="${escapeHtml((video.tags || []).join(', '))}" autocomplete="off" />
                </span>
              </label>
              <label>Starring (comma separated)
                <span class="metadata-autocomplete">
                  <input id="metaStarrings" value="${escapeHtml((video.starrings || []).join(', '))}" autocomplete="off" />
                </span>
              </label>
              <label>View Count <input id="metaViewCount" type="number" min="0" value="${Number(video.viewCount || 0)}" /></label>
              <label>Display Title <input id="metaTitle" value="${escapeHtml(video.displayTitle || '')}" required /></label>
              <label>Date Added <input id="metaCreatedAtDate" type="date" value="${escapeHtml((video.createdAt || '').slice(0, 10))}" /></label>
              <button type="submit" class="primary">Save Metadata</button>
            </form>

            <hr />

            <div class="form-grid meta-editor-form">
              <label>Upload Thumbnail
                <input id="thumbnailUploadInput" type="file" accept="image/png,image/jpeg,image/webp" />
              </label>
              <button id="captureThumbnailBtn">Use Current Frame as Thumbnail</button>
            </div>

            <hr />

            <form id="renameForm" class="form-grid meta-editor-form">
              <label>Rename Real File
                <div class="rename-file-row">
                  <input id="renameInput" value="${escapeHtml(getFileNameBaseName(video.fileName))}" />
                  <span class="rename-file-ext">${escapeHtml(getFileNameExtension(video.fileName))}</span>
                </div>
              </label>
              <button type="submit">Rename File</button>
            </form>
          </div>
        </div>
      </section>

      <section class="section-panel video-slot-markers">
        <div class="panel-body">
          <h3 class="section-title">Jump Markers</h3>
          <form id="noteForm" class="form-grid jump-marker-form" style="margin-top: .7rem;">
            <button type="submit" class="primary">Add Marker</button>
            <input
              id="noteTimestampInput"
              class="jump-marker-time-input"
              type="text"
              placeholder="at current playhead by default"
              aria-label="Jump marker time"
            />
            <input
              id="noteMemoInput"
              type="text"
              placeholder="Marker Name(Optional)"
              aria-label="Jump marker label"
            />
          </form>
          <div class="list-block" id="notesList">${createNotesListHtml(notes)}</div>
        </div>
      </section>

      <section class="section-panel video-slot-reviews">
        <div class="panel-body">
          <h3 class="section-title">Reviews</h3>
          <form id="commentForm" class="form-grid comments-editor" style="margin-top: .7rem;">
            <div class="comment-rating-field">
              <div id="commentRatingEditor" class="rating-editor">
                ${createRatingButtonsHtml(null, 'data-comment-form-rating="1"')}
                <input id="commentRatingInput" type="hidden" data-rating-input value="" />
                <span id="commentRatingLabel" class="rating-label" data-rating-label>No rating</span>
              </div>
            </div>
            <textarea id="commentInput" class="wide-comment-input" placeholder="Write a comment (optional if you leave only a rating)"></textarea>
            <button type="submit" class="primary">Add Review</button>
          </form>
          <div class="list-block" id="commentsList">${commentsHtml || '<div class="muted">No reviews yet.</div>'}</div>
        </div>
      </section>
        </div>
      </div>
      </div>
    `;

    const recommendationSeed = crypto.randomUUID();
    const relatedGrid = document.getElementById('relatedGrid');
    let latestRelatedRequestId = 0;
    let relatedResizeTimer = null;

    function renderRelatedVideos(related) {
      if (related.length === 0) {
        relatedGrid.innerHTML = '<div class="muted">No related videos found.</div>';
        return;
      }

      relatedGrid.innerHTML = '';
      related.forEach((rv, index) => {
        const card = createRelatedCard(rv);
        card.style.setProperty('--stagger', String(index));
        relatedGrid.appendChild(card);
      });
    }

    async function refreshRelatedVideos({ force = false } = {}) {
      const nextRelatedLimit = getRelatedVideoLimit(relatedGrid);
      if (!force && nextRelatedLimit === state.layout.relatedLimit) {
        return;
      }

      state.layout.relatedLimit = nextRelatedLimit;
      const requestId = ++latestRelatedRequestId;
      relatedGrid.innerHTML = '<div class="muted">Loading related videos...</div>';

      try {
        const relatedRes = await api(`/api/videos/${videoId}/related?limit=${nextRelatedLimit}&seed=${recommendationSeed}`);
        if (token !== currentRenderToken || requestId !== latestRelatedRequestId) return;
        renderRelatedVideos(relatedRes.items || []);
      } catch (error) {
        if (token !== currentRenderToken || requestId !== latestRelatedRequestId) return;
        relatedGrid.innerHTML = `<div class="warning error">${escapeHtml(error.message)}</div>`;
      }
    }

    function scheduleRelatedVideosRefresh() {
      if (relatedResizeTimer) {
        clearTimeout(relatedResizeTimer);
      }

      relatedResizeTimer = setTimeout(() => {
        refreshRelatedVideos();
      }, 120);
    }

    state.layout.relatedLimit = null;

    const videoView = document.getElementById('videoView');
    const videoEl = document.getElementById('videoEl');
    const playerShell = document.getElementById('playerShell');
    const playerControls = document.getElementById('playerControls');
    const playPauseBtn = document.getElementById('playPauseBtn');
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    const theaterBtn = document.getElementById('theaterBtn');
    const addMarkerBtn = document.getElementById('addMarkerBtn');
    const muteBtn = document.getElementById('muteBtn');
    const volumeRange = document.getElementById('volumeRange');
    const progressRange = document.getElementById('progressRange');
    const progressWrap = progressRange.closest('.progress-wrap');
    const timelinePreview = document.getElementById('timelinePreview');
    const timelinePreviewImage = document.getElementById('timelinePreviewImage');
    const noteMarkerLayer = document.getElementById('noteMarkerLayer');
    const timeLabel = document.getElementById('timeLabel');
    const notesList = document.getElementById('notesList');

    const relatedPromise = refreshRelatedVideos({ force: true });
    const timelinePreviewState = {
      manifest: null,
      request: null,
      available: null,
      currentUrl: '',
      preloadedUrls: new Set()
    };

    let hideTimer = null;
    const controlsHideMsRaw = Number(state.settings?.controlsHideMs ?? 2500);
    const controlsHideMs = Number.isFinite(controlsHideMsRaw) ? controlsHideMsRaw : 2500;
    let hoveredProgressRatio = null;

    function showControls() {
      playerControls.classList.remove('hidden');
      if (hideTimer) clearTimeout(hideTimer);
      if (!videoEl.paused && controlsHideMs !== 0) {
        hideTimer = setTimeout(() => {
          playerControls.classList.add('hidden');
        }, controlsHideMs);
      }
    }

    function updateTimeLabel() {
      timeLabel.textContent = `${formatDuration(videoEl.currentTime)} / ${formatDuration(videoEl.duration)}`;
    }

    function updateMuteButtonLabel() {
      const isMuted = videoEl.muted || videoEl.volume === 0;
      const label = isMuted ? 'Unmute' : 'Mute';
      muteBtn.innerHTML = isMuted ? ICON_VOLUME_OFF : ICON_VOLUME_ON;
      muteBtn.setAttribute('aria-label', label);
      muteBtn.title = label;
    }

    function clampProgressRatio(ratio) {
      return Math.max(0, Math.min(1, Number(ratio) || 0));
    }

    function getProgressRatioFromClientX(clientX) {
      const rect = progressRange.getBoundingClientRect();
      if (!Number.isFinite(rect.width) || rect.width <= 0) return null;
      return clampProgressRatio((clientX - rect.left) / rect.width);
    }

    function preloadTimelinePreviewItem(item) {
      if (!item?.imageUrl || timelinePreviewState.preloadedUrls.has(item.imageUrl)) {
        return;
      }

      timelinePreviewState.preloadedUrls.add(item.imageUrl);
      const img = new Image();
      img.src = item.imageUrl;
    }

    async function ensureTimelinePreviewManifestLoaded() {
      if (timelinePreviewState.manifest) {
        return timelinePreviewState.manifest;
      }

      if (timelinePreviewState.available === false) {
        return null;
      }

      if (timelinePreviewState.request) {
        return timelinePreviewState.request;
      }

      timelinePreviewState.request = api(`/api/videos/${videoId}/previews`)
        .then((payload) => {
          if (token !== currentRenderToken) {
            return null;
          }

          const items = Array.isArray(payload?.items) ? payload.items.filter((item) => item?.imageUrl) : [];
          if (!payload?.available || items.length === 0) {
            timelinePreviewState.available = false;
            return null;
          }

          const manifest = {
            duration: Number(payload.duration || 0),
            intervalSec: Math.max(1, Number(payload.intervalSec || 0)),
            items
          };

          timelinePreviewState.manifest = manifest;
          timelinePreviewState.available = true;
          preloadTimelinePreviewItem(items[0]);
          preloadTimelinePreviewItem(items[1]);
          return manifest;
        })
        .catch(() => {
          timelinePreviewState.available = false;
          return null;
        })
        .finally(() => {
          timelinePreviewState.request = null;
        });

      return timelinePreviewState.request;
    }

    function getTimelinePreviewDuration() {
      const manifestDuration = Number(timelinePreviewState.manifest?.duration || 0);
      if (manifestDuration > 0) {
        return manifestDuration;
      }

      const videoDuration = Number(videoEl.duration || 0);
      if (videoDuration > 0) {
        return videoDuration;
      }

      const fallbackDuration = Number(video.duration || 0);
      return fallbackDuration > 0 ? fallbackDuration : 0;
    }

    function getTimelinePreviewSelection(ratio) {
      const items = timelinePreviewState.manifest?.items || [];
      if (items.length === 0) {
        return null;
      }

      const safeRatio = clampProgressRatio(ratio);
      const duration = getTimelinePreviewDuration();
      const targetTime = duration > 0 ? safeRatio * duration : safeRatio * Math.max(1, items.length - 1);
      const roughIndex = timelinePreviewState.manifest?.intervalSec
        ? Math.round(targetTime / timelinePreviewState.manifest.intervalSec)
        : Math.round(safeRatio * (items.length - 1));
      const index = Math.max(0, Math.min(items.length - 1, roughIndex));

      return { item: items[index], index };
    }

    function positionTimelinePreview(ratio) {
      const rect = progressWrap?.getBoundingClientRect();
      if (!rect || !Number.isFinite(rect.width) || rect.width <= 0) {
        return;
      }

      const safeRatio = clampProgressRatio(ratio);
      const halfWidth = timelinePreview.offsetWidth / 2 || 0;
      const leftPx = safeRatio * rect.width;
      const clampedLeft = Math.max(halfWidth, Math.min(rect.width - halfWidth, leftPx));
      timelinePreview.style.left = `${clampedLeft}px`;
    }

    function hideTimelinePreview() {
      hoveredProgressRatio = null;
      timelinePreview.classList.remove('is-visible');
    }

    function renderTimelinePreview(ratio) {
      const selection = getTimelinePreviewSelection(ratio);
      if (!selection?.item?.imageUrl) {
        timelinePreview.classList.remove('is-visible');
        return;
      }

      if (timelinePreviewState.currentUrl !== selection.item.imageUrl) {
        timelinePreviewImage.src = selection.item.imageUrl;
        timelinePreviewState.currentUrl = selection.item.imageUrl;
      }

      positionTimelinePreview(ratio);
      timelinePreview.classList.add('is-visible');
      preloadTimelinePreviewItem(timelinePreviewState.manifest?.items?.[selection.index + 1]);
      preloadTimelinePreviewItem(timelinePreviewState.manifest?.items?.[selection.index - 1]);
    }

    function requestTimelinePreviewForRatio(ratio) {
      hoveredProgressRatio = clampProgressRatio(ratio);
      if (timelinePreviewState.manifest) {
        renderTimelinePreview(hoveredProgressRatio);
        return;
      }

      ensureTimelinePreviewManifestLoaded().then((manifest) => {
        if (!manifest || token !== currentRenderToken || hoveredProgressRatio === null) {
          return;
        }

        renderTimelinePreview(hoveredProgressRatio);
      });
    }

    function setVolumeLevel(nextVolume) {
      const normalizedVolume = Math.max(0, Math.min(1, Number(nextVolume)));
      if (!Number.isFinite(normalizedVolume)) return;
      videoEl.volume = normalizedVolume;
      volumeRange.value = String(normalizedVolume);
      updateRangeVisual(volumeRange, normalizedVolume);

      if (normalizedVolume > 0 && videoEl.muted) {
        videoEl.muted = false;
      }
      saveAudioPreferences(localStorage, videoEl, state.playerPrefs);
      updateMuteButtonLabel();
    }

    function syncProgressFromVideo() {
      if (!Number.isFinite(videoEl.duration) || videoEl.duration <= 0) {
        progressRange.value = '0';
        updateRangeVisual(progressRange, 0);
      } else {
        const progressRatio = videoEl.currentTime / videoEl.duration;
        progressRange.value = String(Math.round(progressRatio * 1000));
        updateRangeVisual(progressRange, progressRatio);
      }
      updateTimeLabel();
    }

    function renderNoteMarkers() {
      noteMarkerLayer.innerHTML = '';
      if (!Number.isFinite(videoEl.duration) || videoEl.duration <= 0) return;

      notes.forEach((note) => {
        const pos = (note.timestampSec / videoEl.duration) * 100;
        if (!Number.isFinite(pos)) return;
        const marker = document.createElement('span');
        marker.className = 'note-marker';
        marker.style.left = `${Math.max(0, Math.min(100, pos))}%`;
        marker.dataset.tooltip = note.memo;
        marker.title = note.memo;
        marker.tabIndex = 0;
        marker.addEventListener('pointerdown', (event) => {
          event.preventDefault();
        });
        marker.addEventListener('click', () => {
          videoEl.currentTime = Number(note.timestampSec || 0);
          syncProgressFromVideo();
          showControls();
        });
        marker.addEventListener('keydown', (event) => {
          if (!['Enter', ' '].includes(event.key)) return;
          event.preventDefault();
          event.stopPropagation();
          videoEl.currentTime = Number(note.timestampSec || 0);
          syncProgressFromVideo();
          showControls();
          marker.blur();
        });
        noteMarkerLayer.appendChild(marker);
      });
    }

    function renderNotesList() {
      notesList.innerHTML = createNotesListHtml(notes);
    }

    let latestNotesRequestId = 0;

    async function refreshNotes() {
      const requestId = ++latestNotesRequestId;
      const notesRes = await api(`/api/videos/${videoId}/notes`);
      if (token !== currentRenderToken || requestId !== latestNotesRequestId) {
        return;
      }

      notes = notesRes.items || [];
      renderNotesList();
      renderNoteMarkers();
    }

    activeVideoView.videoId = videoId;
    activeVideoView.refreshNotes = refreshNotes;
    addCleanup(() => {
      if (activeVideoView.videoId === videoId) {
        activeVideoView.videoId = null;
        activeVideoView.refreshNotes = null;
      }
    });

    function skipBy(delta) {
      if (!Number.isFinite(videoEl.duration)) return;
      const next = Math.max(0, Math.min(videoEl.duration, videoEl.currentTime + delta));
      videoEl.currentTime = next;
      syncProgressFromVideo();
    }

    function requestPlay() {
      videoEl.play().catch((error) => {
        if (error?.name === 'NotSupportedError') {
          showToast('Unsupported source. Try Scan Library to refresh stale entries.', true);
        } else {
          showToast(error?.message || 'Failed to play this video.', true);
        }
      });
    }

    Object.assign(state.playerPrefs, readAudioPreferences(localStorage, state.playerPrefs));
    videoEl.volume = state.playerPrefs.volume;
    videoEl.muted = state.playerPrefs.muted;
    volumeRange.value = String(state.playerPrefs.volume);
    updateRangeVisual(volumeRange, state.playerPrefs.volume);
    updateMuteButtonLabel();

    showControls();

    videoEl.addEventListener('loadedmetadata', () => {
      if (playbackToRestore) {
        const nextTime = Math.max(0, Math.min(Number(videoEl.duration) || 0, playbackToRestore.currentTime || 0));
        videoEl.currentTime = nextTime;
      }
      syncProgressFromVideo();
      renderNoteMarkers();
      volumeRange.value = String(videoEl.volume);
      updateRangeVisual(volumeRange, videoEl.volume);
      updateMuteButtonLabel();
      ensureTimelinePreviewManifestLoaded();
      if (playbackToRestore && !playbackToRestore.wasPaused) {
        requestPlay();
      }
    });

    videoEl.addEventListener('timeupdate', syncProgressFromVideo);
    videoEl.addEventListener('play', () => {
      playPauseBtn.textContent = 'Pause';
      showControls();
    });

    videoEl.addEventListener('pause', () => {
      playPauseBtn.textContent = 'Play';
      showControls();
    });

    playPauseBtn.addEventListener('click', () => {
      if (videoEl.paused) {
        requestPlay();
      } else {
        videoEl.pause();
      }
    });

    function seekToProgressRatio(ratio) {
      if (!Number.isFinite(videoEl.duration) || videoEl.duration <= 0) return;
      const safeRatio = clampProgressRatio(ratio);
      const next = safeRatio * videoEl.duration;
      videoEl.currentTime = next;
      syncProgressFromVideo();
    }

    function seekToClientPosition(clientX) {
      const ratio = getProgressRatioFromClientX(clientX);
      if (ratio === null) return;
      seekToProgressRatio(ratio);
    }

    let isScrubbingProgress = false;

    progressRange.addEventListener('input', () => {
      seekToProgressRatio(Number(progressRange.value) / 1000);
    });

    progressRange.addEventListener('pointerdown', (event) => {
      if (!Number.isFinite(videoEl.duration) || videoEl.duration <= 0) return;
      isScrubbingProgress = true;
      progressRange.setPointerCapture?.(event.pointerId);
      const ratio = getProgressRatioFromClientX(event.clientX);
      if (ratio !== null) {
        requestTimelinePreviewForRatio(ratio);
      }
      seekToClientPosition(event.clientX);
      event.preventDefault();
    });

    progressRange.addEventListener('pointermove', (event) => {
      const ratio = getProgressRatioFromClientX(event.clientX);
      if (ratio !== null) {
        requestTimelinePreviewForRatio(ratio);
      }
      if (!isScrubbingProgress) return;
      seekToClientPosition(event.clientX);
    });

    progressRange.addEventListener('pointerenter', (event) => {
      const ratio = getProgressRatioFromClientX(event.clientX);
      if (ratio !== null) {
        requestTimelinePreviewForRatio(ratio);
      } else {
        ensureTimelinePreviewManifestLoaded();
      }
    });

    progressRange.addEventListener('pointerleave', () => {
      hideTimelinePreview();
    });

    progressRange.addEventListener('blur', () => {
      hideTimelinePreview();
    });

    const stopProgressScrub = (event) => {
      if (!isScrubbingProgress) return;
      if (typeof event.clientX === 'number') {
        const ratio = getProgressRatioFromClientX(event.clientX);
        if (ratio !== null) {
          requestTimelinePreviewForRatio(ratio);
        }
        seekToClientPosition(event.clientX);
      }
      if (typeof event.pointerId === 'number' && progressRange.hasPointerCapture?.(event.pointerId)) {
        progressRange.releasePointerCapture(event.pointerId);
      }
      isScrubbingProgress = false;
      if (event.pointerType && event.pointerType !== 'mouse') {
        hideTimelinePreview();
      }
    };

    progressRange.addEventListener('pointerup', stopProgressScrub);
    progressRange.addEventListener('pointercancel', (event) => {
      stopProgressScrub(event);
      hideTimelinePreview();
    });
    progressRange.addEventListener('lostpointercapture', () => {
      isScrubbingProgress = false;
    });

    fullscreenBtn.addEventListener('click', async () => {
      try {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
        } else {
          await playerShell.requestFullscreen();
        }
      } catch (error) {
        showToast(error?.message || 'Fullscreen failed.', true);
      }
    });

    function applyTheaterMode() {
      const on = state.playerPrefs.theaterOn;
      videoView.classList.toggle('theater-on', on);
      videoView.classList.toggle('theater-off', !on);
      theaterBtn.classList.toggle('is-active', on);
      theaterBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }

    function toggleTheater() {
      state.playerPrefs.theaterOn = !state.playerPrefs.theaterOn;
      savePlayerPrefs();
      applyTheaterMode();
      // Layout width of the related-video grid changes with theater mode,
      // so recompute how many related cards fit.
      scheduleRelatedVideosRefresh();
    }

    applyTheaterMode();
    theaterBtn.addEventListener('click', toggleTheater);

    volumeRange.addEventListener('input', () => {
      setVolumeLevel(volumeRange.value);
    });

    function setVolumeByRatio(ratio) {
      setVolumeLevel(Math.max(0, Math.min(1, ratio)));
    }

    function setVolumeByClientPosition(clientX) {
      const rect = volumeRange.getBoundingClientRect();
      if (!Number.isFinite(rect.width) || rect.width <= 0) return;
      setVolumeByRatio((clientX - rect.left) / rect.width);
    }

    let isScrubbingVolume = false;

    volumeRange.addEventListener('pointerdown', (event) => {
      isScrubbingVolume = true;
      volumeRange.setPointerCapture?.(event.pointerId);
      setVolumeByClientPosition(event.clientX);
      event.preventDefault();
    });

    volumeRange.addEventListener('pointermove', (event) => {
      if (!isScrubbingVolume) return;
      setVolumeByClientPosition(event.clientX);
    });

    const stopVolumeScrub = (event) => {
      if (!isScrubbingVolume) return;
      if (typeof event.clientX === 'number') {
        setVolumeByClientPosition(event.clientX);
      }
      if (typeof event.pointerId === 'number' && volumeRange.hasPointerCapture?.(event.pointerId)) {
        volumeRange.releasePointerCapture(event.pointerId);
      }
      isScrubbingVolume = false;
    };

    volumeRange.addEventListener('pointerup', stopVolumeScrub);
    volumeRange.addEventListener('pointercancel', stopVolumeScrub);
    volumeRange.addEventListener('lostpointercapture', () => {
      isScrubbingVolume = false;
    });

    muteBtn.addEventListener('click', () => {
      videoEl.muted = !videoEl.muted;
      saveAudioPreferences(localStorage, videoEl, state.playerPrefs);
      updateMuteButtonLabel();
    });

    videoEl.addEventListener('volumechange', () => {
      if (!videoEl.muted) {
        volumeRange.value = String(videoEl.volume);
      }
      updateRangeVisual(volumeRange, videoEl.muted ? 0 : videoEl.volume);
      if (token !== currentRenderToken || !videoEl.isConnected) return;
      saveAudioPreferences(localStorage, videoEl, state.playerPrefs);
      updateMuteButtonLabel();
    });

    playerShell.addEventListener('mousemove', showControls);
    playerShell.addEventListener('mouseenter', showControls);

    // Never let player controls take keyboard focus on click, so Space/arrows/f/m/t
    // always act on the video instead of re-triggering the last-clicked button.
    playerControls.addEventListener('mousedown', (event) => {
      if (event.target.closest('button')) event.preventDefault();
    });

    const keyboardHandler = (event) => {
      const targetTag = (event.target?.tagName || '').toLowerCase();
      if (['input', 'textarea', 'select', 'button'].includes(targetTag)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      // Match letter shortcuts by physical key (works regardless of keyboard
      // layout, IME, or CapsLock), falling back to the produced character so
      // non-QWERTY physical layouts still trigger on their own 'f'/'m'/'t' key.
      const matchKey = (code, letter) =>
        event.code === code || event.key.toLowerCase() === letter;

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        skipBy(-state.settings.skipSeconds);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        skipBy(state.settings.skipSeconds);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        const currentVolume = videoEl.muted && videoEl.volume === 0 ? 0 : videoEl.volume;
        setVolumeLevel(currentVolume + 0.05);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setVolumeLevel(videoEl.volume - 0.05);
      } else if (event.key === ' ') {
        event.preventDefault();
        if (videoEl.paused) requestPlay();
        else videoEl.pause();
      } else if (matchKey('KeyF', 'f')) {
        event.preventDefault();
        if (document.fullscreenElement) {
          document.exitFullscreen();
        } else {
          playerShell.requestFullscreen();
        }
      } else if (matchKey('KeyM', 'm')) {
        event.preventDefault();
        videoEl.muted = !videoEl.muted;
        saveAudioPreferences(localStorage, videoEl, state.playerPrefs);
        updateMuteButtonLabel();
      } else if (matchKey('KeyT', 't')) {
        event.preventDefault();
        toggleTheater();
      }
    };

    window.addEventListener('keydown', keyboardHandler);
    addCleanup(() => window.removeEventListener('keydown', keyboardHandler));

    const metaToggleBtn = document.getElementById('metaToggleBtn');
    const metaEditor = document.getElementById('metaEditor');
    metaToggleBtn.addEventListener('click', () => {
      const open = metaEditor.classList.toggle('open');
      metaToggleBtn.textContent = open ? 'Close Video Data Editor' : 'Edit Video Data';
    });

    Promise.all([loadMetadataSuggestionNames('/api/tags'), loadMetadataSuggestionNames('/api/starrings')]).then(
      ([tagSuggestions, starringSuggestions]) => {
        attachCommaAutocomplete(document.getElementById('metaTags'), tagSuggestions);
        attachCommaAutocomplete(document.getElementById('metaStarrings'), starringSuggestions);
      }
    );

    const metaForm = document.getElementById('metaForm');
    metaForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await api(`/api/videos/${videoId}/metadata`, {
          method: 'PUT',
          body: JSON.stringify({
            displayTitle: document.getElementById('metaTitle').value.trim(),
            createdAtDate: document.getElementById('metaCreatedAtDate').value,
            viewCount: Number(document.getElementById('metaViewCount').value || 0),
            tags: document.getElementById('metaTags').value
              .split(',')
              .map((v) => v.trim())
              .filter(Boolean),
            starrings: document.getElementById('metaStarrings').value
              .split(',')
              .map((v) => v.trim())
              .filter(Boolean)
          })
        });
        showToast('Metadata saved');
        rerenderPreservingPlayback();
      } catch (error) {
        showToast(error.message, true);
      }
    });

    const renameForm = document.getElementById('renameForm');
    renameForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const newFileName = document.getElementById('renameInput').value.trim();
      const confirmed = await showConfirm(
        'This will rename the actual file on disk. Proceed?',
        { okLabel: 'Proceed' }
      );
      if (!confirmed) return;

      try {
        await api(`/api/videos/${videoId}/rename`, {
          method: 'POST',
          body: JSON.stringify({ newFileName })
        });
        showToast('File renamed');
        rerenderPreservingPlayback();
      } catch (error) {
        showToast(error.message, true);
      }
    });

    const thumbnailUploadInput = document.getElementById('thumbnailUploadInput');
    thumbnailUploadInput.addEventListener('change', async () => {
      const file = thumbnailUploadInput.files?.[0];
      if (!file) return;

      const formData = new FormData();
      formData.append('file', file);

      try {
        const response = await fetch(`/api/videos/${videoId}/thumbnail/upload`, {
          method: 'POST',
          body: formData
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Thumbnail upload failed');

        showToast('Thumbnail uploaded');
        rerenderPreservingPlayback();
      } catch (error) {
        showToast(error.message, true);
      }
    });

    const captureBtn = document.getElementById('captureThumbnailBtn');
    captureBtn.addEventListener('click', async () => {
      if (!videoEl.videoWidth || !videoEl.videoHeight) {
        showToast('Load video metadata first.', true);
        return;
      }

      const canvas = document.createElement('canvas');
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

      try {
        await api(`/api/videos/${videoId}/thumbnail/capture`, {
          method: 'POST',
          body: JSON.stringify({
            dataUrl,
            timestampSec: videoEl.currentTime
          })
        });

        showToast('Thumbnail captured');
        rerenderPreservingPlayback();
      } catch (error) {
        showToast(error.message, true);
      }
    });

    const commentForm = document.getElementById('commentForm');
    const commentRatingEditor = document.getElementById('commentRatingEditor');
    syncRatingEditor(commentRatingEditor, null);
    bindRatingEditorControls(commentRatingEditor, '[data-comment-form-rating]');

    commentForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = document.getElementById('commentInput');
      const ratingInput = document.getElementById('commentRatingInput');
      const content = input.value.trim();
      const rating = normalizeOptionalRating(ratingInput.value);
      if (!content && rating === null) {
        showToast('Write a review or choose a rating.', true);
        return;
      }

      try {
        await api(`/api/videos/${videoId}/comments`, {
          method: 'POST',
          body: JSON.stringify({
            content,
            rating
          })
        });
        showToast('Review added');
        rerenderPreservingPlayback();
      } catch (error) {
        showToast(error.message, true);
      }
    });

    document.querySelectorAll('[data-comment-edit]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        const id = Number(event.currentTarget.getAttribute('data-comment-edit'));
        const current = comments.find((item) => item.id === id);
        if (!current) return;
        openCommentEditDialog({ comment: current, videoId });
      });
    });

    document.querySelectorAll('[data-comment-delete]').forEach((btn) => {
      btn.addEventListener('click', async (event) => {
        const id = Number(event.currentTarget.getAttribute('data-comment-delete'));
        if (!await showConfirm('Delete this review?')) return;

        try {
          await api(`/api/comments/${id}`, { method: 'DELETE' });
          showToast('Review deleted');
          rerenderPreservingPlayback();
        } catch (error) {
          showToast(error.message, true);
        }
      });
    });

    const noteForm = document.getElementById('noteForm');
    const noteTimestampInput = document.getElementById('noteTimestampInput');
    const noteMemoInput = document.getElementById('noteMemoInput');

    bindMarkerTimeInput(noteTimestampInput, () => videoEl.currentTime);

    async function createMarker({ timestampSec, memo }) {
      if (!Number.isFinite(timestampSec) || timestampSec < 0) {
        showToast('Enter a valid time.', true);
        return;
      }

      try {
        await api(`/api/videos/${videoId}/notes`, {
          method: 'POST',
          body: JSON.stringify({ timestampSec, memo: normalizeMarkerLabel(memo) })
        });
        noteTimestampInput.value = '';
        noteMemoInput.value = '';
        await refreshNotes();
        showToast('Marker added');
      } catch (error) {
        showToast(error.message, true);
      }
    }

    const submitMarkerOnEnter = (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        noteForm.requestSubmit();
      }
    };

    noteTimestampInput.addEventListener('keydown', submitMarkerOnEnter);
    noteMemoInput.addEventListener('keydown', submitMarkerOnEnter);

    addMarkerBtn.addEventListener('click', async () => {
      await createMarker({
        timestampSec: Number(videoEl.currentTime || 0),
        memo: noteMemoInput.value
      });
      addMarkerBtn.blur();
    });

    noteForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const timestampSec = parseMarkerTimeValue(noteTimestampInput.value, { fallback: videoEl.currentTime || 0 });
      await createMarker({
        timestampSec,
        memo: noteMemoInput.value
      });
    });

    notesList.addEventListener('click', async (event) => {
      const jumpBtn = event.target.closest?.('[data-note-jump]');
      if (jumpBtn) {
        const id = Number(jumpBtn.getAttribute('data-note-jump'));
        const note = notes.find((item) => item.id === id);
        if (!note) return;
        videoEl.currentTime = Number(note.timestampSec || 0);
        syncProgressFromVideo();
        showControls();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        requestPlay();
        return;
      }

      const editBtn = event.target.closest?.('[data-note-edit]');
      if (editBtn) {
        const id = Number(editBtn.getAttribute('data-note-edit'));
        const current = notes.find((item) => item.id === id);
        if (!current) return;

        openNoteEditDialog({
          note: current,
          videoId,
          getCurrentTime: () => videoEl.currentTime
        });
        return;
      }

      const deleteBtn = event.target.closest?.('[data-note-delete]');
      if (!deleteBtn) return;

      const id = Number(deleteBtn.getAttribute('data-note-delete'));
      if (!await showConfirm('Delete this jump marker?')) return;

      try {
        await api(`/api/notes/${id}`, { method: 'DELETE' });
        await refreshNotes();
        showToast('Marker deleted');
      } catch (error) {
        showToast(error.message, true);
      }
    });

    document.querySelectorAll('[data-video-tag]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        const tag = event.currentTarget.getAttribute('data-video-tag');
        setHash(`#/tag/${encodeURIComponent(tag)}`);
      });
    });

    document.querySelectorAll('[data-video-starring]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        const name = event.currentTarget.getAttribute('data-video-starring');
        setHash(`#/starring/${encodeURIComponent(name)}`);
      });
    });

    addCleanup(() => {
      if (noteEditState.videoId === videoId) {
        closeNoteEditDialog();
      }
    });

    addCleanup(() => {
      if (commentEditState.videoId === videoId) {
        closeCommentEditDialog();
      }
    });

    addCleanup(() => {
      if (hideTimer) clearTimeout(hideTimer);
      videoEl.pause();
      hideTimelinePreview();
    });

    if (typeof ResizeObserver === 'function') {
      const relatedResizeObserver = new ResizeObserver(() => {
        scheduleRelatedVideosRefresh();
      });
      relatedResizeObserver.observe(relatedGrid);
      addCleanup(() => relatedResizeObserver.disconnect());
    } else {
      window.addEventListener('resize', scheduleRelatedVideosRefresh);
      addCleanup(() => window.removeEventListener('resize', scheduleRelatedVideosRefresh));
    }

    addCleanup(() => {
      if (relatedResizeTimer) {
        clearTimeout(relatedResizeTimer);
      }
    });

    await relatedPromise;
  } catch (error) {
    if (token !== currentRenderToken) return;
    mainEl.innerHTML = `<div class="warning error">${escapeHtml(error.message)}</div>`;
  }
}

async function renderTagsView() {
  mainEl.innerHTML = '<div class="status">Loading tags...</div>';

  try {
    const data = await api('/api/tags');
    const items = data.items || [];
    let sortMode = 'alpha';

    const buildItemsHtml = () => {
      const sorted = items.slice().sort((a, b) => {
        if (sortMode === 'count' && b.videoCount !== a.videoCount) {
          return b.videoCount - a.videoCount;
        }
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });

      return (
        sorted
          .map(
            (item) => `
              <div class="starring-item clickable-card">
                <a class="video-card-link" href="#/tag/${encodeURIComponent(item.name)}" aria-label="Open ${escapeHtml(item.name)}"></a>
                <div><strong>#${escapeHtml(item.name)}</strong></div>
                <div class="muted">${item.videoCount} videos</div>
              </div>
            `
          )
          .join('') || '<div class="muted">No tags yet.</div>'
      );
    };

    mainEl.innerHTML = `
      <section class="section-panel">
        <div class="panel-body">
          <div class="tags-header">
            <h2 class="section-title">Tags</h2>
            <select id="tagSortSelect" class="tag-sort-select">
              <option value="alpha">Name (A–Z)</option>
              <option value="count">Video Count</option>
            </select>
          </div>
          <div class="starring-list" id="tagsGrid" style="margin-top: .9rem;"></div>
        </div>
      </section>
    `;

    const tagsGrid = document.getElementById('tagsGrid');
    const tagSortSelect = document.getElementById('tagSortSelect');
    tagSortSelect.value = sortMode;
    tagsGrid.innerHTML = buildItemsHtml();

    tagSortSelect.addEventListener('change', () => {
      sortMode = tagSortSelect.value;
      tagsGrid.innerHTML = buildItemsHtml();
    });
  } catch (error) {
    mainEl.innerHTML = `<div class="warning error">${escapeHtml(error.message)}</div>`;
  }
}

async function renderStarringsView() {
  mainEl.innerHTML = '<div class="status">Loading starrings...</div>';

  try {
    const data = await api('/api/starrings');

    const itemsHtml = (data.items || [])
      .map(
        (item) => `
          <div class="starring-item clickable-card">
            <a class="video-card-link" href="#/starring/${encodeURIComponent(item.name)}" aria-label="Open ${escapeHtml(item.name)}"></a>
            <div><strong>${escapeHtml(item.name)}</strong></div>
            <div class="muted">${item.videoCount} videos</div>
          </div>
        `
      )
      .join('');

    mainEl.innerHTML = `
      <section class="section-panel">
        <div class="panel-body">
          <h2 class="section-title">Starring</h2>
          <div class="starring-list" style="margin-top: .9rem;">
            ${itemsHtml || '<div class="muted">No starring data yet.</div>'}
          </div>
        </div>
      </section>
    `;
  } catch (error) {
    mainEl.innerHTML = `<div class="warning error">${escapeHtml(error.message)}</div>`;
  }
}

async function renderDatabaseView() {
  const token = currentRenderToken;
  mainEl.innerHTML = '<div class="status">Loading video database...</div>';

  try {
    const query = new URLSearchParams();
    query.set('page', String(state.dbFilters.page || 1));
    query.set('pageSize', '120');
    if (state.dbFilters.q) {
      query.set('q', state.dbFilters.q);
    }

    const [summary, data] = await Promise.all([getDatabaseSummary(), api(`/api/videos/admin?${query.toString()}`)]);
    if (token !== currentRenderToken) return;

    const totalPages = Math.max(1, Math.ceil((data.total || 0) / data.pageSize));
    state.dbFilters.page = Math.min(state.dbFilters.page, totalPages);
    const totals = summary?.totals || {};
    const storage = summary?.storage || {};
    const samples = summary?.samples || {};
    const totalVideos = Number(totals.totalVideos || 0);
    const thumbnailCoverage = totalVideos > 0 ? formatPercent(totals.thumbnailCount, totalVideos) : '0%';
    const previewCoverage = totalVideos > 0 ? formatPercent(totals.previewCount, totalVideos) : '0%';
    const interactionCounts = {
      views: Number(totals.totalViews || 0),
      reviews: Number(totals.commentCount || 0),
      markers: Number(totals.noteCount || 0),
      tags: Number(totals.tagCount || 0),
      starrings: Number(totals.starringCount || 0)
    };
    const totalInteractions = Object.values(interactionCounts).reduce((sum, value) => sum + value, 0);

    const rowsHtml = (data.items || [])
      .map(
        (item) => `
          <tr data-video-id="${item.id}">
            <td>${item.id}</td>
            <td class="db-title-cell">${escapeHtml(item.displayTitle || '')}</td>
            <td class="db-file-cell">${escapeHtml(item.fileName || '')}</td>
            <td>${escapeHtml(item.qualityBucket || 'unknown')}</td>
            <td>${formatDate(item.createdAt)}</td>
            <td class="db-actions">
              <button data-db-open>Open</button>
              <button class="danger-btn" data-db-delete>Delete</button>
            </td>
          </tr>
        `
      )
      .join('');

    const thumbnailSamplesHtml = (samples.thumbnails || [])
      .map(
        (item) => `
          <button type="button" class="db-media-card" data-db-summary-open="${item.videoId}">
            <img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.displayTitle || `Thumbnail ${item.videoId}`)}" loading="lazy" />
            <div class="db-media-card-body">
              <strong>${escapeHtml(item.displayTitle || `Video ${item.videoId}`)}</strong>
              <span class="muted">Thumbnail sample</span>
            </div>
          </button>
        `
      )
      .join('');

    const previewSamplesHtml = (samples.previews || [])
      .map(
        (item) => `
          <button type="button" class="db-media-card" data-db-summary-open="${item.videoId}">
            <img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.displayTitle || `Preview ${item.videoId}`)}" loading="lazy" />
            <div class="db-media-card-body">
              <strong>${escapeHtml(item.displayTitle || `Video ${item.videoId}`)}</strong>
              <span class="muted">${formatNumber(item.frameCount || 0)} cached frames</span>
            </div>
          </button>
        `
      )
      .join('');

    const summaryHtml = summary
      ? `
          <div class="db-header">
            <div>
              <h2 class="section-title">Video DB</h2>
              <div class="muted">Overview of indexed videos and CornField-generated database assets.</div>
            </div>
            <div class="db-summary-stamp">${totals.lastUpdatedAt ? `Updated ${escapeHtml(formatDateTime(totals.lastUpdatedAt))}` : 'No indexed videos yet'}</div>
          </div>
          <div class="db-summary-grid">
            <article class="db-summary-card">
              <span class="db-summary-label">Indexed Videos</span>
              <strong>${formatNumber(totalVideos)}</strong>
              <div class="db-summary-value-sub">${formatCollectionDuration(totals.totalDurationSec)} runtime</div>
              <div class="db-summary-inline">
                <span>${formatNumber(totals.totalViews || 0)} views</span>
                <span>${formatNumber(totals.missingVideos || 0)} missing</span>
              </div>
            </article>
            <article class="db-summary-card">
              <span class="db-summary-label">Coverage</span>
              <strong>${thumbnailCoverage}</strong>
              <div class="db-summary-value-sub">${formatNumber(totals.thumbnailCount || 0)} videos with thumbnails</div>
              <div class="db-summary-inline">
                <span>${previewCoverage} previews</span>
                <span>${formatNumber(totals.previewFrameCount || 0)} frames cached</span>
              </div>
            </article>
            <article class="db-summary-card">
              <span class="db-summary-label">Total Interactions</span>
              <strong>${formatNumber(totalInteractions)}</strong>
              <div class="db-summary-value-sub">CornField activity and metadata signals</div>
              <div class="db-summary-inline">
                <span>${formatNumber(interactionCounts.views)} views</span>
                <span>${formatNumber(interactionCounts.reviews)} reviews</span>
                <span>${formatNumber(interactionCounts.markers)} markers</span>
                <span>${formatNumber(interactionCounts.tags)} tags</span>
                <span>${formatNumber(interactionCounts.starrings)} starrings</span>
              </div>
            </article>
            <article class="db-summary-card">
              <span class="db-summary-label">Generated Data</span>
              <strong>${formatBytes(storage.generatedBytes || 0)}</strong>
              <div class="db-summary-value-sub">${formatBytes(storage.sqliteBytes || 0)} SQLite + ${formatBytes(storage.thumbnailBytes || 0)} thumbnails</div>
              <div class="db-summary-inline">
                <span>${formatBytes(storage.previewBytes || 0)} previews</span>
                <span>${formatNumber(storage.thumbnailFileCount || 0)} thumbs</span>
                <span>${formatNumber(storage.previewManifestCount || 0)} preview sets</span>
              </div>
            </article>
          </div>
          <div class="db-sample-grid">
            <section class="db-sample-panel">
              <div class="db-sample-head">
                <h3>Thumbnail Samples</h3>
                <span class="muted">${formatNumber(samples.thumbnails?.length || 0)} shown</span>
              </div>
              <div class="db-media-grid">
                ${thumbnailSamplesHtml || '<div class="muted">No thumbnail samples yet.</div>'}
              </div>
            </section>
            <section class="db-sample-panel">
              <div class="db-sample-head">
                <h3>Frame Preview Samples</h3>
                <span class="muted">${formatNumber(samples.previews?.length || 0)} shown</span>
              </div>
              <div class="db-media-grid">
                ${previewSamplesHtml || '<div class="muted">No cached frame previews yet.</div>'}
              </div>
            </section>
          </div>
        `
      : `
          <h2 class="section-title">Video DB</h2>
          <div class="muted" style="margin-top: 0.45rem;">Summary is temporarily unavailable, but the database table is still usable.</div>
        `;

    mainEl.innerHTML = `
      <section class="section-panel">
        <div class="panel-body">
          ${summaryHtml}
          <div class="db-toolbar">
            <input id="dbSearchInput" type="search" placeholder="Search title, file, category, tag, starring..." value="${escapeHtml(state.dbFilters.q || '')}" />
            <button id="dbApplyBtn" class="primary">Search</button>
            <button id="dbRefreshBtn">Refresh</button>
          </div>
          <div class="status">${formatNumber(data.total || 0)} matching rows | page ${state.dbFilters.page}/${totalPages}</div>
          <div class="table-scroll">
            <table class="db-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th class="db-title-cell">Display Title</th>
                  <th class="db-file-cell">File Name</th>
                  <th>Quality</th>
                  <th>Date Added</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml || '<tr><td colspan="6" class="muted">No videos found.</td></tr>'}
              </tbody>
            </table>
          </div>
          <div class="pager">
            <button id="dbPrevBtn" ${state.dbFilters.page <= 1 ? 'disabled' : ''}>Prev</button>
            <span>Page ${state.dbFilters.page} / ${totalPages}</span>
            <button id="dbNextBtn" ${state.dbFilters.page >= totalPages ? 'disabled' : ''}>Next</button>
          </div>
        </div>
      </section>
    `;

    const dbSearchInput = document.getElementById('dbSearchInput');
    const applySearch = () => {
      state.dbFilters.q = dbSearchInput.value.trim();
      state.dbFilters.page = 1;
      renderRoute();
    };

    document.getElementById('dbApplyBtn').addEventListener('click', applySearch);
    document.getElementById('dbRefreshBtn').addEventListener('click', () => {
      invalidateDatabaseSummary();
      renderRoute();
    });
    dbSearchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') applySearch();
    });

    document.getElementById('dbPrevBtn').addEventListener('click', () => {
      state.dbFilters.page = Math.max(1, state.dbFilters.page - 1);
      renderRoute();
    });
    document.getElementById('dbNextBtn').addEventListener('click', () => {
      state.dbFilters.page = Math.min(totalPages, state.dbFilters.page + 1);
      renderRoute();
    });

    document.querySelectorAll('[data-db-open]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        const tr = event.currentTarget.closest('tr');
        const videoId = Number(tr?.dataset.videoId || 0);
        if (videoId > 0) setHash(`#/video/${videoId}`);
      });
    });

    requestAnimationFrame(() => {
      document.querySelectorAll('.db-media-grid').forEach((grid) => {
        const cards = Array.from(grid.children).filter((el) => el.classList.contains('db-media-card'));
        if (cards.length === 0) return;
        const gridWidth = grid.clientWidth;
        const minCardWidth = 190;
        const gap = 10;
        const columns = Math.max(1, Math.floor((gridWidth + gap) / (minCardWidth + gap)));
        cards.forEach((card, i) => {
          card.style.display = i < columns ? '' : 'none';
        });
        const countEl = grid.closest('.db-sample-panel')?.querySelector('.muted');
        if (countEl) countEl.textContent = `${Math.min(cards.length, columns)} shown`;
      });
    });

    document.querySelectorAll('[data-db-summary-open]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        const videoId = Number(event.currentTarget.getAttribute('data-db-summary-open') || 0);
        if (videoId > 0) {
          setHash(`#/video/${videoId}`);
        }
      });
    });

    document.querySelectorAll('[data-db-delete]').forEach((btn) => {
      btn.addEventListener('click', async (event) => {
        const tr = event.currentTarget.closest('tr');
        const videoId = Number(tr?.dataset.videoId || 0);
        const displayTitle = tr?.querySelector('.db-title-cell')?.textContent?.trim() || '';
        const fileName = tr?.querySelector('.db-file-cell')?.textContent?.trim() || '';
        if (!videoId) return;

        const deleteMode = await confirmVideoDeletion({ videoId, displayTitle, fileName });
        if (!deleteMode) return;

        try {
          await api(`/api/videos/${videoId}`, {
            method: 'DELETE',
            body: JSON.stringify({ deleteFile: deleteMode === 'video' })
          });
          invalidateDatabaseSummary();
          showToast(
            deleteMode === 'video'
              ? 'Video deleted'
              : 'Metadata deleted. Scan Library to import this file again as a new video.'
          );
          renderRoute();
        } catch (error) {
          showToast(error.message, true);
        }
      });
    });
  } catch (error) {
    if (token !== currentRenderToken) return;
    mainEl.innerHTML = `<div class="warning error">${escapeHtml(error.message)}</div>`;
  }
}

function updateNavActive() {
  const activeByRoute = {
    library: 'navLibrary',
    tag: 'navTags',
    tags: 'navTags',
    starring: 'navStarrings',
    starrings: 'navStarrings'
  };
  const activeId = activeByRoute[state.route?.name];
  ['navLibrary', 'navTags', 'navStarrings'].forEach((id) => {
    document.getElementById(id)?.classList.toggle('is-active', id === activeId);
  });
}

async function renderRoute() {
  currentRenderToken += 1;
  cleanupActiveView();
  state.route = parseHash();
  updateNavActive();

  if (!state.settings) {
    try {
      await loadSettings();
    } catch (error) {
      mainEl.innerHTML = `<div class="warning error">${escapeHtml(error.message)}</div>`;
      return;
    }
  }

  if (state.settings.libraryRoot && shouldMonitorLibraryScanStatus()) {
    await refreshLibraryScanStatus({ silent: true });
    scheduleLibraryScanStatusPolling();
  } else {
    stopLibraryScanStatusPolling();
  }

  if (!state.settings.libraryRoot && !['starrings', 'tags', 'database'].includes(state.route.name)) {
    renderNoLibraryConfigured();
    return;
  }

  if (state.route.name === 'video') {
    if (!Number.isInteger(state.route.id) || state.route.id <= 0) {
      mainEl.innerHTML = '<div class="warning error">Invalid video id.</div>';
      return;
    }

    await renderVideoView(state.route.id);
    return;
  }

  if (state.route.name === 'starrings') {
    await renderStarringsView();
    return;
  }

  if (state.route.name === 'tags') {
    await renderTagsView();
    return;
  }

  if (state.route.name === 'database') {
    await renderDatabaseView();
    return;
  }

  if (state.route.name === 'tag') {
    state.page = 1;
    await renderLibraryView({ lockTag: state.route.value });
    return;
  }

  if (state.route.name === 'starring') {
    state.page = 1;
    // Entering a different starring starts fresh; staying on the same one keeps
    // any in-page tag filter so the tag scroller works within a starring view.
    if (state.filters.starring !== state.route.value) {
      state.filters.tag = '';
    }
    await renderLibraryView({ lockStarring: state.route.value });
    return;
  }

  state.filters.starring = '';
  await renderLibraryView();
}

function setupGlobalEvents() {
  let libraryResizeTimer = null;

  const goLibraryHome = ({ reseedRandom = false } = {}) => {
    state.page = 1;
    state.filters.q = '';
    state.filters.tag = '';
    state.filters.starring = '';
    if (reseedRandom) {
      refreshLibraryRandomSeed();
    }
    setHash('#/library');
  };

  document.getElementById('goLibrary').addEventListener('click', () => goLibraryHome({ reseedRandom: true }));
  document.getElementById('navLibrary').addEventListener('click', () => goLibraryHome());
  document.getElementById('navTags').addEventListener('click', () => setHash('#/tags'));
  document.getElementById('navStarrings').addEventListener('click', () => setHash('#/starrings'));
  document.getElementById('navDatabase').addEventListener('click', () => setHash('#/database'));

  document.getElementById('openSettings').addEventListener('click', async () => {
    if (!state.settings) {
      await loadSettings();
    }
    updateSettingsDialogInputs();
    settingsDialog.showModal();
  });

  closeSettingsBtn.addEventListener('click', () => {
    hideScanPreview();
    settingsDialog.close();
  });

  browseLibraryRootBtn.addEventListener('click', async () => {
    await browseForLibraryRoot();
  });

  const autosaveSettingsHandler = async () => {
    try {
      await autosaveSettingsAndRefresh();
    } catch (error) {
      showToast(error.message, true);
      updateSettingsDialogInputs();
    }
  };

  skipSecondsInput.addEventListener('change', autosaveSettingsHandler);
  libraryRowsInput.addEventListener('change', autosaveSettingsHandler);
  controlsHideMsInput.addEventListener('change', autosaveSettingsHandler);
  libraryRootInput.addEventListener('change', autosaveSettingsHandler);
  libraryRootInput.addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    await autosaveSettingsHandler();
    libraryRootInput.blur();
  });
  libraryRootInput.addEventListener('input', () => {
    hideScanPreview();
  });

  settingsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
  });

  bindMarkerTimeInput(noteEditTimestampInput, () => noteEditState.getCurrentTime?.() ?? 0);

  noteEditUseCurrentBtn.addEventListener('click', () => {
    const currentTime = Number(noteEditState.getCurrentTime?.() ?? 0);
    noteEditTimestampInput.value = formatMarkerTimeValue(Number.isFinite(currentTime) ? currentTime : 0);
  });

  noteEditCancelBtn.addEventListener('click', () => {
    closeNoteEditDialog();
  });

  noteEditDialog.addEventListener('close', () => {
    resetNoteEditState();
  });

  noteEditForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!noteEditState.noteId) {
      closeNoteEditDialog();
      return;
    }

    const activeNoteVideoId = noteEditState.videoId;
    const timestampSec = parseMarkerTimeValue(noteEditTimestampInput.value);
    const memo = normalizeMarkerLabel(noteEditMemoInput.value);

    if (!Number.isFinite(timestampSec) || timestampSec < 0) {
      showToast('Enter a valid time.', true);
      return;
    }

    try {
      await api(`/api/notes/${noteEditState.noteId}`, {
        method: 'PUT',
        body: JSON.stringify({
          timestampSec,
          memo
        })
      });
      closeNoteEditDialog();
      if (activeVideoView.videoId === activeNoteVideoId && typeof activeVideoView.refreshNotes === 'function') {
        await activeVideoView.refreshNotes();
      } else {
        rerenderPreservingPlayback();
      }
      showToast('Marker updated');
    } catch (error) {
      showToast(error.message, true);
    }
  });

  commentEditRatingEditor.insertAdjacentHTML('afterbegin', createRatingButtonsHtml(null, 'data-comment-edit-rating="1"'));
  syncRatingEditor(commentEditRatingEditor, null);
  bindRatingEditorControls(commentEditRatingEditor, '[data-comment-edit-rating]');

  commentEditCancelBtn.addEventListener('click', () => {
    closeCommentEditDialog();
  });

  deleteConfirmCancelBtn.addEventListener('click', () => {
    settleDeleteConfirm(false);
  });

  deleteConfirmMetadataBtn.addEventListener('click', () => {
    settleDeleteConfirm('metadata');
  });

  deleteConfirmProceedBtn.addEventListener('click', () => {
    settleDeleteConfirm('video');
  });

  deleteConfirmDialog.addEventListener('close', () => {
    if (typeof deleteConfirmState.resolve === 'function') {
      const resolve = deleteConfirmState.resolve;
      deleteConfirmState.resolve = null;
      resolve(false);
    }
  });

  commentEditDialog.addEventListener('close', () => {
    resetCommentEditState();
  });

  commentEditForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!commentEditState.commentId) {
      closeCommentEditDialog();
      return;
    }

    const content = commentEditContentInput.value.trim();
    const rating = normalizeOptionalRating(commentEditRatingInput.value);

    if (!content && rating === null) {
      showToast('Write a review or choose a rating.', true);
      return;
    }

    try {
      await api(`/api/comments/${commentEditState.commentId}`, {
        method: 'PUT',
        body: JSON.stringify({
          content,
          rating
        })
      });
      closeCommentEditDialog();
      showToast('Review updated');
      rerenderPreservingPlayback();
    } catch (error) {
      showToast(error.message, true);
    }
  });

  const runLibraryScan = async (root) => {
    const finalRoot = String(root || '').trim();
    if (!finalRoot) {
      showToast('Please enter Library Folder Path.', true);
      return;
    }

    applyLibraryScanStatus({
      inProgress: true,
      scannedCount: 0,
      totalCount: null
    });
    scheduleLibraryScanStatusPolling(200);

    try {
      const scanResult = await api('/api/library/scan', {
        method: 'POST',
        body: JSON.stringify({ libraryRoot: finalRoot })
      });
      await loadSettings();
      updateSettingsDialogInputs();
      hideScanPreview();
      const summaryParts = [
        `${Number(scanResult.addedCount || 0)} added`,
        `${Number(scanResult.missingCount ?? scanResult.deletedCount ?? 0)} marked missing`
      ];
      if (Number(scanResult.autoThumbnailsCreated || 0) > 0) {
        summaryParts.push(`${Number(scanResult.autoThumbnailsCreated || 0)} thumbnails auto-assigned`);
      }
      applyLibraryScanStatus({
        inProgress: false,
        scannedCount: scanResult.scannedCount,
        totalCount: scanResult.scannedCount
      });
      showToast(`Library scan complete (${summaryParts.join(' / ')})`);
      renderRoute();
    } catch (error) {
      showToast(error.message, true);
    } finally {
      await refreshLibraryScanStatus({ silent: true });
      scheduleLibraryScanStatusPolling();
      syncLibraryScanControls();
    }
  };

  scanNowBtn.addEventListener('click', async () => {
    const root = libraryRootInput.value.trim();
    if (!root) {
      showToast('Please enter Library Folder Path.', true);
      return;
    }

    try {
      state.libraryScanCheckInProgress = true;
      syncLibraryScanControls();
      const preview = await api('/api/library/scan/preview', {
        method: 'POST',
        body: JSON.stringify({ libraryRoot: root })
      });

      const addedCount = Number(preview.addedCount || 0);
      const missingCount = Number(preview.missingCount ?? preview.deletedCount ?? 0);
      const missingThumbnailCount = Number(preview.missingThumbnailCount || 0);

      if (addedCount === 0 && missingCount === 0 && missingThumbnailCount === 0) {
        hideScanPreview();
        scanStatusText.textContent = 'No library or thumbnail changes detected';
        scanStatusText.hidden = false;
        return;
      }

      showScanPreview(addedCount, missingCount, missingThumbnailCount, root);
    } catch (error) {
      showToast(error.message, true);
    } finally {
      state.libraryScanCheckInProgress = false;
      syncLibraryScanControls();
    }
  });

  scanProceedBtn.addEventListener('click', async () => {
    const root = state.pendingScanRoot || libraryRootInput.value.trim();
    hideScanPreview();
    await runLibraryScan(root);
  });

  scanCancelBtn.addEventListener('click', () => {
    hideScanPreview();
  });

  window.addEventListener('resize', () => {
    if (libraryResizeTimer) {
      clearTimeout(libraryResizeTimer);
    }

    libraryResizeTimer = setTimeout(() => {
      if (state.route?.name === 'video') {
        return;
      }

      if (!['library', 'tag', 'starring'].includes(state.route?.name)) {
        return;
      }

      const videoGrid = document.getElementById('videoGrid');
      if (!videoGrid) {
        return;
      }

      const nextColumns = getGridColumnCount(videoGrid, 208);
      const nextPageSize = getEffectiveLibraryPageSize(videoGrid);

      if (nextColumns !== state.layout.libraryColumns || nextPageSize !== state.layout.libraryPageSize) {
        currentRenderToken += 1;
        cleanupActiveView();

        if (state.route?.name === 'tag') {
          renderLibraryView({ lockTag: state.route.value });
          return;
        }

        if (state.route?.name === 'starring') {
          renderLibraryView({ lockStarring: state.route.value });
          return;
        }

        renderLibraryView();
      }
    }, 120);
  });

  window.addEventListener('hashchange', () => {
    renderRoute();
  });
}

async function boot() {
  setupGlobalEvents();
  await loadSettings();

  if (!window.location.hash) {
    window.location.hash = '#/library';
  }

  await renderRoute();
}

boot().catch((error) => {
  mainEl.innerHTML = `<div class="warning error">${escapeHtml(error.message)}</div>`;
});
