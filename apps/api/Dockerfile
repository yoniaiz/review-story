# Build from the repo root: docker build -f apps/api/Dockerfile .
FROM node:22-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile --filter @review-story/api...
RUN pnpm --filter @review-story/api build
# Standalone production install for the runtime image (dist bundles the
# workspace packages; only api's prod deps, incl. native tree-sitter, remain).
RUN pnpm --filter @review-story/api --prod deploy /deploy

FROM node:22-slim
ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
ENV API_PORT=8787
WORKDIR /app
COPY --from=build /deploy/node_modules ./node_modules
COPY --from=build /deploy/package.json ./package.json
COPY --from=build /repo/apps/api/dist ./dist
EXPOSE 8787
USER node
CMD ["node", "dist/server.js"]
