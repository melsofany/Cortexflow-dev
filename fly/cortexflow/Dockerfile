FROM node:22-alpine AS builder

WORKDIR /app

RUN npm install -g pnpm@10

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY lib/ lib/
COPY artifacts/cortexflow/ artifacts/cortexflow/
COPY attached_assets/ attached_assets/

RUN pnpm install --frozen-lockfile

RUN pnpm --filter @workspace/api-zod build 2>/dev/null || true

ENV BASE_PATH=/
ENV PORT=3000
ENV NODE_ENV=production

RUN pnpm --filter @workspace/cortexflow build

FROM nginx:alpine AS runner

COPY --from=builder /app/artifacts/cortexflow/dist/public /usr/share/nginx/html

COPY fly/cortexflow/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
