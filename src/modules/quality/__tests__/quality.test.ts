import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => {
  const opportunity = { findUnique: vi.fn(), update: vi.fn() };
  const productionOrder = { findUnique: vi.fn(), create: vi.fn() };
  const opportunityStageHistory = { create: vi.fn() };
  const qualityCheck = { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() };
  // Sprint 8 (INV-1): submitQualityCheck, quando aprovado/aprovado com
  // ressalva, chama createInventoryItemFromProductionInTx (módulo
  // `inventory`, real/não mockado) dentro da MESMA transação — que por sua
  // vez escreve em inventoryItem/inventoryMovement do mesmo `tx` mockado
  // aqui (prismaMock, reaproveitado como `tx` por `$transaction` abaixo).
  const inventoryItem = { create: vi.fn() };
  const inventoryMovement = { create: vi.fn() };
  const prismaMock: Record<string, unknown> = {
    opportunity,
    productionOrder,
    opportunityStageHistory,
    qualityCheck,
    inventoryItem,
    inventoryMovement,
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
  getQualityHistoryForOpportunity,
  hasApprovedQualityCheck,
  submitQualityCheck,
  type SubmitQualityCheckInput,
} from "@/modules/quality/services/quality";

const mockedOpportunity = vi.mocked(prisma.opportunity);
const mockedProductionOrder = vi.mocked(prisma.productionOrder);
const mockedHistory = vi.mocked(prisma.opportunityStageHistory);
const mockedQualityCheck = vi.mocked(prisma.qualityCheck);
const mockedInventoryItem = vi.mocked(prisma.inventoryItem);
const mockedInventoryMovement = vi.mocked(prisma.inventoryMovement);

function resetMocks() {
  mockedOpportunity.findUnique.mockReset();
  mockedOpportunity.update.mockReset();
  mockedProductionOrder.findUnique.mockReset();
  mockedProductionOrder.create.mockReset();
  mockedHistory.create.mockReset();
  mockedQualityCheck.create.mockReset();
  mockedQualityCheck.findFirst.mockReset();
  mockedQualityCheck.findMany.mockReset();
  mockedInventoryItem.create.mockReset();
  mockedInventoryMovement.create.mockReset();
  vi.mocked(recordAudit).mockReset();
}

const baseItems: SubmitQualityCheckInput["items"] = [
  { label: "Dimensões", passed: true },
  { label: "Acabamento", passed: true, notes: "Ok", evidencePhotoUrl: "https://example.com/foto.jpg" },
];

function mockHappyPathOpportunityAndOrder() {
  mockedOpportunity.findUnique.mockResolvedValue({ id: "op1", stage: "QUALIDADE" } as never);
  mockedProductionOrder.findUnique.mockResolvedValue({
    id: "po1",
    opportunityId: "op1",
    printStatus: "CONCLUIDA",
    jobId: "job1",
    job: { id: "job1", quantityProduced: 4, directCost: new Prisma.Decimal("40.00") },
  } as never);
  // Default para o caminho aprovado (Sprint 8 — INV-1): a maioria dos testes
  // de APROVADO/RESSALVA não está testando o estoque em si, só precisa que a
  // criação do InventoryItem não quebre por falta de mock.
  mockedInventoryItem.create.mockResolvedValue({ id: "inv1" } as never);
  mockedInventoryMovement.create.mockResolvedValue({ id: "invmov1" } as never);
}

describe("submitQualityCheck", () => {
  beforeEach(resetMocks);

  it("rejeita oportunidade inexistente", async () => {
    mockedOpportunity.findUnique.mockResolvedValue(null);
    await expect(
      submitQualityCheck(
        { opportunityId: "op1", productionOrderId: "po1", items: baseItems, result: "APROVADO" },
        "actor1",
      ),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it("rejeita quando a oportunidade não está na etapa Qualidade", async () => {
    mockedOpportunity.findUnique.mockResolvedValue({ id: "op1", stage: "DESENVOLVIMENTO" } as never);
    await expect(
      submitQualityCheck(
        { opportunityId: "op1", productionOrderId: "po1", items: baseItems, result: "APROVADO" },
        "actor1",
      ),
    ).rejects.toThrow(/etapa Teste de Qualidade/i);
  });

  it("rejeita ordem de produção inexistente", async () => {
    mockedOpportunity.findUnique.mockResolvedValue({ id: "op1", stage: "QUALIDADE" } as never);
    mockedProductionOrder.findUnique.mockResolvedValue(null);
    await expect(
      submitQualityCheck(
        { opportunityId: "op1", productionOrderId: "po1", items: baseItems, result: "APROVADO" },
        "actor1",
      ),
    ).rejects.toThrow(/ordem de produção não encontrada/i);
  });

  it("rejeita ordem de produção de outra oportunidade", async () => {
    mockedOpportunity.findUnique.mockResolvedValue({ id: "op1", stage: "QUALIDADE" } as never);
    mockedProductionOrder.findUnique.mockResolvedValue({
      id: "po1",
      opportunityId: "OUTRA-OP",
      printStatus: "CONCLUIDA",
    } as never);
    await expect(
      submitQualityCheck(
        { opportunityId: "op1", productionOrderId: "po1", items: baseItems, result: "APROVADO" },
        "actor1",
      ),
    ).rejects.toThrow(/não pertence a esta oportunidade/i);
  });

  it("rejeita quando a ordem de produção não está concluída", async () => {
    mockedOpportunity.findUnique.mockResolvedValue({ id: "op1", stage: "QUALIDADE" } as never);
    mockedProductionOrder.findUnique.mockResolvedValue({
      id: "po1",
      opportunityId: "op1",
      printStatus: "IMPRIMINDO",
    } as never);
    await expect(
      submitQualityCheck(
        { opportunityId: "op1", productionOrderId: "po1", items: baseItems, result: "APROVADO" },
        "actor1",
      ),
    ).rejects.toThrow(/status Concluída/i);
  });

  it("rejeita quando nenhum item do checklist é informado", async () => {
    mockHappyPathOpportunityAndOrder();
    await expect(
      submitQualityCheck(
        { opportunityId: "op1", productionOrderId: "po1", items: [], result: "APROVADO" },
        "actor1",
      ),
    ).rejects.toThrow(/ao menos um item/i);
  });

  // --- caso crítico QUAL-2: reprovação exige motivo -------------------------

  it("rejeita reprovação SEM motivo (caso crítico QUAL-2)", async () => {
    mockHappyPathOpportunityAndOrder();
    await expect(
      submitQualityCheck(
        { opportunityId: "op1", productionOrderId: "po1", items: baseItems, result: "REPROVADO" },
        "actor1",
      ),
    ).rejects.toThrow(/motivo da reprovação/i);

    expect(mockedQualityCheck.create).not.toHaveBeenCalled();
    expect(mockedOpportunity.update).not.toHaveBeenCalled();
    expect(mockedProductionOrder.create).not.toHaveBeenCalled();
  });

  it("rejeita reprovação com motivo em branco (só espaços)", async () => {
    mockHappyPathOpportunityAndOrder();
    await expect(
      submitQualityCheck(
        {
          opportunityId: "op1",
          productionOrderId: "po1",
          items: baseItems,
          result: "REPROVADO",
          rejectionReason: "   ",
        },
        "actor1",
      ),
    ).rejects.toThrow(/motivo da reprovação/i);
  });

  // --- caso crítico QUAL-2: reprovação gera retrabalho ----------------------

  it("reprovação COM motivo: cria o QualityCheck, move a oportunidade de volta para Desenvolvimento E abre uma nova ProductionOrder de retrabalho (mesmo job) — tudo na mesma transação", async () => {
    mockHappyPathOpportunityAndOrder();
    mockedQualityCheck.create.mockResolvedValue({ id: "qc1", result: "REPROVADO" } as never);
    mockedOpportunity.update.mockResolvedValue({ id: "op1", stage: "DESENVOLVIMENTO" } as never);
    mockedProductionOrder.create.mockResolvedValue({ id: "po-rework", printStatus: "AGUARDANDO" } as never);

    const result = await submitQualityCheck(
      {
        opportunityId: "op1",
        productionOrderId: "po1",
        items: baseItems,
        result: "REPROVADO",
        rejectionReason: "Peça saiu com falha de aderência na base.",
      },
      "actor1",
    );

    expect(result).toMatchObject({ id: "qc1", result: "REPROVADO" });

    // 1) QualityCheck criado com os itens (normalizados: notes/evidência
    // ausentes viram null) e o motivo.
    expect(mockedQualityCheck.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          opportunityId: "op1",
          productionOrderId: "po1",
          result: "REPROVADO",
          rejectionReason: "Peça saiu com falha de aderência na base.",
          checkedById: "actor1",
          items: {
            create: [
              { label: "Dimensões", passed: true, notes: null, evidencePhotoUrl: null },
              {
                label: "Acabamento",
                passed: true,
                notes: "Ok",
                evidencePhotoUrl: "https://example.com/foto.jpg",
              },
            ],
          },
        }),
      }),
    );

    // 2) Oportunidade volta para Desenvolvimento.
    expect(mockedOpportunity.update).toHaveBeenCalledWith({
      where: { id: "op1" },
      data: { stage: "DESENVOLVIMENTO" },
    });
    expect(mockedHistory.create).toHaveBeenCalledWith({
      data: {
        opportunityId: "op1",
        fromStage: "QUALIDADE",
        toStage: "DESENVOLVIMENTO",
        note: "Peça saiu com falha de aderência na base.",
        userId: "actor1",
      },
    });

    // 3) Nova ProductionOrder de retrabalho, mesmo job da ordem original, AGUARDANDO.
    expect(mockedProductionOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          opportunityId: "op1",
          jobId: "job1",
          printStatus: "AGUARDANDO",
        }),
      }),
    );

    // Auditoria: submissão do checklist + movimentação de etapa + criação da ordem.
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quality_check.submit" }),
      expect.anything(),
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "opportunity.stage.move" }),
      expect.anything(),
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "production_order.create" }),
      expect.anything(),
    );
  });

  it("reprovação em ordem sem job vinculado: retrabalho é criado com jobId nulo", async () => {
    mockedOpportunity.findUnique.mockResolvedValue({ id: "op1", stage: "QUALIDADE" } as never);
    mockedProductionOrder.findUnique.mockResolvedValue({
      id: "po1",
      opportunityId: "op1",
      printStatus: "CONCLUIDA",
      jobId: null,
    } as never);
    mockedQualityCheck.create.mockResolvedValue({ id: "qc1", result: "REPROVADO" } as never);
    mockedOpportunity.update.mockResolvedValue({ id: "op1", stage: "DESENVOLVIMENTO" } as never);
    mockedProductionOrder.create.mockResolvedValue({ id: "po-rework" } as never);

    await submitQualityCheck(
      {
        opportunityId: "op1",
        productionOrderId: "po1",
        items: baseItems,
        result: "REPROVADO",
        rejectionReason: "Defeito de acabamento.",
      },
      "actor1",
    );

    expect(mockedProductionOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ jobId: null }) }),
    );
  });

  // --- aprovação: só registra, não mexe em mais nada ------------------------

  it("aprovação (APROVADO) só cria o QualityCheck — não move etapa nem cria ordem", async () => {
    mockHappyPathOpportunityAndOrder();
    mockedQualityCheck.create.mockResolvedValue({ id: "qc2", result: "APROVADO" } as never);

    await submitQualityCheck(
      { opportunityId: "op1", productionOrderId: "po1", items: baseItems, result: "APROVADO" },
      "actor1",
    );

    expect(mockedOpportunity.update).not.toHaveBeenCalled();
    expect(mockedHistory.create).not.toHaveBeenCalled();
    expect(mockedProductionOrder.create).not.toHaveBeenCalled();
  });

  it("aprovação com ressalva (APROVADO_COM_RESSALVA) também só registra o resultado", async () => {
    mockHappyPathOpportunityAndOrder();
    mockedQualityCheck.create.mockResolvedValue({ id: "qc3", result: "APROVADO_COM_RESSALVA" } as never);

    await submitQualityCheck(
      {
        opportunityId: "op1",
        productionOrderId: "po1",
        items: baseItems,
        result: "APROVADO_COM_RESSALVA",
        rejectionReason: "não deveria ser gravado",
      },
      "actor1",
    );

    expect(mockedOpportunity.update).not.toHaveBeenCalled();
    expect(mockedProductionOrder.create).not.toHaveBeenCalled();
    // rejectionReason só é persistido quando result = REPROVADO.
    expect(mockedQualityCheck.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ rejectionReason: null }) }),
    );
  });

  // --- Sprint 8 (INV-1): aprovação gera InventoryItem, reprovação nunca gera --

  it("APROVADO gera o InventoryItem com a quantidade do Job e o PRODUCAO inicial, na mesma transação", async () => {
    mockHappyPathOpportunityAndOrder(); // job1: quantityProduced=4, directCost=40.00
    mockedQualityCheck.create.mockResolvedValue({ id: "qc-aprovado", result: "APROVADO" } as never);
    mockedInventoryItem.create.mockResolvedValue({ id: "inv-novo", quantityProduced: 4 } as never);

    await submitQualityCheck(
      { opportunityId: "op1", productionOrderId: "po1", items: baseItems, result: "APROVADO" },
      "actor1",
    );

    expect(mockedInventoryItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          opportunityId: "op1",
          jobId: "job1",
          qualityCheckId: "qc-aprovado",
          quantityProduced: 4,
          quantityAvailable: 4,
        }),
      }),
    );
    // unitCost = directCost / quantityProduced = 40.00 / 4 = 10.
    const createArg = mockedInventoryItem.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect((createArg.data.unitCost as Prisma.Decimal).toString()).toBe("10");
    expect(mockedInventoryMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "PRODUCAO", quantity: 4, availableBefore: 0, availableAfter: 4 }),
      }),
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "inventory_item", action: "inventory_item.create" }),
      expect.anything(),
    );
  });

  it("APROVADO_COM_RESSALVA também gera o InventoryItem", async () => {
    mockHappyPathOpportunityAndOrder();
    mockedQualityCheck.create.mockResolvedValue({ id: "qc-ressalva", result: "APROVADO_COM_RESSALVA" } as never);

    await submitQualityCheck(
      { opportunityId: "op1", productionOrderId: "po1", items: baseItems, result: "APROVADO_COM_RESSALVA" },
      "actor1",
    );

    expect(mockedInventoryItem.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ qualityCheckId: "qc-ressalva" }) }),
    );
  });

  it("REPROVADO nunca gera InventoryItem (só o retrabalho)", async () => {
    mockHappyPathOpportunityAndOrder();
    mockedQualityCheck.create.mockResolvedValue({ id: "qc-reprovado", result: "REPROVADO" } as never);
    mockedOpportunity.update.mockResolvedValue({ id: "op1", stage: "DESENVOLVIMENTO" } as never);
    mockedProductionOrder.create.mockResolvedValue({ id: "po-rework" } as never);

    await submitQualityCheck(
      {
        opportunityId: "op1",
        productionOrderId: "po1",
        items: baseItems,
        result: "REPROVADO",
        rejectionReason: "Falha de aderência.",
      },
      "actor1",
    );

    expect(mockedInventoryItem.create).not.toHaveBeenCalled();
    expect(mockedInventoryMovement.create).not.toHaveBeenCalled();
  });

  it("sem Job vinculado (orçamento manual): usa quantidade 1 como fallback e unitCost nulo", async () => {
    mockedOpportunity.findUnique.mockResolvedValue({ id: "op1", stage: "QUALIDADE" } as never);
    mockedProductionOrder.findUnique.mockResolvedValue({
      id: "po1",
      opportunityId: "op1",
      printStatus: "CONCLUIDA",
      jobId: null,
      job: null,
    } as never);
    mockedQualityCheck.create.mockResolvedValue({ id: "qc-manual", result: "APROVADO" } as never);
    mockedInventoryItem.create.mockResolvedValue({ id: "inv-manual" } as never);

    await submitQualityCheck(
      { opportunityId: "op1", productionOrderId: "po1", items: baseItems, result: "APROVADO" },
      "actor1",
    );

    expect(mockedInventoryItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ jobId: null, quantityProduced: 1, quantityAvailable: 1, unitCost: null }),
      }),
    );
  });
});

// --- hasApprovedQualityCheck ------------------------------------------------

describe("hasApprovedQualityCheck", () => {
  beforeEach(resetMocks);

  it("retorna false quando não existe nenhum QualityCheck", async () => {
    mockedQualityCheck.findFirst.mockResolvedValue(null);
    await expect(hasApprovedQualityCheck("op1")).resolves.toBe(false);
  });

  it("retorna true quando o mais recente é APROVADO", async () => {
    mockedQualityCheck.findFirst.mockResolvedValue({ result: "APROVADO" } as never);
    await expect(hasApprovedQualityCheck("op1")).resolves.toBe(true);
    expect(mockedQualityCheck.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { opportunityId: "op1" }, orderBy: { checkedAt: "desc" } }),
    );
  });

  it("retorna true quando o mais recente é APROVADO_COM_RESSALVA", async () => {
    mockedQualityCheck.findFirst.mockResolvedValue({ result: "APROVADO_COM_RESSALVA" } as never);
    await expect(hasApprovedQualityCheck("op1")).resolves.toBe(true);
  });

  it("retorna false quando o mais recente é REPROVADO", async () => {
    mockedQualityCheck.findFirst.mockResolvedValue({ result: "REPROVADO" } as never);
    await expect(hasApprovedQualityCheck("op1")).resolves.toBe(false);
  });
});

// --- getQualityHistoryForOpportunity (QUAL-3) -------------------------------

describe("getQualityHistoryForOpportunity — histórico preserva reprovações antigas (QUAL-3)", () => {
  beforeEach(resetMocks);

  it("retorna todos os QualityChecks da oportunidade, mais recentes primeiro, mesmo após um retrabalho ser aprovado depois", async () => {
    // Cenário: 1ª tentativa reprovada, 2ª tentativa (retrabalho) aprovada —
    // a reprovação original continua na lista, sem ser apagada/alterada.
    const history = [
      { id: "qc2", result: "APROVADO", productionOrderId: "po-rework", checkedAt: new Date("2026-07-10") },
      { id: "qc1", result: "REPROVADO", productionOrderId: "po1", checkedAt: new Date("2026-07-05") },
    ];
    mockedQualityCheck.findMany.mockResolvedValue(history as never);

    const result = await getQualityHistoryForOpportunity("op1");

    expect(result).toEqual(history);
    expect(mockedQualityCheck.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { opportunityId: "op1" }, orderBy: { checkedAt: "desc" } }),
    );
    // A reprovação original (qc1) segue presente no histórico.
    expect(result.some((c) => c.id === "qc1" && c.result === "REPROVADO")).toBe(true);
  });
});
