FROM node:24.15.0-alpine

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json ./
COPY apps ./apps
COPY packages ./packages

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @qdoc/db db:generate
RUN pnpm build

ENV NODE_ENV=production

CMD ["pnpm", "start:web"]
