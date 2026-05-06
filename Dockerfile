FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma

RUN npm config set fetch-retries 5 \
    && npm config set fetch-retry-factor 2 \
    && npm config set fetch-retry-mintimeout 20000 \
    && npm config set fetch-retry-maxtimeout 120000 \
    && npm config set registry https://registry.npmjs.org/ \
    && npm install

COPY . .

ENV APP_NAME=bus-tracking-backend
ENV NODE_ENV=production
ENV PORT=5000
ENV API_VERSION=v1
ENV DATABASE_URL=postgresql://postgres:postgres@localhost:5432/bus_tracking
ENV REDIS_URL=redis://localhost:6379
ENV JWT_ACCESS_SECRET=build-time-access-secret-12345678901234567890
ENV JWT_REFRESH_SECRET=build-time-refresh-secret-1234567890123456789
ENV ACCESS_TOKEN_EXPIRES_IN=15m
ENV REFRESH_TOKEN_EXPIRES_IN=7d
ENV COOKIE_SECURE=false
ENV COOKIE_SAMESITE=lax
ENV COOKIE_DOMAIN=
ENV CORS_ORIGIN=http://localhost:3000
ENV DEFAULT_SPEED_KMH=20
ENV ARRIVAL_RADIUS_METERS=80
ENV LOCATION_DB_WRITE_INTERVAL_MS=10000
ENV RL_LOGIN_WINDOW_MS=600000
ENV RL_LOGIN_MAX=20
ENV RL_REFRESH_WINDOW_MS=300000
ENV RL_REFRESH_MAX=120
ENV STOPS_CACHE_TTL_MS=300000
ENV STOPS_CACHE_MAX_ENTRIES=200
ENV TRIP_STATE_TTL_SECONDS=180
ENV STOPS_CACHE_TTL_SECONDS=300
ENV TRIP_LOCK_TTL_MS=10000
ENV IDEMPOTENCY_TTL_SECONDS=3600

RUN npx prisma generate
RUN npm run build

EXPOSE 5000

CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]