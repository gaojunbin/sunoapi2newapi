FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package.json ./
COPY src ./src

RUN addgroup -S app && adduser -S app -G app \
  && mkdir -p /data \
  && chown -R app:app /app /data

USER app

EXPOSE 3000

CMD ["node", "src/server.js"]
