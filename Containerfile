FROM debian:bookworm-slim

# Install system dependencies, Python 3, and prerequisites
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    procps \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 22 LTS and npm via official NodeSource repository
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Cloudflare Wrangler CLI globally
RUN npm install -g wrangler@latest

# Set working directory inside container
WORKDIR /app

# Expose ports:
# 8787: Wrangler Dev Server (Worker & D1 SQLite API)
# 5173: Vite Dev Server (Frontend Web Dashboard)
EXPOSE 8787 5173

CMD ["/bin/bash"]
