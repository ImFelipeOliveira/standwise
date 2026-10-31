ARG APP=api

FROM oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d AS deps
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d AS docs
ARG SUPPORT_EMAIL
ARG STANDWISE_PUBLIC_URL
WORKDIR /app
COPY --from=node:22-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da /usr/local/bin/node /usr/local/bin/node
COPY . .
RUN bun install --frozen-lockfile
RUN test -n "$SUPPORT_EMAIL" && SUPPORT_EMAIL="$SUPPORT_EMAIL" STANDWISE_PUBLIC_URL="$STANDWISE_PUBLIC_URL" bun run docs:build

FROM oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d
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
