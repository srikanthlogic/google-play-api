# =============================================================================
# Google Play API Dockerfile
# =============================================================================
# This Dockerfile implements best practices for security, performance, and maintainability
# Based on Node.js 22 Alpine Linux for minimal image size and security
# =============================================================================

# Use the official Node.js image as base
# Using specific version for reproducibility and security updates
FROM node:22-alpine AS base

# Set metadata labels following OCI specification
LABEL maintainer="Srikanth <srikanth@cashlessconsumer.in>" \
      version="1.6.0" \
      description="Docker image for running Google Play API" \
      org.opencontainers.image.title="Google Play API" \
      org.opencontainers.image.description="Turn Google Play scraper into a RESTful API" \
      org.opencontainers.image.version="1.6.0" \
      org.opencontainers.image.vendor="Cashless Consumer" \
      org.opencontainers.image.licenses="ISC" \
      org.opencontainers.image.source="https://github.com/srikanthlogic/google-play-api.git" \
      org.opencontainers.image.documentation="https://github.com/srikanthlogic/google-play-api/blob/main/README.md"

# Install security updates and required system packages in a single layer
# Using --no-cache to avoid storing package index
RUN apk update && \
    apk upgrade --no-cache && \
    apk add --no-cache \
        dumb-init \
        ca-certificates && \
    rm -rf /var/cache/apk/*

# Create and set the working directory with proper permissions
WORKDIR /app

# Create a non-root user with a dedicated home directory
# Using specific UID/GID for consistency across environments
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# =============================================================================
# Build Stage
# =============================================================================
FROM base AS build

# Set build arguments for version control
ARG BUILD_DATE
ARG VCS_REF

# Add build metadata labels
LABEL org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.revision="${VCS_REF}"

# Copy only the package.json and package-lock.json first to leverage Docker caching
# Using --link for better layer caching with BuildKit
COPY --link package*.json ./

# Update npm to latest version for security and performance
# Clean npm cache to reduce image size
RUN npm install -g npm@latest && \
    npm cache clean --force

# Install dependencies using npm ci for reproducible builds
# npm ci uses package-lock.json for exact versions, improving security and consistency
# Only install production dependencies to reduce attack surface
RUN npm ci --only=production && \
    npm cache clean --force

# Copy the rest of the application code
# Using --link for better layer caching with BuildKit
COPY --link . .

# Generate OpenAPI specification as part of the build process
RUN npm run generateoas

# Remove development dependencies to reduce final image size
RUN npm prune --production

# =============================================================================
# Final Runtime Stage
# =============================================================================
FROM base AS runtime

# Set runtime arguments
ARG NODE_ENV=production

# Set environment variables for Node.js
ENV NODE_ENV=${NODE_ENV} \
    PORT=3000 \
    # Use dumb-init as PID 1 for proper signal handling
    # This prevents zombie processes and ensures graceful shutdown
    ENTRYPOINT=dumb-init

# Copy application from build stage with proper ownership
COPY --from=build --chown=nodejs:nodejs /app /app

# Change to the application directory
WORKDIR /app

# Switch to non-root user for security
USER nodejs

# Expose port 3000
EXPOSE 3000

# Add health check for container monitoring
# Uses curl to check if the application is responding
# The application should respond with HTTP 200 on the root endpoint
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Set the default command to start the application
# Using node directly instead of npm start to reduce overhead
CMD ["node", "server.js"]