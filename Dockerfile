# syntax=docker/dockerfile:1
#
# Harmony web client — build the Angular app, then serve the static bundle with
# nginx. The app calls the API with same-origin relative paths (/api, /hubs);
# nginx (see nginx.conf) reverse-proxies those to the `api` container. The bundle
# therefore carries no hostname and runs unchanged behind localhost, a tunnel, or
# a real domain. Opened at http://localhost:4200 in the compose stack.

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

# Links the published GHCR package back to this repository. Without it, a package
# pushed from CI is an orphan that the repo's GITHUB_TOKEN has no write access to —
# which fails as `denied: permission_denied: write_package` on the push step.
LABEL org.opencontainers.image.source="https://github.com/MohammadFakih02/harmony-client"
LABEL org.opencontainers.image.description="Harmony web — Angular bundle served by nginx, which also proxies /api and /hubs"

COPY nginx.conf /etc/nginx/conf.d/default.conf
# The Angular application builder emits browser assets under dist/<name>/browser.
COPY --from=build /app/dist/harmony-client/browser /usr/share/nginx/html
EXPOSE 8080
