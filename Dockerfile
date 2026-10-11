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

# Drop root privileges for the bot process.
RUN useradd --system --create-home --uid 1001 mtaula \
  && mkdir -p /app/auth_info_baileys \
  && chown -R mtaula:mtaula /app
USER mtaula

EXPOSE 3000

CMD ["node", "dist/main.js"]
