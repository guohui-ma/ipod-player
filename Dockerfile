FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Runtime stage
FROM node:20-alpine

RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
COPY server.js ./
COPY public/ ./public/

EXPOSE 3001

USER app

CMD ["node", "server.js"]
