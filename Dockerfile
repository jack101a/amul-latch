# ==============================================================================
# Latch Dockerfile — Multi-Stage Build with Playwright Support
# ==============================================================================

FROM node:22-slim AS base
WORKDIR /app

# Install minimal OS dependencies for network & headless browser execution
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

# Install Playwright chromium and system libraries
RUN npx playwright install --with-deps chromium

# Stage 2: Build Application
FROM dependencies AS build
COPY . .
RUN npm run build

# Stage 3: Production Runner
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8082 \
    HOST=0.0.0.0

# Copy cached dependencies & installed Playwright browser
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /root/.cache/ms-playwright /root/.cache/ms-playwright
COPY --from=build /app ./

EXPOSE 8082

# Built-in Node fetch health check (zero extra dependencies)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8082) + '/').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["npm", "run", "dev"]
