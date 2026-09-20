FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
COPY scripts/build.mjs ./scripts/build.mjs
RUN npm run build

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache su-exec curl && mkdir -p /data
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node public/demo ./public/demo
# Keep /demo video available on redeploy until the ~8MB mp4 is committed to git.
# Fetch from the live host while the previous machine still serves it.
RUN curl -fsSL -o public/demo/golf-chatgpt-submission.mp4 \
      https://mcp.golfintelligence.com/demo/golf-chatgpt-submission.mp4 \
  && chown node:node public/demo/golf-chatgpt-submission.mp4 \
  && apk del curl

EXPOSE 3000
CMD ["sh", "-c", "chown node:node /data && exec su-exec node node dist/http.js"]
