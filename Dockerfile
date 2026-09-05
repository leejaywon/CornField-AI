# Optional hosting on a 64-bit Linux NAS or another Docker host.
FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Use system media binaries on both amd64 and arm64. Setting this before npm ci
# also prevents ffmpeg-static from downloading a second binary.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4300 \
    FFMPEG_BIN=/usr/bin/ffmpeg \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public
RUN mkdir -p data/thumbnails data/timeline-previews \
    && chown -R node:node data
USER node
VOLUME ["/app/data"]
EXPOSE 4300
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:4300/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
