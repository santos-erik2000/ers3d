import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => {
  const customer = {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  const company = {
    findFirst: vi.fn(),
    create: vi.fn(),
  };
  const prismaMock: Record<string, unknown> = { customer, company };
  prismaMock.$transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb(prismaMock));
  return { prisma: prismaMock };
});
vi.mock("@/modules/audit/services/audit", () => ({ recordAudit: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/modules/audit/services/audit";
import {
  createCustomer,
  findDuplicateCustomers,
  isValidCnpj,
  isValidCpf,
} from "@/modules/customers/services/customers";

const mockedCustomer = vi.mocked(prisma.customer);
const mockedCompany = vi.mocked(prisma.company);

describe("validação de CPF/CNPJ", () => {
  it("aceita CPF válido (formatado ou não)", () => {
    expect(isValidCpf("111.444.777-35")).toBe(true);
    expect(isValidCpf("11144477735")).toBe(true);
  });

  it("rejeita CPF inválido", () => {
    expect(isValidCpf("123.456.789-00")).toBe(false);
    expect(isValidCpf("111.111.111-11")).toBe(false);
  });

  it("aceita CNPJ válido (formatado ou não)", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11222333000181")).toBe(true);
  });

  it("rejeita CNPJ inválido", () => {
    expect(isValidCnpj("11.222.333/0001-00")).toBe(false);
  });
});

describe("findDuplicateCustomers — CUST-2", () => {
  beforeEach(() => {
    mockedCustomer.findMany.mockReset();
  });

  it("detecta duplicidade por e-mail (normalizado)", async () => {
    mockedCustomer.findMany.mockResolvedValue([
      { id: "c1", name: "Maria Silva", email: "maria@ex.com", phone: null, document: null },
    ] as never);

    const duplicates = await findDuplicateCustomers({ email: "  MARIA@EX.COM  " });

    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]).toMatchObject({ id: "c1", matchedFields: ["email"] });
  });

  it("detecta duplicidade por CPF/CNPJ (removendo formatação antes de comparar)", async () => {
    mockedCustomer.findMany.mockResolvedValue([
      { id: "c2", name: "João Souza", email: null, phone: null, document: "11144477735" },
    ] as never);

    const duplicates = await findDuplicateCustomers({ document: "111.444.777-35" });

    expect(mockedCustomer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ OR: [{ document: "11144477735" }] }),
      }),
    );
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]).toMatchObject({ id: "c2", matchedFields: ["document"] });
  });

  it("não encontra duplicidade quando não há coincidência", async () => {
    mockedCustomer.findMany.mockResolvedValue([]);

    const duplicates = await findDuplicateCustomers({
      email: "novo@ex.com",
      phone: "11999998888",
      document: "11144477735",
    });

    expect(duplicates).toHaveLength(0);
  });

  it("não consulta o banco quando nenhum campo de checagem foi informado", async () => {
    const duplicates = await findDuplicateCustomers({});
    expect(duplicates).toHaveLength(0);
    expect(mockedCustomer.findMany).not.toHaveBeenCalled();
  });
});

describe("createCustomer — fluxo de duplicidade", () => {
  beforeEach(() => {
    mockedCustomer.findMany.mockReset();
    mockedCustomer.create.mockReset();
    mockedCompany.findFirst.mockReset();
    mockedCompany.create.mockReset();
    vi.mocked(recordAudit).mockReset();
  });

  it("retorna status 'duplicate' e não cria o cliente quando há coincidência", async () => {
    mockedCustomer.findMany.mockResolvedValue([
      { id: "c1", name: "Maria Silva", email: "maria@ex.com", phone: null, document: null },
    ] as never);

    const result = await createCustomer(
      { name: "Maria S.", type: "PF", email: "maria@ex.com" },
      "actor1",
    );

    expect(result.status).toBe("duplicate");
    expect(mockedCustomer.create).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("cria o cliente e registra auditoria quando não há duplicidade", async () => {
    mockedCustomer.findMany.mockResolvedValue([]);
    mockedCustomer.create.mockResolvedValue({ id: "new1", name: "Nova Cliente" } as never);

    const result = await createCustomer(
      { name: "Nova Cliente", type: "PF", email: "nova@ex.com" },
      "actor1",
    );

    expect(result.status).toBe("created");
    expect(mockedCustomer.create).toHaveBeenCalledTimes(1);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "customer", action: "customer.create", userId: "actor1" }),
      expect.anything(),
    );
  });

  it("cria mesmo com duplicidade quando o usuário confirma explicitamente", async () => {
    mockedCustomer.create.mockResolvedValue({ id: "new2", name: "Confirmado" } as never);

    const result = await createCustomer(
      { name: "Confirmado", type: "PF", email: "maria@ex.com", confirmedDuplicate: true },
      "actor1",
    );

    expect(result.status).toBe("created");
    // Não deve nem consultar duplicidade quando já confirmado.
    expect(mockedCustomer.findMany).not.toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "Cadastro confirmado pelo usuário apesar de possível duplicidade.",
      }),
      expect.anything(),
    );
  });
});
