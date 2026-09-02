FROM oven/bun:1.3.14-alpine AS build

WORKDIR /app

# vue-tsc currently requires the Node runtime to resolve .vue modules correctly.
RUN apk add --no-cache nodejs

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build-only && node node_modules/vue-tsc/bin/vue-tsc.js --build

FROM oven/bun:1.3.14-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/dist ./dist
COPY --from=build /app/server.ts /app/lan.ts /app/room-session.ts ./

EXPOSE 8080
USER bun
CMD ["bun", "run", "server.ts"]
