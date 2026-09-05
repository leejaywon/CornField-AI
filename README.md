# CornField

CornField is a video player app for your personal libraries.
While CornField keeps your original files on disk untouched, it stores app data locally, and gives you a fast browser UI for browsing, tagging, rating, and watching your own video.

No sample media is bundled in this repository. You point CornField at your own video folder on first use.

## Run on your computer

1. Get the code:

```bash
git clone <repo-url>
cd CornField
```

2. Start it:
   - macOS: double-click `openCornField.command` (if the first launch is blocked, allow it in `System Settings > Privacy & Security > Open Anyway`)
   - Windows: double-click `openCornField.cmd`
   - Any OS (manual): `npm install && npm run dev`

   The desktop launchers open the Node.js download page if Node is missing, install dependencies on first run, start the server, and open your browser.

3. Open [http://localhost:4300](http://localhost:4300), then follow [First-Time Setup](#first-time-setup).

Your database and thumbnails are stored in the project's `data/` folder.

## First-Time Setup

Once CornField is open in your browser:

1. Open `Settings`.
2. Set `Library Folder Path` to your videos folder.
3. Click `Scan Library`.

## Scan Behavior

When you click `Scan Library`, CornField:

- Adds new videos it finds in your library folder
- Removes videos whose files you have deleted
- Creates a thumbnail automatically for each new video

## Features

- Browse, search, and play your videos in the browser
- Organize with titles, descriptions, categories, tags, and starring
- Rate videos, leave comments, and add jump markers("corns") at specific moments
- See related videos based on shared tags and categories
- Automatic thumbnails, or upload/capture your own
- Hover the seek bar to preview scenes, plus keyboard shortcuts for playback

## Technical Notes

### Local Data

- Your media files stay in their original folders and are not copied by default.
- App data is stored in `data/videoplayer.db`.
- Generated or uploaded thumbnails are stored in `data/thumbnails/`.
- Seek-bar hover previews are cached in `data/timeline-previews/` on demand.
- `data/` is gitignored so your personal library state does not get committed to GitHub.
- Keep the project and its `data/` folder on your computer’s local disk. The database uses SQLite WAL mode, which does not support network filesystems.

### Tech Stack

- Backend: Node.js + Fastify
- Database: SQLite (`better-sqlite3`)
- Frontend: Vanilla HTML/CSS/JavaScript
- Media probing: `ffprobe` (bundled `ffprobe-static`, or system `ffprobe` when available)
- Thumbnail extraction for auto-capture: `ffmpeg` when available

### Project Structure

- `src/server.js`: Fastify API, streaming, file operations
- `src/db.js`: SQLite schema, settings, relation helpers
- `src/media-indexer.js`: folder scan, probe, sync, auto-thumbnail logic
- `openCornField.command` / `openCornField.cmd`: macOS / Windows launchers (run on your computer)
- `public/index.html`: app shell
- `public/app.js`: UI behavior and API integration
- `public/styles.css`: dark theme styling

### API Overview

- `GET /api/settings`, `PUT /api/settings`
- `POST /api/library/scan/preview`, `POST /api/library/scan`
- `GET /api/videos`, `GET /api/videos/admin`, `GET /api/videos/:id`
- `PUT /api/videos/:id/metadata`
- `POST /api/videos/:id/rename`
- `DELETE /api/videos/:id`
- `POST /api/videos/:id/view`
- `GET|POST /api/videos/:id/comments`, `PUT|DELETE /api/comments/:id`
- `GET|POST /api/videos/:id/notes`, `PUT|DELETE /api/notes/:id`
- `POST /api/videos/:id/thumbnail/upload`
- `POST /api/videos/:id/thumbnail/capture`
- `GET /api/videos/:id/previews`
- `GET /api/videos/:id/related`
- `GET /api/tags`, `GET /api/starrings`
- `GET /media/*` (video streaming)
