const normalize = (value) => String(value || '').normalize('NFKC').trim().toLowerCase();
const values = (csv) => new Set(String(csv || '').split(',').map(normalize).filter(Boolean));
const words = (title) => new Set((normalize(title).match(/[\p{L}\p{N}]+/gu) || []).filter((word) => word.length > 2 && !/^\d+$/.test(word) && !['mp4', 'mkv', 'mov', '1080p', '720p', '2160p'].includes(word)));

// Weighted Jaccard avoids rewarding metadata stuffing; rare attributes carry more evidence.
function overlap(a, b, frequencies, count) {
  let shared = 0;
  let total = 0;
  for (const key of new Set([...a, ...b])) {
    const weight = 1 + Math.log(1 + count / (1 + (frequencies.get(key) || 0)));
    total += weight;
    if (a.has(key) && b.has(key)) shared += weight;
  }
  return total ? shared / total : 0;
}

export function rankRelatedVideos(source, candidates, limit = 12, now = Date.now(), seed = null) {
  const requested = Number(limit);
  const size = Number.isFinite(requested) ? Math.max(1, Math.min(48, Math.floor(requested))) : 12;
  const seen = new Set([source.id]);
  const rows = candidates.filter((row) => {
    if (seen.has(row.id) || row.is_missing || String(row.file_name || '').startsWith('._')) return false;
    seen.add(row.id);
    return true;
  });
  const features = (row) => ({ row, tags: values(row.tags_csv), cast: values(row.starrings_csv), title: words(row.display_title || row.file_name), category: normalize(row.category) });
  const origin = features(source);
  const pool = rows.map(features);
  const frequency = { tags: new Map(), cast: new Map(), title: new Map() };
  for (const item of [origin, ...pool]) {
    for (const key of Object.keys(frequency)) {
      for (const term of item[key]) frequency[key].set(term, (frequency[key].get(term) || 0) + 1);
    }
  }
  const corpusSize = pool.length + 1;
  const similarity = (a, b) =>
    0.42 * overlap(a.tags, b.tags, frequency.tags, corpusSize) +
    0.32 * overlap(a.cast, b.cast, frequency.cast, corpusSize) +
    0.18 * overlap(a.title, b.title, frequency.title, corpusSize) +
    0.08 * Number(Boolean(a.category) && a.category === b.category);
  for (const item of pool) {
    const row = item.row;
    const count = Math.max(0, Number(row.rating_count) || 0);
    const rating = Math.max(0, Math.min(5, Number(row.average_rating) || 0));
    const ratingSignal = count ? (rating - 3) / 2 * count / (count + 3) : 0;
    const ageDays = Math.max(0, (now - Date.parse(row.last_watched_at)) / 86400000);
    const recentPenalty = Number.isFinite(ageDays) ? 0.06 * Math.exp(-ageDays / 7) : 0;
    item.score = similarity(origin, item) + 0.06 * ratingSignal +
      (Number(row.view_count || 0) === 0 ? 0.015 : 0) - recentPenalty;
  }
  const picks = [];
  while (pool.length && picks.length < size) {
    let best = 0;
    let bestScore = -Infinity;
    pool.forEach((item, index) => {
      const redundancy = picks.reduce((max, pick) => Math.max(max, similarity(item, pick)), 0);
      let score = item.score - 0.12 * redundancy;
      if (seed !== null) {
        const uniform = seededUniform(`${seed}:${source.id}:${picks.length}:${item.row.id}`);
        // Small, bounded variation shuffles close matches without overwhelming relevance.
        score += 0.08 * (uniform - 0.5);
      }
      if (score > bestScore || (score === bestScore && item.row.id < pool[best].row.id)) {
        best = index;
        bestScore = score;
      }
    });
    picks.push(pool.splice(best, 1)[0]);
  }
  return picks.map(({ row }) => row);
}

// Stable per candidate/slot, so a resize extends the same shuffled sequence.
function seededUniform(key) {
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return ((hash >>> 0) + 0.5) / 4294967296;
}
