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
USER node
COPY --from=build --chown=node:node /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/http.js"]
