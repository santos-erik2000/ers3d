import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/auth/services/guard", () => {
  // Mesmo padrão de src/modules/crm/__tests__/actions.test.ts: define as
  // classes de erro aqui dentro (não em escopo externo) para não puxar o
  // guard.ts real (que importa @/auth — NextAuth + Prisma + argon2), pesado
  // demais e desnecessário para um teste unitário de Server Action.
  class ForbiddenError extends Error {}
  class UnauthorizedError extends Error {}
  return { requirePermission: vi.fn(), requireSession: vi.fn(), ForbiddenError, UnauthorizedError };
});
vi.mock("@/modules/finance/services/receivables", async () => {
  const actual = await vi.importActual<typeof import("@/modules/finance/services/receivables")>(
    "@/modules/finance/services/receivables",
  );
  return {
    ...actual,
    recordPayment: vi.fn(),
    reverseTransaction: vi.fn(),
    splitInstallments: vi.fn(),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { requirePermission, ForbiddenError } from "@/modules/auth/services/guard";
import { PERMISSIONS } from "@/modules/auth/services/permissions";
import { recordPayment, reverseTransaction, splitInstallments } from "@/modules/finance/services/receivables";
import { recordPaymentAction, reverseTransactionAction, splitInstallmentsAction } from "@/modules/finance/actions";

const mockedRequirePermission = vi.mocked(requirePermission);
const mockedRecordPayment = vi.mocked(recordPayment);
const mockedReverseTransaction = vi.mocked(reverseTransaction);
const mockedSplitInstallments = vi.mocked(splitInstallments);

function formDataFor(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

function resetMocks() {
  mockedRequirePermission.mockReset();
  mockedRecordPayment.mockReset();
  mockedReverseTransaction.mockReset();
  mockedSplitInstallments.mockReset();
}

// --- CASO CRÍTICO EXPLÍCITO (FIN-3): "Contador tenta editar módulo financeiro" --
//
// Dado um usuário com perfil Contador (que só tem `finance.read`, nunca
// `finance.manage`), quando ele tenta (via chamada direta à Server Action,
// simulando "mesmo que o front-end escondesse o botão") registrar pagamento,
// estornar ou dividir parcelas, o backend nega com 403 (ForbiddenError) —
// independente do que a UI mostrar ou esconder. `requirePermission` já é
// testado de forma genérica em src/modules/auth/__tests__/guard.test.ts; aqui
// testamos que CADA Server Action de escrita do financeiro efetivamente
// chama `requirePermission(PERMISSIONS.FINANCE_MANAGE)` antes de tocar o
// service, e que a negação nunca chega a invocar o service.

describe("Finance actions — CASO CRÍTICO FIN-3: Contador (finance.read, sem finance.manage) recebe 403 ao tentar escrever", () => {
  beforeEach(resetMocks);

  it("recordPaymentAction propaga ForbiddenError e NUNCA chama recordPayment", async () => {
    mockedRequirePermission.mockRejectedValue(new ForbiddenError());

    await expect(
      recordPaymentAction(
        undefined,
        formDataFor({ installmentId: "inst1", opportunityId: "op1", amount: "100", paymentMethod: "PIX" }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(mockedRequirePermission).toHaveBeenCalledWith(PERMISSIONS.FINANCE_MANAGE);
    expect(mockedRecordPayment).not.toHaveBeenCalled();
  });

  it("reverseTransactionAction propaga ForbiddenError e NUNCA chama reverseTransaction", async () => {
    mockedRequirePermission.mockRejectedValue(new ForbiddenError());

    await expect(reverseTransactionAction("tx1", "Motivo qualquer.", "op1")).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    expect(mockedRequirePermission).toHaveBeenCalledWith(PERMISSIONS.FINANCE_MANAGE);
    expect(mockedReverseTransaction).not.toHaveBeenCalled();
  });

  it("splitInstallmentsAction propaga ForbiddenError e NUNCA chama splitInstallments", async () => {
    mockedRequirePermission.mockRejectedValue(new ForbiddenError());

    await expect(
      splitInstallmentsAction(undefined, formDataFor({ accountsReceivableId: "ar1", opportunityId: "op1", count: "2" })),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(mockedRequirePermission).toHaveBeenCalledWith(PERMISSIONS.FINANCE_MANAGE);
    expect(mockedSplitInstallments).not.toHaveBeenCalled();
  });
});

describe("Finance actions — permissão concedida (finance.manage, ex.: Administrador)", () => {
  beforeEach(() => {
    resetMocks();
    mockedRequirePermission.mockResolvedValue({ userId: "actor1" });
  });

  it("recordPaymentAction chama recordPayment com o userId do ator autenticado", async () => {
    mockedRecordPayment.mockResolvedValue({} as never);

    const result = await recordPaymentAction(
      undefined,
      formDataFor({ installmentId: "inst1", opportunityId: "op1", amount: "100", paymentMethod: "PIX" }),
    );

    expect(result).toBeUndefined();
    expect(mockedRecordPayment).toHaveBeenCalledWith(
      expect.objectContaining({ installmentId: "inst1", amount: "100", paymentMethod: "PIX" }),
      "actor1",
    );
  });

  it("reverseTransactionAction chama reverseTransaction com o userId do ator autenticado", async () => {
    mockedReverseTransaction.mockResolvedValue({} as never);

    const result = await reverseTransactionAction("tx1", "Motivo do estorno.", "op1");

    expect(result).toEqual({});
    expect(mockedReverseTransaction).toHaveBeenCalledWith("tx1", "Motivo do estorno.", "actor1");
  });

  it("splitInstallmentsAction chama splitInstallments com o userId do ator autenticado", async () => {
    mockedSplitInstallments.mockResolvedValue([] as never);

    const result = await splitInstallmentsAction(
      undefined,
      formDataFor({ accountsReceivableId: "ar1", opportunityId: "op1", count: "3" }),
    );

    expect(result).toBeUndefined();
    expect(mockedSplitInstallments).toHaveBeenCalledWith("ar1", 3, "actor1");
  });
});
