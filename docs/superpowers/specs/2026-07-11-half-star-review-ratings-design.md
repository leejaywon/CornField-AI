# Half-star review ratings

Date: 2026-07-11  
Status: Approved for planning

## Goal

Let reviews use half-star ratings (`0`, `0.5`, `1`, … `5`) with a left-to-right yellow fill that snaps to 0.5 on hover. Remove redundant `x/5` text from saved review cards (stars already show the score).

## Decisions

| Topic | Choice |
| --- | --- |
| Editor label (`No rating` / `x/5`) | Keep |
| Review list `x/5` text | Remove |
| Hover fill | Snap to 0.5 steps (not continuous) |
| Saved review display | Half-filled stars |
| Video card / header average (`★ 4.5`) | Unchanged (out of scope) |
| Implementation approach | CSS fill track + store `REAL` ratings |

## Behavior

### Rating editor (new review + edit)

- Keep **No rating** and **0** buttons.
- Replace per-star click buttons with a single **5-star track**.
- On `mousemove` over the track: compute rating from pointer X, snap to `{0.5, 1, 1.5, …, 5}`, preview yellow fill from the left (including half of a star).
- On `click`: commit that snapped value; update hidden input and label (`2.5/5`, etc.).
- On `mouseleave`: restore fill to the committed value (or empty if unrated).
- Track hover never produces `0`; use the **0** button for a zero rating. **No rating** clears the rating.

### Saved review cards

- Render the same half-star fill for the stored value.
- Do **not** show `5/5` / `x/5` next to the stars.
- Timestamp and Edit / Delete unchanged.

### Out of scope

- Changing average-rating presentation on library cards / video header beyond what `AVG` already returns.
- Touch-specific UX beyond click on the track (click uses the same X→0.5 mapping as hover).

## Data & API

### Schema

- `comments.rating`: change from integer-only expectation to **REAL** (SQLite affinity), allowing fractional values.
- Existing integer ratings remain valid.
- Follow the project’s existing `db.js` migration style (detect/alter as needed).

### Validation (`parseRating` in `src/server.js`)

- Accept empty / null when the client means “no rating” (existing create/update rules unchanged: need comment text and/or a rating).
- When a rating is present: `Number(value)` must be finite, `0 ≤ value ≤ 5`, and equal to `k / 2` for integer `k` in `0…10` (compare via `Math.round(value * 2)` to avoid float noise).
- Reject others with `400` and message: `rating must be a multiple of 0.5 between 0 and 5.`

### Aggregation

- Keep `AVG(rating)` / `rating_count` as today; half-star values participate naturally.

## Frontend structure

### Files

- `public/app.js` — rating normalize/snap helpers, track pointer mapping, editor wiring, review display HTML
- `public/styles.css` — track + fill styles for half stars (editor + static display)
- `src/server.js` — `parseRating` + error copy
- `src/db.js` — rating column affinity / migration

### Helpers (conceptual)

- `normalizeOptionalRating` / clamp: allow 0.5 steps (or `null` for unrated).
- `ratingFromPointer(clientX, trackEl)` → snapped `0.5…5`.
- Shared star-fill renderer used by editor preview/commit and review list display.

### CSS

- Prefer one fill overlay (width % or gradient) over ten hit-target buttons.
- Reuse existing yellow accent used by active stars.

## Error handling

- Invalid rating from API → existing toast / error path.
- Unrated + empty comment → existing “Enter a review or choose a rating” rule unchanged.

## Testing (manual)

1. New review: hover shows 0.5 steps; click 2.5; label `2.5/5`; submit; card shows half-filled stars, no `2.5/5` text.
2. **0** and **No rating** still work.
3. Edit review: change 4 → 3.5; save; display updates.
4. Existing integer reviews still display correctly.
5. Reject (via API or crafted request) values like `1.2`.
6. Video average still updates when half-star reviews exist.

## Non-goals

- Redesigning the Reviews section layout.
- Removing editor labels.
- Continuous (non-snapped) hover fill.
