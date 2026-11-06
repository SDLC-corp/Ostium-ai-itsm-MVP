FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server.js llms.txt ./
COPY src ./src
COPY public ./public
COPY docs/openapi.yaml ./docs/openapi.yaml
ENV PORT=3000 OSTIUM_DATA=/app/data/db.json NODE_ENV=production
EXPOSE 3000
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
CMD ["node", "server.js"]
