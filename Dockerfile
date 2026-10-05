FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
ARG BASE_PATH=""
ENV BASE_PATH=$BASE_PATH
ENV NEXT_TELEMETRY_DISABLED=1
ENV BUILD_STANDALONE=true
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 DATA_DIR=/data
RUN addgroup --system --gid 1001 reader && adduser --system --uid 1001 --ingroup reader reader && mkdir -p /data && chown reader:reader /data
COPY --from=builder --chown=reader:reader /app/.next/standalone ./
COPY --from=builder --chown=reader:reader /app/.next/static ./.next/static
COPY --from=builder --chown=reader:reader /app/public ./public
USER reader
EXPOSE 3000
CMD ["node", "server.js"]
