# Build the static files
FROM node:24 AS build
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# Serve the static files
FROM nginx:mainline-alpine-slim AS runtime
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
