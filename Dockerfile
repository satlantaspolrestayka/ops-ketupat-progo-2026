FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source code
COPY scripts/ ./scripts/
COPY data/ ./data/

# Create necessary directories
RUN mkdir -p data/{backups,reports,logs}

# Make scripts executable
RUN chmod +x scripts/*.js

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node scripts/health-check.js

# Default command
CMD ["node", "scripts/validate-parking.js", "--mode=strict"]
