# syntax=docker/dockerfile:1
#
# Harmony web client — build the Angular app, then serve the static bundle with
# nginx. The API base URL is baked in at build time from src/environments/
# environment.ts (http://localhost:5057), so the compose stack maps the API to
# host port 5057 and this app is opened at http://localhost:4200.

# ---- build ----
FROM node:22 AS build
WORKDIR /app

# Install deps from the lockfile first (cached until package*.json change).
COPY package.json package-lock.json ./
RUN npm ci

# Build the production bundle (ng build defaults to the production config).
COPY . .
RUN npm run build

# ---- runtime ----
FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
# The Angular application builder emits browser assets under dist/<name>/browser.
COPY --from=build /app/dist/harmony-client/browser /usr/share/nginx/html
EXPOSE 8080
