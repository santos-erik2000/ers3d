import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => {
  const opportunity = { findUnique: vi.fn() };
  const delivery = { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() };
  const deliveryChecklistItem = { update: vi.fn() };
  const prismaMock: Record<string, unknown> = { opportunity, delivery, deliveryChecklistItem };
  prismaMock.$transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb(prismaMock));
  return { prisma: prismaMock };
});
vi.mock("@/modules/audit/services/audit", () => ({ recordAudit: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/modules/audit/services/audit";
import {
  BusinessRuleError,
  createDelivery,
  hasDeliveredDelivery,
  markDeliveryAsDelivered,
  markDeliveryAsShipped,
  updateDelivery,
} from "@/modules/deliveries/services/deliveries";

const mockedOpportunity = vi.mocked(prisma.opportunity);
const mockedDelivery = vi.mocked(prisma.delivery);
const mockedChecklistItem = vi.mocked(prisma.deliveryChecklistItem);

function resetMocks() {
  mockedOpportunity.findUnique.mockReset();
  mockedDelivery.create.mockReset();
  mockedDelivery.update.mockReset();
  mockedDelivery.findUnique.mockReset();
  mockedDelivery.findFirst.mockReset();
  mockedChecklistItem.update.mockReset();
  vi.mocked(recordAudit).mockReset();
}

// --- createDelivery (DEL-1) --------------------------------------------------

describe("createDelivery", () => {
  beforeEach(resetMocks);

  it("rejeita oportunidade inexistente", async () => {
    mockedOpportunity.findUnique.mockResolvedValue(null);
    await expect(
      createDelivery({ opportunityId: "op1", method: "CORREIOS" }, "actor1"),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it("rejeita quando a oportunidade não está na etapa Entrega", async () => {
    mockedOpportunity.findUnique.mockResolvedValue({ id: "op1", stage: "QUALIDADE" } as never);
    await expect(
      createDelivery({ opportunityId: "op1", method: "CORREIOS" }, "actor1"),
    ).rejects.toThrow(/etapa Entrega/i);
  });

  it("cria a entrega PENDENTE com o checklist de embalagem fixo (8 itens desmarcados)", async () => {
    mockedOpportunity.findUnique.mockResolvedValue({ id: "op1", stage: "ENTREGA" } as never);
    mockedDelivery.create.mockResolvedValue({ id: "del1", status: "PENDENTE" } as never);

    await createDelivery(
      { opportunityId: "op1", method: "TRANSPORTADORA", trackingCode: "BR123" },
      "actor1",
    );

    expect(mockedDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          opportunityId: "op1",
          method: "TRANSPORTADORA",
          status: "PENDENTE",
          trackingCode: "BR123",
          checklistItems: {
            create: expect.arrayContaining([
              expect.objectContaining({ label: "Conferência da peça", checked: false }),
              expect.objectContaining({ label: "Foto da embalagem", checked: false }),
            ]),
          },
        }),
      }),
    );
    const callArg = mockedDelivery.create.mock.calls[0]?.[0] as {
      data: { checklistItems: { create: unknown[] } };
    };
    expect(callArg.data.checklistItems.create).toHaveLength(8);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "delivery", action: "delivery.create" }),
      expect.anything(),
    );
  });

  it("rejeita método inválido", async () => {
    mockedOpportunity.findUnique.mockResolvedValue({ id: "op1", stage: "ENTREGA" } as never);
    await expect(
      createDelivery({ opportunityId: "op1", method: "PROMBOY" as never }, "actor1"),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });
});

// --- updateDelivery -----------------------------------------------------------

describe("updateDelivery", () => {
  beforeEach(resetMocks);

  it("rejeita edição de entrega já ENTREGUE", async () => {
    mockedDelivery.findUnique.mockResolvedValue({
      id: "del1",
      status: "ENTREGUE",
      checklistItems: [],
    } as never);

    await expect(updateDelivery("del1", { notes: "tentando editar" }, "actor1")).rejects.toThrow(
      /já foi confirmada como entregue/i,
    );
    expect(mockedDelivery.update).not.toHaveBeenCalled();
  });

  it("atualiza dados e aplica só os itens de checklist que pertencem a esta entrega", async () => {
    mockedDelivery.findUnique.mockResolvedValue({
      id: "del1",
      status: "PENDENTE",
      method: "CORREIOS",
      address: null,
      recipientName: null,
      trackingCode: null,
      expectedAt: null,
      notes: null,
      proofUrl: null,
      checklistItems: [{ id: "item1" }, { id: "item2" }],
    } as never);
    mockedDelivery.update.mockResolvedValue({ id: "del1", method: "CORREIOS" } as never);

    await updateDelivery(
      "del1",
      {
        checklist: [
          { id: "item1", checked: true, notes: "ok" },
          { id: "item-de-outra-entrega", checked: true },
        ],
      },
      "actor1",
    );

    expect(mockedChecklistItem.update).toHaveBeenCalledTimes(1);
    expect(mockedChecklistItem.update).toHaveBeenCalledWith({
      where: { id: "item1" },
      data: { checked: true, notes: "ok" },
    });
  });
});

// --- transições de status (DEL-2) --------------------------------------------

describe("markDeliveryAsShipped", () => {
  beforeEach(resetMocks);

  it("só a partir de PENDENTE", async () => {
    mockedDelivery.findUnique.mockResolvedValue({ id: "del1", status: "ENVIADO" } as never);
    await expect(markDeliveryAsShipped("del1", "actor1")).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it("marca como ENVIADO e grava shippedAt", async () => {
    mockedDelivery.findUnique.mockResolvedValue({ id: "del1", status: "PENDENTE" } as never);
    mockedDelivery.update.mockResolvedValue({ id: "del1", status: "ENVIADO" } as never);

    const result = await markDeliveryAsShipped("del1", "actor1");

    expect(result).toMatchObject({ status: "ENVIADO" });
    expect(mockedDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "del1" }, data: expect.objectContaining({ status: "ENVIADO" }) }),
    );
  });
});

describe("markDeliveryAsDelivered — DEL-2", () => {
  beforeEach(resetMocks);

  it("rejeita quando já está ENTREGUE", async () => {
    mockedDelivery.findUnique.mockResolvedValue({ id: "del1", status: "ENTREGUE" } as never);
    await expect(markDeliveryAsDelivered("del1", "actor1")).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it("marca como ENTREGUE a partir de PENDENTE (ex.: retirada, sem etapa de envio)", async () => {
    mockedDelivery.findUnique.mockResolvedValue({ id: "del1", status: "PENDENTE", proofUrl: null } as never);
    mockedDelivery.update.mockResolvedValue({ id: "del1", status: "ENTREGUE" } as never);

    const result = await markDeliveryAsDelivered("del1", "actor1", "https://example.com/comprovante.jpg");

    expect(result).toMatchObject({ status: "ENTREGUE" });
    expect(mockedDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "ENTREGUE", proofUrl: "https://example.com/comprovante.jpg" }),
      }),
    );
  });

  it("marca como ENTREGUE a partir de ENVIADO", async () => {
    mockedDelivery.findUnique.mockResolvedValue({ id: "del1", status: "ENVIADO", proofUrl: null } as never);
    mockedDelivery.update.mockResolvedValue({ id: "del1", status: "ENTREGUE" } as never);

    await markDeliveryAsDelivered("del1", "actor1");
    expect(mockedDelivery.update).toHaveBeenCalled();
  });
});

// --- hasDeliveredDelivery (pré-condição de Entrega -> Concluído) ------------

describe("hasDeliveredDelivery", () => {
  beforeEach(resetMocks);

  it("retorna false quando não existe nenhuma Delivery", async () => {
    mockedDelivery.findFirst.mockResolvedValue(null);
    await expect(hasDeliveredDelivery("op1")).resolves.toBe(false);
  });

  it("retorna true quando a Delivery mais recente está ENTREGUE", async () => {
    mockedDelivery.findFirst.mockResolvedValue({ status: "ENTREGUE" } as never);
    await expect(hasDeliveredDelivery("op1")).resolves.toBe(true);
    expect(mockedDelivery.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { opportunityId: "op1" }, orderBy: { createdAt: "desc" } }),
    );
  });

  it("retorna false quando a Delivery mais recente ainda está PENDENTE/ENVIADO, mesmo que uma anterior tenha sido ENTREGUE", async () => {
    mockedDelivery.findFirst.mockResolvedValue({ status: "ENVIADO" } as never);
    await expect(hasDeliveredDelivery("op1")).resolves.toBe(false);
  });
});
