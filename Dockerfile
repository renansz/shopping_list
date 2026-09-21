# Imagem enxuta: nenhuma dependência para instalar, só o Node e o código.
FROM node:22-alpine

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000 \
    HOST=0.0.0.0

WORKDIR /app

COPY package.json ./
COPY server ./server
COPY public ./public
COPY tools ./tools

# O banco fica num volume para sobreviver a atualizações da imagem.
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME ["/data"]

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
