FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public
COPY database/migraciones ./database/migraciones
COPY scripts/migrar.js ./scripts/migrar.js

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Primero lleva la base a la ultima version del esquema; si eso falla, el
# servidor no arranca sobre una base desactualizada.
CMD ["sh", "-c", "node scripts/migrar.js && exec node src/server.js"]
