# Multi-stage Dockerfile for InvoiceMe Backend
# Stage 1: Production Dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

# Stage 2: Dev Dependencies (for building)
FROM node:20-alpine AS deps-dev
WORKDIR /app
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

# Install curl for health checks
RUN apk add --no-cache curl

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy production dependencies
COPY --from=deps --chown=nodejs:nodejs /app/node_modules ./node_modules

# Copy built application
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist

# Copy package.json for metadata
COPY --chown=nodejs:nodejs package.json ./

# Set environment variables
ENV NODE_ENV=production

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# Labels for metadata
LABEL version="1.0.0" \
      description="InvoiceMe backend API" \
      maintainer="InvoiceMe Team"

# Start application
CMD ["node", "dist/main.js"]

