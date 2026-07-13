import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/auth/services/guard", () => {
  // Definidas aqui dentro (não em escopo externo) para não colidir com o
  // hoisting de vi.mock, e para não puxar o guard.ts real — que importa
  // @/auth (NextAuth + Prisma + argon2), pesado demais para um teste unitário
  // de Server Action e desnecessário aqui: só precisamos das duas classes de
  // erro com o mesmo formato do módulo real.
  class ForbiddenError extends Error {}
  class UnauthorizedError extends Error {}
  return { requirePermission: vi.fn(), requireSession: vi.fn(), ForbiddenError, UnauthorizedError };
});
vi.mock("@/modules/crm/services/opportunities", async () => {
  const actual = await vi.importActual<typeof import("@/modules/crm/services/opportunities")>(
    "@/modules/crm/services/opportunities",
  );
  return {
    ...actual,
    createOpportunity: vi.fn(),
    moveStage: vi.fn(),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { requirePermission, ForbiddenError } from "@/modules/auth/services/guard";
import { PERMISSIONS } from "@/modules/auth/services/permissions";
import { createOpportunity, moveStage } from "@/modules/crm/services/opportunities";
import { createOpportunityAction, moveOpportunityStageAction } from "@/modules/crm/actions";

const mockedRequirePermission = vi.mocked(requirePermission);
const mockedCreate = vi.mocked(createOpportunity);
const mockedMoveStage = vi.mocked(moveStage);

function formDataFor(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("CRM actions — permissão negada (crm.manage)", () => {
  beforeEach(() => {
    mockedRequirePermission.mockReset();
    mockedCreate.mockReset();
    mockedMoveStage.mockReset();
  });

  it("createOpportunityAction propaga ForbiddenError e nunca chama o service", async () => {
    mockedRequirePermission.mockRejectedValue(new ForbiddenError());

    await expect(
      createOpportunityAction(undefined, formDataFor({ title: "Projeto X", customerId: "c1" })),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(mockedRequirePermission).toHaveBeenCalledWith(PERMISSIONS.CRM_MANAGE);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("moveOpportunityStageAction propaga ForbiddenError e nunca chama moveStage", async () => {
    mockedRequirePermission.mockRejectedValue(new ForbiddenError());

    await expect(moveOpportunityStageAction("op1", "NEGOCIACAO")).rejects.toBeInstanceOf(ForbiddenError);

    expect(mockedRequirePermission).toHaveBeenCalledWith(PERMISSIONS.CRM_MANAGE);
    expect(mockedMoveStage).not.toHaveBeenCalled();
  });
});

describe("CRM actions — permissão concedida", () => {
  beforeEach(() => {
    mockedRequirePermission.mockReset();
    mockedCreate.mockReset();
    mockedMoveStage.mockReset();
    mockedRequirePermission.mockResolvedValue({ userId: "actor1" });
  });

  it("createOpportunityAction chama o service com o userId do ator autenticado", async () => {
    mockedCreate.mockResolvedValue({ id: "op1" } as never);

    const result = await createOpportunityAction(
      undefined,
      formDataFor({ title: "Projeto X", customerId: "c1", value: "100" }),
    );

    expect(result).toBeUndefined();
    expect(mockedCreate).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Projeto X", customerId: "c1" }),
      "actor1",
    );
  });

  it("moveOpportunityStageAction chama moveStage com o userId do ator autenticado", async () => {
    mockedMoveStage.mockResolvedValue({ id: "op1", stage: "NEGOCIACAO" } as never);

    const result = await moveOpportunityStageAction("op1", "NEGOCIACAO");

    expect(result).toEqual({});
    expect(mockedMoveStage).toHaveBeenCalledWith("op1", "NEGOCIACAO", "actor1", null);
  });
});
