import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => {
  const user = {
    findUnique: vi.fn(),
    count: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
  };
  const prismaMock: Record<string, unknown> = { user };
  prismaMock.$transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb(prismaMock));
  return { prisma: prismaMock };
});
vi.mock("@/modules/audit/services/audit", () => ({ recordAudit: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { BusinessRuleError, blockUser } from "@/modules/auth/services/users";

const mockedUser = vi.mocked(prisma.user);

describe("blockUser — regra do último ROOT ativo", () => {
  beforeEach(() => {
    mockedUser.findUnique.mockReset();
    mockedUser.count.mockReset();
    mockedUser.findUniqueOrThrow.mockReset();
    mockedUser.update.mockReset();
  });

  it("rejeita o bloqueio quando o alvo é o único usuário ROOT ativo", async () => {
    mockedUser.findUnique.mockResolvedValue({
      id: "u1",
      userRoles: [{ role: { slug: "root" } }],
    } as never);
    mockedUser.count.mockResolvedValue(0);

    await expect(blockUser("u1", "actor1")).rejects.toBeInstanceOf(BusinessRuleError);
    expect(mockedUser.update).not.toHaveBeenCalled();
  });

  it("permite bloquear um ROOT quando existe outro ROOT ativo", async () => {
    mockedUser.findUnique.mockResolvedValue({
      id: "u1",
      userRoles: [{ role: { slug: "root" } }],
    } as never);
    mockedUser.count.mockResolvedValue(1);
    mockedUser.findUniqueOrThrow.mockResolvedValue({ id: "u1", status: "ACTIVE" } as never);
    mockedUser.update.mockResolvedValue({ id: "u1", status: "BLOCKED" } as never);

    await expect(blockUser("u1", "actor1")).resolves.toBeUndefined();
    expect(mockedUser.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { status: "BLOCKED" },
    });
  });

  it("permite bloquear um usuário que não é ROOT sem checar contagem", async () => {
    mockedUser.findUnique.mockResolvedValue({
      id: "u2",
      userRoles: [{ role: { slug: "admin" } }],
    } as never);
    mockedUser.findUniqueOrThrow.mockResolvedValue({ id: "u2", status: "ACTIVE" } as never);
    mockedUser.update.mockResolvedValue({ id: "u2", status: "BLOCKED" } as never);

    await expect(blockUser("u2", "actor1")).resolves.toBeUndefined();
    expect(mockedUser.count).not.toHaveBeenCalled();
  });
});
