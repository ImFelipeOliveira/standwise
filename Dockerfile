ARG APP=api

FROM oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d AS deps
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d
ARG APP
ENV NODE_ENV=production
ENV PORT=3000
ENV STANDWISE_APP=${APP}
WORKDIR /app
COPY --from=deps --chown=bun:bun /app /app
USER bun
EXPOSE 3000
CMD ["sh", "-c", "case \"$STANDWISE_APP\" in api) bun run db:migrate && exec bun run apps/api/src/main.ts ;; worker) exec bun run apps/worker/src/main.ts ;; *) echo \"APP must be api or worker\" >&2; exit 1 ;; esac"]
