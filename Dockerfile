ARG APP=api

FROM oven/bun:1.4.4 AS deps
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4.4 AS docs
ARG SUPPORT_EMAIL
WORKDIR /app
COPY --from=node:22-slim /usr/local/bin/node /usr/local/bin/node
COPY . .
RUN bun install --frozen-lockfile
RUN test -n "$SUPPORT_EMAIL" && SUPPORT_EMAIL="$SUPPORT_EMAIL" bun run docs:build

FROM oven/bun:1.4.4 AS runtime-base
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps --chown=bun:bun /app /app

FROM runtime-base AS runtime-api
COPY --from=docs --chown=bun:bun /app/docs/site/.vitepress/dist /app/docs/site/.vitepress/dist
USER bun
ENV PORT=3000
EXPOSE 3000
CMD ["sh", "-c", "bun run db:migrate && exec bun run apps/api/src/main.ts"]

FROM runtime-base AS runtime-worker
USER bun
CMD ["bun", "run", "apps/worker/src/main.ts"]

FROM runtime-${APP}
