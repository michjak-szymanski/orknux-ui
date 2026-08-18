# The front end as something you can run.
#
# Two stages: node builds the bundle, nginx serves it. Nothing from the build
# stage reaches the final image except `dist`, so the toolchain, the sources and
# the dependency tree are not shipped to anybody.
FROM node:22-bookworm-slim AS build

WORKDIR /app

# The lockfile first, on its own layer: dependencies change far less often than
# the code, so a source edit does not reinstall them.
COPY package.json package-lock.json ./
RUN npm ci --no-fund --no-audit

COPY . .
RUN npm run build

# ---------------------------------------------------------------------------

# The unprivileged variant. The ordinary nginx image cannot run as a user: it
# opens /run/nginx.pid at startup, which only root may write, and it dies there.
# This one is built for it — uid 101, and a port a user is allowed to bind.
FROM nginxinc/nginx-unprivileged:1.27-alpine

# Where this image sends /api, /graphql and /mcp. The bundle calls them on its
# own origin — that is what keeps the session cookie first-party — so something
# has to forward them, and in development that something is vite's proxy.
ENV ORKNUX_SERVER_URL=http://orknux-server:8080

# nginx's own entrypoint runs envsubst over anything in templates/ before it
# starts, which is how the address above reaches the configuration without
# baking it into the image.
COPY docker/default.conf.template /etc/nginx/templates/default.conf.template
COPY docker/proxy.conf /etc/nginx/orknux-proxy.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
    CMD wget -qO- http://localhost:8080/ >/dev/null || exit 1
