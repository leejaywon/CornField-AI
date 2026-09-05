export function readAudioPreferences(storage, fallback = { volume: 1, muted: false }) {
  const raw = storage.getItem('playerVolume');
  const volume = raw === null || raw.trim() === '' ? NaN : Number(raw);
  const muted = storage.getItem('playerMuted');
  return {
    volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : fallback.volume,
    muted: muted === null ? fallback.muted : muted === '1'
  };
}

export function saveAudioPreferences(storage, media, preferences) {
  preferences.volume = media.volume;
  preferences.muted = media.muted;
  storage.setItem('playerVolume', String(preferences.volume));
  storage.setItem('playerMuted', preferences.muted ? '1' : '0');
}
