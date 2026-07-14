import { describe, expect, it } from "vitest";
import {
  PRODUCTION_DUE_SOON_THRESHOLD_DAYS,
  getProductionDeadlineCounter,
  getProductionDeadlineStatus,
} from "@/modules/production/format";

const NOW = new Date("2026-07-13T12:00:00Z");

describe("getProductionDeadlineCounter — função pura, sem IO (Sprint 6)", () => {
  it("retorna ATRASADO quando plannedEndAt já passou", () => {
    expect(getProductionDeadlineCounter("2026-07-10T12:00:00Z", NOW)).toBe("ATRASADO");
  });

  it(`retorna PROXIMO_VENCIMENTO quando faltam <= ${PRODUCTION_DUE_SOON_THRESHOLD_DAYS} dias`, () => {
    expect(getProductionDeadlineCounter("2026-07-13T18:00:00Z", NOW)).toBe("PROXIMO_VENCIMENTO");
    expect(getProductionDeadlineCounter("2026-07-15T12:00:00Z", NOW)).toBe("PROXIMO_VENCIMENTO");
  });

  it("retorna NO_PRAZO quando faltam mais dias que o limiar", () => {
    expect(getProductionDeadlineCounter("2026-07-20T12:00:00Z", NOW)).toBe("NO_PRAZO");
  });
});

describe("getProductionDeadlineStatus — sempre cor + texto (nunca só cor)", () => {
  it("ordem concluída: neutro, independente do plannedEndAt", () => {
    expect(getProductionDeadlineStatus("2026-07-01T00:00:00Z", "CONCLUIDA", NOW)).toEqual({
      tone: "neutral",
      label: "Concluída",
    });
  });

  it("sem plannedEndAt definido: neutro", () => {
    expect(getProductionDeadlineStatus(null, "AGUARDANDO", NOW)).toEqual({
      tone: "neutral",
      label: "Sem prazo previsto definido",
    });
  });

  it("atrasado: tone danger", () => {
    expect(getProductionDeadlineStatus("2026-07-01T00:00:00Z", "IMPRIMINDO", NOW).tone).toBe("danger");
  });

  it("próximo do vencimento: tone warning", () => {
    expect(getProductionDeadlineStatus("2026-07-14T00:00:00Z", "AGUARDANDO", NOW).tone).toBe("warning");
  });

  it("no prazo: tone success", () => {
    expect(getProductionDeadlineStatus("2026-07-25T00:00:00Z", "AGUARDANDO", NOW).tone).toBe("success");
  });
});
