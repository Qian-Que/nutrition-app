FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build && npm prune --omit=dev

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=4000
ENV SQLITE_PATH=/app/data/nutrition.db

EXPOSE 4000

CMD ["node", "dist/index.js"]
