FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y \
  ffmpeg \
  imagemagick \
  webp \
  fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps against the lockfile for reproducible builds.
COPY package.json package-lock.json* ./
RUN npm ci --legacy-peer-deps || npm install --legacy-peer-deps

# Build BEFORE copying sources that change often, so the dep/build layers cache.
COPY tsconfig.json ./
COPY src ./src
COPY public ./public

# Fail the image build if TypeScript breaks (previously masked by `|| true`,
# which shipped images that crashed at runtime with "dist/main.js not found").
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000

# NOTE: we intentionally stay root here. Render mounts the session Disk at
# SESSION_DIR (e.g. /data/auth_info_baileys) owned by root and does not chown
# it at runtime; a non-root USER cannot write there, so the WhatsApp session
# would be lost on every deploy and force a re-pair. The process binds no
# privileged ports (default 3000), and isolation here is provided by the
# container itself.

EXPOSE 3000

CMD ["node", "dist/main.js"]
