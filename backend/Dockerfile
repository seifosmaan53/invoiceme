# Multi-stage Dockerfile for InvoiceMe Backend
#
# PDF generation uses Puppeteer with Alpine's own Chromium (installed in the
# production stage). Puppeteer's postinstall download is skipped in every
# build stage: it fetches a glibc Chrome-for-Testing build that cannot run on
# Alpine/musl, it lands in /root/.cache (never copied into the final image),
# and its HTTP client has no timeout, so a slow download host stalls the build.

# Stage 1: Production Dependencies
FROM node:20-alpine AS deps
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package*.json ./
RUN npm ci --omit=dev

# Stage 2: Dev Dependencies (for building)
FROM node:20-alpine AS deps-dev
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package*.json ./
RUN npm ci

# Stage 3: Build
FROM deps-dev AS builder
WORKDIR /app
COPY src/ ./src/
COPY tsconfig.json ./
COPY nest-cli.json ./
RUN npm run build

# Stage 4: Production
FROM node:20-alpine AS production
WORKDIR /app

# curl for health checks; Chromium plus the libraries and fonts it needs to
# render invoice PDFs
RUN apk add --no-cache \
      curl \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      font-freefont

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy production dependencies
COPY --from=deps --chown=nodejs:nodejs /app/node_modules ./node_modules

# Copy built application
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist

# Copy package.json for metadata
COPY --chown=nodejs:nodejs package.json ./

# Strict health check: HTTP 200 + status ok + database connected; redirects fail
COPY --chown=nodejs:nodejs healthcheck.js ./

# Set environment variables
# Both PdfService and PdfCacheService launch the browser at this path.
ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD ["node", "healthcheck.js"]

# Labels for metadata
LABEL version="1.0.0" \
      description="InvoiceMe backend API" \
      maintainer="InvoiceMe Team"

# Start application
CMD ["node", "dist/main.js"]

