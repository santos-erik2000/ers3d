# ERS 3D — Gestão de Soluções e Fabricações

CRM operacional da ERS 3D Soluções e Fabricações. Este README cobre a **Fundação** (Sprint 0 + Sprint 1 do backlog) — setup do projeto, banco, autenticação e permissões por ação —, o módulo **Clientes** (Sprint 2), o **Kanban CRM** (Sprint 3) e **Filamentos & Calculadora** (Sprint 4). Os demais módulos de negócio (Orçamento, Produção, Qualidade, Entrega, Financeiro) entram nos sprints seguintes, conforme a Etapa 5 do planejamento.

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
    filaments/           estoque de filamento e movimentações (Sprint 4)
    jobs/                projetos, jobs e motor de precificação — calculadora (Sprint 4)
    quotes/ inventory/ quality/
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

## O que já funciona (Filamentos & Calculadora — Sprint 4)

- **Estoque de filamentos** (`/estoque`) — CRUD completo (nome, marca, material, cor, lote, fornecedor, preço/kg, peso inicial, gramas disponíveis, estoque mínimo, data de compra, localização, status, observações) e alerta visual (cor + texto, `Abaixo do mínimo`) quando `gramas_disponíveis < estoque_mínimo` (PROD-4)
- **Movimentações de estoque** com os tipos Entrada/Ajuste/Perda/Devolução/Correção — cada movimentação grava saldo anterior e saldo posterior e nunca deixa o saldo ficar negativo (`src/modules/filaments/services/filaments.ts`, função `recordMovement`): a checagem de saldo suficiente é uma escrita condicional atômica no banco (`updateMany` com filtro `availableGrams >= mínimo necessário`), não um "ler depois escrever" separado — sob concorrência, só uma movimentação vence e a outra recebe erro de saldo insuficiente (caso crítico PROD-5 da Etapa 2 §05)
- **Calculadora de precificação** (`/calculadora`) — motor puro `src/modules/jobs/services/pricing.ts` (`calculatePrice`) implementa a fórmula da Etapa 1 §10 com `Prisma.Decimal` do início ao fim (nunca `Number()`/float, nem em cálculo intermediário): custo de filamentos + custo de energia = custo direto; preço final = custo direto ÷ (1 − soma dos percentuais de manutenção/segurança/lucro)
- **Rejeição quando a soma dos percentuais é ≥ 100%** (CALC-3, caso crítico da Etapa 2 §05) — mensagem clara, nenhum job é salvo; testado exaustivamente em `src/modules/jobs/__tests__/pricing.test.ts` (soma exatamente 100% rejeita, 99,99% passa)
- **Projeto & Job** — `Project` (nome, cliente opcional, descrição, categoria, responsável, status) e `Job` guarda, de forma imutável após criado, todas as entradas usadas (potência, horas, preço do kWh, percentuais, filamentos e gramas — com o preço/kg do filamento congelado no momento do cálculo em `JobFilament.pricePerKgAtTime`) e o resultado calculado, junto de uma `ruleVersion` (`"v1"`) para permitir evoluir a fórmula no futuro sem invalidar jobs antigos
- Percentual digitado como número inteiro na UI (ex.: "20") e convertido para a fração armazenada (0.20) com `Prisma.Decimal` sobre a string do formulário — nunca pede o decimal ao usuário, nunca usa float na conversão
- Toda escrita (`filaments.manage`, `jobs.manage`) passa por `requirePermission` e é registrada em `audit_logs`

**Fora de escopo deste sprint, deliberadamente** (ver `planejamento/05-backlog-sprints-dod.html` §01 e os comentários `TODO` em `src/modules/jobs/services/jobs.ts`):
- **Reserva/consumo real de filamento por uma ordem de produção** (`FilamentMovementType` não tem "RESERVA"/"LIBERACAO" ainda) — o `Job` desta etapa é uma simulação de custo/preço, não debita `Filament.availableGrams`. Isso só é exercido a partir do Sprint 6 (Produção), quando uma oportunidade aprovada no Kanban de fato reserva/consome filamento (épico E5, história PROD-1)
- **Orçamento** (`quotes`, versionamento, aprovação, exportação em PDF — CALC-4/CALC-5) e **qualquer vínculo do Job com uma Opportunity do Kanban** — o Job desta etapa é standalone. A conexão Job → Orçamento → Oportunidade é Sprint 5
- `discount`/`freight`/`taxes`/`additionalCosts` existem como colunas reservadas em `Job` (para não migrar o schema de novo depois) mas não entram no cálculo de `finalPrice` ainda

## Riscos e limitações conhecidas (documentados, não escondidos)

- **Rate limiting é em memória de processo** (`src/lib/rate-limit.ts`) — decisão deliberada para não depender de Redis nesta escala. Não sobrevive a restart/deploy e não é compartilhado entre instâncias. Documentado na Etapa 1 (arquitetura) como trade-off aceito; revisar se a aplicação escalar horizontalmente.
- **Testes automatizados atuais usam Prisma mockado**, não um Postgres real — não havia banco disponível no ambiente em que a Fundação foi implementada, e essa mesma limitação se manteve no Sprint 2 (Clientes), no Sprint 3 (CRM Kanban) e no Sprint 4 (Filamentos & Calculadora). Cobre a lógica de negócio (regra do último ROOT, guarda de permissão, formato da auditoria, validação de CPF/CNPJ, detecção de duplicidade, validação de transição de etapa do Kanban e histórico, fórmula de precificação exaustivamente, saldo de estoque nunca negativo) mas não valida constraints reais do banco (índices, cascatas, comportamento de `String[]`/`Decimal`/enums no Postgres) nem concorrência real (o teste de "dois usuários no mesmo filamento" da Etapa 2 §05 está coberto pelo desenho da query condicional em `recordMovement`, não por um teste de concorrência de fato contra um Postgres real). As migrations de clientes, oportunidades e filamentos/jobs (`prisma/migrations/20260713010000_add_customers`, `prisma/migrations/20260713020000_add_opportunities`, `prisma/migrations/20260713030000_add_filaments_and_jobs`) também foram escritas manualmente com `prisma migrate diff --from-schema-datamodel <schema anterior> --to-schema-datamodel prisma/schema.prisma --script`, sem `migrate dev` contra um banco real. Recomendado rodar `prisma migrate deploy` + um teste de integração manual (incluindo concorrência real em `recordMovement`) contra um Neon de desenvolvimento antes do primeiro deploy real.
- **Bloqueio de usuário por um form simples**: se a regra do último ROOT for violada via um clique (condição rara — só ocorre se o admin tentar bloquear o único ROOT), o erro aparece como página de erro genérica do Next.js, não como mensagem inline. A regra é respeitada corretamente (a operação é bloqueada), mas a UX desse caso específico pode melhorar depois.
- **Motivo da reprovação de qualidade via `window.prompt`**: no Kanban, quando um card é movido de Qualidade para Desenvolvimento (reprovação), a UI pede o motivo obrigatório com `window.prompt` em vez de um modal desenhado — funcional e sempre bloqueia a movimentação sem motivo, mas não segue o design system. Melhoria de UX pendente, não bloqueante.
- **Atualização otimista no drag-and-drop**: o card muda de coluna imediatamente ao soltar, antes da confirmação do servidor; se o backend rejeitar a transição (pré-condição não cumprida), o card volta para a coluna original e o erro aparece acima do quadro — não há um "toast" de erro dedicado ainda.
- **`package.json#prisma` está deprecated** a partir do Prisma 7 (aviso, não erro). Migrar para `prisma.config.ts` é um follow-up de baixo risco, não bloqueante.
