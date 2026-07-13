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
  const prismaMock: Record<string, unknown> = { opportunity, opportunityStageHistory };
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

function resetMocks() {
  mockedOpportunity.findMany.mockReset();
  mockedOpportunity.findUnique.mockReset();
  mockedOpportunity.create.mockReset();
  mockedOpportunity.update.mockReset();
  mockedHistory.create.mockReset();
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

  it("permite Negociação → Desenvolvimento com valor e prazo (orçamento aprovado fica de TODO para o Sprint 5)", () => {
    expect(() =>
      validateTransition("NEGOCIACAO", "DESENVOLVIMENTO", {
        value: new Prisma.Decimal(500),
        deadlineAt: new Date(),
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

  it("permite os demais passos do fluxo (Desenvolvimento → Qualidade, Qualidade → Entrega, Entrega → Concluído)", () => {
    const subject = { value: new Prisma.Decimal(0), deadlineAt: null };
    expect(() => validateTransition("DESENVOLVIMENTO", "QUALIDADE", subject)).not.toThrow();
    expect(() => validateTransition("QUALIDADE", "ENTREGA", subject)).not.toThrow();
    expect(() => validateTransition("ENTREGA", "CONCLUIDO", subject)).not.toThrow();
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

// --- createOpportunity -------------------------------------------------------

describe("createOpportunity", () => {
  beforeEach(resetMocks);

  it("cria a oportunidade, o histórico inicial (Proposta) e a auditoria", async () => {
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
