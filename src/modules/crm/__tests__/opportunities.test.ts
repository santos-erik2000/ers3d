import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => {
  const opportunity = {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  const opportunityStageHistory = {
    create: vi.fn(),
  };
  const crmCycle = {
    findFirst: vi.fn(),
    create: vi.fn(),
  };
  const quoteVersion = {
    findFirst: vi.fn(),
  };
  const productionOrder = {
    findFirst: vi.fn(),
  };
  const qualityCheck = {
    findFirst: vi.fn(),
  };
  const prismaMock: Record<string, unknown> = {
    opportunity,
    opportunityStageHistory,
    crmCycle,
    quoteVersion,
    productionOrder,
    qualityCheck,
  };
  prismaMock.$transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb(prismaMock));
  return { prisma: prismaMock };
});
vi.mock("@/modules/audit/services/audit", () => ({ recordAudit: vi.fn() }));

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/modules/audit/services/audit";
import {
  BusinessRuleError,
  createOpportunity,
  listOpportunities,
  moveStage,
  validateTransition,
} from "@/modules/crm/services/opportunities";

const mockedOpportunity = vi.mocked(prisma.opportunity);
const mockedHistory = vi.mocked(prisma.opportunityStageHistory);
const mockedCrmCycle = vi.mocked(prisma.crmCycle);
const mockedQuoteVersion = vi.mocked(prisma.quoteVersion);
const mockedProductionOrder = vi.mocked(prisma.productionOrder);
const mockedQualityCheck = vi.mocked(prisma.qualityCheck);

function resetMocks() {
  mockedOpportunity.findMany.mockReset();
  mockedOpportunity.findUnique.mockReset();
  mockedOpportunity.create.mockReset();
  mockedOpportunity.update.mockReset();
  mockedHistory.create.mockReset();
  mockedCrmCycle.findFirst.mockReset();
  mockedCrmCycle.create.mockReset();
  mockedQuoteVersion.findFirst.mockReset();
  mockedProductionOrder.findFirst.mockReset();
  mockedQualityCheck.findFirst.mockReset();
  vi.mocked(recordAudit).mockReset();
}

// --- validateTransition (pura) ---------------------------------------------
// Caso crítico explícito da Etapa 2, seção 05: nenhuma transição que não
// existe no fluxo do Kanban pode passar, mesmo pulando só uma pré-condição.

describe("validateTransition — CRM-2 (caso crítico: movimentação inválida)", () => {
  it("permite um passo válido para frente (Proposta → Negociação)", () => {
    expect(() =>
      validateTransition("PROPOSTA", "NEGOCIACAO", { value: new Prisma.Decimal(0), deadlineAt: null }),
    ).not.toThrow();
  });

  it("rejeita pular etapa (Proposta → Entrega direto)", () => {
    expect(() =>
      validateTransition("PROPOSTA", "ENTREGA", { value: new Prisma.Decimal(0), deadlineAt: null }),
    ).toThrow(BusinessRuleError);
  });

  it("rejeita qualquer transição para trás fora da reprovação de qualidade", () => {
    expect(() =>
      validateTransition("DESENVOLVIMENTO", "PROPOSTA", { value: new Prisma.Decimal(0), deadlineAt: null }),
    ).toThrow(BusinessRuleError);
  });

  it("rejeita mover para a mesma etapa", () => {
    expect(() =>
      validateTransition("NEGOCIACAO", "NEGOCIACAO", { value: new Prisma.Decimal(0), deadlineAt: null }),
    ).toThrow(BusinessRuleError);
  });

  it("bloqueia Negociação → Desenvolvimento sem valor negociado definido", () => {
    expect(() =>
      validateTransition("NEGOCIACAO", "DESENVOLVIMENTO", {
        value: new Prisma.Decimal(0),
        deadlineAt: new Date(),
      }),
    ).toThrow(/valor negociado/i);
  });

  it("bloqueia Negociação → Desenvolvimento sem prazo definido", () => {
    expect(() =>
      validateTransition("NEGOCIACAO", "DESENVOLVIMENTO", {
        value: new Prisma.Decimal(500),
        deadlineAt: null,
      }),
    ).toThrow(/prazo/i);
  });

  it("bloqueia Negociação → Desenvolvimento sem orçamento aprovado (Sprint 5 conecta a pré-condição real)", () => {
    expect(() =>
      validateTransition("NEGOCIACAO", "DESENVOLVIMENTO", {
        value: new Prisma.Decimal(500),
        deadlineAt: new Date(),
        hasApprovedQuote: false,
      }),
    ).toThrow(/orçamento aprovada/i);
  });

  it("permite Negociação → Desenvolvimento com valor, prazo e orçamento aprovado", () => {
    expect(() =>
      validateTransition("NEGOCIACAO", "DESENVOLVIMENTO", {
        value: new Prisma.Decimal(500),
        deadlineAt: new Date(),
        hasApprovedQuote: true,
      }),
    ).not.toThrow();
  });

  it("exige motivo para reprovação de qualidade (Qualidade → Desenvolvimento)", () => {
    expect(() =>
      validateTransition("QUALIDADE", "DESENVOLVIMENTO", { value: new Prisma.Decimal(0), deadlineAt: null }),
    ).toThrow(/motivo/i);

    expect(() =>
      validateTransition(
        "QUALIDADE",
        "DESENVOLVIMENTO",
        { value: new Prisma.Decimal(0), deadlineAt: null },
        "Peça saiu com falha de aderência na base.",
      ),
    ).not.toThrow();
  });

  it("permite Entrega → Concluído (sem pré-condição adicional checável hoje)", () => {
    const subject = { value: new Prisma.Decimal(0), deadlineAt: null };
    expect(() => validateTransition("ENTREGA", "CONCLUIDO", subject)).not.toThrow();
  });
});

// --- validateTransition: Qualidade → Entrega exige checklist aprovado (Sprint 7, QUAL-1..2) --

describe("validateTransition — Qualidade → Entrega exige QualityCheck aprovado/aprovado com ressalva (Sprint 7)", () => {
  it("bloqueia quando não há checklist de qualidade aprovado (ou aprovado com ressalva) mais recente", () => {
    expect(() =>
      validateTransition("QUALIDADE", "ENTREGA", {
        value: new Prisma.Decimal(0),
        deadlineAt: null,
        hasQualityApproval: false,
      }),
    ).toThrow(/checklist de qualidade/i);
  });

  it("permite quando o checklist de qualidade mais recente está aprovado (ou aprovado com ressalva)", () => {
    expect(() =>
      validateTransition("QUALIDADE", "ENTREGA", {
        value: new Prisma.Decimal(0),
        deadlineAt: null,
        hasQualityApproval: true,
      }),
    ).not.toThrow();
  });
});

// --- validateTransition: Desenvolvimento → Qualidade exige produção concluída (Sprint 6) --

describe("validateTransition — Desenvolvimento → Qualidade exige ProductionOrder concluída (Sprint 6, PROD-3)", () => {
  it("bloqueia quando não há ordem de produção concluída vinculada à oportunidade", () => {
    expect(() =>
      validateTransition("DESENVOLVIMENTO", "QUALIDADE", {
        value: new Prisma.Decimal(0),
        deadlineAt: null,
        hasCompletedProduction: false,
      }),
    ).toThrow(/produção.*concluída/i);
  });

  it("permite quando existe uma ordem de produção concluída vinculada à oportunidade", () => {
    expect(() =>
      validateTransition("DESENVOLVIMENTO", "QUALIDADE", {
        value: new Prisma.Decimal(0),
        deadlineAt: null,
        hasCompletedProduction: true,
      }),
    ).not.toThrow();
  });
});

// --- moveStage (integração com Prisma mockado) ------------------------------

describe("moveStage", () => {
  beforeEach(resetMocks);

  it("aplica uma transição válida e registra o histórico + auditoria", async () => {
    mockedOpportunity.findUnique.mockResolvedValue({
      id: "op1",
      stage: "PROPOSTA",
      value: new Prisma.Decimal(0),
      deadlineAt: null,
    } as never);
    mockedOpportunity.update.mockResolvedValue({ id: "op1", stage: "NEGOCIACAO" } as never);

    const result = await moveStage("op1", "NEGOCIACAO", "actor1");

    expect(result).toMatchObject({ id: "op1", stage: "NEGOCIACAO" });
    expect(mockedOpportunity.update).toHaveBeenCalledWith({
      where: { id: "op1" },
      data: { stage: "NEGOCIACAO" },
    });
    expect(mockedHistory.create).toHaveBeenCalledWith({
      data: {
        opportunityId: "op1",
        fromStage: "PROPOSTA",
        toStage: "NEGOCIACAO",
        note: null,
        userId: "actor1",
      },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "opportunity",
        entityId: "op1",
        action: "opportunity.stage.move",
        userId: "actor1",
      }),
      expect.anything(),
    );
  });

  it("rejeita transição inválida (pular etapa) e não grava nada", async () => {
    mockedOpportunity.findUnique.mockResolvedValue({
      id: "op1",
      stage: "PROPOSTA",
      value: new Prisma.Decimal(0),
      deadlineAt: null,
    } as never);

    await expect(moveStage("op1", "ENTREGA", "actor1")).rejects.toBeInstanceOf(BusinessRuleError);

    expect(mockedOpportunity.update).not.toHaveBeenCalled();
    expect(mockedHistory.create).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("rejeita oportunidade inexistente", async () => {
    mockedOpportunity.findUnique.mockResolvedValue(null);
    await expect(moveStage("does-not-exist", "NEGOCIACAO", "actor1")).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
  });

  it("registra o motivo da reprovação de qualidade no histórico", async () => {
    mockedOpportunity.findUnique.mockResolvedValue({
      id: "op2",
      stage: "QUALIDADE",
      value: new Prisma.Decimal(500),
      deadlineAt: new Date(),
    } as never);
    mockedOpportunity.update.mockResolvedValue({ id: "op2", stage: "DESENVOLVIMENTO" } as never);

    await moveStage("op2", "DESENVOLVIMENTO", "actor1", "Falha de aderência na base.");

    expect(mockedHistory.create).toHaveBeenCalledWith({
      data: {
        opportunityId: "op2",
        fromStage: "QUALIDADE",
        toStage: "DESENVOLVIMENTO",
        note: "Falha de aderência na base.",
        userId: "actor1",
      },
    });
  });
});

// --- moveStage: Negociação → Desenvolvimento exige orçamento aprovado (Sprint 5) --

describe("moveStage — Negociação → Desenvolvimento exige QuoteVersion aprovada (Sprint 5)", () => {
  beforeEach(resetMocks);

  it("bloqueia quando não há nenhuma QuoteVersion aprovada vinculada à oportunidade", async () => {
    mockedOpportunity.findUnique.mockResolvedValue({
      id: "op3",
      stage: "NEGOCIACAO",
      value: new Prisma.Decimal(500),
      deadlineAt: new Date(),
    } as never);
    mockedQuoteVersion.findFirst.mockResolvedValue(null);

    await expect(moveStage("op3", "DESENVOLVIMENTO", "actor1")).rejects.toThrow(/orçamento aprovada/i);

    expect(mockedQuoteVersion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "APPROVED", quote: { opportunityId: "op3" } } }),
    );
    expect(mockedOpportunity.update).not.toHaveBeenCalled();
    expect(mockedHistory.create).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("permite quando existe uma QuoteVersion aprovada vinculada à oportunidade", async () => {
    mockedOpportunity.findUnique.mockResolvedValue({
      id: "op3",
      stage: "NEGOCIACAO",
      value: new Prisma.Decimal(500),
      deadlineAt: new Date(),
    } as never);
    mockedQuoteVersion.findFirst.mockResolvedValue({ id: "qv1" } as never);
    mockedOpportunity.update.mockResolvedValue({ id: "op3", stage: "DESENVOLVIMENTO" } as never);

    const result = await moveStage("op3", "DESENVOLVIMENTO", "actor1");

    expect(result).toMatchObject({ id: "op3", stage: "DESENVOLVIMENTO" });
    expect(mockedOpportunity.update).toHaveBeenCalledWith({
      where: { id: "op3" },
      data: { stage: "DESENVOLVIMENTO" },
    });
  });

  it("não consulta QuoteVersion quando a oportunidade não está saindo de Negociação", async () => {
    mockedOpportunity.findUnique.mockResolvedValue({
      id: "op1",
      stage: "PROPOSTA",
      value: new Prisma.Decimal(0),
      deadlineAt: null,
    } as never);
    mockedOpportunity.update.mockResolvedValue({ id: "op1", stage: "NEGOCIACAO" } as never);

    await moveStage("op1", "NEGOCIACAO", "actor1");

    expect(mockedQuoteVersion.findFirst).not.toHaveBeenCalled();
  });
});

// --- moveStage: Desenvolvimento → Qualidade exige ProductionOrder concluída (Sprint 6) --

describe("moveStage — Desenvolvimento → Qualidade exige ProductionOrder concluída (Sprint 6)", () => {
  beforeEach(resetMocks);

  it("bloqueia quando não há nenhuma ProductionOrder concluída vinculada à oportunidade", async () => {
    mockedOpportunity.findUnique.mockResolvedValue({
      id: "op4",
      stage: "DESENVOLVIMENTO",
      value: new Prisma.Decimal(500),
      deadlineAt: new Date(),
    } as never);
    mockedProductionOrder.findFirst.mockResolvedValue(null);

    await expect(moveStage("op4", "QUALIDADE", "actor1")).rejects.toThrow(/produção.*concluída/i);

    // hasCompletedProductionOrder (Sprint 7) passou a checar a ordem MAIS
    // RECENTE (orderBy createdAt desc), não "existe alguma CONCLUIDA alguma
    // vez" — ver comentário em src/modules/production/services/production.ts.
    expect(mockedProductionOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { opportunityId: "op4" }, orderBy: { createdAt: "desc" } }),
    );
    expect(mockedOpportunity.update).not.toHaveBeenCalled();
    expect(mockedHistory.create).not.toHaveBeenCalled();
  });

  it("permite quando a ProductionOrder mais recente vinculada à oportunidade está concluída", async () => {
    mockedOpportunity.findUnique.mockResolvedValue({
      id: "op4",
      stage: "DESENVOLVIMENTO",
      value: new Prisma.Decimal(500),
      deadlineAt: new Date(),
    } as never);
    mockedProductionOrder.findFirst.mockResolvedValue({ printStatus: "CONCLUIDA" } as never);
    mockedOpportunity.update.mockResolvedValue({ id: "op4", stage: "QUALIDADE" } as never);

    const result = await moveStage("op4", "QUALIDADE", "actor1");

    expect(result).toMatchObject({ id: "op4", stage: "QUALIDADE" });
  });

  it("não consulta ProductionOrder quando a oportunidade não está saindo de Desenvolvimento", async () => {
    mockedOpportunity.findUnique.mockResolvedValue({
      id: "op1",
      stage: "PROPOSTA",
      value: new Prisma.Decimal(0),
      deadlineAt: null,
    } as never);
    mockedOpportunity.update.mockResolvedValue({ id: "op1", stage: "NEGOCIACAO" } as never);

    await moveStage("op1", "NEGOCIACAO", "actor1");

    expect(mockedProductionOrder.findFirst).not.toHaveBeenCalled();
  });
});

// --- moveStage: Qualidade → Entrega exige QualityCheck aprovado (Sprint 7) --

describe("moveStage — Qualidade → Entrega exige QualityCheck aprovado/aprovado com ressalva (Sprint 7)", () => {
  beforeEach(resetMocks);

  it("bloqueia quando não há nenhum QualityCheck aprovado (ou aprovado com ressalva) vinculado à oportunidade", async () => {
    mockedOpportunity.findUnique.mockResolvedValue({
      id: "op5",
      stage: "QUALIDADE",
      value: new Prisma.Decimal(500),
      deadlineAt: new Date(),
    } as never);
    mockedQualityCheck.findFirst.mockResolvedValue(null);

    await expect(moveStage("op5", "ENTREGA", "actor1")).rejects.toThrow(/checklist de qualidade/i);

    expect(mockedQualityCheck.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { opportunityId: "op5" }, orderBy: { checkedAt: "desc" } }),
    );
    expect(mockedOpportunity.update).not.toHaveBeenCalled();
    expect(mockedHistory.create).not.toHaveBeenCalled();
  });

  it("bloqueia quando o QualityCheck mais recente está REPROVADO, mesmo que um mais antigo tenha sido aprovado", async () => {
    mockedOpportunity.findUnique.mockResolvedValue({
      id: "op5",
      stage: "QUALIDADE",
      value: new Prisma.Decimal(500),
      deadlineAt: new Date(),
    } as never);
    // findFirst com orderBy checkedAt desc já devolve só o mais recente —
    // simula o mais recente sendo REPROVADO.
    mockedQualityCheck.findFirst.mockResolvedValue({ result: "REPROVADO" } as never);

    await expect(moveStage("op5", "ENTREGA", "actor1")).rejects.toThrow(/checklist de qualidade/i);
  });

  it("permite quando o QualityCheck mais recente está APROVADO", async () => {
    mockedOpportunity.findUnique.mockResolvedValue({
      id: "op5",
      stage: "QUALIDADE",
      value: new Prisma.Decimal(500),
      deadlineAt: new Date(),
    } as never);
    mockedQualityCheck.findFirst.mockResolvedValue({ result: "APROVADO" } as never);
    mockedOpportunity.update.mockResolvedValue({ id: "op5", stage: "ENTREGA" } as never);

    const result = await moveStage("op5", "ENTREGA", "actor1");

    expect(result).toMatchObject({ id: "op5", stage: "ENTREGA" });
  });

  it("permite quando o QualityCheck mais recente está APROVADO_COM_RESSALVA", async () => {
    mockedOpportunity.findUnique.mockResolvedValue({
      id: "op5",
      stage: "QUALIDADE",
      value: new Prisma.Decimal(500),
      deadlineAt: new Date(),
    } as never);
    mockedQualityCheck.findFirst.mockResolvedValue({ result: "APROVADO_COM_RESSALVA" } as never);
    mockedOpportunity.update.mockResolvedValue({ id: "op5", stage: "ENTREGA" } as never);

    const result = await moveStage("op5", "ENTREGA", "actor1");

    expect(result).toMatchObject({ id: "op5", stage: "ENTREGA" });
  });

  it("não consulta QualityCheck quando a transição saindo de Qualidade é a reprovação (Qualidade → Desenvolvimento)", async () => {
    mockedOpportunity.findUnique.mockResolvedValue({
      id: "op5",
      stage: "QUALIDADE",
      value: new Prisma.Decimal(500),
      deadlineAt: new Date(),
    } as never);
    mockedOpportunity.update.mockResolvedValue({ id: "op5", stage: "DESENVOLVIMENTO" } as never);

    await moveStage("op5", "DESENVOLVIMENTO", "actor1", "Motivo qualquer.");

    expect(mockedQualityCheck.findFirst).not.toHaveBeenCalled();
  });

  it("não consulta QualityCheck quando a oportunidade não está saindo de Qualidade", async () => {
    mockedOpportunity.findUnique.mockResolvedValue({
      id: "op1",
      stage: "PROPOSTA",
      value: new Prisma.Decimal(0),
      deadlineAt: null,
    } as never);
    mockedOpportunity.update.mockResolvedValue({ id: "op1", stage: "NEGOCIACAO" } as never);

    await moveStage("op1", "NEGOCIACAO", "actor1");

    expect(mockedQualityCheck.findFirst).not.toHaveBeenCalled();
  });
});

// --- createOpportunity -------------------------------------------------------

describe("createOpportunity", () => {
  beforeEach(resetMocks);

  it("cria a oportunidade vinculada ao ciclo aberto atual, o histórico inicial (Proposta) e a auditoria", async () => {
    mockedCrmCycle.findFirst.mockResolvedValue({
      id: "cycle1",
      status: "OPEN",
      referenceMonth: new Date(Date.UTC(2026, 6, 1)),
    } as never);
    mockedOpportunity.create.mockResolvedValue({
      id: "new1",
      title: "Suporte de câmera",
      stage: "PROPOSTA",
      priority: "MEDIUM",
      deadlineAt: null,
    } as never);

    const result = await createOpportunity(
      { title: "Suporte de câmera", customerId: "cust1", value: "150.50" },
      "actor1",
    );

    expect(result).toMatchObject({ id: "new1" });
    expect(mockedOpportunity.create).toHaveBeenCalledTimes(1);
    expect(mockedOpportunity.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ cycleId: "cycle1" }) }),
    );
    expect(mockedCrmCycle.create).not.toHaveBeenCalled();
    expect(mockedHistory.create).toHaveBeenCalledWith({
      data: {
        opportunityId: "new1",
        fromStage: null,
        toStage: "PROPOSTA",
        userId: "actor1",
      },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "opportunity", action: "opportunity.create", userId: "actor1" }),
      expect.anything(),
    );
  });

  it("cria automaticamente o primeiro ciclo mensal quando nenhum ciclo aberto existe ainda", async () => {
    mockedCrmCycle.findFirst.mockResolvedValue(null);
    mockedCrmCycle.create.mockResolvedValue({
      id: "cycle-new",
      status: "OPEN",
      referenceMonth: new Date(Date.UTC(2026, 6, 1)),
    } as never);
    mockedOpportunity.create.mockResolvedValue({ id: "new2", stage: "PROPOSTA" } as never);

    await createOpportunity({ title: "Peça X", customerId: "cust1" }, "actor1");

    expect(mockedCrmCycle.create).toHaveBeenCalledTimes(1);
    expect(mockedOpportunity.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ cycleId: "cycle-new" }) }),
    );
  });

  it("rejeita título vazio", async () => {
    await expect(createOpportunity({ title: "   ", customerId: "cust1" }, "actor1")).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
    expect(mockedOpportunity.create).not.toHaveBeenCalled();
  });

  it("rejeita cliente não informado", async () => {
    await expect(
      createOpportunity({ title: "Projeto X", customerId: "" }, "actor1"),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it("rejeita valor negativo", async () => {
    await expect(
      createOpportunity({ title: "Projeto X", customerId: "cust1", value: "-10" }, "actor1"),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    expect(mockedOpportunity.create).not.toHaveBeenCalled();
  });
});

// --- listOpportunities --------------------------------------------------------

describe("listOpportunities", () => {
  beforeEach(resetMocks);

  it("aplica filtro de responsável, cliente e prioridade no where", async () => {
    mockedOpportunity.findMany.mockResolvedValue([]);

    await listOpportunities({ ownerId: "u1", customerId: "c1", priority: "HIGH" });

    expect(mockedOpportunity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerId: "u1", customerId: "c1", priority: "HIGH" },
      }),
    );
  });

  it("filtra atrasados: prazo no passado e etapa diferente de Concluído", async () => {
    mockedOpportunity.findMany.mockResolvedValue([]);

    await listOpportunities({ overdueOnly: true });

    expect(mockedOpportunity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deadlineAt: { lt: expect.any(Date) },
          stage: { not: "CONCLUIDO" },
        }),
      }),
    );
  });

  it("sem filtros, consulta tudo", async () => {
    mockedOpportunity.findMany.mockResolvedValue([]);
    await listOpportunities();
    expect(mockedOpportunity.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });
});
