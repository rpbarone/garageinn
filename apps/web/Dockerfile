FROM node:24-bookworm-slim AS deps
WORKDIR /srv/garageinn-legacy
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/mobile/package.json ./apps/mobile/package.json
RUN npm ci --workspace apps/web

FROM node:24-bookworm-slim AS builder
WORKDIR /srv/garageinn-legacy
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_VERCEL_URL
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
ENV NEXT_PUBLIC_VERCEL_URL=${NEXT_PUBLIC_VERCEL_URL}
COPY --from=deps /srv/garageinn-legacy/node_modules ./node_modules
COPY --from=deps /srv/garageinn-legacy/apps ./apps
COPY package.json package-lock.json ./
COPY apps ./apps
RUN npm run build --workspace apps/web

FROM node:24-bookworm-slim AS runner
WORKDIR /srv/garageinn-legacy
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=builder /srv/garageinn-legacy/apps/web/.next/standalone ./
COPY --from=builder /srv/garageinn-legacy/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /srv/garageinn-legacy/apps/web/public ./apps/web/public
RUN cd apps/web && npm install --omit=dev --no-save --include=optional --os=linux --cpu=x64 sharp@0.34.4
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
