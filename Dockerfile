# The arcade server. Pass API keys at run time (--env-file), never at build time.
FROM oven/bun:1.4.2
WORKDIR /app

COPY package.json bun.lock tsconfig.json ./
COPY packages/ai/package.json packages/ai/
COPY packages/arcade/package.json packages/arcade/
RUN bun install --frozen-lockfile --production

COPY packages packages

ENV NODE_ENV=production SYSTEM_ONE_DB=/data/arcade.sqlite PORT=3000
VOLUME /data
EXPOSE 3000
CMD ["bun", "packages/arcade/src/server/index.ts"]
