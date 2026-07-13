# ERS 3D — Gestão de Soluções e Fabricações

CRM operacional da ERS 3D Soluções e Fabricações. Este README cobre a **Fundação** (Sprint 0 + Sprint 1 do backlog) — setup do projeto, banco, autenticação e permissões por ação —, o módulo **Clientes** (Sprint 2) e o **Kanban CRM** (Sprint 3). Os demais módulos de negócio (Calculadora, Produção, Qualidade, Estoque, Financeiro) entram nos sprints seguintes, conforme a Etapa 5 do planejamento.

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
npx prisma migrate deploy   # aplica todas as migrations em prisma/migrations/
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
    customers/           clientes PF/PJ (Sprint 2)
    crm/                 oportunidades e Kanban (Sprint 3)
    quotes/ jobs/ filaments/ inventory/ quality/
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

## O que já funciona (Clientes — Sprint 2)

- Cadastro de clientes PF/PJ (`/clientes`) com validação de CPF/CNPJ (dígito verificador)
- Detecção de duplicidade por e-mail, telefone ou CPF/CNPJ (normalizados antes de comparar) — a tela alerta o usuário e exige confirmação explícita antes de salvar um cadastro coincidente, nunca bloqueia silenciosamente (CUST-2)
- "Empresa" do cliente como tag leve (encontra ou cria por nome, sem cadastro/CRUD próprio — decisão registrada na Etapa 1)
- Página 360° do cliente (`/clientes/[id]`) — esqueleto: dados cadastrais completos hoje, linha do tempo consolidada (interações, orçamentos, produção, financeiro) entra conforme os módulos correspondentes forem implementados
- Toda escrita (`customers.manage`) passa por `requirePermission` e é registrada em `audit_logs`

## O que já funciona (CRM Kanban — Sprint 3)

- Quadro Kanban em `/crm` com as 6 etapas do fluxo (Proposta → Negociação → Desenvolvimento → Teste de Qualidade → Entrega → Concluído), drag-and-drop real com `@dnd-kit/core` (+ botão de avanço rápido no card como alternativa ao arrastar)
- Toda movimentação de etapa é validada no backend (`src/modules/crm/services/opportunities.ts`, função `validateTransition`) — pular etapa (ex.: Proposta → Entrega direto) é rejeitado com erro claro (CRM-2); a única transição para trás permitida é a reprovação de qualidade (Qualidade → Desenvolvimento), que exige motivo obrigatório
- Histórico completo de movimentação em `opportunity_stage_history` (etapa anterior, nova etapa, quem moveu, quando, observação) — base do "dias na etapa" exibido em cada card (CRM-3)
- Indicador visual de prazo sempre com cor **e** texto (nunca só cor): atrasado (`danger`), próximo do prazo/vence hoje (`warning`), no prazo (`success`), sem prazo definido (`neutral`)
- Filtros do quadro por responsável, cliente, prioridade e atrasados (CRM-4)
- Formulário de nova oportunidade vinculado a um cliente existente (reaproveita `listCustomers` do módulo `customers`)
- Toda escrita (`crm.manage`) passa por `requirePermission` e é registrada em `audit_logs`

**Fora de escopo deste sprint, deliberadamente** (ver `planejamento/05-backlog-sprints-dod.html` §01 e os comentários `TODO` em `src/modules/crm/services/opportunities.ts`):
- `crm_cycles` (ciclo mensal / CRM-5, fechamento com cards em aberto) — Sprint 5, junto do módulo de orçamento
- Pré-condições de transição que dependem de módulos futuros (orçamento aprovado, produção concluída, qualidade aprovada, entrega registrada, financeiro conhecido) não são simuladas — cada uma está documentada como `TODO` inline no service, apontando o sprint que vai conectá-la de verdade. `Negociação → Desenvolvimento` hoje só exige valor negociado e prazo preenchidos (campos manuais do card), não "orçamento aprovado" (isso é Sprint 5)
- Granularidade de permissão por perfil/transição (Comercial só move Proposta↔Negociação, Técnico só move Desenvolvimento↔Qualidade↔Entrega, retrocesso manual fora do fluxo só Admin — `planejamento/02-personas-jornadas-historias.html` §06) — hoje é uma permissão única `crm.manage`, porque os perfis "Comercial" e "Técnico" ainda não existem no seed

## Riscos e limitações conhecidas (documentados, não escondidos)

- **Rate limiting é em memória de processo** (`src/lib/rate-limit.ts`) — decisão deliberada para não depender de Redis nesta escala. Não sobrevive a restart/deploy e não é compartilhado entre instâncias. Documentado na Etapa 1 (arquitetura) como trade-off aceito; revisar se a aplicação escalar horizontalmente.
- **Testes automatizados atuais usam Prisma mockado**, não um Postgres real — não havia banco disponível no ambiente em que a Fundação foi implementada, e essa mesma limitação se manteve no Sprint 2 (Clientes) e no Sprint 3 (CRM Kanban). Cobre a lógica de negócio (regra do último ROOT, guarda de permissão, formato da auditoria, validação de CPF/CNPJ, detecção de duplicidade, validação de transição de etapa do Kanban e histórico) mas não valida constraints reais do banco (índices, cascatas, comportamento de `String[]`/`Decimal`/enums no Postgres). As migrations de clientes e de oportunidades (`prisma/migrations/20260713010000_add_customers`, `prisma/migrations/20260713020000_add_opportunities`) também foram escritas manualmente com `prisma migrate diff --from-empty --to-schema-datamodel --script`, sem `migrate dev` contra um banco real. Recomendado rodar `prisma migrate deploy` + um teste de integração manual contra um Neon de desenvolvimento antes do primeiro deploy real.
- **Bloqueio de usuário por um form simples**: se a regra do último ROOT for violada via um clique (condição rara — só ocorre se o admin tentar bloquear o único ROOT), o erro aparece como página de erro genérica do Next.js, não como mensagem inline. A regra é respeitada corretamente (a operação é bloqueada), mas a UX desse caso específico pode melhorar depois.
- **Motivo da reprovação de qualidade via `window.prompt`**: no Kanban, quando um card é movido de Qualidade para Desenvolvimento (reprovação), a UI pede o motivo obrigatório com `window.prompt` em vez de um modal desenhado — funcional e sempre bloqueia a movimentação sem motivo, mas não segue o design system. Melhoria de UX pendente, não bloqueante.
- **Atualização otimista no drag-and-drop**: o card muda de coluna imediatamente ao soltar, antes da confirmação do servidor; se o backend rejeitar a transição (pré-condição não cumprida), o card volta para a coluna original e o erro aparece acima do quadro — não há um "toast" de erro dedicado ainda.
- **`package.json#prisma` está deprecated** a partir do Prisma 7 (aviso, não erro). Migrar para `prisma.config.ts` é um follow-up de baixo risco, não bloqueante.
