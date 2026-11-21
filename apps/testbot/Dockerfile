# Chat test bot (testing.md › Chat test bot, #109). Staging only. Build context: repo root.
FROM node:22-slim AS build
WORKDIR /src/apps/testbot
COPY apps/testbot/package.json apps/testbot/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY apps/testbot/ ./
# The app's own MLS code is bundled in (same wire format as the app).
COPY apps/mobile/src/chat/mls.ts apps/mobile/src/chat/bytes.ts /src/apps/mobile/src/chat/
RUN node build.mjs

FROM node:22-slim
WORKDIR /app
COPY --from=build /src/apps/testbot/dist/bot.mjs /src/apps/testbot/dist/bot.mjs.map ./
ENV BOT_DATA_DIR=/data NODE_ENV=production
CMD ["node", "--enable-source-maps", "bot.mjs"]
