# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

ERS 3D — Gestão de Soluções e Fabricações: a CRM for ERS 3D Soluções e Fabricações covering commercial pipeline (Kanban), 3D printing quotes/pricing, production, quality control, deliveries, filament and parts inventory, and finance. Full product planning (vision, personas, security, design system, backlog) lives in `planejamento/` as five linked HTML documents — read those before making product decisions; this file only covers how to work in the codebase.

Currently implemented: the Fundação (auth, RBAC-by-action, audit trail, app shell), the Clientes module (Sprint 2 — PF/PJ registration, duplicate detection, 360° page skeleton), the CRM Kanban (Sprint 3 — 6-stage board with `dnd-kit` drag-and-drop, backend-validated stage transitions, `opportunity_stage_history`, filters), Filamentos & Calculadora (Sprint 4 — filament CRUD + stock movements with never-negative balance, and the pricing engine `src/modules/jobs/services/pricing.ts` that rejects a calculation when maintenance% + safety% + profit% ≥ 100%), Orçamento & Ciclo mensal (Sprint 5 — `quotes`/`quote_versions` generated from a calculated `Job` or manual with mandatory justification, versioned so an approved version is never overwritten, plus `crm_cycles` with non-destructive monthly closing that requires an explicit per-card decision), Produção (Sprint 6 — `production_orders`, filament reservation wired into `approveVersion` when a `QuoteVersion` came from a `Job`, `completeProduction` converting the reservation into real consumption with actual grams, and the Desenvolvimento → Qualidade Kanban transition now requiring the MOST RECENT production order to be completed), and Qualidade (Sprint 7 — `quality_checks`/`quality_check_items`, a fixed checklist run against a completed `ProductionOrder`, result Aprovado/Reprovado/Aprovado com ressalva; rejecting requires a reason and — in the same transaction as `src/modules/quality/services/quality.ts`'s `submitQualityCheck` — moves the opportunity back to Desenvolvimento and opens a new rework `ProductionOrder` on the same `Job`, reusing `completeProduction` unchanged; the original rejected `QualityCheck` is never deleted/altered; Qualidade → Entrega now requires the most recent `QualityCheck` to be Aprovado/Aprovado com ressalva). Deliveries and finance are still scaffolded as empty module folders awaiting their sprint — see the remaining TODOs in `src/modules/crm/services/opportunities.ts`.

## Commands

```bash
npm run dev          # dev server
npm run build        # production build
npm run lint         # ESLint (flat config, eslint.config.mjs)
npm run typecheck    # tsc --noEmit
npm test             # vitest run
npm run test:watch   # vitest watch mode
npx vitest run path/to/file.test.ts   # single test file

npm run db:migrate   # create/apply a migration in dev (needs DATABASE_URL)
npm run db:deploy    # apply pending migrations (prod/CI)
npm run db:seed      # run prisma/seed.ts
npm run db:studio    # Prisma Studio
```

CI (`.github/workflows/ci.yml`) runs lint → typecheck → prisma generate → test → build → migration dry-run, in that order, on every push/PR to `main`/`staging`.

No live database is required to lint, typecheck, or build — `DATABASE_URL` just needs to be a syntactically valid Postgres URL for those steps. It's only needed at runtime and for `db:*` commands.

## Architecture

Single Next.js (App Router) app — frontend and backend in one deployable, not a separate API service. This was a deliberate pivot (not the original plan): given the operation's small scale and a hard "everything free" infra constraint, a split Next.js + NestJS backend was rejected in favor of one app with strict internal module boundaries. See `planejamento/01-visao-arquitetura.html` §10 for the full reasoning — don't reintroduce a separate backend service without checking with the user first, it was an explicit, considered decision.

**The module boundary is the load-bearing convention in this codebase:**

- `src/app/` — routes only (App Router). Route Handlers, Server Components, and Server Actions call into `src/modules/<domain>/`. They never import `@/lib/prisma` or touch business logic directly.
- `src/modules/<domain>/services/` — the actual domain/business logic per module (`auth`, `audit`, `customers`, `crm`, `quotes`, `projects`, `jobs`, `filaments`, `inventory`, `quality`, `deliveries`, `finance`, `reports`, `catalogs`, `files`, `notifications`, `settings`). This is what preserves testability and what would let a future API service be extracted without rewriting logic, if the SaaS ambitions in the planning docs ever materialize.
- `src/modules/<domain>/actions.ts` — Server Actions, thin: call a guard, call a service, `revalidatePath`.
- `src/lib/` — cross-cutting infra only (Prisma singleton, rate limiter). Not business logic.

**Permissions are checked by action, never by role name.** Never write `if (role === "admin")`. Every sensitive Server Action/Route Handler starts with `requirePermission(PERMISSIONS.SOME_ACTION)` from `src/modules/auth/services/guard.ts`, which checks the named permission slug through whatever roles the user has (`src/modules/auth/services/permissions.ts`). Roles are just a grouping of permissions in the `role_permissions` table — they're not the source of truth for access control. When a new module needs a new permission, add the slug to the `PERMISSIONS` catalog and to the seed's role mapping, don't invent ad hoc role checks.

**Auditing goes through one function.** `recordAudit()` in `src/modules/audit/services/audit.ts` is the only place that writes `audit_logs`. It accepts an optional Prisma transaction client so it can be called inside the same transaction as the business operation it's logging (e.g., approving a quote + creating a receivable + writing the audit entry, atomically). Never `prisma.auditLog.create()` directly from a service.

**Auth is split across two files on purpose:** `src/auth.config.ts` (Edge-safe, used by `src/middleware.ts`, no Prisma/argon2 imports) and `src/auth.ts` (full config with the Credentials provider, Prisma, argon2 — used by Route Handlers/Server Components/Actions). This split exists because bundling `argon2` (native `node:crypto`) into the Edge middleware bundle breaks the build. Don't merge these back into one file, and don't import `@/auth` from `src/middleware.ts`.

**Money will use Prisma `Decimal`/`NUMERIC`, never `number`/float**, once financial modules exist (Sprint 9 in the backlog) — this rule is set in the planning docs and applies from the first migration that touches a money column.

**Design tokens** live as CSS custom properties in `src/app/globals.css` (light/dark, mirrors `planejamento/04-wireframes-design-system.html`) and are wired into `tailwind.config.ts` as named colors (`bg`, `surface`, `accent`, `success`, `danger`, `dev`, etc.) — use those Tailwind classes, don't hardcode hex values in components.

## Known trade-offs (see README.md for the full list)

- Login rate limiting is in-process memory, not Redis — deliberate given current scale, won't survive multi-instance deploys.
- The Fundação's tests mock Prisma (no live Postgres was available while building it) — real constraint/cascade behavior hasn't been verified against an actual database yet.
