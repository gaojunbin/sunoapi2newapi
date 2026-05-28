FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package.json ./
COPY src ./src
COPY docker-entrypoint.sh ./

RUN apk add --no-cache su-exec \
  && addgroup -S app && adduser -S app -G app \
  && mkdir -p /data \
  && chown -R app:app /app /data \
  && chmod +x /app/docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
