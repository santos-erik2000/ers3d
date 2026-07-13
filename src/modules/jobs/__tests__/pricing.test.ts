import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { CALC_RULE_VERSION, calculatePrice, type PricingResult } from "@/modules/jobs/services/pricing";

function expectOk(result: ReturnType<typeof calculatePrice>): asserts result is PricingResult {
  if (result.rejected) {
    throw new Error(`Esperava sucesso mas foi rejeitado: ${result.reason}`);
  }
}

const baseInput = {
  powerWatts: "150",
  printHours: "4",
  kwhPrice: "0.80",
  maintenancePct: "0.20",
  safetyPct: "0.10",
  profitPct: "0.30",
  filaments: [{ filamentId: "f1", pricePerKg: "120", gramsUsed: "250" }],
};

describe("calculatePrice — fórmula completa (CALC-2)", () => {
  it("calcula corretamente um job com um único filamento (exemplo verificado à mão)", () => {
    // pricePerKg=120, gramsUsed=250 => custo filamento = (120/1000)*250 = 30.00
    // powerWatts=150, printHours=4 => consumoKwh = (150/1000)*4 = 0.6
    // kwhPrice=0.80 => custo energia = 0.6*0.80 = 0.48
    // custo direto = 30.00 + 0.48 = 30.48
    // soma % = 0.20+0.10+0.30 = 0.60
    // preço final = 30.48 / (1-0.60) = 30.48/0.40 = 76.20
    // manutenção = 76.20*0.20 = 15.24 · segurança = 76.20*0.10 = 7.62 · lucro = 76.20*0.30 = 22.86
    const result = calculatePrice(baseInput);
    expectOk(result);

    expect(result.ruleVersion).toBe(CALC_RULE_VERSION);
    expect(result.filamentsCost.toString()).toBe("30");
    expect(result.energyCost.toString()).toBe("0.48");
    expect(result.directCost.toString()).toBe("30.48");
    expect(result.finalPrice.toString()).toBe("76.2");
    expect(result.maintenanceValue.toString()).toBe("15.24");
    expect(result.safetyValue.toString()).toBe("7.62");
    expect(result.profitValue.toString()).toBe("22.86");

    // consistência interna: custo direto + os três valores = preço final
    const rebuilt = result.directCost
      .plus(result.maintenanceValue)
      .plus(result.safetyValue)
      .plus(result.profitValue);
    expect(rebuilt.toString()).toBe(result.finalPrice.toString());
  });

  it("soma o custo de múltiplos filamentos corretamente", () => {
    const result = calculatePrice({
      ...baseInput,
      filaments: [
        { filamentId: "f1", pricePerKg: "100", gramsUsed: "200" }, // 20.00
        { filamentId: "f2", pricePerKg: "50", gramsUsed: "300" }, // 15.00
        { filamentId: "f3", pricePerKg: "80", gramsUsed: "125" }, // 10.00
      ],
    });
    expectOk(result);
    expect(result.filamentsCost.toString()).toBe("45");
    expect(result.filaments).toHaveLength(3);
    expect(result.filaments.map((f) => f.cost.toString())).toEqual(["20", "15", "10"]);
  });

  it("potência ou horas zero resulta em custo de energia zero, sem rejeitar", () => {
    const result = calculatePrice({ ...baseInput, powerWatts: "0", printHours: "0" });
    expectOk(result);
    expect(result.energyCost.toString()).toBe("0");
    expect(result.directCost.toString()).toBe(result.filamentsCost.toString());
  });
});

describe("calculatePrice — CALC-3 (caso crítico: soma de percentuais >= 100%)", () => {
  it("rejeita quando a soma é EXATAMENTE 100%", () => {
    const result = calculatePrice({
      ...baseInput,
      maintenancePct: "0.50",
      safetyPct: "0.30",
      profitPct: "0.20",
    });
    expect(result.rejected).toBe(true);
    if (result.rejected) {
      expect(result.reason).toMatch(/inferior a 100%/i);
      expect(result.reason).toMatch(/100/);
    }
  });

  it("rejeita quando a soma é maior que 100%", () => {
    const result = calculatePrice({
      ...baseInput,
      maintenancePct: "0.50",
      safetyPct: "0.40",
      profitPct: "0.30",
    });
    expect(result.rejected).toBe(true);
  });

  it("aceita quando a soma é 99,99% (limite inferior imediatamente abaixo de 100%)", () => {
    const result = calculatePrice({
      ...baseInput,
      maintenancePct: "0.4999",
      safetyPct: "0.3000",
      profitPct: "0.1999",
      // soma = 0.9998 — abaixo de 100%
    });
    expectOk(result);
    expect(result.finalPrice.greaterThan(0)).toBe(true);
  });

  it("aceita 99,99% construído para somar exatamente 0.9999", () => {
    const result = calculatePrice({
      ...baseInput,
      maintenancePct: "0.9999",
      safetyPct: "0",
      profitPct: "0",
    });
    expectOk(result);
  });

  it("rejeita soma passando de 1 por uma fração mínima (100,01%)", () => {
    const result = calculatePrice({
      ...baseInput,
      maintenancePct: "0.5001",
      safetyPct: "0.3000",
      profitPct: "0.2000",
    });
    expect(result.rejected).toBe(true);
  });

  it("não calcula preço final (nem mais nada) quando rejeitado — só retorna o motivo", () => {
    const result = calculatePrice({ ...baseInput, maintenancePct: "1", safetyPct: "0", profitPct: "0" });
    expect(result).toEqual({ rejected: true, reason: expect.stringMatching(/inferior a 100%/i) });
  });
});

describe("calculatePrice — validações de entrada", () => {
  it("rejeita quando nenhum filamento é informado", () => {
    const result = calculatePrice({ ...baseInput, filaments: [] });
    expect(result.rejected).toBe(true);
  });

  it("rejeita potência negativa", () => {
    expect(calculatePrice({ ...baseInput, powerWatts: "-1" }).rejected).toBe(true);
  });

  it("rejeita horas de impressão negativas", () => {
    expect(calculatePrice({ ...baseInput, printHours: "-1" }).rejected).toBe(true);
  });

  it("rejeita preço do kWh negativo", () => {
    expect(calculatePrice({ ...baseInput, kwhPrice: "-0.1" }).rejected).toBe(true);
  });

  it("rejeita percentuais negativos", () => {
    expect(calculatePrice({ ...baseInput, maintenancePct: "-0.1" }).rejected).toBe(true);
    expect(calculatePrice({ ...baseInput, safetyPct: "-0.1" }).rejected).toBe(true);
    expect(calculatePrice({ ...baseInput, profitPct: "-0.1" }).rejected).toBe(true);
  });

  it("rejeita preço por kg negativo de um filamento", () => {
    const result = calculatePrice({
      ...baseInput,
      filaments: [{ filamentId: "f1", pricePerKg: "-10", gramsUsed: "100" }],
    });
    expect(result.rejected).toBe(true);
  });

  it("rejeita gramas utilizadas zero ou negativas", () => {
    expect(
      calculatePrice({ ...baseInput, filaments: [{ filamentId: "f1", pricePerKg: "10", gramsUsed: "0" }] })
        .rejected,
    ).toBe(true);
    expect(
      calculatePrice({ ...baseInput, filaments: [{ filamentId: "f1", pricePerKg: "10", gramsUsed: "-5" }] })
        .rejected,
    ).toBe(true);
  });
});

describe("calculatePrice — arredondamento (ROUND_HALF_UP só no resultado final)", () => {
  it("arredonda 12.345 para 12.35 (half up, não banker's rounding)", () => {
    const result = calculatePrice({
      powerWatts: "0",
      printHours: "0",
      kwhPrice: "0",
      maintenancePct: "0",
      safetyPct: "0",
      profitPct: "0",
      filaments: [{ filamentId: "f1", pricePerKg: "1000", gramsUsed: "12.345" }],
    });
    expectOk(result);
    expect(result.filamentsCost.toString()).toBe("12.35");
    expect(result.directCost.toString()).toBe("12.35");
    expect(result.finalPrice.toString()).toBe("12.35");
    expect(result.filaments[0]?.cost.toString()).toBe("12.35");
  });

  it("não perde precisão ao somar várias parcelas antes de arredondar o total", () => {
    // Cada parcela isolada arredondaria para baixo, mas a soma exata deve
    // bater com o arredondamento do total, não com a soma dos arredondados.
    const result = calculatePrice({
      ...baseInput,
      filaments: [
        { filamentId: "f1", pricePerKg: "10", gramsUsed: "100.111" }, // 1.00111
        { filamentId: "f2", pricePerKg: "10", gramsUsed: "100.111" }, // 1.00111
        { filamentId: "f3", pricePerKg: "10", gramsUsed: "100.111" }, // 1.00111
      ],
    });
    expectOk(result);
    // soma exata = 3.00333 -> arredonda para 3.00
    expect(result.filamentsCost.toString()).toBe("3");
  });

  it("percentSum retornado não é arredondado (fração exata, não é dinheiro)", () => {
    const result = calculatePrice({ ...baseInput, maintenancePct: "0.1111", safetyPct: "0", profitPct: "0" });
    expectOk(result);
    expect(result.percentSum.toString()).toBe("0.1111");
  });
});

describe("calculatePrice — aceita Prisma.Decimal, string e number como entrada", () => {
  it("aceita instâncias de Prisma.Decimal diretamente", () => {
    const result = calculatePrice({
      ...baseInput,
      powerWatts: new Prisma.Decimal("150"),
      filaments: [{ filamentId: "f1", pricePerKg: new Prisma.Decimal("120"), gramsUsed: new Prisma.Decimal("250") }],
    });
    expectOk(result);
    expect(result.filamentsCost.toString()).toBe("30");
  });

  it("aceita number", () => {
    const result = calculatePrice({
      ...baseInput,
      filaments: [{ filamentId: "f1", pricePerKg: 120, gramsUsed: 250 }],
    });
    expectOk(result);
    expect(result.filamentsCost.toString()).toBe("30");
  });
});
