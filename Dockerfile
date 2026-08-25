# ── CloudPilot AI — Development Dockerfile ──────────────────────────────────
# Runs both the Vite frontend (port 8080) and Deno backend gateway (port 54321)
# inside a single container using `npm run dev` (concurrently).

FROM node:22-slim

# Install Deno
RUN apt-get update && apt-get install -y curl unzip && \
    curl -fsSL https://deno.land/install.sh | sh && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Add Deno to PATH
ENV DENO_DIR=/root/.deno
ENV PATH="${DENO_DIR}/bin:${PATH}"

WORKDIR /app

# Copy dependency files first for layer caching
COPY package.json package-lock.json* deno.json deno.lock* ./

# Install Node.js dependencies
RUN npm install

# Copy the rest of the application
COPY . .

# Expose frontend (Vite) and backend (Deno gateway) ports
EXPOSE 8080 54321

# Create a volume mount point for SQLite persistence
VOLUME ["/app/data"]

# Use an entrypoint script to handle SQLite path and startup
CMD ["npm", "run", "dev"]
