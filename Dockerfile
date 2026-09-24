# ── CloudPilot AI — Hardened Production Dockerfile ──────────────────────────
# Multi-stage build: builder stage compiles frontend, runtime stage serves app
# Security: non-root user, pinned images, verified Deno install, production CMD

# ══════════════════════════════════════════════════════════════════════════════
# Stage 1: Builder
# ══════════════════════════════════════════════════════════════════════════════
FROM node:22.13.1-slim AS builder

WORKDIR /build

# Install build dependencies and Deno with checksum verification
# Deno 2.1.9 x86_64-unknown-linux-gnu
ENV DENO_VERSION=2.1.9
ENV DENO_CHECKSUM=5b6dea6e87ebca3dbe5f30fefb95e0dc8d7e7e36cd97d56f085ac8c7b7f6edd6

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates unzip && \
    curl -fsSL "https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/deno-x86_64-unknown-linux-gnu.zip" -o deno.zip && \
    echo "${DENO_CHECKSUM}  deno.zip" | sha256sum -c - && \
    unzip deno.zip && \
    mv deno /usr/local/bin/ && \
    rm deno.zip && \
    apt-get remove -y curl unzip && \
    apt-get autoremove -y && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Copy dependency files for layer caching
COPY package.json package-lock.json* deno.json deno.lock* ./

# Install Node.js dependencies (including dev dependencies for build)
RUN npm ci && \
    npm cache clean --force

# Copy application source
COPY . .

# Build frontend for production
RUN npm run build

# ══════════════════════════════════════════════════════════════════════════════
# Stage 2: Runtime
# ══════════════════════════════════════════════════════════════════════════════
FROM node:22.13.1-slim

# Install runtime dependencies and Deno with checksum verification
ENV DENO_VERSION=2.1.9
ENV DENO_CHECKSUM=5b6dea6e87ebca3dbe5f30fefb95e0dc8d7e7e36cd97d56f085ac8c7b7f6edd6

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates unzip && \
    curl -fsSL "https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/deno-x86_64-unknown-linux-gnu.zip" -o deno.zip && \
    echo "${DENO_CHECKSUM}  deno.zip" | sha256sum -c - && \
    unzip deno.zip && \
    mv deno /usr/local/bin/ && \
    rm deno.zip && \
    apt-get remove -y curl unzip && \
    apt-get autoremove -y && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r cloudpilot --gid=1001 && \
    useradd -r -g cloudpilot --uid=1001 --home-dir=/app --shell=/bin/bash cloudpilot

WORKDIR /app

# Copy built artifacts and dependencies from builder
COPY --from=builder --chown=cloudpilot:cloudpilot /build/node_modules ./node_modules
COPY --from=builder --chown=cloudpilot:cloudpilot /build/dist ./dist
COPY --from=builder --chown=cloudpilot:cloudpilot /build/package.json ./
COPY --chown=cloudpilot:cloudpilot local-server.ts deno.json deno.lock* vite.config.* ./
COPY --chown=cloudpilot:cloudpilot supabase ./supabase

# Create data directory for SQLite with proper permissions
RUN mkdir -p /app/data && chown cloudpilot:cloudpilot /app/data

# Set Deno cache directory for non-root user
ENV DENO_DIR=/app/.deno
ENV PATH="${DENO_DIR}/bin:${PATH}"

# Switch to non-root user
USER cloudpilot

# Expose frontend (Vite) and backend (Deno gateway) ports
EXPOSE 8080 54321

# Volume mount point for SQLite persistence
VOLUME ["/app/data"]

# Health check on frontend port
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD ["/usr/local/bin/node", "-e", "require('http').get('http://localhost:8080', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"]

# Production command: serve built frontend with vite preview and run Deno backend
CMD ["npm", "start"]
