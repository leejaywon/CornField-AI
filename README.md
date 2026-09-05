# CornField

A browser video player for your own library. Browse, organize, rate, and watch videos from a local folder, external drive, or mounted NAS share.

## Get started

1. Download and extract this repository, or clone it.
2. Open the launcher for your computer:
   - **macOS:** double-click `openCornField.command`.
   - **Windows:** double-click `openCornField.cmd`.
3. When CornField opens in your browser, go to **Settings**, choose your **Library Folder Path**, and click **Scan Library**.

The launcher installs dependencies on the first run. If Node.js is missing, it opens the download page; install Node.js and run the launcher again. On macOS, if the launcher is blocked, allow it in **System Settings → Privacy & Security → Open Anyway**.

You can also open CornField at [localhost:4300](http://localhost:4300). Keep its terminal window open while using it.

## Using CornField

- **Find a video:** search your library, filter by quality or tags, and choose a sort order.
- **Watch:** click a video. Hover over the seek bar for a preview, or switch to theater or fullscreen mode.
- **Organize:** edit titles, tags, and starring; add ratings and comments.
- **Mark a moment:** use **Add Marker** to save a timestamp with a note.
- **Refresh your library:** after adding or removing video files, use **Settings → Scan Library** and review the changes.

Your volume, mute, and theater preferences are remembered in your browser. Videos stay in the folder you choose; no sample videos are included.

## Optional: use a NAS or home server

You can run CornField on a compatible NAS or another computer with Docker and open it from other devices. A NAS is not required for the normal setup above.

On the machine that will run CornField:

1. Download this repository and copy `.env.example` to `.env`.
2. In `.env`, set `CORNFIELD_LIBRARY_PATH` to your video folder. To connect from other devices, set `CORNFIELD_BIND_ADDRESS` to that machine's local network IP address.
3. From the repository folder, run:

```bash
docker compose up -d --build
```

4. Open `http://<server-ip>:4300`, then set **Library Folder Path** to `/library` and click **Scan Library**.

Everyone connecting to that server uses the same library, tags, ratings, and comments. Use it on a trusted network; CornField has no sign-in. The default Docker setup allows playback and metadata edits but keeps original video files read-only.

To stop, run `docker compose down`. After updating the code, run the start command again. Your app data is kept. QNAP users need a model that supports 64-bit containers in Container Station.

## Technical notes

- **Manual launch:** with Node.js installed, run `npm install` and `npm start` from the repository folder.
- **App data:** stored in `data/`, or a persistent Docker volume when using Compose. Back up this data to keep your library metadata. Keep the database on the server's local storage, even when videos are on a network share. Docker storage options are in `.env.example`.
- **Playback:** videos stream in their original format, so your browser must support their codecs.
- **Stack:** Node.js, Fastify, SQLite, vanilla JavaScript, and FFmpeg/FFprobe. The container targets 64-bit Intel/AMD and ARM hosts.
