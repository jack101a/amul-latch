# ==============================================================================
# Latch Dockerfile — Multi-Stage Build
# ==============================================================================

FROM node:22-slim AS base
WORKDIR /app

# Install minimal OS dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    gnupg \
    ca-certificates \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Stage 1: Install Node Dependencies
FROM base AS dependencies
COPY package*.json ./
RUN npm ci

# Stage 2: Build Application
FROM dependencies AS build
COPY . .
RUN npm run build

# Stage 3: Production Runner
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8082 \
    HOST=0.0.0.0 \
    NODE_OPTIONS="--max-old-space-size=48 --expose-gc"

# Copy cached dependencies
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app ./

EXPOSE 8082

CMD ["node", ".output/server/index.mjs"]
