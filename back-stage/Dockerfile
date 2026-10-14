FROM node:24-alpine AS deps
WORKDIR /app
COPY ha-console/package*.json ./ha-console/
COPY back-stage/package*.json ./back-stage/
WORKDIR /app/ha-console
RUN npm ci
WORKDIR /app/back-stage
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app ./
COPY ha-console ./ha-console
COPY back-stage ./back-stage
WORKDIR /app/back-stage
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app/back-stage
ENV NODE_ENV=production PORT=3001 HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/back-stage/.next/standalone/back-stage ./
COPY --from=builder --chown=nextjs:nodejs /app/back-stage/.next/static ./.next/static
USER nextjs
EXPOSE 3001
CMD ["node", "server.js"]
