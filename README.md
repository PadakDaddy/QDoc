# QDoc

QDoc is being rebuilt from a hackathon-era walk-in queue demo into a private-beta operational service for clinic check-in and queue management.

## Branch intent

- `main` remains the legacy MVP baseline.
- `v1-foundation` recreates the lost monorepo scaffold.
- `v1-domain-schema` will add the first PostgreSQL Prisma domain model on top of the new foundation.

## Repository layout on `v1-foundation`

```text
apps/
  api/        NestJS API foundation
  web/        Next.js patient/staff web foundation
  worker/     async job runner foundation
packages/
  config/     shared tooling placeholders
  contracts/  shared cross-app contracts
  db/         Prisma/PostgreSQL package placeholder
  ui/         shared UI primitives

frontend/     legacy patient web reference
backend/      legacy API reference
hospital-wpf/ legacy staff desktop reference
Robot/        legacy integration reference
```

## What this branch does

- establishes pnpm workspace boundaries,
- creates the new app/package roots,
- introduces the initial Prisma/PostgreSQL private-beta domain schema,
- preserves legacy code as reference material,
- prepares the next step for API, auth, and queue-service implementation.

## What this branch does not do yet

- migrate business logic,
- introduce the PostgreSQL production schema,
- replace the legacy apps,
- or provide feature parity.
