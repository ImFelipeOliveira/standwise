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

FROM oven/bun:1.4.4
ARG APP
ENV NODE_ENV=production
ENV PORT=3000
ENV STANDWISE_APP=${APP}
WORKDIR /app
COPY --from=deps --chown=bun:bun /app /app
COPY --from=docs --chown=bun:bun /app/docs/site/.vitepress/dist /app/docs/site/.vitepress/dist
USER bun
EXPOSE 3000
CMD ["sh", "-c", "case \"$STANDWISE_APP\" in api) bun run db:migrate && exec bun run apps/api/src/main.ts ;; worker) exec bun run apps/worker/src/main.ts ;; *) echo \"APP must be api or worker\" >&2; exit 1 ;; esac"]
