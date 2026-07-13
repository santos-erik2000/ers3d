# ERS 3D — Gestão de Soluções e Fabricações

CRM operacional da ERS 3D Soluções e Fabricações. Este README cobre a **Fundação** (Sprint 0 + Sprint 1 do backlog): setup do projeto, banco, autenticação e permissões por ação. Os módulos de negócio (Clientes, Kanban, Calculadora, Produção, Qualidade, Estoque, Financeiro) entram nos sprints seguintes, conforme a Etapa 5 do planejamento.

Documentos de planejamento completos (visão, arquitetura, personas, segurança, design system, backlog): ver pasta `planejamento/`.

## Stack

- Next.js 15 (App Router) + TypeScript, front-end e back-end no mesmo app — sem serviço separado (decisão da Etapa 1, motivada por escala pequena e orçamento zero).
- Auth.js (NextAuth v5) — credenciais e-mail/senha, sem SSO.
- PostgreSQL + Prisma. Hospedagem de banco recomendada: [Neon](https://neon.tech) (free tier).
- Tailwind CSS, tokens de design definidos em `src/app/globals.css` (Etapa 4).
- Vitest para testes.
- Deploy recomendado: Render (free tier) — ver Etapa 1, seção 10.

## Pré-requisitos

- Node.js ≥ 20
- Uma URL de conexão PostgreSQL (Neon, ou Postgres local para desenvolvimento)

## Setup

```bash
npm install
cp .env.example .env
```

Edite `.env`:
- `DATABASE_URL`: sua conexão Postgres
- `AUTH_SECRET`: gere com `npx auth secret`
- `SEED_ROOT_EMAIL` / `SEED_ROOT_PASSWORD`: credenciais do primeiro usuário ROOT (troque a senha após o primeiro login)

Aplique as migrations e rode o seed:

```bash
npx prisma migrate deploy   # aplica prisma/migrations/20260713000000_init
npm run db:seed             # cria permissões, perfis (ROOT/Admin/Contador) e o usuário ROOT
```

Em desenvolvimento local, use `npm run db:migrate` em vez de `migrate deploy` caso vá alterar o schema.

Suba a aplicação:

```bash
npm run dev
```

Acesse `http://localhost:3000` — a rota `/` redireciona para `/login`. Entre com o e-mail/senha definidos em `SEED_ROOT_EMAIL`/`SEED_ROOT_PASSWORD`.

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Build de produção |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Testes (Vitest) |
| `npm run db:migrate` | Cria/aplica migration em desenvolvimento |
| `npm run db:deploy` | Aplica migrations pendentes (uso em produção/CI) |
| `npm run db:seed` | Roda `prisma/seed.ts` |
| `npm run db:studio` | Abre o Prisma Studio |

## Estrutura

```
src/
  app/                  rotas (App Router)
    (app)/              rotas autenticadas — sidebar + header
    login/               tela pública de login
    api/                Route Handlers (auth, health check)
  modules/              camada de domínio — uma pasta por módulo de negócio
    auth/                autenticação, usuários, permissões (RBAC por ação)
    audit/               interceptor único de auditoria (audit_logs)
    customers/ crm/ quotes/ jobs/ filaments/ inventory/ quality/
    deliveries/ finance/ reports/ catalogs/ files/ notifications/ settings/
                          (pastas já criadas, populadas sprint a sprint)
  lib/                   infraestrutura compartilhada (Prisma client, rate limit)
  components/ui/         componentes de interface reutilizáveis
prisma/
  schema.prisma          schema atual (users, roles, permissions, audit_logs)
  migrations/            histórico de migrations, nunca editado retroativamente
  seed.ts                seed idempotente de permissões/perfis/usuário ROOT
planejamento/            as 5 etapas do planejamento do produto
```

**Regra de arquitetura:** nenhuma rota (`app/`) acessa o Prisma diretamente. Toda escrita/leitura de negócio passa por `src/modules/<domínio>/services/*.ts`. Isso preserva a separação por domínio mesmo dentro de um único app Next.js (ver Etapa 1, seção 10) e é o que permite, no futuro, extrair um serviço de API separado sem reescrever a lógica de negócio.

## Permissões

A checagem de acesso nunca é feita pelo nome do perfil (`role === "admin"`). Toda ação sensível chama `requirePermission(PERMISSIONS.ALGUMA_ACAO)` (`src/modules/auth/services/guard.ts`), que verifica se o usuário tem aquela permissão nomeada através de qualquer perfil atribuído a ele. Perfis (`ROOT`, `Administrador`, `Contador`) são só um agrupamento conveniente de permissões — a fonte de verdade é a tabela `role_permissions`.

## O que já funciona (Fundação)

- Login com e-mail/senha (Auth.js, argon2, rate limiting de 5 tentativas/15min)
- Sessão protegida por middleware — rotas fora de `/login` exigem autenticação
- Usuários & Permissões: listar, criar, bloquear/desbloquear — respeitando a regra "não é possível bloquear o último usuário ROOT ativo"
- Auditoria: login (sucesso/falha), criação/bloqueio/desbloqueio de usuário
- Health check em `/api/health`

## Riscos e limitações conhecidas (documentados, não escondidos)

- **Rate limiting é em memória de processo** (`src/lib/rate-limit.ts`) — decisão deliberada para não depender de Redis nesta escala. Não sobrevive a restart/deploy e não é compartilhado entre instâncias. Documentado na Etapa 1 (arquitetura) como trade-off aceito; revisar se a aplicação escalar horizontalmente.
- **Testes automatizados atuais usam Prisma mockado**, não um Postgres real — não havia banco disponível no ambiente em que a Fundação foi implementada. Cobre a lógica de negócio (regra do último ROOT, guarda de permissão, formato da auditoria) mas não valida constraints reais do banco (índices únicos, cascatas). Recomendado rodar `prisma migrate deploy` + um teste de integração manual contra um Neon de desenvolvimento antes do primeiro deploy real.
- **Bloqueio de usuário por um form simples**: se a regra do último ROOT for violada via um clique (condição rara — só ocorre se o admin tentar bloquear o único ROOT), o erro aparece como página de erro genérica do Next.js, não como mensagem inline. A regra é respeitada corretamente (a operação é bloqueada), mas a UX desse caso específico pode melhorar depois.
- **`package.json#prisma` está deprecated** a partir do Prisma 7 (aviso, não erro). Migrar para `prisma.config.ts` é um follow-up de baixo risco, não bloqueante.
