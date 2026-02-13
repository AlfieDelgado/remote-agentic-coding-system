FROM ubuntu:24.04


# Prevent interactive prompts during installation
ENV DEBIAN_FRONTEND=noninteractive

WORKDIR /app

# Install all system dependencies, Python, Node.js, and GitHub CLI in one layer
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl \
        git \
        bash \
        ca-certificates \
        gnupg \
        postgresql-client \
        software-properties-common \
    && add-apt-repository ppa:deadsnakes/ppa \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        python3.13 \
        python3-pip \
        python3.13-venv \
    && ln -sf /usr/bin/python3.13 /usr/local/bin/python \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update \
    && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for running Claude Code
# Claude Code refuses to run with --dangerously-skip-permissions as root for security
RUN useradd -m -u 1001 -s /bin/bash appuser \
    && mkdir -p /workspace \
    && chown -R appuser:appuser /app /workspace

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including devDependencies for build)
RUN npm ci

# Copy application code
COPY . .

# Build TypeScript
RUN npm run build

# Remove devDependencies to reduce image size
RUN npm prune --production

# Fix permissions for appuser
RUN chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Create .codex directory for Codex authentication
RUN mkdir -p /home/appuser/.codex

# Configure git to trust /workspace directory
# This prevents "fatal: detected dubious ownership" errors when git operations
# are performed in mounted volumes or repos cloned by different users
RUN git config --global --add safe.directory /workspace && \
    git config --global --add safe.directory '/workspace/*'

# Add local bin to PATH
ENV PATH="${PATH}:/home/appuser/.codex/bin:/home/appuser/.local/bin"

# Expose port
EXPOSE 3000

# Setup Codex authentication from environment variables, then start app
CMD ["sh", "-c", "npm run setup-auth && npm start"]
