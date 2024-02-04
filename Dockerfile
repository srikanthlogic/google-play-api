# Use the official Node.js image as base
FROM node:18-alpine AS base

# Set metadata labels
LABEL maintainer="Srikanth <srikanth@cashlessconsumer.in>" \
      version="1.5.0" \
      description="Docker image for running Google Play API"

# Create and set the working directory
WORKDIR /app

FROM base as build

# Copy only the package.json and package-lock.json first to leverage Docker caching
COPY --link package-lock.json package.json ./

RUN npm install -g npm@10.3.0

# Install dependencies
RUN npm install

COPY --link . .

RUN npm run generateoas

RUN npm prune

FROM base
# Copy the rest of the application code
COPY --from=build /app /app

# Expose port 3000
EXPOSE 3000

# Set the user to 'node' and run the application using npm start
USER node
CMD [ "npm", "start" ]
