import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { computeAggregateStatus, computeInstallmentStatus } from "@/modules/finance/format";

const d = (v: number) => new Prisma.Decimal(v);

describe("computeInstallmentStatus", () => {
  it("PAGO quando amountPaid >= amount", () => {
    expect(computeInstallmentStatus(d(500), d(500), null)).toBe("PAGO");
    expect(computeInstallmentStatus(d(500), d(600), null)).toBe("PAGO");
  });

  it("PARCIALMENTE_PAGO quando 0 < amountPaid < amount", () => {
    expect(computeInstallmentStatus(d(500), d(200), null)).toBe("PARCIALMENTE_PAGO");
  });

  it("PENDENTE quando nada foi pago e ainda está dentro do prazo", () => {
    const future = new Date(Date.now() + 86_400_000);
    expect(computeInstallmentStatus(d(500), d(0), future)).toBe("PENDENTE");
  });

  it("PENDENTE quando nada foi pago e não há vencimento definido", () => {
    expect(computeInstallmentStatus(d(500), d(0), null)).toBe("PENDENTE");
  });

  it("VENCIDO quando nada foi pago e o vencimento já passou — calculado inline, não por cron", () => {
    const past = new Date(Date.now() - 86_400_000);
    expect(computeInstallmentStatus(d(500), d(0), past)).toBe("VENCIDO");
  });
});

describe("computeAggregateStatus", () => {
  it("PAGO quando todas as parcelas estão pagas", () => {
    const installments = [
      { amount: d(300), amountPaid: d(300), dueDate: null },
      { amount: d(200), amountPaid: d(200), dueDate: null },
    ];
    expect(computeAggregateStatus(installments)).toBe("PAGO");
  });

  it("PARCIALMENTE_PAGO quando alguma parcela está paga e outra não", () => {
    const installments = [
      { amount: d(300), amountPaid: d(300), dueDate: null },
      { amount: d(200), amountPaid: d(0), dueDate: null },
    ];
    expect(computeAggregateStatus(installments)).toBe("PARCIALMENTE_PAGO");
  });

  it("PARCIALMENTE_PAGO também quando uma única parcela recebeu pagamento parcial", () => {
    const installments = [{ amount: d(500), amountPaid: d(150), dueDate: null }];
    expect(computeAggregateStatus(installments)).toBe("PARCIALMENTE_PAGO");
  });

  it("PENDENTE quando nenhuma parcela foi paga e nenhuma está vencida", () => {
    const future = new Date(Date.now() + 86_400_000);
    const installments = [{ amount: d(500), amountPaid: d(0), dueDate: future }];
    expect(computeAggregateStatus(installments)).toBe("PENDENTE");
  });

  it("VENCIDO quando nenhuma parcela foi paga e ao menos uma está vencida", () => {
    const past = new Date(Date.now() - 86_400_000);
    const installments = [
      { amount: d(300), amountPaid: d(0), dueDate: null },
      { amount: d(200), amountPaid: d(0), dueDate: past },
    ];
    expect(computeAggregateStatus(installments)).toBe("VENCIDO");
  });

  it("nunca retorna PREVISTO/CANCELADO/ESTORNADO (reservados para outros momentos/fluxos)", () => {
    const installments = [{ amount: d(500), amountPaid: d(0), dueDate: null }];
    const status = computeAggregateStatus(installments);
    expect(["PREVISTO", "CANCELADO", "ESTORNADO"]).not.toContain(status);
  });
});
