# ERS 3D — Gestão de Soluções e Fabricações

CRM operacional da ERS 3D Soluções e Fabricações. Este README cobre a **Fundação** (Sprint 0 + Sprint 1 do backlog) — setup do projeto, banco, autenticação e permissões por ação —, o módulo **Clientes** (Sprint 2), o **Kanban CRM** (Sprint 3), **Filamentos & Calculadora** (Sprint 4), **Orçamento & Ciclo mensal** (Sprint 5) e **Produção** (Sprint 6). Os demais módulos de negócio (Qualidade, Entrega, Financeiro) entram nos sprints seguintes, conforme a Etapa 5 do planejamento.

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
    quotes/              orçamento — versionamento, aprovação/rejeição (Sprint 5)
    production/          ordem de produção, reserva/consumo real de filamento (Sprint 6)
    inventory/ quality/
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
- Formulário de nova oportunidade vinculado a um cliente existente (reaproveita `listCustomers` do módulo `customers`) — toda oportunidade nova é automaticamente vinculada ao ciclo mensal aberto atual (Sprint 5, ver abaixo)
- Toda escrita (`crm.manage`) passa por `requirePermission` e é registrada em `audit_logs`

**Fora de escopo deste sprint, deliberadamente** (ver `planejamento/05-backlog-sprints-dod.html` §01 e os comentários `TODO` em `src/modules/crm/services/opportunities.ts`):
- Pré-condições de transição que dependem de módulos futuros ainda sem módulo implementado (produção concluída, qualidade aprovada, entrega registrada, financeiro conhecido) não são simuladas — cada uma está documentada como `TODO` inline no service, apontando o sprint que vai conectá-la de verdade. A pré-condição "orçamento aprovado" de `Negociação → Desenvolvimento` já foi conectada de verdade no Sprint 5 (ver abaixo) — as demais continuam pendentes
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
- `discount`/`freight`/`taxes`/`additionalCosts` existem como colunas reservadas em `Job` (para não migrar o schema de novo depois) mas não entram no cálculo de `finalPrice` ainda

## O que já funciona (Orçamento & Ciclo mensal — Sprint 5)

- **Orçamento** (`quotes`/`quote_versions`) — gerado a partir de um `Job` já calculado na calculadora (reaproveita `job.finalPrice`, só pede o desconto) ou manual, com **justificativa obrigatória** quando não vem de um job (regra do briefing original). Cada revisão é uma nova `QuoteVersion` (número sequencial, valor original/desconto/valor final, condição de pagamento, prazo de entrega, quantidade, observações, data de envio/aceite) — visível na página da oportunidade (`/crm/[id]`, botão "Abrir orçamento" no card do Kanban)
- **Nunca edita uma versão já aprovada** (caso crítico explícito da Etapa 2 §05, "Alterar orçamento já aprovado"): "editar" um orçamento — mesmo um já aprovado — sempre cria uma nova `QuoteVersion`; a versão aprovada original permanece intacta e consultável no histórico. Nenhuma função do módulo (`src/modules/quotes/services/quotes.ts`) faz `update` nos campos monetários de uma versão existente — só cria linhas novas ou muda status/timestamps da própria versão sendo decidida (`approveVersion`/`rejectVersion`/`sendVersion`)
- Aprovar uma versão (`status: APPROVED`) não move o card do Kanban nem mexe no financeiro (isso é Sprint 9) — mas, a partir do Sprint 6, **quando a versão aprovada veio de um `Job`**, a mesma transação da aprovação já reserva o filamento estimado e gera a ordem de produção (ver seção "Produção" abaixo). A transição **Negociação → Desenvolvimento** do Kanban checa de verdade a existência de uma `QuoteVersion` aprovada vinculada à oportunidade (`src/modules/crm/services/opportunities.ts`, `validateTransition`)
- **Ciclo mensal** (`crm_cycles`) — toda oportunidade nasce vinculada ao ciclo aberto atual (o primeiro ciclo é criado automaticamente na primeira oportunidade, se nenhum existir ainda). A mesma linha de `Opportunity` muda de ciclo ao longo do tempo — não duplica registro por ciclo; o histórico completo continua em `opportunity_stage_history`
- **Fechamento de ciclo nunca é automático nem destrutivo** (caso crítico CRM-5 da Etapa 2 §05): a Server Action de fechamento (`/crm`, botão "Fechar ciclo") exige uma decisão explícita — "transportar" ou "manter como pendência carregada" (`Opportunity.carriedFromCycleId`) — para **cada** card ainda em aberto (`stage != CONCLUIDO`) do ciclo; se a lista de decisões não cobrir exatamente os cards em aberto, o fechamento inteiro é rejeitado e nada é aplicado. Cards concluídos ficam arquivados no ciclo fechado, sem decisão necessária
- Nova permissão `quotes.manage` (seedada para ROOT e Administrador) guarda as Server Actions de orçamento; o fechamento de ciclo usa `crm.manage` (mesma permissão do quadro Kanban)
- Toda escrita passa por `requirePermission` e é registrada em `audit_logs`

**Fora de escopo deste sprint, deliberadamente**:
- **Exportação do orçamento em PDF** (CALC-5) — decisão já registrada como sprint futuro; este sprint só cobre o registro/versionamento do orçamento
- **Vínculo formal `Job ↔ Opportunity` no schema** — a UI de orçamento lista todos os jobs calculados (`listJobs()`) para escolha manual; não há FK entre `Job`/`Project` e `Opportunity`, então nada filtra automaticamente por cliente
- Pré-condições de transição que ainda dependem de módulos futuros sem módulo implementado (produção concluída, qualidade aprovada, entrega registrada, pendências financeiras) continuam como `TODO` — só a pré-condição de orçamento aprovado foi conectada de verdade
- Tela de fechamento de ciclo é um painel inline (sem modal desenhado) — mesmo trade-off de UX já documentado para o `window.prompt` da reprovação de qualidade no Kanban

## O que já funciona (Produção — Sprint 6)

- **Ordem de produção** (`production_orders`) — impressora (`printers`, tabela leve com as 3 impressoras da operação, sem agenda/calendário — decisão já confirmada na Etapa 1 §03), responsável técnico, datas previstas de início/término, status de impressão (Aguardando/Imprimindo/Concluída/Falhou) e observações técnicas. Visível no painel "Produção" da página da oportunidade (`/crm/[id]`)
- **Reserva de filamento na aprovação do orçamento** (PROD-1, política de estoque já decidida na Etapa 1 §03): quando uma `QuoteVersion` com `jobId` é aprovada, a MESMA transação de `approveVersion` (`src/modules/quotes/services/quotes.ts`) reserva o filamento estimado de cada `JobFilament` (tipo de movimentação `RESERVA`, reaproveitando a escrita condicional atômica de `recordMovementInTx` do módulo `filaments` — nunca duplicada) e cria a `ProductionOrder` (status Aguardando). **Se qualquer filamento não tiver saldo suficiente, a transação inteira falha: a versão não fica aprovada, nenhum filamento é reservado, nenhuma ordem é criada** (caso crítico combinado PROD-5 + "alterar orçamento já aprovado" da Etapa 2 §05)
- **Versão de orçamento manual (sem job)**: `approveVersion` aprova normalmente, sem reserva nem ordem automática — o usuário cria a ordem manualmente pelo formulário "Criar ordem de produção manual" no painel de Produção (`createManualProductionOrder`, exige que a oportunidade já tenha uma versão de orçamento aprovada)
- **Conclusão da produção convertendo reserva em consumo real** (PROD-3): `completeProduction` (`src/modules/production/services/production.ts`) aponta horas reais e, quando a ordem tem job vinculado, reconcilia as gramas reais de cada filamento contra o estimado — gramas a mais consomem a diferença do saldo disponível (nova movimentação `RESERVA`, que falha se não houver saldo — nada é aplicado, a ordem continua não concluída); gramas a menos liberam a diferença de volta (`LIBERACAO_RESERVA`). Tudo em uma única transação, mesmo espírito do caso crítico "Editar job já com estoque reservado" da Etapa 2 §05 (aqui aplicado no momento da conclusão, já que `Job` é imutável neste sistema — não existe uma tela de "editar job")
- **Contador de prazo calculado, nunca armazenado** (`src/modules/production/format.ts`, `getProductionDeadlineCounter` — função pura, sem IO): `NO_PRAZO` / `PROXIMO_VENCIMENTO` (≤ 2 dias corridos até `plannedEndAt` — limiar mais apertado que o do Kanban comercial porque o prazo de produção é operacional, medido em poucos dias) / `ATRASADO`. Sempre exibido com cor **e** texto (nunca só cor), mesma regra do indicador de prazo do Kanban
- **Pré-condição real da transição Desenvolvimento → Teste de Qualidade** (substituindo o `TODO` do Sprint 3): exige uma `ProductionOrder` com status Concluída vinculada à oportunidade (`src/modules/crm/services/opportunities.ts`, `validateTransition`)
- Nova permissão `production.manage` (seedada para ROOT e Administrador) guarda todas as Server Actions do módulo (`src/modules/production/actions.ts`)
- Toda escrita passa por `requirePermission` e é registrada em `audit_logs`

**Fora de escopo deste sprint, deliberadamente**:
- **Qualidade, entrega e financeiro** continuam como `TODO` em `validateTransition` — só a pré-condição de produção concluída foi conectada de verdade neste sprint
- **Falhas/reimpressões com novo ciclo de consumo**: o status "Falhou" existe (`updateProductionOrderDetails`) mas é só um marcador informativo — ele não libera a reserva nem gera um novo consumo de retrabalho automaticamente; isso é Sprint 7 (Qualidade), quando a reprovação já formaliza esse fluxo
- **Agenda/calendário de impressoras** — decisão já confirmada como fora de escopo (Etapa 1 §03): `Printer` é só um campo de nome/status, sem verificação de conflito de horário
- Formulário de conclusão de produção é confirmado inline (botão "Registrar conclusão" abre o formulário na mesma página), sem modal desenhado — mesmo trade-off de UX já documentado para outras telas deste projeto

## Riscos e limitações conhecidas (documentados, não escondidos)

- **Rate limiting é em memória de processo** (`src/lib/rate-limit.ts`) — decisão deliberada para não depender de Redis nesta escala. Não sobrevive a restart/deploy e não é compartilhado entre instâncias. Documentado na Etapa 1 (arquitetura) como trade-off aceito; revisar se a aplicação escalar horizontalmente.
- **Testes automatizados atuais usam Prisma mockado**, não um Postgres real — não havia `psql`/`docker` disponível no ambiente em que a Fundação foi implementada, e essa mesma limitação se manteve nos Sprints 2 a 6. Cobre a lógica de negócio (regra do último ROOT, guarda de permissão, formato da auditoria, validação de CPF/CNPJ, detecção de duplicidade, validação de transição de etapa do Kanban e histórico, fórmula de precificação exaustivamente, saldo de estoque nunca negativo, versionamento de orçamento nunca sobrescrevendo uma versão aprovada, fechamento de ciclo exigindo decisão por card, reserva de filamento na aprovação falhando por completo sem saldo, reconciliação de gramas reais na conclusão da produção) mas não valida constraints reais do banco (índices, cascatas, comportamento de `String[]`/`Decimal`/enums no Postgres) nem concorrência real de duas transações simultâneas (o mecanismo de escrita condicional atômica de `recordMovementInTx` é o que garante essa segurança em produção — testado unitariamente, não sob carga real). As migrations de clientes, oportunidades, filamentos/jobs, orçamento/ciclo e produção (`prisma/migrations/20260713010000_add_customers`, `..._add_opportunities`, `..._add_filaments_and_jobs`, `20260713040000_add_quotes_and_cycles`, `20260713050000_add_production`) também foram escritas manualmente com `prisma migrate diff --from-schema-datamodel <schema anterior> --to-schema-datamodel prisma/schema.prisma --script`, sem `migrate dev` contra um banco real — as migrations dos Sprints 5 e 6, porém, já foram aplicadas com `prisma migrate deploy` contra o Neon de desenvolvimento configurado em `.env` (ambas aditivas: só criam tabelas/enums novos e colunas nuláveis, sem risco para os dados existentes; a do Sprint 6 adiciona dois valores a um enum existente — `RESERVA`/`LIBERACAO_RESERVA` em `FilamentMovementType` — o que é seguro em uma migration própria porque nenhum dado é escrito usando esses valores na mesma transação).
- **Bloqueio de usuário por um form simples**: se a regra do último ROOT for violada via um clique (condição rara — só ocorre se o admin tentar bloquear o único ROOT), o erro aparece como página de erro genérica do Next.js, não como mensagem inline. A regra é respeitada corretamente (a operação é bloqueada), mas a UX desse caso específico pode melhorar depois.
- **Motivo da reprovação de qualidade via `window.prompt`**: no Kanban, quando um card é movido de Qualidade para Desenvolvimento (reprovação), a UI pede o motivo obrigatório com `window.prompt` em vez de um modal desenhado — funcional e sempre bloqueia a movimentação sem motivo, mas não segue o design system. Melhoria de UX pendente, não bloqueante.
- **Atualização otimista no drag-and-drop**: o card muda de coluna imediatamente ao soltar, antes da confirmação do servidor; se o backend rejeitar a transição (pré-condição não cumprida), o card volta para a coluna original e o erro aparece acima do quadro — não há um "toast" de erro dedicado ainda.
- **`package.json#prisma` está deprecated** a partir do Prisma 7 (aviso, não erro). Migrar para `prisma.config.ts` é um follow-up de baixo risco, não bloqueante.
