# Threadback server. No npm install: the server has zero dependencies.
FROM node:22-alpine
WORKDIR /srv/threadback
COPY package.json ./
COPY server ./server
COPY app ./app
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production PORT=4173 DB_FILE=/data/threadback.db DEMO=0
USER node
VOLUME /data
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:4173/api/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
