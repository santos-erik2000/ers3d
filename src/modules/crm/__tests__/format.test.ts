import { describe, expect, it } from "vitest";
import { daysSince, formatCurrency, getDeadlineStatus } from "@/modules/crm/format";

describe("formatCurrency", () => {
  it("formata em Real com separador de milhar e duas casas decimais", () => {
    expect(formatCurrency("1234.5")).toContain("1.234,50");
  });

  it("nunca quebra com valor inválido — cai para zero", () => {
    expect(formatCurrency("not-a-number")).toContain("0,00");
  });
});

describe("daysSince", () => {
  it("calcula dias corridos completos", () => {
    const now = new Date("2026-07-13T12:00:00Z");
    const since = new Date("2026-07-10T08:00:00Z");
    expect(daysSince(since, now)).toBe(3);
  });

  it("nunca retorna negativo", () => {
    const now = new Date("2026-07-10T00:00:00Z");
    const since = new Date("2026-07-13T00:00:00Z");
    expect(daysSince(since, now)).toBe(0);
  });
});

describe("getDeadlineStatus — CRM-3 (indicador visual de atraso)", () => {
  const now = new Date("2026-07-13T12:00:00Z");

  it("sinaliza atraso (danger) quando o prazo já passou", () => {
    const status = getDeadlineStatus(new Date("2026-07-10T00:00:00Z"), "DESENVOLVIMENTO", now);
    expect(status.tone).toBe("danger");
    expect(status.label).toMatch(/atrasado/i);
  });

  it("sinaliza próximo do prazo (warning) dentro de 3 dias", () => {
    const status = getDeadlineStatus(new Date("2026-07-15T12:00:00Z"), "DESENVOLVIMENTO", now);
    expect(status.tone).toBe("warning");
  });

  it("sinaliza no prazo (success) quando falta bastante tempo", () => {
    const status = getDeadlineStatus(new Date("2026-08-01T00:00:00Z"), "DESENVOLVIMENTO", now);
    expect(status.tone).toBe("success");
  });

  it("sem prazo definido é neutro, não perigo", () => {
    const status = getDeadlineStatus(null, "DESENVOLVIMENTO", now);
    expect(status.tone).toBe("neutral");
  });

  it("card concluído nunca é marcado como atrasado, mesmo com prazo vencido", () => {
    const status = getDeadlineStatus(new Date("2026-01-01T00:00:00Z"), "CONCLUIDO", now);
    expect(status.tone).toBe("neutral");
  });

  it("todo indicador de prazo vem com um rótulo de texto, nunca só a cor", () => {
    const statuses = [
      getDeadlineStatus(new Date("2026-07-10T00:00:00Z"), "DESENVOLVIMENTO", now),
      getDeadlineStatus(new Date("2026-08-01T00:00:00Z"), "DESENVOLVIMENTO", now),
      getDeadlineStatus(null, "DESENVOLVIMENTO", now),
    ];
    for (const s of statuses) {
      expect(s.label.length).toBeGreaterThan(0);
    }
  });
});
