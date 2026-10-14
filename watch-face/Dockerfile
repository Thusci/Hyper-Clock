# Built from the repository root (docker-compose.yml: context "."), matching outputFileTracingRoot.
FROM node:24-alpine AS deps
WORKDIR /app/watch-face
COPY watch-face/package*.json ./
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/watch-face/node_modules ./watch-face/node_modules
COPY watch-face ./watch-face
WORKDIR /app/watch-face
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app/watch-face
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/watch-face/.next/standalone/watch-face ./
COPY --from=builder --chown=nextjs:nodejs /app/watch-face/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/watch-face/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/watch-face/data ./data
USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
